// The raid maps: Lost Vegas, Frostbite Peaks and Bayou Royale, built from a shared kit.
//
// Static scenery is collected into `statics` and merged per 60m chunk by `bake()`, so a huge map
// still costs only a few hundred draw calls (and far chunks get frustum-culled).
// Colliders live in a spatial grid so physics and bullets only check nearby ones.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { part, toon, canvasTexture, INK } from './toon.js';

const CELL = 20;
const CHUNK = 85;
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

function groundTexture(g) {
  const tex = canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = g.base;
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      c.fillStyle = Math.random() < 0.5 ? g.a : g.b;
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
function skyDome([topC, midC, lowC]) {
  const geo = new THREE.SphereGeometry(400, 24, 12);
  const colors = [];
  const top = new THREE.Color(topC);
  const mid = new THREE.Color(midC);
  const low = new THREE.Color(lowC);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 400;
    const c = y > 0.25 ? mid.clone().lerp(top, Math.min(1, (y - 0.25) / 0.6)) : low.clone().lerp(mid, Math.max(0, y / 0.25));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
}


// The maps you can deploy to. Each has its own look, size and layout builder below.
export const MAPS = {
  vegas: {
    name: 'Lost Vegas', icon: '🌵', size: 'Huge', danger: 'Medium', half: 240, wilds: 'The Desert',
    blurb: 'A sun-baked desert strip. The Lucky Dump Grand casino sits in the middle with a vault in the back.',
    sky: [0x2a1650, 0xb3477a, 0xf6a35c], fog: 0xd77a6a,
    ground: { base: '#e8b878', a: 'rgba(170,110,60,0.18)', b: 'rgba(255,230,180,0.25)' },
    mapGround: '#e7c08a', hemi: [0xffe2c4, 0x7a4a5a, 1.7], sun: [0xffd2a1, 2.3], mountains: [0xa0522d, 0x8b4513], glow: 0xff3fa4, tough: 1,
  },
  frost: {
    name: 'Frostbite Peaks', icon: '🏔️', size: 'Huge', danger: 'Hard', half: 200, wilds: 'The Backcountry',
    blurb: 'A snowed-in ski town. Machines are tougher up here, and the Alpine Ace Lodge hides the good stuff.',
    sky: [0x1e3a5f, 0x7aa6d6, 0xdbeafe], fog: 0xc7d9ef,
    ground: { base: '#eef2f7', a: 'rgba(148,163,184,0.22)', b: 'rgba(255,255,255,0.7)' },
    mapGround: '#eef3f8', hemi: [0xeef6ff, 0x8090b0, 1.8], sun: [0xfff4e6, 2.2], mountains: [0xe2e8f0, 0x94a3b8], glow: 0x2ee6d6, tough: 1.3,
  },
  bayou: {
    name: 'Bayou Royale', icon: '🐊', size: 'Large', danger: 'Medium', half: 185, wilds: 'The Swamp',
    blurb: 'A muggy swamp town wrapped around the Riverboat Royale, a casino on a paddle steamer.',
    sky: [0x173326, 0x5e8a54, 0xe6c97a], fog: 0x9aa97f,
    ground: { base: '#6f8f3c', a: 'rgba(40,70,20,0.3)', b: 'rgba(170,190,90,0.3)' },
    mapGround: '#86a35a', hemi: [0xf2f7d9, 0x3d5230, 1.7], sun: [0xffe9b0, 2.1], mountains: [0x2f4f2f, 0x3b5d3b], glow: 0xffd23f, tough: 1.1,
  },
};

export function buildMap(scene, mapId = 'vegas') {
  const def = MAPS[mapId] || MAPS.vegas;
  const H = def.half;
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

  scene.background = new THREE.Color(def.sky[1]);
  scene.fog = new THREE.Fog(def.fog, 80, 230);
  scene.add(skyDome(def.sky));
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

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(H * 2 + 400, H * 2 + 400), toon(0xffffff, { map: groundTexture(def.ground) }));
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
    zones.push({ name, x, z, w, d, tier, indoor: roof });
    minimap.push({ x, z, w, d, color: mapColor, label: name, tier, building: true });
  }

  const container = (kind, x, z, tier, rot = 0) => containers.push({ kind, x, z, tier, rot });
  const enemies = (type, x, z, n = 1, spread = 6) => {
    for (let i = 0; i < n; i++) enemySpots.push({ type, x: x + (Math.random() - 0.5) * spread, z: z + (Math.random() - 0.5) * spread });
  };

  // ---------- more props ----------

  function pine(x, z, snowy = true) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const s = 0.8 + Math.random() * 0.6;
    g.scale.setScalar(s);
    const trunk = part(new THREE.CylinderGeometry(0.25, 0.35, 1.6, 8), 0x6b3a1e, { ink: 0.025 });
    trunk.position.y = 0.8;
    g.add(trunk);
    for (let i = 0; i < 3; i++) {
      const cone = part(new THREE.ConeGeometry(2.0 - i * 0.5, 2.4, 8), 0x1f5f3f, { ink: 0.04 });
      cone.position.y = 2.2 + i * 1.4;
      g.add(cone);
      if (snowy) {
        const cap = part(new THREE.ConeGeometry(1.0 - i * 0.25, 0.8, 8), 0xffffff, { ink: 0.02, shadow: false });
        cap.position.y = 3.0 + i * 1.4;
        g.add(cap);
      }
    }
    statics.add(g);
    circle(x, z, 0.5 * s, 7 * s);
  }

  function snowman(x, z) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    for (const [r, y] of [[0.9, 0.8], [0.65, 2.0], [0.45, 2.95]]) {
      const ball = part(new THREE.SphereGeometry(r, 14, 10), 0xffffff, { ink: 0.035 });
      ball.position.y = y;
      g.add(ball);
    }
    const nose = part(new THREE.ConeGeometry(0.1, 0.5, 8), 0xff9f43, { ink: 0.015 });
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 2.95, 0.6);
    const hat = part(new THREE.CylinderGeometry(0.35, 0.35, 0.5, 12), 0x1b0f2b, { ink: 0.02 });
    hat.position.y = 3.5;
    g.add(nose, hat);
    g.rotation.y = Math.random() * Math.PI * 2;
    statics.add(g);
    circle(x, z, 0.9, 3.5);
  }

  function cypress(x, z) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const s = 0.8 + Math.random() * 0.6;
    g.scale.setScalar(s);
    const base = part(new THREE.CylinderGeometry(0.4, 1.0, 2, 8), 0x5b4636, { ink: 0.03 });
    base.position.y = 1;
    const trunk = part(new THREE.CylinderGeometry(0.3, 0.4, 5, 8), 0x5b4636, { ink: 0.03 });
    trunk.position.y = 4.2;
    g.add(base, trunk);
    for (let i = 0; i < 3; i++) {
      const canopy = part(new THREE.SphereGeometry(1.8, 10, 6), 0x3f6b2a, { ink: 0.04 });
      canopy.scale.set(1.4, 0.45, 1.4);
      canopy.position.set((Math.random() - 0.5) * 1.5, 6.4 + i * 0.6, (Math.random() - 0.5) * 1.5);
      g.add(canopy);
    }
    // Spanish moss.
    for (let i = 0; i < 4; i++) {
      const moss = part(new THREE.ConeGeometry(0.25, 1.4, 5), 0x9aa97f, { ink: 0, shadow: false });
      moss.rotation.x = Math.PI;
      const a = Math.random() * Math.PI * 2;
      moss.position.set(Math.cos(a) * 1.6, 5.6, Math.sin(a) * 1.6);
      g.add(moss);
    }
    statics.add(g);
    circle(x, z, 0.8 * s, 8 * s);
  }

  function reeds(x, z) {
    for (let i = 0; i < 5; i++) {
      const r = part(new THREE.CylinderGeometry(0.04, 0.06, 1.4 + Math.random(), 4), 0x8a9a5b, { ink: 0, shadow: false });
      r.position.set(x + (Math.random() - 0.5) * 1.2, 0.7, z + (Math.random() - 0.5) * 1.2);
      r.rotation.z = (Math.random() - 0.5) * 0.4;
      statics.add(r);
    }
  }

  // A patch of shallow water (walkable, just for looks).
  const waterMat = new THREE.MeshBasicMaterial({ color: 0x3f7f6f, transparent: true, opacity: 0.85 });
  const ponds = [];
  function pond(x, z, r) {
    ponds.push({ x, z, r });
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 24), waterMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.03, z);
    statics.add(m);
    minimap.push({ x, z, w: r * 1.6, d: r * 1.6, color: '#3f7f6f' });
  }

  // Burning barrel: stand near one to warm up in the cold.
  const fires = [];
  const flameMats = [new THREE.MeshBasicMaterial({ color: 0xff7a1a }), new THREE.MeshBasicMaterial({ color: 0xffd23f })];
  function fire(x, z) {
    const barrel = part(new THREE.CylinderGeometry(0.55, 0.5, 1.1, 12), 0x3f3f46);
    barrel.position.set(x, 0.55, z);
    statics.add(barrel);
    circle(x, z, 0.55, 1.1);
    const flames = new THREE.Group();
    flames.position.set(x, 1.1, z);
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.32 - i * 0.07, 1.0 - i * 0.2, 7), flameMats[i % 2]);
      f.position.set((Math.random() - 0.5) * 0.3, 0.4, (Math.random() - 0.5) * 0.3);
      flames.add(f);
    }
    scene.add(flames);
    const seed = Math.random() * 10;
    animated.push((dt) => {
      const t = performance.now() / 1000 + seed;
      flames.children.forEach((f, i) => {
        f.scale.set(1, 0.8 + Math.sin(t * 9 + i * 2) * 0.25, 1);
        f.rotation.y += dt * (2 + i);
      });
    });
    fires.push({ x, z });
  }

  function mountains(colors) {
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const r = H + 40 + Math.random() * 30;
      const s = 30 + Math.random() * 30;
      const m = new THREE.Mesh(new THREE.ConeGeometry(s, s * (0.8 + Math.random() * 0.6), 5), toon(colors[i % 2]));
      m.position.set(Math.cos(a) * r, s * 0.35, Math.sin(a) * r);
      m.rotation.y = Math.random() * Math.PI;
      statics.add(m);
    }
  }

  // Scatter props across open ground, avoiding buildings, roads and exits.
  function scatter(count, place, avoid) {
    const blocked = (x, z, pad) => zones.some((zn) => Math.abs(x - zn.x) < zn.w / 2 + pad && Math.abs(z - zn.z) < zn.d / 2 + pad) || avoid(x, z);
    for (let i = 0; i < count; i++) {
      const x = (Math.random() * 2 - 1) * (H - 6);
      const z = (Math.random() * 2 - 1) * (H - 6);
      if (blocked(x, z, 6)) continue;
      place(x, z);
    }
  }

  // The casino every map is built around: a 100x70 hall with slots, tables, a cashier,
  // a bar, chandeliers, a vault behind a keycard door, and room for the Pit Boss.
  function casino({ x: CX, z: CZ, name, sign, signColor = '#ff3fa4', color = 0x6a2c91, trim = 0x2b1640, mapColor = '#6a2c91', felt = 0x1f8a4c, plaza = null }) {
    const CW = 100;
    const CD = 70;
    building({
      name, x: CX, z: CZ, w: CW, d: CD, h: 10, color, trim, floorMap: carpetTexture(), tier: 3, mapColor,
      doors: [{ side: 's', at: 0, width: 12 }, { side: 'w', at: 10, width: 5 }, { side: 'e', at: 10, width: 5 }, { side: 'n', at: 30, width: 4 }],
    });
    const signMesh = neonSign(sign, signColor, 40);
    signMesh.position.set(CX, 13.5, CZ + CD / 2 + 0.6);
    statics.add(signMesh);
    for (const dx of [-9, 9]) {
      const col = part(new THREE.CylinderGeometry(0.9, 0.9, 10, 16), 0xd4a63a);
      col.position.set(CX + dx, 5, CZ + CD / 2 + 2);
      statics.add(col);
      circle(CX + dx, CZ + CD / 2 + 2, 0.9, 10);
    }
    // Vault room at the back, behind a locked door.
    const vz = CZ - CD / 2 + 9;
    const vaultWall = toon(0x374151);
    for (const [x0, x1] of [[-14, -2.5], [2.5, 14]]) {
      const len = x1 - x0;
      const wall = part(new THREE.BoxGeometry(len, 10, 0.8), vaultWall, { ink: 0.04 });
      wall.position.set(CX + (x0 + x1) / 2, 5, vz + 9);
      statics.add(wall);
      box(CX + (x0 + x1) / 2, vz + 9, len, 0.8, 10);
    }
    for (const sx of [-14, 14]) {
      const wall = part(new THREE.BoxGeometry(0.8, 10, 18), vaultWall, { ink: 0.04 });
      wall.position.set(CX + sx, 5, vz);
      statics.add(wall);
      box(CX + sx, vz, 0.8, 18, 10);
    }
    zones.push({ name: 'The Vault', x: CX, z: vz, w: 28, d: 18, tier: 4 });
    minimap.push({ x: CX, z: vz, w: 28, d: 18, color: '#374151', label: 'Vault' });
    for (const vx of [-10, -5, 0, 5, 10]) container('vault', CX + vx, vz - 5, 4);

    // Slot rows along the side walls; every third machine is a working loot slot.
    const slotColors = [0x2a9d8f, 0xe63946, 0x7b2cbf];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 9; i++) {
        const sx = CX + side * (CW / 2 - 2.5);
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
    // Card tables in the main hall (cover for the boss fight).
    const tableTop = toon(felt);
    for (const [tx, tz] of [[-24, 10], [24, 10], [-24, 27], [24, 27], [-12, 19], [12, 19]]) {
      const base = part(new THREE.CylinderGeometry(0.8, 1.1, 0.9, 14), 0x2b2140);
      base.position.set(CX + tx, 0.45, CZ + tz);
      const rim = part(new THREE.CylinderGeometry(2.4, 2.4, 0.22, 28), 0x6b3a1e);
      rim.position.set(CX + tx, 1, CZ + tz);
      const top = part(new THREE.CylinderGeometry(2.2, 2.2, 0.06, 28), tableTop, { ink: 0 });
      top.position.set(CX + tx, 1.12, CZ + tz);
      statics.add(base, rim, top);
      circle(CX + tx, CZ + tz, 2.4, 1.15);
    }
    // Cashier cage and bar.
    const cage = part(new THREE.BoxGeometry(14, 1.3, 2), 0x24103d);
    cage.position.set(CX - 30, 0.65, CZ - 20);
    statics.add(cage);
    box(CX - 30, CZ - 20, 14, 2, 1.3);
    for (const rx of [-35, -30, -25]) container('register', CX + rx, CZ - 18.4, 3);
    const bar = part(new THREE.BoxGeometry(14, 1.25, 2), 0x6b3a1e);
    bar.position.set(CX + 30, 0.62, CZ - 20);
    statics.add(bar);
    box(CX + 30, CZ - 20, 14, 2, 1.3);
    container('register', CX + 30, CZ - 18.4, 3);
    for (const lx of [-40, -36, 36, 40]) container('locker', CX + lx, CZ - CD / 2 + 1.5, 3);
    for (const [kx, kz] of [[-18, -7], [18, -7], [-40, 15], [40, 15], [-20, 30], [20, 30]]) container('crate', CX + kx, CZ + kz, 3);
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff1b8 });
    for (const [lx, lz] of [[-20, 15], [20, 15], [0, 25], [-20, -5], [20, -5]]) {
      const ring = part(new THREE.TorusGeometry(1.6, 0.1, 8, 24), 0xd4a63a, { ink: 0.02, shadow: false });
      ring.rotation.x = Math.PI / 2;
      ring.position.set(CX + lx, 8, CZ + lz);
      statics.add(ring);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), bulbMat);
        bulb.position.set(CX + lx + Math.cos(a) * 1.6, 8.15, CZ + lz + Math.sin(a) * 1.6);
        statics.add(bulb);
      }
    }
    enemies('slotbot', CX - 20, CZ + 15, 2, 10);
    enemies('slotbot', CX + 20, CZ + 15, 2, 10);
    enemies('shark', CX, CZ + 25, 2, 14);
    enemies('shark', CX - 30, CZ - 5, 1);
    enemies('shark', CX + 30, CZ - 5, 1);
    enemies('dicer', CX, CZ + 5, 2, 20);
    if (plaza) plaza(CX, CZ + CD / 2 + 15);
    return {
      casino: { x: CX, z: CZ, w: CW, d: CD },
      vault: { x: CX, z: vz, doorZ: vz + 9 },
    };
  }

  // ---------- bigger set pieces for the outer areas ----------

  const fencePanel = new THREE.MeshBasicMaterial({ color: 0x9ca3af, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
  // A straight chain-link fence between two points on the same row or column.
  function fence(x1, z1, x2, z2, h = 2.6) {
    const horiz = Math.abs(z2 - z1) < Math.abs(x2 - x1);
    const len = horiz ? Math.abs(x2 - x1) : Math.abs(z2 - z1);
    if (len < 0.5) return;
    const cx = (x1 + x2) / 2;
    const cz = (z1 + z2) / 2;
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(len, h), fencePanel);
    panel.position.set(cx, h / 2, cz);
    if (!horiz) panel.rotation.y = Math.PI / 2;
    statics.add(panel);
    const rail = part(new THREE.BoxGeometry(horiz ? len : 0.1, 0.1, horiz ? 0.1 : len), 0x6b7280, { ink: 0 });
    rail.position.set(cx, h, cz);
    statics.add(rail);
    for (let t = 0; t <= len + 0.01; t += 4) {
      const post = part(new THREE.CylinderGeometry(0.08, 0.08, h + 0.2, 6), 0x4b5563, { ink: 0.015, shadow: false });
      post.position.set(horiz ? Math.min(x1, x2) + t : cx, (h + 0.2) / 2, horiz ? cz : Math.min(z1, z2) + t);
      statics.add(post);
    }
    box(cx, cz, horiz ? len : 0.2, horiz ? 0.2 : len, h);
  }
  // A fenced yard with a gate in the middle of each listed side. Counts as an outdoor zone.
  function yard({ name, x, z, w, d, gates = ['s'], gate = 8, tier = 2, mapColor = '#8a8a8a' }) {
    const hw = w / 2;
    const hd = d / 2;
    const side = (key, ax, az, bx, bz) => {
      if (!gates.includes(key)) { fence(ax, az, bx, bz); return; }
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      const horiz = az === bz;
      fence(ax, az, horiz ? mx - gate / 2 : mx, horiz ? mz : mz - gate / 2);
      fence(horiz ? mx + gate / 2 : mx, horiz ? mz : mz + gate / 2, bx, bz);
    };
    side('n', x - hw, z - hd, x + hw, z - hd);
    side('s', x - hw, z + hd, x + hw, z + hd);
    side('w', x - hw, z - hd, x - hw, z + hd);
    side('e', x + hw, z - hd, x + hw, z + hd);
    zones.push({ name, x, z, w, d, tier });
    minimap.push({ x, z, w, d, color: mapColor, label: name, tier, yard: true });
  }

  function waterTower(x, z, color = 0xd1d5db, label = null) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    for (const [dx, dz] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]]) {
      const leg = part(new THREE.CylinderGeometry(0.2, 0.25, 10, 6), 0x6b7280, { ink: 0.02 });
      leg.position.set(dx, 5, dz);
      g.add(leg);
    }
    const tank = part(new THREE.CylinderGeometry(3.4, 3.4, 4.5, 16), color, { ink: 0.05 });
    tank.position.y = 12.2;
    const cap = part(new THREE.ConeGeometry(3.6, 2, 16), 0x4b5563, { ink: 0.04 });
    cap.position.y = 15.4;
    g.add(tank, cap);
    if (label) {
      const sg = neonSign(label, '#ffd23f', 6);
      sg.position.set(0, 12.2, 3.5);
      g.add(sg);
    }
    statics.add(g);
    for (const [dx, dz] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]]) circle(x + dx, z + dz, 0.3, 10);
  }

  function watchtower(x, z, color = 0x8b5a2b) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    for (const [dx, dz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) {
      const leg = part(new THREE.BoxGeometry(0.3, 6, 0.3), color, { ink: 0.02 });
      leg.position.set(dx, 3, dz);
      g.add(leg);
    }
    const deck = part(new THREE.BoxGeometry(3.6, 0.3, 3.6), color, { ink: 0.03 });
    deck.position.y = 6;
    const rail = part(new THREE.BoxGeometry(3.6, 1, 3.6), color, { ink: 0.03 });
    rail.position.y = 6.6;
    const roofCone = part(new THREE.ConeGeometry(3, 1.6, 4), 0x2b2140, { ink: 0.04 });
    roofCone.position.y = 8.6;
    roofCone.rotation.y = Math.PI / 4;
    g.add(deck, rail, roofCone);
    statics.add(g);
    for (const [dx, dz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) circle(x + dx, z + dz, 0.25, 6);
  }

  function tent(x, z, color = 0x2a9d8f) {
    const t = part(new THREE.ConeGeometry(2.3, 2.6, 4), color, { ink: 0.04 });
    t.position.set(x, 1.3, z);
    t.rotation.y = Math.random() * Math.PI;
    statics.add(t);
    circle(x, z, 1.6, 2.6);
  }

  // A railway boxcar. Good cover.
  function boxcar(x, z, color = 0x9b2226) {
    const body = part(new THREE.BoxGeometry(3.6, 3.4, 12), color, { ink: 0.05 });
    body.position.set(x, 2.5, z);
    const roofTop = part(new THREE.BoxGeometry(3.8, 0.3, 12.2), 0x3f3f46, { ink: 0.02 });
    roofTop.position.set(x, 4.3, z);
    statics.add(body, roofTop);
    for (const dz of [-4, 4]) {
      const truck = part(new THREE.BoxGeometry(3, 0.8, 2.6), 0x1f2937, { ink: 0.02 });
      truck.position.set(x, 0.4, z + dz);
      statics.add(truck);
    }
    box(x, z, 3.6, 12, 4.4);
  }

  function rails(x, z1, z2) {
    const len = Math.abs(z2 - z1);
    const cz = (z1 + z2) / 2;
    for (const dx of [-0.75, 0.75]) flat(x + dx, cz, 0.18, len, toon(0x6b7280), 0.08);
    for (let t = Math.min(z1, z2); t < Math.max(z1, z2); t += 1.6) flat(x, t, 2.6, 0.35, toon(0x5b4636), 0.06);
  }

  function pyramid(x, z, s, color = 0xe9c46a) {
    const p = part(new THREE.ConeGeometry(s, s * 0.9, 4), color, { ink: 0.08 });
    p.position.set(x, s * 0.45, z);
    p.rotation.y = Math.PI / 4;
    statics.add(p);
    box(x, z, s * 1.2, s * 1.2, s * 0.9);
  }

  const kit = {
    H, THREE, statics, zones, minimap, containers, slotSpots, enemySpots, solids,
    part, toon, neonSign, carpetTexture, flat, box, circle, addCollider, addRayBlocker,
    car, palm, cactus, rock, streetLight, billboard, crateStack, building, container, enemies,
    pine, snowman, cypress, reeds, pond, mountains, scatter, casino, fire, ponds, fires,
    fence, yard, waterTower, watchtower, tent, boxcar, rails, pyramid, boardTexture,
  };
  const layout = BUILDERS[mapId in BUILDERS ? mapId : 'vegas'](kit);
  mountains(def.mountains);
  const { extracts, spawns } = layout;
  const CX = layout.casino.x;
  const CZ = layout.casino.z;

  // ---------- lighting ----------

  scene.add(new THREE.HemisphereLight(def.hemi[0], def.hemi[1], def.hemi[2]));
  const sun = new THREE.DirectionalLight(def.sun[0], def.sun[1]);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: 1, far: 160 });
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const SUN_DIR = new THREE.Vector3(-0.55, 0.62, 0.35).normalize();
  const casinoGlow = new THREE.PointLight(def.glow, 60, 40, 1.4);
  casinoGlow.position.set(CX, 9, CZ + 43);
  scene.add(casinoGlow);

  const map = {
    id: mapId,
    name: def.name,
    mapGround: def.mapGround,
    // Machines on harder maps have more health and hit harder.
    toughness: def.tough || 1,
    half: H,
    statics,
    solids,
    zones,
    minimap,
    containers,
    slotSpots,
    enemySpots,
    extracts,
    casino: layout.casino,
    // Map-specific dangers: traffic lanes, cold and fires, gator ponds.
    hazards: { ...(layout.hazards || {}), fires, ponds },
    vault: layout.vault,
    spawns,

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
      return best ? best.name : def.wilds;
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

// The overhead map, drawn once into a canvas. The HUD draws live markers on top.
// `labels` adds building names (for the full map; the minimap stays uncluttered).
const SKIP_LABELS = new Set(['Trailer', 'Ski Cabin', 'Stilt Shack', 'Ice Hut', 'Vault', 'Snack Bar', 'Farm Office', 'Bait Shed', 'Buried Cabin']);

function roundRect(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

export function drawMinimap(map, size = 512, labels = false) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext('2d');
  const s = size / (map.half * 2);
  const tx = (v) => (v + map.half) * s;
  const k = size / 512;

  // Ground with a soft vignette and a faint 50m grid.
  c.fillStyle = map.mapGround || '#e7c08a';
  c.fillRect(0, 0, size, size);
  const vig = c.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size * 0.75);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(27,15,43,0.18)');
  c.fillStyle = vig;
  c.fillRect(0, 0, size, size);
  c.strokeStyle = 'rgba(27,15,43,0.06)';
  c.lineWidth = 1;
  for (let v = -map.half; v <= map.half; v += 50) {
    c.beginPath(); c.moveTo(tx(v), 0); c.lineTo(tx(v), size); c.stroke();
    c.beginPath(); c.moveTo(0, tx(v)); c.lineTo(size, tx(v)); c.stroke();
  }

  // Ground features first (roads, lots, water), then buildings on top.
  for (const r of map.minimap) {
    if (r.building) continue;
    const x = tx(r.x - r.w / 2);
    const y = tx(r.z - r.d / 2);
    const w = r.w * s;
    const h = r.d * s;
    if (r.yard) {
      // Fenced yards: a faint lot with a dashed fence line.
      c.fillStyle = 'rgba(27,15,43,0.08)';
      c.fillRect(x, y, w, h);
      c.strokeStyle = r.tier >= 3 ? '#b8860b' : 'rgba(27,15,43,0.55)';
      c.lineWidth = 1.5 * k;
      c.setLineDash([4 * k, 3 * k]);
      c.strokeRect(x, y, w, h);
      c.setLineDash([]);
      continue;
    }
    c.fillStyle = r.color;
    roundRect(c, x, y, w, h, Math.min(w, h) * 0.3);
    c.fill();
    // Dashed center line on long, thin roads.
    const long = Math.max(w, h);
    const thin = Math.min(w, h);
    if (long / thin > 6 && !/7f6f|6b5c|bfe3/i.test(r.color)) {
      c.strokeStyle = 'rgba(255,214,63,0.75)';
      c.lineWidth = Math.max(1, 1.2 * k);
      c.setLineDash([6 * k, 6 * k]);
      c.beginPath();
      if (w > h) { c.moveTo(x, y + h / 2); c.lineTo(x + w, y + h / 2); } else { c.moveTo(x + w / 2, y); c.lineTo(x + w / 2, y + h); }
      c.stroke();
      c.setLineDash([]);
    }
  }

  for (const r of map.minimap) {
    if (!r.building) continue;
    const x = tx(r.x - r.w / 2);
    const y = tx(r.z - r.d / 2);
    const w = Math.max(3, r.w * s);
    const h = Math.max(3, r.d * s);
    const rad = Math.min(4 * k, w / 3, h / 3);
    // Shadow, body, top highlight, ink outline.
    c.fillStyle = 'rgba(27,15,43,0.25)';
    roundRect(c, x + 2 * k, y + 2.5 * k, w, h, rad);
    c.fill();
    c.fillStyle = r.color;
    roundRect(c, x, y, w, h, rad);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.18)';
    roundRect(c, x, y, w, h * 0.35, rad);
    c.fill();
    c.strokeStyle = r.tier >= 3 ? '#ffd23f' : 'rgba(27,15,43,0.75)';
    c.lineWidth = (r.tier >= 3 ? 2.5 : 1.2) * k;
    roundRect(c, x, y, w, h, rad);
    c.stroke();
  }

  if (labels) {
    const seen = new Set();
    const placed = [];
    c.font = `900 ${Math.round(13 * k)}px Nunito, system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const r of map.minimap) {
      if (!r.label || SKIP_LABELS.has(r.label) || seen.has(r.label)) continue;
      seen.add(r.label);
      const text = r.label;
      const tw = c.measureText(text).width + 12 * k;
      const th = 18 * k;
      // Keep labels on the map and off each other: nudge down, then up, else skip.
      const lx = Math.max(tw / 2 + 2, Math.min(size - tw / 2 - 2, tx(r.x)));
      const base = Math.min(size - th, tx(r.z + r.d / 2) + th * 0.9);
      const hits = (y) => placed.some((q) => Math.abs(q.x - lx) < (q.w + tw) / 2 + 2 && Math.abs(q.y - y) < th + 1);
      const ly = [0, 1, -1, 2, -2].map((n) => Math.max(th / 2, Math.min(size - th / 2, base + n * (th + 2)))).find((y) => !hits(y));
      if (ly === undefined) continue;
      placed.push({ x: lx, y: ly, w: tw });
      c.fillStyle = r.tier >= 3 ? 'rgba(122,16,40,0.92)' : 'rgba(27,15,43,0.82)';
      roundRect(c, lx - tw / 2, ly - th / 2, tw, th, th / 2);
      c.fill();
      c.fillStyle = r.tier >= 3 ? '#ffd23f' : '#fff6e0';
      c.fillText(text, lx, ly + 1);
    }
  }
  return canvas;
}

export { INK };


// ---------- map layouts ----------

function lostVegas(k) {
  const {
    H, THREE, statics, zones, minimap, slotSpots, part, toon, neonSign, flat, box, circle,
    car, palm, cactus, rock, streetLight, billboard, crateStack, building, container, enemies, casino,
    watchtower, waterTower, rails, boxcar, pyramid,
  } = k;
  const asphalt = toon(0x3b3548);
  // ---------- the strip ----------

  // Main road south from the casino, and a cross street.
  flat(0, 110, 16, 260, asphalt);
  flat(0, 40, H * 2, 14, asphalt, 0.025);
  minimap.push({ x: 0, z: 110, w: 16, d: 260, color: '#3b3548' }, { x: 0, z: 40, w: H * 2, d: 14, color: '#3b3548' });
  const dash = toon(0xffd23f);
  for (let z = -15; z < H; z += 8) if (Math.abs(z - 40) > 9) flat(0, z, 0.4, 3.5, dash, 0.035);
  for (let x = -H + 4; x < H; x += 8) if (Math.abs(x) > 10) flat(x, 40, 3.5, 0.4, dash, 0.035);
  // Parking lot behind the casino.
  flat(0, -125, 70, 40, asphalt);
  minimap.push({ x: 0, z: -125, w: 70, d: 40, color: '#3b3548' });
  for (let x = -30; x <= 30; x += 6) flat(x, -125, 0.3, 6, toon(0xffffff), 0.035);

  const cas = casino({
    x: 0, z: -55, name: 'Lucky Dump Grand Casino', sign: 'LUCKY DUMP GRAND',
    plaza(px, pz) {
      const fountain = part(new THREE.CylinderGeometry(5, 5.4, 1, 28), 0xe9d8a6);
      fountain.position.set(px, 0.5, pz);
      const water = new THREE.Mesh(new THREE.CircleGeometry(4.6, 28), new THREE.MeshBasicMaterial({ color: 0x4dabff }));
      water.rotation.x = -Math.PI / 2;
      water.position.set(px, 1.02, pz);
      const spout = part(new THREE.CylinderGeometry(0.4, 0.8, 3, 12), 0xd4a63a);
      spout.position.set(px, 2, pz);
      statics.add(fountain, water, spout);
      circle(px, pz, 5.4, 1.0);
      for (const [dx, dz] of [[-14, -3], [14, -3], [-22, 10], [22, 10]]) palm(px + dx, pz + dz);
      enemies('dicer', px, pz + 3, 2, 16);
    },
  });
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
  for (let z = 0; z < H - 10; z += 18) {
    streetLight(-9, z);
    streetLight(9, z + 9);
  }
  for (let x = -H + 10; x < H - 10; x += 24) if (Math.abs(x) > 12) streetLight(x, 32);
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

  // ===== The outer ring: the new, wider desert =====

  // ----- Neon Boneyard (northwest): where old casino signs go to die -----
  {
    const bx = -170;
    const bz = -150;
    k.yard({ name: 'Neon Boneyard', x: bx, z: bz, w: 56, d: 44, gates: ['s', 'e'], tier: 2, mapColor: '#8d5a97' });
    const dead = [['GOLDEN NUGGET', '#ffd23f'], ['STARDUST', '#ff7eb6'], ['LUCKY 7', '#2ee6d6'], ['DUNES', '#ff9f43'], ['SAHARA', '#c77dff'], ['FREE BUFFET', '#5ee27a']];
    dead.forEach(([text, color], i) => {
      const sg = neonSign(text, color, 12);
      const x = bx - 18 + (i % 3) * 18;
      const z = bz - 10 + Math.floor(i / 3) * 18;
      sg.position.set(x, 1.6, z);
      sg.rotation.set(-0.35 + Math.random() * 0.2, Math.random() * 0.6 - 0.3, Math.random() * 0.3 - 0.15);
      statics.add(sg);
      box(x, z, 12, 1.4, 2.4);
      if (i % 2 === 0) container('crate', x + 7.5, z + 3, 2);
    });
    container('safe', bx + 22, bz - 16, 2);
    container('locker', bx - 24, bz + 16, 2);
    slotSpots.push({ x: bx + 20, z: bz + 14, rot: 0, tier: 2 });
    enemies('slotbot', bx, bz, 2, 20);
    enemies('dicer', bx, bz + 30, 2, 16);
  }

  // ----- Area 52 Test Range (southeast… well, north-east): high risk, high reward -----
  {
    const ax = 175;
    const az = -172;
    k.yard({ name: 'Area 52 Test Range', x: ax, z: az, w: 70, d: 56, gates: ['w', 's'], tier: 3, mapColor: '#4b5563' });
    building({
      name: 'Hangar 52', x: ax + 6, z: az - 6, w: 34, d: 22, h: 9, color: 0x9ca3af, trim: 0x1f2937, tier: 3, sign: 'HANGAR 52', signColor: '#5ee27a', mapColor: '#374151',
      doors: [{ side: 's', at: 0, width: 10 }, { side: 'w', at: 0, width: 3 }],
    });
    container('safe', ax - 6, az - 13, 3);
    container('safe', ax + 18, az - 13, 3);
    container('locker', ax + 18, az + 1, 3);
    container('crate', ax - 6, az + 1, 3);
    crateStack(ax + 6, az - 10);
    for (const [dx, dz] of [[-31, -24], [31, -24], [-31, 24], [31, 24]]) watchtower(ax + dx, az + dz, 0x4b5563);
    container('crate', ax - 22, az + 18, 2);
    container('crate', ax + 24, az + 20, 2);
    enemies('slotbot', ax + 6, az - 6, 3, 18);
    enemies('shark', ax - 20, az + 16, 2, 8);
    enemies('dicer', ax, az + 34, 3, 24);
    billboard(ax - 42, az + 34, Math.PI / 4, 'NOTHING TO\nSEE HERE', '#1f2937', '#5ee27a');
  }

  // ----- Starlite Drive-In (southwest) -----
  {
    const dx0 = -160;
    const dz0 = 190;
    zones.push({ name: 'Starlite Drive-In', x: dx0, z: dz0, w: 64, d: 50, tier: 1 });
    minimap.push({ x: dx0, z: dz0, w: 64, d: 50, color: '#4b4458', label: 'Starlite Drive-In', tier: 1 });
    flat(dx0, dz0, 64, 50, asphalt, 0.02);
    const screen = new THREE.Mesh(new THREE.BoxGeometry(30, 14, 0.6), [
      toon(0xf8f9fa), toon(0xf8f9fa), toon(0xf8f9fa), toon(0xf8f9fa),
      new THREE.MeshBasicMaterial({ map: k.boardTexture('TONIGHT:\nTHE HOUSE WINS', '#1b0f2b', '#fff6e0') }), toon(0x6b7280),
    ]);
    screen.position.set(dx0, 11, dz0 - 24);
    statics.add(screen);
    for (const sx of [-12, 12]) {
      const leg = part(new THREE.BoxGeometry(0.8, 5, 0.8), 0x6b7280, { ink: 0.02 });
      leg.position.set(dx0 + sx, 2.5, dz0 - 24);
      statics.add(leg);
      box(dx0 + sx, dz0 - 24, 0.8, 0.8, 5);
    }
    for (let i = 0; i < 12; i++) car(dx0 - 20 + (i % 4) * 13, dz0 - 8 + Math.floor(i / 4) * 9, 'z', undefined, i % 5 === 0);
    building({
      name: 'Snack Bar', x: dx0, z: dz0 + 20, w: 14, d: 8, h: 4, color: 0xffd6a5, trim: 0xe63946, tier: 2, sign: 'SNACKS', signColor: '#ff5d5d', mapColor: '#b5651d',
      doors: [{ side: 'n', at: 0, width: 3 }],
    });
    container('register', dx0 + 3, dz0 + 21, 2);
    container('locker', dx0 - 4, dz0 + 22, 2);
    enemies('shark', dx0, dz0, 2, 30);
    enemies('dicer', dx0, dz0 - 10, 1);
  }

  // ----- Bust-a-Lane Bowling (far west) -----
  building({
    name: 'Bust-a-Lane Bowling', x: -190, z: 85, w: 32, d: 20, h: 6, color: 0xff7eb6, trim: 0x1b0f2b, tier: 2, sign: 'BUST-A-LANE', signColor: '#2ee6d6', mapColor: '#c2457a',
    doors: [{ side: 'e', at: 0, width: 4 }, { side: 'n', at: -10, width: 2.4 }],
  });
  for (let i = 0; i < 4; i++) flat(-196, 78 + i * 4.5, 14, 2.6, toon(0xd4a373), 0.07);
  container('register', -178, 80, 2);
  container('locker', -203, 92, 2);
  container('crate', -203, 78, 2);
  slotSpots.push({ x: -178, z: 92, rot: -Math.PI / 2, tier: 2 });
  enemies('slotbot', -170, 85, 1);
  enemies('shark', -190, 85, 1);

  // ----- Pharaoh's Folly: a half-built pyramid casino that went bust (south of the parking lot) -----
  {
    const px = -80;
    const pz = -205;
    pyramid(px, pz, 18);
    zones.push({ name: "Pharaoh's Folly", x: px, z: pz, w: 60, d: 40, tier: 2 });
    minimap.push({ x: px, z: pz, w: 22, d: 22, color: '#c9a227', label: "Pharaoh's Folly", tier: 2 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const col = part(new THREE.CylinderGeometry(0.8, 0.9, 5 + (i % 3) * 2, 10), 0xe9c46a, { ink: 0.03 });
      col.position.set(px + Math.cos(a) * 22, (5 + (i % 3) * 2) / 2, pz + Math.sin(a) * 16);
      statics.add(col);
      circle(px + Math.cos(a) * 22, pz + Math.sin(a) * 16, 0.9, 9);
    }
    container('safe', px + 14, pz + 12, 2);
    container('crate', px - 15, pz + 12, 2);
    container('crate', px + 16, pz - 12, 2);
    crateStack(px - 18, pz - 10);
    enemies('slotbot', px, pz + 16, 1);
    enemies('dicer', px, pz, 2, 30);
  }

  // ----- Dusty Spur Ranch (southeast) -----
  {
    const rx = 175;
    const rz = 195;
    building({
      name: 'Dusty Spur Barn', x: rx, z: rz, w: 22, d: 14, h: 7, color: 0xb23a48, trim: 0xf8f9fa, tier: 1, mapColor: '#8b2c38',
      doors: [{ side: 'w', at: 0, width: 5 }],
    });
    waterTower(rx - 26, rz - 14, 0xd1d5db, 'DUSTY');
    k.yard({ name: 'Ranch Corral', x: rx - 30, z: rz + 18, w: 24, d: 18, gates: ['n'], tier: 1, mapColor: '#a47148' });
    container('crate', rx + 6, rz - 3, 1);
    container('locker', rx + 6, rz + 4, 1);
    container('crate', rx - 30, rz + 20, 1);
    enemies('shark', rx - 10, rz, 1);
    enemies('dicer', rx - 30, rz + 18, 1);
  }

  // ----- Freight yard along the east edge -----
  rails(H - 12, -H + 10, H - 10);
  minimap.push({ x: H - 12, z: 0, w: 3, d: H * 2 - 20, color: '#5b4636' });
  for (const [z, color] of [[-60, 0x9b2226], [-20, 0x005f73], [70, 0xca6702], [110, 0x9b2226], [150, 0x3a5a40]]) boxcar(H - 12, z, color);
  zones.push({ name: 'Freight Yard', x: H - 20, z: 40, w: 30, d: 120, tier: 1 });
  container('crate', H - 18, -40, 1);
  container('crate', H - 18, 90, 1);
  container('locker', H - 18, 130, 2);
  enemies('slotbot', H - 24, 40, 1);

  // ----- Helipad and the extraction points -----
  const helipad = part(new THREE.CylinderGeometry(8, 8, 0.3, 32), 0x4b5563, { ink: 0.05 });
  helipad.position.set(40, 0.15, -222);
  statics.add(helipad);
  flat(40, -222, 9, 1.4, toon(0xffffff), 0.32);
  const extracts = [
    { name: 'Helipad', x: 40, z: -222 },
    { name: 'Getaway Car', x: 0, z: H - 10 },
    { name: 'Storm Drain', x: -H + 10, z: 40 },
    { name: 'Freight Train', x: H - 20, z: 40 },
  ];
  car(4, H - 15, 'z', 0x1b0f2b);

  // ----- Outskirts -----
  const blocked = (x, z, pad) => zones.some((zn) => Math.abs(x - zn.x) < zn.w / 2 + pad && Math.abs(z - zn.z) < zn.d / 2 + pad)
    || Math.abs(x) < 14 || Math.abs(z - 40) < 12 || (Math.abs(x) < 40 && z < -100) || x > H - 20 || extracts.some((e) => Math.hypot(x - e.x, z - e.z) < 12);
  for (let i = 0; i < 480; i++) {
    const x = (Math.random() * 2 - 1) * (H - 6);
    const z = (Math.random() * 2 - 1) * (H - 6);
    if (blocked(x, z, 6)) continue;
    const r = Math.random();
    if (r < 0.45) cactus(x, z);
    else if (r < 0.85) rock(x, z, 0.8 + Math.random() * 2.2);
    else crateStack(x, z);
  }
  // Some loose loot out in the desert.
  for (let i = 0; i < 36; i++) {
    const x = (Math.random() * 2 - 1) * (H - 20);
    const z = (Math.random() * 2 - 1) * (H - 20);
    if (blocked(x, z, 4)) continue;
    container('crate', x, z, 1);
  }
  for (let i = 0; i < 12; i++) enemies('dicer', (Math.random() * 2 - 1) * 200, (Math.random() * 2 - 1) * 200, 1);
  for (let i = 0; i < 4; i++) enemies('shark', (Math.random() * 2 - 1) * 200, (Math.random() * 2 - 1) * 200, 1);

  return {
    ...cas,
    extracts,
    spawns: [[-215, 215], [215, 120], [-215, -60], [110, -215], [-215, -10], [205, -60], [80, 220], [-60, 220], [-120, 140], [130, 140], [-140, -215]],
    // Cars cruise the strip and the cross street. Don't stand in the road.
    hazards: {
      lanes: [
        { axis: 'z', at: 3.5, from: -16, to: H - 4, dir: 1 },
        { axis: 'z', at: -3.5, from: -16, to: H - 4, dir: -1 },
        { axis: 'x', at: 43.5, from: -H + 4, to: H - 4, dir: 1 },
        { axis: 'x', at: 36.5, from: -H + 4, to: H - 4, dir: -1 },
      ],
    },
  };
}

function frostbitePeaks(k) {
  const {
    H, THREE, statics, zones, minimap, slotSpots, part, toon, neonSign, flat, box, circle,
    car, rock, streetLight, billboard, crateStack, building, container, enemies, casino,
    pine, snowman, scatter, fire, yard, watchtower, waterTower, tent,
  } = k;
  const path = toon(0xb8c4d6);
  flat(0, 105, 14, 190, path);
  flat(0, 40, H * 2, 12, path, 0.025);
  minimap.push({ x: 0, z: 105, w: 14, d: 190, color: '#94a3b8' }, { x: 0, z: 40, w: H * 2, d: 12, color: '#94a3b8' });

  const cas = casino({
    x: 0, z: -45, name: 'Alpine Ace Lodge', sign: 'ALPINE ACE LODGE', signColor: '#2ee6d6',
    color: 0x7c2d12, trim: 0x1c1917, mapColor: '#7c2d12', felt: 0x1e3a8a,
    plaza(px, pz) {
      // A giant decorated pine and a snowman welcoming committee.
      const g = new THREE.Group();
      g.position.set(px, 0, pz);
      for (let i = 0; i < 4; i++) {
        const cone = part(new THREE.ConeGeometry(5 - i, 4, 10), 0x1f5f3f, { ink: 0.05 });
        cone.position.y = 2.5 + i * 2.4;
        g.add(cone);
      }
      const star = part(new THREE.OctahedronGeometry(0.9), 0xffd23f, { ink: 0.03 });
      star.position.y = 12.5;
      g.add(star);
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2;
        const h = 2 + Math.random() * 8;
        const r = (5 - (h - 2) / 2.4) * 0.85;
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: [0xff5d5d, 0xffd23f, 0x4dabff, 0x5ee27a][i % 4] }));
        bulb.position.set(Math.cos(a) * r, h, Math.sin(a) * r);
        g.add(bulb);
      }
      statics.add(g);
      circle(px, pz, 5, 12);
      snowman(px - 10, pz - 2);
      snowman(px + 10, pz - 2);
      enemies('dicer', px, pz + 6, 2, 16);
    },
  });

  // Cabins on both sides of the main path.
  const cabinColors = [0x8b5a2b, 0x9c6644, 0x7f5539, 0xa47148];
  [[-40, 70], [-40, 95], [-40, 120], [40, 75], [40, 100], [40, 125], [-75, 100], [75, 105]].forEach(([x, z], i) => {
    building({
      name: 'Ski Cabin', x, z, w: 12, d: 9, h: 4, color: cabinColors[i % 4], trim: 0xf8fafc, floor: 0x6b4f3a, tier: 1, mapColor: '#8b5a2b',
      doors: [{ side: x < 0 ? 'e' : 'w', at: 0, width: 2.4 }],
    });
    container(i % 2 ? 'locker' : 'crate', x + (x < 0 ? -3 : 3), z - 2, 1);
    if (i % 3 === 0) container('safe', x + (x < 0 ? -3 : 3), z + 2.5, 1);
  });
  enemies('shark', -40, 95, 2, 30);
  enemies('slotbot', 40, 100, 1);

  building({
    name: 'Ski Rental', x: -70, z: 20, w: 22, d: 14, h: 5, color: 0x2563eb, trim: 0xf8fafc, tier: 2, sign: 'SKI RENTAL', signColor: '#ffd23f', mapColor: '#2563eb',
    doors: [{ side: 's', at: 0, width: 3 }],
  });
  container('register', -66, 18, 2);
  container('locker', -78, 15, 2);
  container('locker', -62, 15, 2);
  slotSpots.push({ x: -79, z: 22, rot: Math.PI / 2, tier: 2 });
  enemies('slotbot', -70, 35, 1);
  enemies('dicer', -70, 5, 2, 10);

  building({
    name: 'Hot Cocoa Diner', x: 65, z: 18, w: 20, d: 12, h: 4.5, color: 0xfca5a5, trim: 0x7f1d1d, tier: 2, sign: 'HOT COCOA', signColor: '#ff7eb6', mapColor: '#b91c1c',
    doors: [{ side: 's', at: 0, width: 3 }],
  });
  container('register', 68, 15, 2);
  container('locker', 72, 21, 2);
  slotSpots.push({ x: 56.5, z: 18, rot: Math.PI / 2, tier: 2 });
  enemies('shark', 65, 32, 1);

  building({
    name: 'Snowcat Garage', x: -95, z: -80, w: 30, d: 20, h: 7, color: 0x64748b, trim: 0x1e293b, tier: 2, mapColor: '#475569',
    doors: [{ side: 'e', at: 0, width: 6 }],
  });
  for (const [x, z] of [[-104, -86], [-88, -86], [-100, -74]]) container('crate', x, z, 2);
  container('safe', -106, -74, 2);
  crateStack(-92, -78);
  enemies('slotbot', -95, -80, 2, 10);

  building({
    name: 'Gondola Station', x: 95, z: -85, w: 24, d: 16, h: 6, color: 0xe2e8f0, trim: 0x0f172a, tier: 2, sign: 'GONDOLA', signColor: '#2ee6d6', mapColor: '#64748b',
    doors: [{ side: 'w', at: 0, width: 4 }],
  });
  container('locker', 100, -90, 2);
  container('register', 90, -80, 2);
  enemies('shark', 95, -85, 1);
  enemies('dicer', 80, -70, 2, 10);

  // Frozen lake with ice-fishing huts.
  const ice = new THREE.Mesh(new THREE.CircleGeometry(28, 32), new THREE.MeshBasicMaterial({ color: 0xbfe3f5 }));
  ice.rotation.x = -Math.PI / 2;
  ice.position.set(85, 0.03, 70);
  statics.add(ice);
  minimap.push({ x: 85, z: 70, w: 44, d: 44, color: '#bfe3f5', label: 'Frozen Lake' });
  zones.push({ name: 'Frozen Lake', x: 85, z: 70, w: 50, d: 50, tier: 1 });
  [[75, 62], [95, 78], [88, 55]].forEach(([x, z], i) => {
    building({ name: 'Ice Hut', x, z, w: 5, d: 4, h: 3, color: [0xef4444, 0x3b82f6, 0xf59e0b][i], trim: 0x1f2937, tier: 1, mapColor: '#ef4444', doors: [{ side: 's', at: 0, width: 1.8 }] });
    container('crate', x, z - 0.8, 1);
  });
  enemies('dicer', 85, 70, 2, 30);

  // Ski lift towers marching up toward the peaks.
  for (let i = 0; i < 9; i++) {
    const x = -20 - i * 20;
    const z = -100 + i * 4;
    const pole = part(new THREE.CylinderGeometry(0.4, 0.5, 12, 8), 0x475569, { ink: 0.03 });
    pole.position.set(x, 6, z);
    const arm = part(new THREE.BoxGeometry(4, 0.4, 0.4), 0x475569, { ink: 0.02 });
    arm.position.set(x, 12, z);
    statics.add(pole, arm);
    circle(x, z, 0.5, 12);
  }
  for (let i = 0; i < 6; i++) car(-12 + (i % 3) * 12, -95 - Math.floor(i / 3) * 10, 'z');
  for (let z = 0; z < H - 10; z += 22) { streetLight(-8, z); streetLight(8, z + 11); }
  billboard(-25, 50, Math.PI / 2, 'FRESH POWDER\nFRESH LOSSES', '#1e3a8a', '#fff6e0');
  billboard(25, 10, -Math.PI / 2, 'THE HOUSE\nNEVER MELTS', '#7c2d12', '#ffd23f');
  zones.push({ name: 'Main Street', x: 0, z: 75, w: 30, d: 130, tier: 2 });
  enemies('slotbot', 0, 60, 1);
  enemies('dicer', 0, 110, 2, 20);

  // ===== The outer ring =====

  // ----- Summit Observatory (northwest peak): the most dangerous spot outside the lodge -----
  {
    const ox = -150;
    const oz = -155;
    building({
      name: 'Summit Observatory', x: ox, z: oz, w: 26, d: 26, h: 7, color: 0xe2e8f0, trim: 0x1e293b, tier: 3, sign: 'OBSERVATORY', signColor: '#c77dff', mapColor: '#6d28d9',
      doors: [{ side: 's', at: 0, width: 4 }, { side: 'e', at: 6, width: 2.4 }],
    });
    const dome = part(new THREE.SphereGeometry(10, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0xcbd5e1, { ink: 0.05 });
    dome.position.set(ox, 7.4, oz);
    const scope = part(new THREE.CylinderGeometry(1.2, 1.6, 12, 12), 0x334155, { ink: 0.04 });
    scope.position.set(ox + 4, 14, oz - 2);
    scope.rotation.z = -0.8;
    statics.add(dome, scope);
    container('safe', ox - 9, oz - 9, 3);
    container('safe', ox + 9, oz - 9, 3);
    container('locker', ox - 9, oz + 6, 3);
    container('crate', ox + 9, oz + 6, 3);
    enemies('slotbot', ox, oz + 4, 2, 10);
    enemies('shark', ox, oz + 22, 2, 14);
    enemies('dicer', ox + 20, oz, 2, 14);
  }

  // ----- Frosty's Ice Hotel (southeast) -----
  {
    const ix = 150;
    const iz = 150;
    building({
      name: "Frosty's Ice Hotel", x: ix, z: iz, w: 32, d: 18, h: 6, color: 0xbfe3f5, trim: 0x0ea5e9, tier: 2, sign: 'ICE HOTEL', signColor: '#2ee6d6', mapColor: '#38bdf8',
      doors: [{ side: 'w', at: 0, width: 4 }, { side: 'n', at: 8, width: 2.4 }],
    });
    for (const dx of [-8, 0, 8]) {
      const wall = part(new THREE.BoxGeometry(0.5, 6, 11), 0xbfe3f5, { ink: 0.03 });
      wall.position.set(ix + dx + 2, 3, iz + 3.5);
      statics.add(wall);
      box(ix + dx + 2, iz + 3.5, 0.5, 11, 6);
    }
    container('register', ix - 12, iz - 5, 2);
    container('locker', ix - 2, iz + 6, 2);
    container('locker', ix + 6, iz + 6, 2);
    container('safe', ix + 14, iz + 6, 2);
    slotSpots.push({ x: ix + 13, z: iz - 6, rot: -Math.PI / 2, tier: 2 });
    snowman(ix - 22, iz - 6);
    snowman(ix - 22, iz + 6);
    enemies('slotbot', ix - 26, iz, 1);
    enemies('shark', ix, iz - 18, 2, 14);
  }

  // ----- Ranger Station (southwest) -----
  {
    const rx = -160;
    const rz = 145;
    building({
      name: 'Ranger Station', x: rx, z: rz, w: 16, d: 12, h: 4.5, color: 0x3f6212, trim: 0xf8fafc, tier: 2, sign: 'RANGERS', signColor: '#5ee27a', mapColor: '#4d7c0f',
      doors: [{ side: 'e', at: 0, width: 3 }],
    });
    watchtower(rx + 20, rz - 16);
    container('locker', rx - 4, rz - 3, 2);
    container('crate', rx - 4, rz + 3, 2);
    container('crate', rx + 20, rz - 12, 1);
    for (let i = 0; i < 4; i++) tent(rx - 10 + i * 8, rz + 22, [0xf97316, 0x2a9d8f, 0xe63946, 0xffd23f][i]);
    zones.push({ name: 'Campground', x: rx + 2, z: rz + 22, w: 40, d: 12, tier: 1 });
    container('crate', rx + 2, rz + 26, 1);
    enemies('dicer', rx, rz + 10, 2, 20);
    enemies('shark', rx + 10, rz + 22, 1);
  }

  // ----- Big Air Ski Jump (north) -----
  {
    const jx = 60;
    const jz = -165;
    const slope = Math.atan2(14, 44);
    const ramp = part(new THREE.BoxGeometry(7, 0.6, 46), 0xf8fafc, { ink: 0.05 });
    ramp.position.set(jx, 10, jz);
    ramp.rotation.x = slope;
    statics.add(ramp);
    for (const dz of [-18, -6, 6, 18]) {
      const hgt = 10 - (dz / 23) * 7 - 0.4;
      for (const dx of [-3, 3]) {
        const leg = part(new THREE.BoxGeometry(0.5, hgt, 0.5), 0x475569, { ink: 0.02 });
        leg.position.set(jx + dx, hgt / 2, jz + dz);
        statics.add(leg);
        box(jx + dx, jz + dz, 0.5, 0.5, hgt);
      }
    }
    const hut = part(new THREE.BoxGeometry(8, 4, 6), 0xdc2626, { ink: 0.05 });
    hut.position.set(jx, 19, jz - 25);
    statics.add(hut);
    zones.push({ name: 'Big Air Ski Jump', x: jx, z: jz, w: 30, d: 56, tier: 2 });
    minimap.push({ x: jx, z: jz, w: 7, d: 46, color: '#e2e8f0', label: 'Ski Jump', tier: 2 });
    container('crate', jx - 7, jz + 10, 2);
    container('locker', jx + 7, jz + 14, 2);
    container('crate', jx + 7, jz - 4, 2);
    crateStack(jx - 8, jz - 8);
    enemies('dicer', jx, jz, 3, 24);
  }

  // ----- Avalanche Row: cabins half-buried by the last slide (far east) -----
  {
    const vx = 168;
    const vz = -25;
    for (const [dz, c] of [[-26, 0x8b5a2b], [0, 0x9c6644], [26, 0x7f5539]]) {
      building({
        name: 'Buried Cabin', x: vx, z: vz + dz, w: 12, d: 10, h: 4, color: c, trim: 0xf8fafc, floor: 0x6b4f3a, tier: 2, roof: dz !== 0, mapColor: '#8b5a2b',
        doors: [{ side: 'w', at: 0, width: 2.4 }],
      });
      const drift = part(new THREE.SphereGeometry(7, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0xf8fafc, { ink: 0.04 });
      drift.scale.set(0.7, 0.6, 1);
      drift.position.set(vx + 9, 0, vz + dz);
      statics.add(drift);
      box(vx + 9, vz + dz, 9, 12, 4);
      container(dz ? 'locker' : 'safe', vx - 2, vz + dz - 2, 2);
    }
    zones.push({ name: 'Avalanche Row', x: vx, z: vz, w: 34, d: 70, tier: 2 });
    enemies('slotbot', vx - 14, vz, 1);
    enemies('shark', vx - 10, vz + 30, 1);
  }

  // ----- Old Mine (far south-west by the frozen creek) -----
  {
    const mx = -175;
    const mz = 40;
    const rockFace = part(new THREE.BoxGeometry(14, 12, 18), 0x64748b, { ink: 0.06 });
    rockFace.position.set(mx - 10, 6, mz);
    const mouth = part(new THREE.BoxGeometry(1, 4.5, 5), 0x111827, { ink: 0 });
    mouth.position.set(mx - 2.6, 2.25, mz);
    statics.add(rockFace, mouth);
    box(mx - 10, mz, 14, 18, 12);
    waterTower(mx + 8, mz - 16, 0x94a3b8);
    for (let i = 0; i < 3; i++) {
      const cart = part(new THREE.BoxGeometry(2, 1.4, 3), 0x78350f, { ink: 0.03 });
      cart.position.set(mx + 4 + i * 4, 0.9, mz + 8);
      statics.add(cart);
      box(mx + 4 + i * 4, mz + 8, 2, 3, 1.6);
    }
    zones.push({ name: 'Old Mine', x: mx, z: mz, w: 30, d: 36, tier: 1 });
    minimap.push({ x: mx - 10, z: mz, w: 14, d: 18, color: '#64748b', label: 'Old Mine', tier: 1 });
    container('crate', mx + 2, mz - 6, 1);
    container('crate', mx + 2, mz + 4, 2);
    enemies('slotbot', mx + 10, mz, 1);
  }

  // Burning barrels to warm up at, spread so you can hop between them.
  for (const [x, z] of [[-15, 30], [15, 50], [-8, 100], [8, 128], [-60, 30], [65, 30], [-90, -65], [100, -70], [70, 80], [-40, 82], [40, 112],
    [-110, 0], [110, 0], [-100, 110], [100, 115], [-60, -110], [40, -110], [0, -5], [-125, 45], [-120, -85], [110, -100],
    // The outer ring.
    [-150, -130], [-130, -175], [150, 130], [125, 160], [-145, 130], [-160, 168], [60, -138], [40, -180], [150, -25], [150, 15],
    [-160, 60], [-160, 15], [0, 170], [0, 195], [-60, 165], [75, 160], [175, 80], [175, -100], [-90, -170], [100, -165], [-185, -40], [130, 190]]) fire(x, z);

  const extracts = [
    { name: 'Gondola', x: 160, z: -175 },
    { name: 'Snowmobile Trail', x: -188, z: 95 },
    { name: 'Ice Road', x: 0, z: 188 },
    { name: 'Ski Lift', x: -190, z: -95 },
  ];
  scatter(400, (x, z) => {
    const r = Math.random();
    if (r < 0.6) pine(x, z);
    else if (r < 0.85) rock(x, z, 0.8 + Math.random() * 2);
    else if (r < 0.92) snowman(x, z);
    else crateStack(x, z);
  }, (x, z) => Math.abs(x) < 12 || Math.abs(z - 40) < 10 || extracts.some((e) => Math.hypot(x - e.x, z - e.z) < 12) || (Math.abs(x) < 25 && z < -85));
  for (let i = 0; i < 10; i++) enemies('dicer', (Math.random() * 2 - 1) * 170, (Math.random() * 2 - 1) * 170, 1);
  for (let i = 0; i < 3; i++) enemies('shark', (Math.random() * 2 - 1) * 170, (Math.random() * 2 - 1) * 170, 1);
  for (let i = 0; i < 22; i++) {
    const x = (Math.random() * 2 - 1) * (H - 20);
    const z = (Math.random() * 2 - 1) * (H - 20);
    if (zones.some((zn) => Math.abs(x - zn.x) < zn.w / 2 + 4 && Math.abs(z - zn.z) < zn.d / 2 + 4)) continue;
    container('crate', x, z, 1);
  }

  return {
    ...cas,
    extracts,
    spawns: [[-180, 175], [175, 185], [-185, -20], [185, 45], [-80, 185], [80, 188], [185, -120], [-100, -185], [20, -185]],
    hazards: { cold: true },
  };
}

function bayouRoyale(k) {
  const {
    H, THREE, statics, zones, minimap, slotSpots, part, toon, neonSign, flat, box, circle,
    rock, streetLight, billboard, crateStack, building, container, enemies, casino,
    cypress, reeds, pond, scatter, car, yard, tent, watchtower, fire,
  } = k;
  const planks = toon(0x8b6a43);
  // Boardwalks instead of roads.
  flat(0, 90, 8, 170, planks, 0.05);
  flat(0, 30, H * 2 - 20, 7, planks, 0.055);
  minimap.push({ x: 0, z: 90, w: 8, d: 170, color: '#8b6a43' }, { x: 0, z: 30, w: H * 2 - 20, d: 7, color: '#8b6a43' });
  // The river behind the riverboat.
  const river = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, 30), new THREE.MeshBasicMaterial({ color: 0x356b5c }));
  river.rotation.x = -Math.PI / 2;
  river.position.set(0, 0.03, -100);
  statics.add(river);
  minimap.push({ x: 0, z: -100, w: H * 2, d: 30, color: '#356b5c' });

  const cas = casino({
    x: 0, z: -40, name: 'Riverboat Royale', sign: 'RIVERBOAT ROYALE', signColor: '#ffd23f',
    color: 0xf5f5f4, trim: 0x991b1b, mapColor: '#b91c1c', felt: 0x14532d,
    plaza(px, pz) {
      for (const dx of [-14, 14]) cypress(px + dx, pz + 4);
      enemies('dicer', px, pz + 4, 2, 14);
    },
  });
  // Paddle wheels and smokestacks so the casino reads as a boat.
  for (const side of [-1, 1]) {
    const wheel = new THREE.Group();
    wheel.position.set(side * 52, 7, -40);
    const rim = part(new THREE.TorusGeometry(6, 0.5, 8, 24), 0xb91c1c, { ink: 0.05 });
    rim.rotation.y = Math.PI / 2;
    wheel.add(rim);
    for (let i = 0; i < 8; i++) {
      const spoke = part(new THREE.BoxGeometry(0.4, 12, 1.4), 0x7f1d1d, { ink: 0.02 });
      spoke.rotation.x = (i / 8) * Math.PI;
      wheel.add(spoke);
    }
    statics.add(wheel);
    box(side * 52, -40, 2, 12, 12);
  }
  for (const dx of [-10, 10]) {
    const stack = part(new THREE.CylinderGeometry(1.4, 1.6, 10, 12), 0x1b0f2b, { ink: 0.05 });
    stack.position.set(dx, 15, -60);
    const crown = part(new THREE.CylinderGeometry(2, 1.4, 1.2, 12), 0xd4a63a, { ink: 0.03 });
    crown.position.set(dx, 20.5, -60);
    statics.add(stack, crown);
  }

  // Stilt shacks and shops around the swamp.
  const shackColors = [0x9c6644, 0x6b705c, 0xa5a58d, 0x7f5539];
  [[-55, 55], [-75, 85], [-50, 105], [55, 60], [80, 90], [50, 110], [-95, 40], [95, 35]].forEach(([x, z], i) => {
    building({
      name: 'Stilt Shack', x, z, w: 10, d: 8, h: 4, color: shackColors[i % 4], trim: 0x3f3f2f, floor: 0x5b4636, tier: 1, mapColor: '#6b705c',
      doors: [{ side: x < 0 ? 'e' : 'w', at: 0, width: 2.2 }],
    });
    container(i % 2 ? 'crate' : 'locker', x + (x < 0 ? -2.5 : 2.5), z - 1.5, 1);
  });
  enemies('shark', -60, 80, 2, 30);
  enemies('shark', 60, 85, 2, 30);

  building({
    name: "Gator's Bait & Tackle", x: -45, z: 10, w: 18, d: 12, h: 4.5, color: 0x4d7c0f, trim: 0x1a2e05, tier: 2, sign: 'BAIT & TACKLE', signColor: '#5ee27a', mapColor: '#4d7c0f',
    doors: [{ side: 's', at: 0, width: 3 }],
  });
  container('register', -42, 7, 2);
  container('safe', -51, 13, 2);
  slotSpots.push({ x: -53.5, z: 8, rot: Math.PI / 2, tier: 2 });
  enemies('slotbot', -45, 22, 1);

  building({
    name: 'Voodoo Pawn', x: 45, z: 10, w: 16, d: 12, h: 4.5, color: 0x581c87, trim: 0xfacc15, tier: 2, sign: 'VOODOO PAWN', signColor: '#c77dff', mapColor: '#581c87',
    doors: [{ side: 's', at: 0, width: 3 }],
  });
  container('safe', 50, 7, 2);
  container('register', 40, 7, 2);
  container('locker', 50, 13, 2);
  enemies('slotbot', 45, 22, 1);
  enemies('dicer', 60, 0, 1);

  building({
    name: 'Crawdad Shack', x: 0, z: 95, w: 18, d: 12, h: 4.5, color: 0xf97316, trim: 0x431407, tier: 2, sign: 'CRAWDAD SHACK', signColor: '#ff9f43', mapColor: '#c2410c',
    doors: [{ side: 's', at: 0, width: 3 }],
  });
  container('register', 3, 92, 2);
  container('locker', -5, 98, 2);
  slotSpots.push({ x: 8.5, z: 95, rot: -Math.PI / 2, tier: 2 });
  enemies('shark', 0, 108, 1);

  building({
    name: 'Old Cannery', x: -95, z: -55, w: 26, d: 18, h: 6, color: 0x78716c, trim: 0x292524, tier: 2, mapColor: '#57534e',
    doors: [{ side: 'e', at: 0, width: 5 }],
  });
  for (const [x, z] of [[-102, -60], [-88, -60], [-100, -50]]) container('crate', x, z, 2);
  container('safe', -104, -50, 2);
  crateStack(-92, -52);
  enemies('slotbot', -95, -55, 2, 10);

  for (const [x, z, r] of [[-80, 0, 10], [75, -20, 12], [-30, 70, 8], [30, 75, 7], [-100, 100, 12], [100, 105, 10], [70, -60, 9],
    [-160, -10, 10], [155, 95, 11], [60, 155, 9], [-20, 140, 7], [-150, 120, 9]]) {
    pond(x, z, r);
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2;
      reeds(x + Math.cos(a) * r, z + Math.sin(a) * r);
    }
  }
  for (let z = 0; z < H - 15; z += 22) { streetLight(-6, z + 5); streetLight(6, z + 16); }
  billboard(-20, 50, Math.PI / 2, 'FEED THE\nGATORS', '#14532d', '#ffd23f');
  billboard(20, 70, -Math.PI / 2, 'ALL ABOARD\nTHE ROYALE', '#991b1b', '#fff6e0');
  for (let i = 0; i < 4; i++) car(-20 + i * 12, 15, 'x', undefined, i % 2 === 0);
  zones.push({ name: 'Swamp Town', x: 0, z: 60, w: 24, d: 110, tier: 2 });
  enemies('slotbot', 0, 50, 1);
  enemies('dicer', 0, 75, 2, 16);

  // ===== The outer ring =====

  // ----- Madame Marie's Mansion (southeast): spooky, guarded, worth it -----
  {
    const mx = 140;
    const mz = 145;
    building({
      name: "Madame Marie's Mansion", x: mx, z: mz, w: 32, d: 22, h: 8, color: 0xe7e5e4, trim: 0x44403c, tier: 3, sign: "MARIE'S", signColor: '#c77dff', mapColor: '#57534e',
      doors: [{ side: 'n', at: 0, width: 4 }, { side: 'w', at: 5, width: 2.4 }],
    });
    for (let i = 0; i < 6; i++) {
      const col = part(new THREE.CylinderGeometry(0.5, 0.55, 8, 10), 0xf5f5f4, { ink: 0.03 });
      col.position.set(mx - 13 + i * 5.2, 4, mz - 13);
      statics.add(col);
      circle(mx - 13 + i * 5.2, mz - 13, 0.55, 8);
    }
    const wall = part(new THREE.BoxGeometry(0.5, 8, 14), 0xe7e5e4, { ink: 0.03 });
    wall.position.set(mx + 4, 4, mz + 4);
    statics.add(wall);
    box(mx + 4, mz + 4, 0.5, 14, 8);
    container('safe', mx + 13, mz + 8, 3);
    container('safe', mx - 13, mz + 8, 3);
    container('locker', mx + 13, mz - 6, 3);
    container('crate', mx - 6, mz + 8, 3);
    slotSpots.push({ x: mx + 9, z: mz + 9, rot: Math.PI, tier: 3 });
    for (const dx of [-24, 24]) cypress(mx + dx, mz - 18);
    enemies('slotbot', mx, mz - 22, 2, 14);
    enemies('shark', mx, mz, 2, 14);
    enemies('dicer', mx - 26, mz, 2, 14);
  }

  // ----- Gator Farm (west): fenced ponds full of gators, and lots of teeth -----
  {
    const gx = -145;
    const gz = 55;
    yard({ name: 'Gator Farm', x: gx, z: gz, w: 54, d: 44, gates: ['e', 'n'], tier: 2, mapColor: '#5b7f3a' });
    for (const [dx, dz, r] of [[-14, -8, 8], [12, -10, 7], [-2, 12, 8]]) pond(gx + dx, gz + dz, r);
    building({
      name: 'Farm Office', x: gx + 18, z: gz + 14, w: 10, d: 8, h: 4, color: 0x9c6644, trim: 0x3f3f2f, tier: 2, mapColor: '#6b705c',
      doors: [{ side: 'w', at: 0, width: 2.2 }],
    });
    container('register', gx + 20, gz + 12, 2);
    container('safe', gx + 20, gz + 16, 2);
    watchtower(gx - 22, gz + 18);
    enemies('shark', gx + 30, gz, 1);
  }

  // ----- Shipwreck (across the river, southwest) -----
  {
    const sx = -120;
    const sz = -150;
    building({
      name: 'Shipwreck', x: sx, z: sz, w: 30, d: 10, h: 3.5, color: 0x5b4636, trim: 0x2b2117, floor: 0x6b4f3a, tier: 2, roof: false, mapColor: '#5b4636',
      doors: [{ side: 'n', at: -6, width: 3 }, { side: 'e', at: 0, width: 3 }],
    });
    const bow = part(new THREE.ConeGeometry(5, 9, 4), 0x5b4636, { ink: 0.05 });
    bow.rotation.set(0, Math.PI / 4, Math.PI / 2);
    bow.position.set(sx - 19, 2.5, sz);
    bow.scale.set(1, 1, 0.7);
    const mast = part(new THREE.CylinderGeometry(0.35, 0.4, 16, 8), 0x3f2e1f, { ink: 0.03 });
    mast.position.set(sx + 2, 7, sz);
    mast.rotation.z = 0.35;
    statics.add(bow, mast);
    circle(sx - 19, sz, 3.5, 5);
    container('safe', sx - 10, sz + 2, 2);
    container('crate', sx, sz - 2, 2);
    container('crate', sx + 10, sz + 2, 2);
    enemies('slotbot', sx, sz + 14, 1);
    enemies('dicer', sx, sz, 2, 16);
  }

  // ----- Fishing Camp (southeast, across the river) -----
  {
    const fx0 = 140;
    const fz0 = -150;
    for (let i = 0; i < 5; i++) tent(fx0 - 16 + i * 8, fz0 + (i % 2) * 6, [0xf97316, 0x2a9d8f, 0xe63946, 0xffd23f, 0x4dabff][i]);
    fire(fx0, fz0 + 12);
    building({
      name: 'Bait Shed', x: fx0 + 22, z: fz0 + 10, w: 10, d: 8, h: 3.6, color: 0x6b705c, trim: 0x3f3f2f, tier: 1, mapColor: '#6b705c',
      doors: [{ side: 'w', at: 0, width: 2.2 }],
    });
    zones.push({ name: 'Fishing Camp', x: fx0, z: fz0 + 4, w: 44, d: 24, tier: 1 });
    minimap.push({ x: fx0, z: fz0 + 4, w: 36, d: 14, color: '#7c6a4f', label: 'Fishing Camp', tier: 1 });
    container('crate', fx0 - 12, fz0 + 8, 1);
    container('locker', fx0 + 24, fz0 + 8, 1);
    container('crate', fx0 + 6, fz0 - 4, 1);
    enemies('shark', fx0, fz0, 1);
    enemies('dicer', fx0 + 10, fz0 + 10, 1);
  }

  // ----- Sunken Chapel (north-west of the bus stop) -----
  {
    const cx = -65;
    const cz = 160;
    building({
      name: 'Sunken Chapel', x: cx, z: cz, w: 14, d: 20, h: 6, color: 0xd6d3d1, trim: 0x44403c, tier: 2, sign: 'ST. JACKPOT', signColor: '#ffd23f', mapColor: '#78716c',
      doors: [{ side: 'e', at: 0, width: 3 }],
    });
    const steeple = part(new THREE.ConeGeometry(2.5, 6, 4), 0x44403c);
    steeple.position.set(cx, 9.3, cz - 6);
    steeple.rotation.set(0.15, Math.PI / 4, 0.1);
    statics.add(steeple);
    pond(cx - 18, cz, 7);
    container('locker', cx - 3, cz - 6, 2);
    container('safe', cx - 3, cz + 6, 2);
    slotSpots.push({ x: cx + 3, z: cz - 8, rot: 0, tier: 2 });
    enemies('shark', cx + 14, cz, 1);
    enemies('dicer', cx, cz + 16, 1);
  }

  // ----- Swamp Gas & Bait (east, on the far boardwalk) -----
  {
    flat(130, 30, 60, 7, planks, 0.055);
    building({
      name: 'Swamp Gas', x: 160, z: 50, w: 16, d: 12, h: 4.5, color: 0xfacc15, trim: 0x1a2e05, tier: 2, sign: 'SWAMP GAS', signColor: '#5ee27a', mapColor: '#ca8a04',
      doors: [{ side: 'n', at: 0, width: 3 }],
    });
    container('register', 156, 52, 2);
    container('locker', 165, 54, 2);
    for (let i = 0; i < 3; i++) car(140 + i * 9, 40, 'z', undefined, i === 1);
    enemies('slotbot', 160, 36, 1);
  }

  const extracts = [
    { name: 'Airboat Dock', x: -160, z: -165 },
    { name: 'Old Bridge', x: 170, z: -40 },
    { name: 'Bus Stop', x: 0, z: 175 },
    { name: 'Hidden Bayou', x: -165, z: 165 },
  ];
  scatter(380, (x, z) => {
    const r = Math.random();
    if (r < 0.5) cypress(x, z);
    else if (r < 0.75) reeds(x, z);
    else if (r < 0.9) rock(x, z, 0.8 + Math.random() * 1.8);
    else crateStack(x, z);
  }, (x, z) => Math.abs(x) < 9 || Math.abs(z - 30) < 8 || Math.abs(z + 100) < 18 || extracts.some((e) => Math.hypot(x - e.x, z - e.z) < 12));
  for (let i = 0; i < 10; i++) enemies('dicer', (Math.random() * 2 - 1) * 160, (Math.random() * 2 - 1) * 160, 1);
  for (let i = 0; i < 3; i++) enemies('shark', (Math.random() * 2 - 1) * 160, (Math.random() * 2 - 1) * 160, 1);
  for (let i = 0; i < 22; i++) {
    const x = (Math.random() * 2 - 1) * (H - 20);
    const z = (Math.random() * 2 - 1) * (H - 20);
    if (zones.some((zn) => Math.abs(x - zn.x) < zn.w / 2 + 4 && Math.abs(z - zn.z) < zn.d / 2 + 4)) continue;
    container('crate', x, z, 1);
  }

  return {
    ...cas,
    extracts,
    spawns: [[-170, 20], [172, 10], [-120, -175], [120, -175], [-100, 175], [100, 175], [172, 110], [-172, -60], [50, -175]],
  };
}

const BUILDERS = { vegas: lostVegas, frost: frostbitePeaks, bayou: bayouRoyale };
