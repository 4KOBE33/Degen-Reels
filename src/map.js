// Lost Vegas: the raid map. A big desert town with the Grand Casino in the middle.
//
// Static scenery is collected into `statics` and merged per 60m chunk by `bake()`, so a huge map
// still costs only a few hundred draw calls (and far chunks get frustum-culled).
// Colliders live in a spatial grid so physics and bullets only check nearby ones.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MAP } from './config.js';
import { part, toon, canvasTexture, INK } from './toon.js';

const CELL = 20;
const CHUNK = 60;
const proxyMat = new THREE.MeshBasicMaterial();

export function neonSign(text, color, width = 18) {
  const tex = canvasTexture(1024, 200, (c, w, h) => {
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = "120px 'Luckiest Guy', 'Arial Black', sans-serif";
    c.shadowColor = color;
    c.shadowBlur = 40;
    c.lineWidth = 10;
    c.strokeStyle = color;
    c.strokeText(text, w / 2, h / 2 + 8, w - 40);
    c.shadowBlur = 10;
    c.fillStyle = '#fff6e0';
    c.fillText(text, w / 2, h / 2 + 8, w - 40);
  });
  return new THREE.Mesh(
    new THREE.PlaneGeometry(width, width * 0.195),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
  );
}

function boardTexture(text, bg, fg) {
  return canvasTexture(512, 256, (c, w, h) => {
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    c.strokeStyle = fg;
    c.lineWidth = 12;
    c.strokeRect(10, 10, w - 20, h - 20);
    c.fillStyle = fg;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = "56px 'Luckiest Guy', 'Arial Black', sans-serif";
    const lines = text.split('\n');
    lines.forEach((line, i) => c.fillText(line, w / 2, h / 2 + (i - (lines.length - 1) / 2) * 64, w - 50));
  });
}

function sandTexture() {
  const tex = canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#e8b878';
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      c.fillStyle = Math.random() < 0.5 ? 'rgba(170,110,60,0.18)' : 'rgba(255,230,180,0.25)';
      const x = Math.random() * w;
      const y = Math.random() * h;
      c.beginPath();
      c.ellipse(x, y, 2 + Math.random() * 10, 1 + Math.random() * 3, 0, 0, Math.PI * 2);
      c.fill();
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(40, 40);
  return tex;
}

function carpetTexture() {
  const tex = canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#8e1b2c';
    c.fillRect(0, 0, w, h);
    const diamond = (x, y, r, color) => {
      c.fillStyle = color;
      c.beginPath();
      c.moveTo(x, y - r);
      c.lineTo(x + r, y);
      c.lineTo(x, y + r);
      c.lineTo(x - r, y);
      c.closePath();
      c.fill();
    };
    for (const [x, y] of [[0, 0], [256, 0], [0, 256], [256, 256], [128, 128]]) {
      diamond(x, y, 70, '#a8263a');
      diamond(x, y, 22, '#d4a63a');
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(25, 18);
  return tex;
}

// Sky dome: purple overhead fading to a sunset orange at the horizon.
function skyDome() {
  const geo = new THREE.SphereGeometry(400, 24, 12);
  const colors = [];
  const top = new THREE.Color(0x2a1650);
  const mid = new THREE.Color(0xb3477a);
  const low = new THREE.Color(0xf6a35c);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 400;
    const c = y > 0.25 ? mid.clone().lerp(top, Math.min(1, (y - 0.25) / 0.6)) : low.clone().lerp(mid, Math.max(0, y / 0.25));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
}

export function buildMap(scene) {
  const H = MAP.half;
  const statics = new THREE.Group();
  const grid = new Map();
  const solids = [];
  const zones = [];
  const minimap = [];
  const containers = [];
  const slotSpots = [];
  const enemySpots = [];
  const animated = [];
  const extraProxies = [];

  scene.background = new THREE.Color(0xb3477a);
  scene.fog = new THREE.Fog(0xd77a6a, 80, 230);
  scene.add(skyDome());

  // ---------- collision grid ----------

  const cellKey = (cx, cz) => `${cx},${cz}`;
  function insert(entry, minX, maxX, minZ, maxZ) {
    for (let cx = Math.floor((minX - 1) / CELL); cx <= Math.floor((maxX + 1) / CELL); cx++) {
      for (let cz = Math.floor((minZ - 1) / CELL); cz <= Math.floor((maxZ + 1) / CELL); cz++) {
        const k = cellKey(cx, cz);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(entry);
      }
    }
  }
  function boundsOf(c) {
    return c.type === 'box' ? [c.minX, c.maxX, c.minZ, c.maxZ] : [c.x - c.r, c.x + c.r, c.z - c.r, c.z + c.r];
  }
  function proxyFor(c, bottom = 0) {
    const h = c.top - bottom;
    const mesh = c.type === 'box'
      ? new THREE.Mesh(new THREE.BoxGeometry(c.maxX - c.minX, h, c.maxZ - c.minZ), proxyMat)
      : new THREE.Mesh(new THREE.CylinderGeometry(c.r, c.r, h, 10), proxyMat);
    if (c.type === 'box') mesh.position.set((c.minX + c.maxX) / 2, bottom + h / 2, (c.minZ + c.maxZ) / 2);
    else mesh.position.set(c.x, bottom + h / 2, c.z);
    mesh.updateMatrixWorld(true);
    return mesh;
  }
  // A solid thing: blocks movement and bullets.
  function addCollider(c) {
    c.proxy = proxyFor(c);
    insert(c, ...boundsOf(c));
    return c;
  }
  // Something bullets and the camera hit but you don't walk into (roofs).
  function addRayBlocker(minX, maxX, minZ, maxZ, bottom, top) {
    const c = { type: 'box', minX, maxX, minZ, maxZ, top, rayOnly: true };
    c.proxy = proxyFor(c, bottom);
    insert(c, minX, maxX, minZ, maxZ);
  }
  const box = (x, z, w, d, top) => addCollider({ type: 'box', minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top });
  const circle = (x, z, r, top) => addCollider({ type: 'circle', x, z, r, top });

  // ---------- ground ----------

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(H * 2 + 400, H * 2 + 400), toon(0xffffff, { map: sandTexture() }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const groundProxy = new THREE.Mesh(new THREE.BoxGeometry(H * 4, 0.2, H * 4), proxyMat);
  groundProxy.position.y = -0.1;
  groundProxy.updateMatrixWorld(true);
  solids.push(groundProxy);

  const asphalt = toon(0x3b3548);
  const flat = (x, z, w, d, mat, y = 0.02) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    statics.add(m);
    return m;
  };

  // ---------- the strip ----------

  // Main road south from the casino, and a cross street.
  flat(0, 80, 16, 200, asphalt);
  flat(0, 40, H * 2, 14, asphalt, 0.025);
  minimap.push({ x: 0, z: 80, w: 16, d: 200, color: '#3b3548' }, { x: 0, z: 40, w: H * 2, d: 14, color: '#3b3548' });
  const dash = toon(0xffd23f);
  for (let z = -15; z < 175; z += 8) if (Math.abs(z - 40) > 9) flat(0, z, 0.4, 3.5, dash, 0.035);
  for (let x = -170; x < 175; x += 8) if (Math.abs(x) > 10) flat(x, 40, 3.5, 0.4, dash, 0.035);
  // Parking lot behind the casino.
  flat(0, -125, 70, 40, asphalt);
  minimap.push({ x: 0, z: -125, w: 70, d: 40, color: '#3b3548' });
  for (let x = -30; x <= 30; x += 6) flat(x, -125, 0.3, 6, toon(0xffffff), 0.035);

  // ---------- props ----------

  const CAR_COLORS = [0xe63946, 0x4dabff, 0xffd23f, 0x5ee27a, 0xc77dff, 0xff9f43, 0xf1f5f9, 0x2b2140];
  function car(x, z, along = 'x', color = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)], wrecked = false) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    if (along === 'z') g.rotation.y = Math.PI / 2;
    const body = part(new THREE.BoxGeometry(4.2, 1.0, 2.0), wrecked ? 0x7c5a45 : color);
    body.position.y = 0.75;
    const cabin = part(new THREE.BoxGeometry(2.2, 0.8, 1.8), wrecked ? 0x5b4636 : 0x9fd8ff);
    cabin.position.set(-0.2, 1.6, 0);
    g.add(body, cabin);
    for (const [wx, wz] of [[1.3, 1], [-1.3, 1], [1.3, -1], [-1.3, -1]]) {
      const wheel = part(new THREE.CylinderGeometry(0.4, 0.4, 0.3, 10), 0x1b0f2b, { ink: 0.02 });
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, 0.4, wz);
      g.add(wheel);
    }
    if (wrecked) g.rotation.z = (Math.random() - 0.5) * 0.3;
    statics.add(g);
    if (along === 'x') box(x, z, 4.3, 2.1, 2.0); else box(x, z, 2.1, 4.3, 2.0);
  }

  function palm(x, z) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const lean = (Math.random() - 0.5) * 0.3;
    for (let i = 0; i < 4; i++) {
      const seg = part(new THREE.CylinderGeometry(0.22, 0.28, 1.6, 8), 0x8b5a2b, { ink: 0.025 });
      seg.position.set(lean * i * 1.5, 0.8 + i * 1.5, 0);
      g.add(seg);
    }
    for (let i = 0; i < 6; i++) {
      const leaf = part(new THREE.ConeGeometry(0.5, 3, 4), 0x2f9e44, { ink: 0.03 });
      const a = (i / 6) * Math.PI * 2;
      leaf.position.set(lean * 6 + Math.cos(a) * 1.3, 6.2, Math.sin(a) * 1.3);
      leaf.rotation.set(Math.sin(a) * 1.2, 0, -Math.cos(a) * 1.2);
      g.add(leaf);
    }
    statics.add(g);
    circle(x, z, 0.35, 8);
  }

  function cactus(x, z) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const s = 0.8 + Math.random() * 0.7;
    g.scale.setScalar(s);
    const trunk = part(new THREE.CapsuleGeometry(0.35, 2.2, 4, 10), 0x40916c, { ink: 0.035 });
    trunk.position.y = 1.4;
    g.add(trunk);
    for (const side of [-1, 1]) {
      if (Math.random() < 0.3) continue;
      const arm = part(new THREE.CapsuleGeometry(0.22, 0.8, 4, 8), 0x40916c, { ink: 0.03 });
      arm.position.set(side * 0.6, 1.6 + Math.random() * 0.6, 0);
      g.add(arm);
    }
    g.rotation.y = Math.random() * Math.PI;
    statics.add(g);
    circle(x, z, 0.4 * s, 3 * s);
  }

  function rock(x, z, s) {
    const m = part(new THREE.DodecahedronGeometry(s, 0), 0xb08968, { ink: 0.05 });
    m.position.set(x, s * 0.35, z);
    m.scale.y = 0.6;
    m.rotation.y = Math.random() * Math.PI;
    statics.add(m);
    circle(x, z, s * 0.9, s * 0.9);
  }

  function streetLight(x, z) {
    const pole = part(new THREE.CylinderGeometry(0.12, 0.15, 6, 8), 0x2b2140, { ink: 0.02 });
    pole.position.set(x, 3, z);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff7eb6 }));
    bulb.position.set(x, 6.1, z);
    statics.add(pole, bulb);
    circle(x, z, 0.2, 6);
  }

  function billboard(x, z, rotY, text, bg = '#1b0f2b', fg = '#ffd23f') {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    for (const dx of [-3, 3]) {
      const leg = part(new THREE.BoxGeometry(0.4, 6, 0.4), 0x4b5563, { ink: 0.02 });
      leg.position.set(dx, 3, 0);
      g.add(leg);
    }
    const board = new THREE.Mesh(new THREE.BoxGeometry(10, 5, 0.3), [
      toon(0x1b0f2b), toon(0x1b0f2b), toon(0x1b0f2b), toon(0x1b0f2b),
      new THREE.MeshBasicMaterial({ map: boardTexture(text, bg, fg) }), new THREE.MeshBasicMaterial({ map: boardTexture(text, bg, fg) }),
    ]);
    board.position.y = 8;
    g.add(board);
    statics.add(g);
    const dx = Math.cos(rotY) * 3;
    const dz = -Math.sin(rotY) * 3;
    circle(x + dx, z + dz, 0.3, 6);
    circle(x - dx, z - dz, 0.3, 6);
  }

  function crateStack(x, z) {
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const s = 1.2 + Math.random() * 0.4;
      const ox = (Math.random() - 0.5) * 2.5;
      const oz = (Math.random() - 0.5) * 2.5;
      const crate = part(new THREE.BoxGeometry(s, s, s), 0xb7791f);
      crate.position.set(x + ox, s / 2, z + oz);
      statics.add(crate);
      box(x + ox, z + oz, s, s, s);
    }
  }

  // ---------- buildings ----------

  // Walls with door gaps, a floor and a roof. doors: [{ side: 'n'|'s'|'e'|'w', at, width }]
  function building({ name, x, z, w, d, h = 5, color = 0xe9d8a6, trim = 0x2b2140, floor = 0x9c6b4a, floorMap = null, doors = [], tier = 2, sign = null, signColor = '#ff3fa4', roof = true, mapColor = '#6b4f3a' }) {
    const T = 0.5;
    const wallMat = toon(color);
    const trimMat = toon(trim);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMap ? toon(0xffffff, { map: floorMap }) : toon(floor));
    fl.rotation.x = -Math.PI / 2;
    fl.position.set(x, 0.05, z);
    fl.receiveShadow = true;
    statics.add(fl);

    const sides = {
      n: { len: w, cx: x, cz: z - d / 2, horiz: true },
      s: { len: w, cx: x, cz: z + d / 2, horiz: true },
      w: { len: d, cx: x - w / 2, cz: z, horiz: false },
      e: { len: d, cx: x + w / 2, cz: z, horiz: false },
    };
    for (const [key, s] of Object.entries(sides)) {
      const gaps = doors.filter((dr) => dr.side === key).map((dr) => [dr.at - dr.width / 2, dr.at + dr.width / 2]).sort((a, b) => a[0] - b[0]);
      let cursor = -s.len / 2 - T / 2;
      const segs = [];
      for (const [a, b] of gaps) {
        if (a > cursor) segs.push([cursor, a]);
        cursor = b;
      }
      if (cursor < s.len / 2 + T / 2) segs.push([cursor, s.len / 2 + T / 2]);
      for (const [a, b] of segs) {
        const len = b - a;
        const mid = (a + b) / 2;
        const wx = s.horiz ? s.cx + mid : s.cx;
        const wz = s.horiz ? s.cz : s.cz + mid;
        const ww = s.horiz ? len : T;
        const wd = s.horiz ? T : len;
        const wall = part(new THREE.BoxGeometry(ww, h, wd), wallMat, { ink: 0.04 });
        wall.position.set(wx, h / 2, wz);
        statics.add(wall);
        const base = part(new THREE.BoxGeometry(ww + 0.06, 0.9, wd + 0.06), trimMat, { ink: 0 });
        base.position.set(wx, 0.45, wz);
        statics.add(base);
        box(wx, wz, ww, wd, h);
      }
      // Lintels over doors.
      for (const [a, b] of gaps) {
        const len = b - a;
        const mid = (a + b) / 2;
        const lintel = part(new THREE.BoxGeometry(s.horiz ? len : T, h - 3.4, s.horiz ? T : len), wallMat, { ink: 0.04 });
        lintel.position.set(s.horiz ? s.cx + mid : s.cx, 3.4 + (h - 3.4) / 2, s.horiz ? s.cz : s.cz + mid);
        statics.add(lintel);
      }
    }
    if (roof) {
      const top = part(new THREE.BoxGeometry(w + 1, 0.4, d + 1), trimMat, { ink: 0.05 });
      top.castShadow = false;
      top.position.set(x, h + 0.2, z);
      statics.add(top);
      addRayBlocker(x - w / 2, x + w / 2, z - d / 2, z + d / 2, h, h + 0.4);
    }
    if (sign) {
      const front = doors[0] ? doors[0].side : 's';
      const sg = neonSign(sign, signColor, Math.min(w * 0.9, 16));
      const off = 0.4;
      if (front === 's') sg.position.set(x + (doors[0] ? doors[0].at : 0) * 0, h + 1.6, z + d / 2 + off);
      if (front === 'n') { sg.position.set(x, h + 1.6, z - d / 2 - off); sg.rotation.y = Math.PI; }
      if (front === 'e') { sg.position.set(x + w / 2 + off, h + 1.6, z); sg.rotation.y = Math.PI / 2; }
      if (front === 'w') { sg.position.set(x - w / 2 - off, h + 1.6, z); sg.rotation.y = -Math.PI / 2; }
      statics.add(sg);
    }
    zones.push({ name, x, z, w, d, tier });
    minimap.push({ x, z, w, d, color: mapColor, label: name });
  }

  const container = (kind, x, z, tier, rot = 0) => containers.push({ kind, x, z, tier, rot });
  const enemies = (type, x, z, n = 1, spread = 6) => {
    for (let i = 0; i < n; i++) enemySpots.push({ type, x: x + (Math.random() - 0.5) * spread, z: z + (Math.random() - 0.5) * spread });
  };

  // ----- The Grand Casino -----
  const CX = 0;
  const CZ = -55;
  const CW = 100;
  const CD = 70;
  building({
    name: 'Lucky Dump Grand Casino', x: CX, z: CZ, w: CW, d: CD, h: 10, color: 0x6a2c91, trim: 0x2b1640,
    floorMap: carpetTexture(), tier: 3, mapColor: '#6a2c91',
    doors: [{ side: 's', at: 0, width: 12 }, { side: 'w', at: 10, width: 5 }, { side: 'e', at: 10, width: 5 }, { side: 'n', at: 30, width: 4 }],
  });
  {
    const sign = neonSign('LUCKY DUMP GRAND', '#ff3fa4', 40);
    sign.position.set(0, 13.5, CZ + CD / 2 + 0.6);
    statics.add(sign);
    // Gold columns flanking the entrance.
    for (const dx of [-9, 9]) {
      const col = part(new THREE.CylinderGeometry(0.9, 0.9, 10, 16), 0xd4a63a);
      col.position.set(dx, 5, CZ + CD / 2 + 2);
      statics.add(col);
      circle(dx, CZ + CD / 2 + 2, 0.9, 10);
    }
    // Vault room at the back, behind a locked door.
    const vz = CZ - CD / 2 + 9;
    const vaultWall = toon(0x374151);
    for (const [x0, x1] of [[-14, -2.5], [2.5, 14]]) {
      const len = x1 - x0;
      const wall = part(new THREE.BoxGeometry(len, 10, 0.8), vaultWall, { ink: 0.04 });
      wall.position.set((x0 + x1) / 2, 5, vz + 9);
      statics.add(wall);
      box((x0 + x1) / 2, vz + 9, len, 0.8, 10);
    }
    for (const sx of [-14, 14]) {
      const wall = part(new THREE.BoxGeometry(0.8, 10, 18), vaultWall, { ink: 0.04 });
      wall.position.set(sx, 5, vz);
      statics.add(wall);
      box(sx, vz, 0.8, 18, 10);
    }
    zones.push({ name: 'The Vault', x: 0, z: vz, w: 28, d: 18, tier: 4 });
    minimap.push({ x: 0, z: vz, w: 28, d: 18, color: '#374151', label: 'Vault' });
    for (const vx of [-10, -5, 5, 10]) container('vault', vx, vz - 5, 4);
    container('vault', 0, vz - 5, 4);

    // Slot machine rows along the side walls (decorative) and a few working loot slots.
    const slotColors = [0x2a9d8f, 0xe63946, 0x7b2cbf];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 9; i++) {
        const sx = side * (CW / 2 - 2.5);
        const sz = CZ - 31 + i * 4.2;
        if (i % 3 === 1) {
          slotSpots.push({ x: sx, z: sz, rot: side > 0 ? -Math.PI / 2 : Math.PI / 2, tier: 3 });
          continue;
        }
        const g = new THREE.Group();
        g.position.set(sx, 0, sz);
        g.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        const bodyM = part(new THREE.BoxGeometry(1.6, 2.2, 1.2), slotColors[i % 3]);
        bodyM.position.y = 1.1;
        const topM = part(new THREE.BoxGeometry(1.8, 0.6, 1.3), 0x1b0f2b);
        topM.position.y = 2.5;
        const screen = part(new THREE.BoxGeometry(1.2, 0.6, 0.05), 0xfff6e0, { ink: 0.02 });
        screen.position.set(0, 1.6, 0.62);
        g.add(bodyM, topM, screen);
        statics.add(g);
        box(sx, sz, 1.4, 1.8, 2.8);
      }
    }
    // Card tables and a roulette wheel in the main hall (cover for the boss fight).
    const tableTop = toon(0x1f8a4c);
    for (const [tx, tz] of [[-24, -45], [24, -45], [-24, -28], [24, -28], [-12, -36], [12, -36]]) {
      const base = part(new THREE.CylinderGeometry(0.8, 1.1, 0.9, 14), 0x2b2140);
      base.position.set(tx, 0.45, tz);
      const rim = part(new THREE.CylinderGeometry(2.4, 2.4, 0.22, 28), 0x6b3a1e);
      rim.position.set(tx, 1, tz);
      const felt = part(new THREE.CylinderGeometry(2.2, 2.2, 0.06, 28), tableTop, { ink: 0 });
      felt.position.set(tx, 1.12, tz);
      statics.add(base, rim, felt);
      circle(tx, tz, 2.4, 1.15);
    }
    // Cashier cage with registers.
    const cage = part(new THREE.BoxGeometry(14, 1.3, 2), 0x24103d);
    cage.position.set(-30, 0.65, CZ - 20);
    statics.add(cage);
    box(-30, CZ - 20, 14, 2, 1.3);
    for (const rx of [-35, -30, -25]) container('register', rx, CZ - 18.4, 3);
    // Bar.
    const bar = part(new THREE.BoxGeometry(14, 1.25, 2), 0x6b3a1e);
    bar.position.set(30, 0.62, CZ - 20);
    statics.add(bar);
    box(30, CZ - 20, 14, 2, 1.3);
    container('register', 30, CZ - 18.4, 3);
    // Back hallway lockers.
    for (const lx of [-40, -36, 36, 40]) container('locker', lx, CZ - CD / 2 + 1.5, 3);
    for (const [kx, kz] of [[-18, -62], [18, -62], [-40, -40], [40, -40], [-20, -25], [20, -25]]) container('crate', kx, kz, 3);
    // Chandeliers.
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff1b8 });
    for (const [lx, lz] of [[-20, -40], [20, -40], [0, -30], [-20, -60], [20, -60]]) {
      const ring = part(new THREE.TorusGeometry(1.6, 0.1, 8, 24), 0xd4a63a, { ink: 0.02, shadow: false });
      ring.rotation.x = Math.PI / 2;
      ring.position.set(lx, 8, lz);
      statics.add(ring);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), bulbMat);
        bulb.position.set(lx + Math.cos(a) * 1.6, 8.15, lz + Math.sin(a) * 1.6);
        statics.add(bulb);
      }
    }
    enemies('slotbot', -20, -40, 2, 10);
    enemies('slotbot', 20, -40, 2, 10);
    enemies('shark', 0, -30, 2, 14);
    enemies('shark', -30, -60, 1);
    enemies('shark', 30, -60, 1);
    enemies('dicer', 0, -50, 2, 20);
    // Plaza out front.
    const fountain = part(new THREE.CylinderGeometry(5, 5.4, 1, 28), 0xe9d8a6);
    fountain.position.set(0, 0.5, -5);
    const water = new THREE.Mesh(new THREE.CircleGeometry(4.6, 28), new THREE.MeshBasicMaterial({ color: 0x4dabff }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, 1.02, -5);
    const spout = part(new THREE.CylinderGeometry(0.4, 0.8, 3, 12), 0xd4a63a);
    spout.position.set(0, 2, -5);
    statics.add(fountain, water, spout);
    circle(0, -5, 5.4, 1.0);
    for (const [px, pz] of [[-14, -8], [14, -8], [-22, 5], [22, 5]]) palm(px, pz);
    enemies('dicer', 0, -2, 2, 16);
  }

  // ----- Snake Eyes Motel (west) -----
  {
    const mx = -75;
    const mz = 12;
    building({
      name: 'Snake Eyes Motel', x: mx, z: mz, w: 44, d: 12, h: 4.5, color: 0xf4a261, trim: 0x264653, tier: 2, sign: 'SNAKE EYES MOTEL', signColor: '#2ee6d6', mapColor: '#9a5b33',
      doors: [-18, -11, -4, 3, 10, 17].map((at) => ({ side: 's', at, width: 2.2 })),
    });
    // Room dividers.
    for (const dx of [-14.5, -7.5, -0.5, 6.5, 13.5]) {
      const wall = part(new THREE.BoxGeometry(0.4, 4.5, 11.5), toon(0xf4a261), { ink: 0.03 });
      wall.position.set(mx + dx, 2.25, mz);
      statics.add(wall);
      box(mx + dx, mz, 0.4, 11.5, 4.5);
    }
    [-18, -11, -4, 3, 10, 17].forEach((at, i) => container(i % 2 ? 'locker' : 'crate', mx + at, mz - 4.2, 2));
    for (let i = 0; i < 5; i++) car(mx - 18 + i * 9, mz + 13, 'z');
    enemies('shark', mx, mz + 9, 2, 20);
    enemies('dicer', mx, mz + 18, 1);
  }

  // ----- Lucky Pawn -----
  building({
    name: 'Lucky Pawn', x: -40, z: 78, w: 16, d: 12, h: 4.5, color: 0x90be6d, trim: 0x283618, tier: 2, sign: 'LUCKY PAWN', signColor: '#ffd23f', mapColor: '#5b7f3a',
    doors: [{ side: 'e', at: 0, width: 3 }],
  });
  container('safe', -45, 74, 2);
  container('register', -36, 82, 2);
  container('locker', -45, 82, 2);
  enemies('slotbot', -30, 78, 1);

  // ----- Little Chapel of Bad Decisions -----
  building({
    name: 'Chapel of Bad Decisions', x: -110, z: -70, w: 14, d: 20, h: 6, color: 0xf8f9fa, trim: 0x6d597a, tier: 1, sign: 'LITTLE CHAPEL', signColor: '#ff7eb6', mapColor: '#9c89b8',
    doors: [{ side: 's', at: 0, width: 3 }],
  });
  {
    const steeple = part(new THREE.ConeGeometry(2.5, 6, 4), 0x6d597a);
    steeple.position.set(-110, 9.3, -74);
    steeple.rotation.y = Math.PI / 4;
    statics.add(steeple);
  }
  container('crate', -113, -76, 1);
  container('locker', -107, -76, 1);
  enemies('dicer', -110, -50, 2, 14);

  // ----- Gas & Go Broke (east) -----
  building({
    name: 'Gas & Go Broke', x: 78, z: 15, w: 18, d: 12, h: 4.5, color: 0xffffff, trim: 0xe63946, tier: 2, sign: 'GAS & GO BROKE', signColor: '#ff5d5d', mapColor: '#b23a48',
    doors: [{ side: 'w', at: 0, width: 3 }],
  });
  {
    const canopy = part(new THREE.BoxGeometry(18, 0.6, 12), 0xe63946);
    canopy.castShadow = true;
    canopy.position.set(52, 5.5, 15);
    statics.add(canopy);
    for (const [px, pz] of [[45, 11], [59, 11], [45, 19], [59, 19]]) {
      const pillar = part(new THREE.BoxGeometry(0.5, 5.5, 0.5), 0xffffff, { ink: 0.02 });
      pillar.position.set(px, 2.75, pz);
      statics.add(pillar);
      box(px, pz, 0.5, 0.5, 5.5);
    }
    for (const px of [49, 55]) {
      const pump = part(new THREE.BoxGeometry(1, 1.8, 0.7), 0xffd23f);
      pump.position.set(px, 0.9, 15);
      statics.add(pump);
      box(px, 15, 1, 0.7, 1.8);
    }
    minimap.push({ x: 52, z: 15, w: 18, d: 12, color: '#7a2832' });
  }
  container('register', 80, 12, 2);
  container('locker', 84, 19, 2);
  container('crate', 74, 19, 2);
  slotSpots.push({ x: 84, z: 11, rot: -Math.PI / 2, tier: 2 });
  enemies('slotbot', 52, 22, 1);
  enemies('dicer', 60, 5, 2, 10);

  // ----- Double Down Diner -----
  building({
    name: 'Double Down Diner', x: 50, z: 92, w: 20, d: 12, h: 4.5, color: 0x8ecae6, trim: 0x023047, tier: 2, sign: 'DOUBLE DOWN DINER', signColor: '#ff9f43', mapColor: '#3a7ca5',
    doors: [{ side: 'w', at: 0, width: 3 }],
  });
  container('register', 53, 88, 2);
  container('locker', 58, 96, 2);
  slotSpots.push({ x: 58, z: 88, rot: -Math.PI / 2, tier: 2 });
  enemies('shark', 38, 92, 1);
  enemies('dicer', 50, 108, 1);

  // ----- Warehouses (east) -----
  building({
    name: 'Chip Warehouse', x: 118, z: -58, w: 30, d: 20, h: 7, color: 0x8d99ae, trim: 0x2b2d42, tier: 2, mapColor: '#5c677d',
    doors: [{ side: 'w', at: 0, width: 6 }, { side: 'e', at: 4, width: 3 }],
  });
  for (const [kx, kz] of [[110, -64], [124, -64], [118, -52], [128, -52]]) container('crate', kx, kz, 2);
  container('safe', 130, -64, 2);
  crateStack(112, -52);
  crateStack(124, -58);
  enemies('slotbot', 118, -58, 2, 12);
  building({
    name: 'Dice Storage', x: 120, z: -105, w: 26, d: 18, h: 7, color: 0xadb5bd, trim: 0x343a40, tier: 2, mapColor: '#5c677d',
    doors: [{ side: 'n', at: 0, width: 5 }],
  });
  container('crate', 114, -100, 2);
  container('locker', 128, -100, 2);
  crateStack(120, -108);
  enemies('shark', 120, -112, 1);
  enemies('dicer', 120, -85, 1);

  // ----- Trailer park (south) -----
  for (let i = 0; i < 8; i++) {
    const tx = -42 + (i % 4) * 22 + (i % 4 > 1 ? 10 : 0);
    const tz = 128 + Math.floor(i / 4) * 22;
    building({
      name: 'Trailer', x: tx, z: tz, w: 10, d: 4, h: 3.2, color: [0xf1faee, 0xa8dadc, 0xffd6a5, 0xcaffbf][i % 4], trim: 0x6c757d, tier: 1, mapColor: '#8d8d8d',
      doors: [{ side: 's', at: 1.5, width: 1.8 }],
    });
    container(i % 3 === 0 ? 'locker' : 'crate', tx - 2.5, tz - 0.5, 1);
  }
  zones.push({ name: 'Rusty Spur Trailer Park', x: 0, z: 140, w: 110, d: 40, tier: 1 });
  enemies('shark', 0, 140, 2, 40);

  // ----- Junkyard -----
  for (let i = 0; i < 16; i++) car(95 + (i % 4) * 7 + Math.random() * 2, 120 + Math.floor(i / 4) * 7, Math.random() < 0.5 ? 'x' : 'z', 0, true);
  minimap.push({ x: 106, z: 131, w: 34, d: 34, color: '#7c5a45', label: 'Junkyard' });
  zones.push({ name: 'Junkyard', x: 106, z: 131, w: 34, d: 34, tier: 1 });
  container('safe', 120, 145, 1);
  container('crate', 96, 146, 1);
  enemies('slotbot', 106, 131, 1);
  enemies('dicer', 106, 150, 1);

  // ----- Strip dressing -----
  for (let z = 0; z < 170; z += 18) {
    streetLight(-9, z);
    streetLight(9, z + 9);
  }
  for (let x = -160; x < 170; x += 24) if (Math.abs(x) > 12) streetLight(x, 32);
  for (const [px, pz] of [[-12, 20], [12, 60], [-12, 100], [12, 120], [-12, 150]]) palm(px, pz);
  for (let i = 0; i < 10; i++) car(i % 2 ? 11 : -11, 70 + i * 9 - (i % 2) * 4, 'z');
  for (let i = 0; i < 10; i++) car(-28 + (i % 5) * 14, -118 + Math.floor(i / 5) * 12, 'z');
  billboard(-25, 55, Math.PI / 2, 'THE HOUSE\nALWAYS WINS', '#e63946', '#fff6e0');
  billboard(25, 115, -Math.PI / 2, 'ASK ABOUT\nOUR LOANS', '#1b0f2b', '#ffd23f');
  billboard(-60, 50, 0, 'PAWN YOUR\nDREAMS', '#2a9d8f', '#fff6e0');
  billboard(80, 50, 0, 'LOSE BIG AT\nTHE GRAND', '#7b2cbf', '#ffd23f');
  enemies('slotbot', 0, 60, 1);
  enemies('slotbot', 0, 110, 1);
  enemies('dicer', 0, 85, 2, 20);
  enemies('dicer', -100, 40, 1);
  enemies('dicer', 100, 40, 1);
  zones.push({ name: 'The Strip', x: 0, z: 80, w: 40, d: 200, tier: 2 });

  // ----- Helipad and the extraction points -----
  const helipad = part(new THREE.CylinderGeometry(8, 8, 0.3, 32), 0x4b5563, { ink: 0.05 });
  helipad.position.set(0, 0.15, -158);
  statics.add(helipad);
  flat(0, -158, 9, 1.4, toon(0xffffff), 0.32);
  const extracts = [
    { name: 'Helipad', x: 0, z: -158 },
    { name: 'Getaway Car', x: 0, z: 165 },
    { name: 'Storm Drain', x: -163, z: 40 },
    { name: 'Freight Train', x: 163, z: 40 },
  ];
  car(4, 160, 'z', 0x1b0f2b);

  // ----- Outskirts -----
  const blocked = (x, z, pad) => zones.some((zn) => Math.abs(x - zn.x) < zn.w / 2 + pad && Math.abs(z - zn.z) < zn.d / 2 + pad)
    || Math.abs(x) < 14 || Math.abs(z - 40) < 12 || (Math.abs(x) < 40 && z < -100) || extracts.some((e) => Math.hypot(x - e.x, z - e.z) < 12);
  for (let i = 0; i < 260; i++) {
    const x = (Math.random() * 2 - 1) * (H - 6);
    const z = (Math.random() * 2 - 1) * (H - 6);
    if (blocked(x, z, 6)) continue;
    const r = Math.random();
    if (r < 0.45) cactus(x, z);
    else if (r < 0.85) rock(x, z, 0.8 + Math.random() * 2.2);
    else crateStack(x, z);
  }
  // Some loose loot out in the desert.
  for (let i = 0; i < 18; i++) {
    const x = (Math.random() * 2 - 1) * (H - 20);
    const z = (Math.random() * 2 - 1) * (H - 20);
    if (blocked(x, z, 4)) continue;
    container('crate', x, z, 1);
  }
  for (let i = 0; i < 6; i++) enemies('dicer', (Math.random() * 2 - 1) * 140, (Math.random() * 2 - 1) * 140, 1);

  // Mountains ring the map so the edge looks like a valley.
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const r = H + 40 + Math.random() * 30;
    const s = 30 + Math.random() * 30;
    const m = new THREE.Mesh(new THREE.ConeGeometry(s, s * (0.8 + Math.random() * 0.6), 5), toon(i % 2 ? 0xa0522d : 0x8b4513));
    m.position.set(Math.cos(a) * r, s * 0.35, Math.sin(a) * r);
    m.rotation.y = Math.random() * Math.PI;
    statics.add(m);
  }

  // ---------- lighting ----------

  scene.add(new THREE.HemisphereLight(0xffe2c4, 0x7a4a5a, 1.7));
  const sun = new THREE.DirectionalLight(0xffd2a1, 2.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: 1, far: 160 });
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const SUN_DIR = new THREE.Vector3(-0.55, 0.62, 0.35).normalize();
  const casinoGlow = new THREE.PointLight(0xff3fa4, 60, 40, 1.4);
  casinoGlow.position.set(0, 9, -12);
  scene.add(casinoGlow);

  const map = {
    half: H,
    statics,
    solids,
    zones,
    minimap,
    containers,
    slotSpots,
    enemySpots,
    extracts,
    casino: { x: CX, z: CZ, w: CW, d: CD },
    vault: { x: 0, z: CZ - CD / 2 + 9, doorZ: CZ - CD / 2 + 18 },
    spawns: [[-150, 150], [150, 150], [-150, -130], [150, -130], [-160, -20], [160, -20], [80, 165], [-80, 165], [-150, 95], [150, 95]],

    addCollider,
    removeCollider(c) {
      for (const list of grid.values()) {
        const i = list.indexOf(c);
        if (i >= 0) list.splice(i, 1);
      }
    },
    animate(fn) { animated.push(fn); },

    // Colliders near a point (anything that could touch a body standing there).
    near(x, z) {
      return grid.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL))) || [];
    },

    // Proxy meshes a ray from `origin` along `dir` for `range` could hit.
    rayTargets(origin, dir, range) {
      const ex = origin.x + dir.x * range;
      const ez = origin.z + dir.z * range;
      const minX = Math.floor(Math.min(origin.x, ex) / CELL);
      const maxX = Math.floor(Math.max(origin.x, ex) / CELL);
      const minZ = Math.floor(Math.min(origin.z, ez) / CELL);
      const maxZ = Math.floor(Math.max(origin.z, ez) / CELL);
      const out = new Set();
      for (let cx = minX; cx <= maxX; cx++) {
        for (let cz = minZ; cz <= maxZ; cz++) {
          const list = grid.get(cellKey(cx, cz));
          if (list) for (const c of list) out.add(c.proxy);
        }
      }
      return [groundProxy, ...out, ...extraProxies];
    },

    tierAt(x, z) {
      let tier = 1;
      for (const zn of zones) {
        if (Math.abs(x - zn.x) <= zn.w / 2 && Math.abs(z - zn.z) <= zn.d / 2) tier = Math.max(tier, zn.tier);
      }
      return tier;
    },

    zoneName(x, z) {
      let best = null;
      for (const zn of zones) {
        if (Math.abs(x - zn.x) <= zn.w / 2 && Math.abs(z - zn.z) <= zn.d / 2 && (!best || zn.w * zn.d < best.w * best.d)) best = zn;
      }
      return best ? best.name : 'The Desert';
    },

    isFree(x, z, r = 1) {
      for (const c of map.near(x, z)) {
        if (c.rayOnly) continue;
        if (c.type === 'box') {
          const nx = Math.max(c.minX, Math.min(x, c.maxX));
          const nz = Math.max(c.minZ, Math.min(z, c.maxZ));
          if (Math.hypot(x - nx, z - nz) < r) return false;
        } else if (Math.hypot(x - c.x, z - c.z) < c.r + r) return false;
      }
      return Math.abs(x) < H - 2 && Math.abs(z) < H - 2;
    },

    groundAt(x, z, y) {
      let g = 0;
      for (const c of map.near(x, z)) {
        if (c.rayOnly || c.top > y + 0.3) continue;
        const over = c.type === 'box'
          ? x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ
          : Math.hypot(x - c.x, z - c.z) <= c.r;
        if (over) g = Math.max(g, c.top);
      }
      return g;
    },

    // Keep the sun's shadow box centered on whoever we're looking at.
    followShadow(focus) {
      const snap = 2;
      const fx = Math.round(focus.x / snap) * snap;
      const fz = Math.round(focus.z / snap) * snap;
      sun.target.position.set(fx, 0, fz);
      sun.position.set(fx + SUN_DIR.x * 80, SUN_DIR.y * 80, fz + SUN_DIR.z * 80);
    },

    update(dt) {
      for (const fn of animated) fn(dt);
    },

    // Merge static meshes per chunk and material.
    bake() {
      scene.add(statics);
      statics.updateMatrixWorld(true);
      const buckets = new Map();
      const center = new THREE.Vector3();
      statics.traverse((o) => {
        if (!o.isMesh) return;
        o.getWorldPosition(center);
        const chunk = `${Math.floor(center.x / CHUNK)},${Math.floor(center.z / CHUNK)}`;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        // Multi-material meshes (billboards) stay as they are.
        if (mats.length > 1) {
          const keep = o.clone();
          keep.matrixAutoUpdate = false;
          keep.matrix.copy(o.matrixWorld);
          keep.matrixWorld.copy(o.matrixWorld);
          buckets.set(`keep-${o.uuid}`, { keep });
          return;
        }
        const key = `${chunk}|${o.material.uuid}|${o.castShadow}`;
        if (!buckets.has(key)) buckets.set(key, { material: o.material, cast: o.castShadow, geos: [] });
        const g = o.geometry.clone();
        g.applyMatrix4(o.matrixWorld);
        for (const name of Object.keys(g.attributes)) {
          if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        }
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        buckets.get(key).geos.push(g.index ? g : g.toNonIndexed());
      });
      scene.remove(statics);
      for (const b of buckets.values()) {
        if (b.keep) { scene.add(b.keep); continue; }
        for (const list of [b.geos.filter((g) => g.index), b.geos.filter((g) => !g.index)]) {
          if (!list.length) continue;
          const merged = mergeGeometries(list);
          if (!merged) continue;
          merged.computeBoundingSphere();
          const mesh = new THREE.Mesh(merged, b.material);
          mesh.castShadow = b.cast;
          mesh.receiveShadow = true;
          mesh.matrixAutoUpdate = false;
          scene.add(mesh);
        }
        for (const g of b.geos) g.dispose();
      }
    },
  };
  return map;
}

// The overhead map drawn once into a canvas; the HUD draws markers on top.
export function drawMinimap(map, size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext('2d');
  const s = size / (map.half * 2);
  const tx = (x) => (x + map.half) * s;
  c.fillStyle = '#d9a86c';
  c.fillRect(0, 0, size, size);
  for (const r of map.minimap) {
    c.fillStyle = r.color;
    c.fillRect(tx(r.x - r.w / 2), tx(r.z - r.d / 2), r.w * s, r.d * s);
  }
  c.strokeStyle = 'rgba(27,15,43,0.6)';
  c.lineWidth = 1;
  for (const r of map.minimap) if (r.label) c.strokeRect(tx(r.x - r.w / 2), tx(r.z - r.d / 2), r.w * s, r.d * s);
  c.fillStyle = '#1b0f2b';
  c.font = `bold ${Math.round(size / 48)}px sans-serif`;
  c.textAlign = 'center';
  for (const r of map.minimap) {
    if (!r.label || r.label === 'Trailer') continue;
    c.fillText(r.label, tx(r.x), tx(r.z + r.d / 2) + size / 40);
  }
  return canvas;
}

export { INK };
