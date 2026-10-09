// The raid maps: Lost Vegas, Frostbite Peaks and Bayou Royale, built from a shared kit.
//
// Static scenery is collected into `statics` and merged per 60m chunk by `bake()`, so a huge map
// still costs only a few hundred draw calls (and far chunks get frustum-culled).
// Colliders live in a spatial grid so physics and bullets only check nearby ones.
import * as THREE from 'three';
import { topAt } from './physics.js';
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
  // Two faces back to back, so it reads the right way round from either side.
  const geo = new THREE.PlaneGeometry(width, width * 0.195);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  const g = new THREE.Group();
  const front = new THREE.Mesh(geo, mat);
  const back = new THREE.Mesh(geo, mat);
  back.rotation.y = Math.PI;
  g.add(front, back);
  return g;
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
// What each danger level means, so a Hard map really is harder than a Medium one: machine health,
// how hard everything hits you, how many machines, how many raiders (and how sharp), and the boss.
export const DIFFICULTY = {
  Safe: { hp: 1, dmg: 1, count: 1, raiders: 1, skill: 1, boss: { hp: 1, dmg: 1, rate: 1 } },
  // Medium bosses are the ones people learn on: less health, softer hits, specials a bit slower.
  Medium: { hp: 1, dmg: 1, count: 1, raiders: 1, skill: 1, boss: { hp: 0.7, dmg: 0.7, rate: 0.9, adds: 2, addDmg: 0.5, addSpeed: 0.75 } },
  Hard: { hp: 1.35, dmg: 1.25, count: 1.3, raiders: 1.25, skill: 1.08, boss: { hp: 1.6, dmg: 1.25, rate: 1.15, adds: 3, addDmg: 0.75, addSpeed: 0.85 } },
  Deadly: { hp: 1.7, dmg: 1.5, count: 1.4, raiders: 1.4, skill: 1.15, boss: { hp: 2.4, dmg: 1.5, rate: 1.3 } },
};

export const MAPS = {
  vegas: {
    name: 'Lost Vegas', icon: '🌵', size: 'Huge', danger: 'Medium', half: 330, wilds: 'The Desert',
    blurb: 'A sun-baked desert strip. The Lucky Dump Grand casino sits in the middle with a vault in the back.',
    sky: [0x2a1650, 0xb3477a, 0xf6a35c], fog: 0xd77a6a,
    ground: { base: '#e8b878', a: 'rgba(170,110,60,0.18)', b: 'rgba(255,230,180,0.25)' },
    mapGround: '#e7c08a', hemi: [0xffe2c4, 0x7a4a5a, 1.7], sun: [0xffd2a1, 2.3], mountains: [0xa0522d, 0x8b4513], glow: 0xff3fa4, tough: 1,
  },
  frost: {
    name: 'Frostbite Peaks', icon: '🏔️', size: 'Huge', danger: 'Hard', half: 290, wilds: 'The Backcountry',
    blurb: 'A snowed-in ski town. Machines are tougher up here, and the Alpine Ace Lodge hides the good stuff.',
    sky: [0x1e3a5f, 0x7aa6d6, 0xdbeafe], fog: 0xc7d9ef,
    ground: { base: '#eef2f7', a: 'rgba(148,163,184,0.22)', b: 'rgba(255,255,255,0.7)' },
    mapGround: '#eef3f8', hemi: [0xeef6ff, 0x8090b0, 1.8], sun: [0xfff4e6, 2.2], mountains: [0xe2e8f0, 0x94a3b8], glow: 0x2ee6d6, tough: 1.3,
  },
  tequila: {
    name: 'Temakilla', icon: '🍷', size: 'Huge', danger: 'Hard', half: 300, wilds: 'The Hills',
    blurb: 'Temecula wine country: Old Town\'s Front Street, vineyards on every hill and hot air balloons overhead. The Grand Vine Casino sits up the hill, Château Jackpot keeps the good bottles locked up, and Santa Ana dust storms roll in off the desert.',
    sky: [0x2b3a67, 0x8fb8de, 0xf7c59f], fog: 0xd9c3a5,
    ground: { base: '#c8b27a', a: 'rgba(120,140,60,0.25)', b: 'rgba(255,236,190,0.25)' },
    mapGround: '#bfae78', hemi: [0xfff1dc, 0x6b5a4a, 1.75], sun: [0xffe2b8, 2.3], mountains: [0x9c7b5b, 0x7a6248], glow: 0xff7eb6, tough: 1.15,
  },
  bunker: {
    name: 'The Bunker', icon: '🥊', size: 'Small', danger: 'Deadly', half: 95, wilds: 'Service Tunnels', indoor: true,
    blurb: 'An underground high-stakes den. Guard machines in every room, a pack of raiders who want your stuff, the meanest boss in the game, and the BEST loot: every crate is vault-grade.',
    sky: [0x0b0612, 0x120a1c, 0x1b0f2b], fog: 0x120a1c,
    ground: { base: '#3a3046', a: 'rgba(0,0,0,0.25)', b: 'rgba(120,90,150,0.18)' },
    mapGround: '#2b2238', hemi: [0xd8c8ff, 0x3a2a4a, 2.2], sun: [0xffe0f0, 0.6], mountains: null, glow: 0xff3fa4, tough: 1,
    raidTime: 600, raiders: 13, hostile: 0.9,
    // The best loot in the game (everything a tier up, an extra item per search). Raiders aim a
    // little looser than outdoors so close quarters stay a fair fight.
    lootBonus: 1, lootRolls: 1, botSkill: 0.8, botAim: 1.7,
  },
  lounge: {
    name: 'High Roller Lounge', icon: '🎩', size: 'Social', danger: 'Safe', half: 60, wilds: 'The Lounge', indoor: true,
    blurb: 'No machines, no raiders, no shooting... except in The Pit. Challenge a friend (or the House Champion) to a 1v1 and bet chips or your guns on it.',
    sky: [0x0b0612, 0x120a1c, 0x1b0f2b], fog: 0x1b0f2b,
    ground: { base: '#5a1f3a', a: 'rgba(0,0,0,0.2)', b: 'rgba(255,210,63,0.12)' },
    mapGround: '#3a1d2c', hemi: [0xffe6f0, 0x3a2a4a, 2.4], sun: [0xffe0f0, 0.5], mountains: null, glow: 0xffd23f, tough: 1,
    raidTime: 7200, raiders: 0, hostile: 0, safe: true, noBoss: true,
  },
  training: {
    name: 'Training Floor', icon: '🎓', size: 'Tiny', danger: 'Safe', half: 52, wilds: 'Training Floor', tutorial: true,
    blurb: 'A practice run through the basics: moving, looting, shooting, healing and getting out.',
    sky: [0x2a1650, 0x7b3fa0, 0xf6a35c], fog: 0xb07ab0,
    ground: { base: '#c9a46b', a: 'rgba(120,80,40,0.15)', b: 'rgba(255,230,180,0.2)' },
    mapGround: '#c9a46b', hemi: [0xffe2c4, 0x6a4a6a, 1.8], sun: [0xffd2a1, 2.2], mountains: [0xa0522d, 0x8b4513], glow: 0xff3fa4, tough: 1,
    raidTime: 1800, raiders: 0, hostile: 0, noBoss: true,
  },
  bayou: {
    name: 'Bayou Royale', icon: '🐊', size: 'Huge', danger: 'Medium', half: 270, wilds: 'The Swamp',
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
  scene.fog = def.indoor ? new THREE.Fog(def.fog, 40, 140) : new THREE.Fog(def.fog, 80, 230);
  if (!def.indoor) scene.add(skyDome(def.sky));
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
    c.proxy = c.noProxy ? null : proxyFor(c, c.bottom || 0);
    insert(c, ...boundsOf(c));
    return c;
  }
  // Something bullets and the camera hit but you don't walk into (roofs).
  function addRayBlocker(minX, maxX, minZ, maxZ, bottom, top) {
    const c = { type: 'box', minX, maxX, minZ, maxZ, top, rayOnly: true };
    c.proxy = proxyFor(c, bottom);
    insert(c, minX, maxX, minZ, maxZ);
  }
  function removeCollider(c) {
    const [minX, maxX, minZ, maxZ] = boundsOf(c);
    for (let cx = Math.floor((minX - 1) / CELL); cx <= Math.floor((maxX + 1) / CELL); cx++) {
      for (let cz = Math.floor((minZ - 1) / CELL); cz <= Math.floor((maxZ + 1) / CELL); cz++) {
        const list = grid.get(cellKey(cx, cz));
        if (list) { const i = list.indexOf(c); if (i >= 0) list.splice(i, 1); }
      }
    }
  }
  // Trees, cacti and rocks, so a tower or monument built later can clear them out of its way
  // (no more pine trees growing through a staircase).
  const scenery = [];
  function clearScenery(minX, maxX, minZ, maxZ) {
    for (let i = scenery.length - 1; i >= 0; i--) {
      const t = scenery[i];
      if (t.x + t.r < minX || t.x - t.r > maxX || t.z + t.r < minZ || t.z - t.r > maxZ) continue;
      if (t.obj.parent) t.obj.parent.remove(t.obj);
      removeCollider(t.col);
      scenery.splice(i, 1);
    }
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
    scenery.push({ x, z, r: 2, obj: g, col: circle(x, z, 0.35, 8) });
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
    scenery.push({ x, z, r: s, obj: g, col: circle(x, z, 0.4 * s, 3 * s) });
  }

  function rock(x, z, s) {
    const m = part(new THREE.DodecahedronGeometry(s, 0), 0xb08968, { ink: 0.05 });
    m.position.set(x, s * 0.35, z);
    m.scale.y = 0.6;
    m.rotation.y = Math.random() * Math.PI;
    statics.add(m);
    scenery.push({ x, z, r: s, obj: m, col: circle(x, z, s * 0.9, s * 0.9) });
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

  const winFrameMat = toon(0xfff6e0);
  const artMats = [0xe63946, 0x2ee6d6, 0xffd23f, 0xc77dff, 0x5ee27a, 0xff9f43].map((c) => new THREE.MeshBasicMaterial({ color: c }));
  const rugMats = [0x9b2226, 0x1d3557, 0x6a4c93, 0x2d6a4f, 0x7f5539].map((c) => toon(c));
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff1b8 });
  const winPaneMat = new THREE.MeshBasicMaterial({ color: 0x35507a });

  const doorFronts = [];
  const interiors = [];
  // Walls with door gaps, a floor and a roof. doors: [{ side: 'n'|'s'|'e'|'w', at, width }]
  function building({ name, x, z, w, d, h = 5, color = 0xe9d8a6, trim = 0x2b2140, floor = 0x9c6b4a, floorMap = null, doors = [], tier = 2, sign = null, signColor = '#ff3fa4', roof = true, mapColor = '#6b4f3a', windows = !def.indoor, furnish = true }) {
    const T = 0.5;
    const innerMat = toon(new THREE.Color(color).multiplyScalar(0.72).getHex());
    const wallMat = toon(color);
    const trimMat = toon(trim);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMap ? toon(0xffffff, { map: floorMap }) : toon(floor));
    fl.rotation.x = -Math.PI / 2;
    fl.position.set(x, 0.05, z);
    fl.receiveShadow = true;
    statics.add(fl);
    if (roof && furnish && w >= 6 && d >= 6 && w * d < 2500) {
      const rug = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.45, d * 0.45), rugMats[Math.abs(Math.round(x * 3 + z * 5)) % rugMats.length]);
      rug.rotation.x = -Math.PI / 2;
      rug.position.set(x, 0.07, z);
      statics.add(rug);
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.12, 12), lampMat);
      lamp.position.set(x, h - 0.12, z);
      statics.add(lamp);
    }

    // Rooms get furniture later, once everything else is placed (see the furnishing pass).
    if (furnish && w >= 5 && d >= 5 && w * d < 2500 && (roof || def.indoor)) interiors.push({ name, x, z, w, d, h, doors });
    // Remember where the doors are, so the outside can be dressed without blocking them.
    for (const dr of doors) {
      const nx = dr.side === 'e' ? 1 : dr.side === 'w' ? -1 : 0;
      const nz = dr.side === 's' ? 1 : dr.side === 'n' ? -1 : 0;
      doorFronts.push({ x: nz ? x + dr.at : x + (nx * w) / 2, z: nz ? z + (nz * d) / 2 : z + dr.at, nx, nz, width: dr.width });
    }
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
        // Inside: a painted band along the bottom of the wall, and the odd picture.
        if (roof && furnish) {
          const inn = key === 'n' || key === 'w' ? 1 : -1;
          const bx = s.horiz ? wx : s.cx + inn * (T / 2 + 0.02);
          const bz = s.horiz ? s.cz + inn * (T / 2 + 0.02) : wz;
          const band = new THREE.Mesh(new THREE.BoxGeometry(s.horiz ? len : 0.04, 1.1, s.horiz ? 0.04 : len), innerMat);
          band.position.set(bx, 0.55, bz);
          statics.add(band);
          if (len >= 5 && h >= 3.6) {
            const pic = new THREE.Mesh(new THREE.BoxGeometry(s.horiz ? 1.4 : 0.05, 1.0, s.horiz ? 0.05 : 1.4), trimMat);
            pic.position.set(bx, Math.min(2.4, h - 1.2), bz);
            const art = new THREE.Mesh(new THREE.BoxGeometry(s.horiz ? 1.1 : 0.06, 0.7, s.horiz ? 0.06 : 1.1), artMats[(Math.abs(Math.round(wx * 7 + wz * 3))) % artMats.length]);
            art.position.set(bx + (s.horiz ? 0 : inn * 0.01), pic.position.y, bz + (s.horiz ? inn * 0.01 : 0));
            statics.add(pic, art);
          }
        }
        // Windows along the outside, so buildings aren't blank boxes.
        if (windows && roof && h >= 3.6 && len >= 3.4) {
          const out = key === 'n' || key === 'w' ? -1 : 1;
          const n = Math.max(1, Math.floor((len - 1) / 4.2));
          const step = len / n;
          const wy = Math.min(2.3, h * 0.5);
          for (let i = 0; i < n; i++) {
            const along = a + step * (i + 0.5);
            const px = s.horiz ? s.cx + along : s.cx + out * (T / 2 + 0.03);
            const pz = s.horiz ? s.cz + out * (T / 2 + 0.03) : s.cz + along;
            const fr = new THREE.Mesh(new THREE.BoxGeometry(s.horiz ? 1.7 : 0.08, 1.35, s.horiz ? 0.08 : 1.7), winFrameMat);
            fr.position.set(px, wy, pz);
            const pane = new THREE.Mesh(new THREE.BoxGeometry(s.horiz ? 1.4 : 0.1, 1.05, s.horiz ? 0.1 : 1.4), winPaneMat);
            pane.position.set(px + (s.horiz ? 0 : out * 0.02), wy, pz + (s.horiz ? out * 0.02 : 0));
            const sill = new THREE.Mesh(new THREE.BoxGeometry(s.horiz ? 1.9 : 0.22, 0.12, s.horiz ? 0.22 : 1.9), trimMat);
            sill.position.set(px + (s.horiz ? 0 : out * 0.06), wy - 0.72, pz + (s.horiz ? out * 0.06 : 0));
            statics.add(fr, pane, sill);
            // Taller buildings get a second row.
            if (h >= 7.5) {
              const fr2 = fr.clone();
              fr2.position.y = wy + 3.4;
              const pane2 = pane.clone();
              pane2.position.y = wy + 3.4;
              statics.add(fr2, pane2);
            }
          }
        }
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

  const container = (kind, x, z, tier, rot = 0, y = 0) => containers.push({ kind, x, z, tier, rot, y });
  const enemies = (type, x, z, n = 1, spread = 6, y = 0) => {
    for (let i = 0; i < n; i++) enemySpots.push({ type, x: x + (Math.random() - 0.5) * spread, z: z + (Math.random() - 0.5) * spread, y });
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
    scenery.push({ x, z, r: 2 * s, obj: g, col: circle(x, z, 0.5 * s, 7 * s) });
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
    scenery.push({ x, z, r: 2.4 * s, obj: g, col: circle(x, z, 0.8 * s, 8 * s) });
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
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const s = 30 + Math.random() * 30;
      // Out past the edge of the (square) map, never poking into it, corners included.
      const edge = H + s + 6 + Math.random() * 20;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const k = edge / Math.max(Math.abs(c), Math.abs(sn));
      const m = new THREE.Mesh(new THREE.ConeGeometry(s, s * (0.8 + Math.random() * 0.6), 5), toon(colors[i % 2]));
      m.position.set(c * k, s * 0.35, sn * k);
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
    const doorways = [{ side: 's', at: 0, width: 12 }, { side: 'w', at: 10, width: 5 }, { side: 'e', at: 10, width: 5 }, { side: 'n', at: 30, width: 4 }];
    building({ name, x: CX, z: CZ, w: CW, d: CD, h: 10, color, trim, floorMap: carpetTexture(), tier: 3, mapColor, doors: doorways, windows: false, furnish: false });
    // Where the doorways are in the world (the Pit Boss fight seals them).
    const doors = doorways.map((dr) => {
      const horiz = dr.side === 's' || dr.side === 'n';
      return {
        horiz,
        width: dr.width,
        x: horiz ? CX + dr.at : CX + (dr.side === 'e' ? CW / 2 : -CW / 2),
        z: horiz ? CZ + (dr.side === 's' ? CD / 2 : -CD / 2) : CZ + dr.at,
      };
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
    // The front: a lit marquee over the doors, a red carpet, rows of windows, bulbs along the
    // roofline and a giant chip on each front corner.
    const FZ = CZ + CD / 2 + 0.35;
    const frontTrimMat = toon(trim);
    const canopy = part(new THREE.BoxGeometry(24, 0.7, 6), frontTrimMat, { ink: 0.03 });
    canopy.position.set(CX, 7.6, FZ + 3);
    statics.add(canopy);
    addRayBlocker(CX - 12, CX + 12, FZ, FZ + 6, 7.25, 7.95);
    const marquee = part(new THREE.BoxGeometry(24, 1.2, 0.3), 0x1b0f2b, { ink: 0.02 });
    marquee.position.set(CX, 8.5, FZ + 6);
    statics.add(marquee);
    const frontBulbMat = new THREE.MeshBasicMaterial({ color: 0xfff1b8 });
    const frontBulbGeo = new THREE.SphereGeometry(0.16, 6, 5);
    for (let i = 0; i <= 24; i++) {
      for (const [y, z] of [[8.0, FZ + 6.2], [9.0, FZ + 6.2]]) {
        const b = new THREE.Mesh(frontBulbGeo, frontBulbMat);
        b.position.set(CX - 12 + i, y, z);
        statics.add(b);
      }
    }
    flat(CX, FZ + 7, 9, 14, toon(0xb91c1c), 0.045);
    for (const side of [-1, 1]) {
      const rope = part(new THREE.BoxGeometry(0.1, 0.1, 10), 0xd4a63a, { ink: 0 });
      rope.position.set(CX + side * 5.4, 0.9, FZ + 8);
      statics.add(rope);
      for (let k = 0; k < 3; k++) {
        const post = part(new THREE.CylinderGeometry(0.12, 0.16, 1, 8), 0xd4a63a, { ink: 0.01 });
        post.position.set(CX + side * 5.4, 0.5, FZ + 3 + k * 5);
        statics.add(post);
      }
    }
    const frontGlass = new THREE.MeshBasicMaterial({ color: 0x2a1b4a });
    const frontFrameMat = toon(0xfff1b8);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        const wx = CX + side * (16 + i * 5.6);
        for (const wy of [3.2, 6.6]) {
          const fr = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.1, 0.12), frontFrameMat);
          fr.position.set(wx, wy, FZ + 0.02);
          const pane = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.7), frontGlass);
          pane.position.set(wx, wy, FZ + 0.1);
          statics.add(fr, pane);
        }
      }
    }
    for (let x = -CW / 2; x <= CW / 2; x += 2) {
      const b = new THREE.Mesh(frontBulbGeo, frontBulbMat);
      b.position.set(CX + x, 10.55, FZ + 0.15);
      statics.add(b);
    }
    for (const side of [-1, 1]) {
      const chip = part(new THREE.CylinderGeometry(3, 3, 0.8, 24), 0xe63946, { ink: 0.03 });
      chip.rotation.x = Math.PI / 2;
      chip.position.set(CX + side * (CW / 2 - 4), 13.4, FZ - 1);
      const spot = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.85, 20), frontFrameMat);
      spot.rotation.x = Math.PI / 2;
      spot.position.copy(chip.position);
      const stand = part(new THREE.BoxGeometry(0.5, 3, 0.5), trim, { ink: 0.02 });
      stand.position.set(CX + side * (CW / 2 - 4), 11, FZ - 1);
      statics.add(chip, spot, stand);
    }

    // Vault room at the back, behind a locked door.
    // A tight little strongroom: three treasure chests, and whatever's guarding them.
    const VW = 16;
    const VD = 12;
    const vz = CZ - CD / 2 + VD / 2;
    const vaultWall = toon(0x374151);
    for (const [x0, x1] of [[-VW / 2, -2.5], [2.5, VW / 2]]) {
      const len = x1 - x0;
      const wall = part(new THREE.BoxGeometry(len, 10, 0.8), vaultWall, { ink: 0.04 });
      wall.position.set(CX + (x0 + x1) / 2, 5, vz + VD / 2);
      statics.add(wall);
      box(CX + (x0 + x1) / 2, vz + VD / 2, len, 0.8, 10);
    }
    for (const sx of [-VW / 2, VW / 2]) {
      const wall = part(new THREE.BoxGeometry(0.8, 10, VD), vaultWall, { ink: 0.04 });
      wall.position.set(CX + sx, 5, vz);
      statics.add(wall);
      box(CX + sx, vz, 0.8, VD, 10);
    }
    // Gold trim and a velvet rug so it feels like a vault.
    flat(CX, vz, VW - 1, VD - 1, toon(0x7a1028), 0.05);
    const vaultSign = neonSign('THE VAULT', '#ffd23f', 8);
    vaultSign.position.set(CX, 6.5, vz + VD / 2 + 0.5);
    statics.add(vaultSign);
    zones.push({ name: 'The Vault', x: CX, z: vz, w: VW, d: VD, tier: 4 });
    minimap.push({ x: CX, z: vz, w: VW, d: VD, color: '#374151', label: 'Vault' });
    for (const vx of [-4.5, 0, 4.5]) container('vault', CX + vx, vz - 2.5, 4);

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
    // Real cover for the boss fight: marble pillars up to the ceiling, back-to-back banks of tall
    // slot machines, and a giant chip statue by the doors. Rockets and bullets stop on all of them.
    const marble = toon(0xf3e8d6);
    const goldM = toon(0xd4a63a);
    const comps = [];
    for (const [px, pz] of [[-10, 2], [10, 2], [-34, 20], [34, 20], [-36, -6], [36, -6], [0, -6]]) {
      const shaft = part(new THREE.CylinderGeometry(1.15, 1.15, 10, 18), marble, { ink: 0.03 });
      shaft.position.set(CX + px, 5, CZ + pz);
      for (const y of [0.35, 9.65]) {
        const cap = part(new THREE.CylinderGeometry(1.5, 1.5, 0.7, 18), goldM, { ink: 0.02 });
        cap.position.set(CX + px, y, CZ + pz);
        statics.add(cap);
      }
      statics.add(shaft);
      circle(CX + px, CZ + pz, 1.3, 10);
      comps.push({ x: CX + px, z: CZ + pz + (pz < 10 ? -2.2 : 2.2) });
    }
    const bankColors = [0x2a9d8f, 0xe63946, 0x7b2cbf, 0xff9f1c];
    for (const [bx, bz] of [[-20, -8], [20, -8], [-38, 30], [38, 30]]) {
      const g = new THREE.Group();
      g.position.set(CX + bx, 0, CZ + bz);
      const core = part(new THREE.BoxGeometry(7.2, 3.4, 1.0), 0x1b0f2b, { ink: 0.03 });
      core.position.y = 1.7;
      g.add(core);
      for (const face of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          const mx = -2.7 + i * 1.8;
          const body = part(new THREE.BoxGeometry(1.6, 3.0, 0.6), bankColors[(i + (face > 0 ? 1 : 0)) % 4], { ink: 0.02 });
          body.position.set(mx, 1.5, face * 0.75);
          const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7), new THREE.MeshBasicMaterial({ color: 0xfff6e0 }));
          scr.position.set(mx, 2.2, face * 1.06);
          if (face < 0) scr.rotation.y = Math.PI;
          const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: [0xff3fa4, 0xffd23f, 0x2ee6d6][i % 3] }));
          lamp.position.set(mx, 3.2, face * 0.75);
          g.add(body, scr, lamp);
        }
      }
      const sign = part(new THREE.BoxGeometry(7.4, 0.5, 0.3), 0xd4a63a, { ink: 0.02 });
      sign.position.y = 3.65;
      g.add(sign);
      statics.add(g);
      box(CX + bx, CZ + bz, 7.4, 2.2, 3.9);
    }
    // The chip statue: a tall stack of giant chips on a plinth.
    {
      const sx = CX;
      const sz = CZ + 26;
      const plinth = part(new THREE.CylinderGeometry(2.4, 2.6, 1, 24), 0x2b2140, { ink: 0.03 });
      plinth.position.set(sx, 0.5, sz);
      statics.add(plinth);
      const chipCols = [0xe63946, 0x1b0f2b, 0x2a9d8f, 0x7b2cbf, 0xffd23f];
      for (let i = 0; i < 6; i++) {
        const c = part(new THREE.CylinderGeometry(1.9, 1.9, 0.55, 28), chipCols[i % 5], { ink: 0.02 });
        c.position.set(sx + Math.sin(i * 1.7) * 0.12, 1.3 + i * 0.56, sz + Math.cos(i * 1.7) * 0.12);
        statics.add(c);
      }
      circle(sx, sz, 2.4, 4.6);
      comps.push({ x: sx, z: sz - 3.2 });
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
    for (const [kx, kz] of [[-18, -12], [18, -12], [-40, 15], [40, 15], [-20, 31], [20, 31]]) container('crate', CX + kx, CZ + kz, 3);
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
      casino: { x: CX, z: CZ, w: CW, d: CD, doors, comps },
      vault: { x: CX, z: vz, doorZ: vz + VD / 2 },
    };
  }

  // ---------- bigger set pieces for the outer areas ----------

  const fencePanel = new THREE.MeshBasicMaterial({ color: 0x9ca3af, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
  // A straight chain-link fence between two points on the same row or column.
  function fenceLine(x1, z1, x2, z2, h = 2.6) {
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
  // A stone wall with a capstone (the fancy version of a fence).
  function stoneWall(x1, z1, x2, z2, h = 2.4, color = 0xd6c7a1) {
    const horiz = Math.abs(z2 - z1) < Math.abs(x2 - x1);
    const len = horiz ? Math.abs(x2 - x1) : Math.abs(z2 - z1);
    if (len < 0.5) return;
    const cx = (x1 + x2) / 2;
    const cz = (z1 + z2) / 2;
    const wall = part(new THREE.BoxGeometry(horiz ? len : 0.8, h, horiz ? 0.8 : len), color, { ink: 0.03 });
    wall.position.set(cx, h / 2, cz);
    const cap = part(new THREE.BoxGeometry(horiz ? len + 0.2 : 1.1, 0.3, horiz ? 1.1 : len + 0.2), 0x8b5a2b, { ink: 0.02 });
    cap.position.set(cx, h + 0.15, cz);
    statics.add(wall, cap);
    for (let t = 0; t <= len + 0.01; t += 8) {
      const pillar = part(new THREE.BoxGeometry(1.2, h + 0.8, 1.2), color, { ink: 0.03 });
      pillar.position.set(horiz ? Math.min(x1, x2) + t : cx, (h + 0.8) / 2, horiz ? cz : Math.min(z1, z2) + t);
      statics.add(pillar);
    }
    box(cx, cz, horiz ? len : 0.8, horiz ? 0.8 : len, h);
  }
  const fence = fenceLine;
  // A fenced yard with a gate in the middle of each listed side. Counts as an outdoor zone.
  function yard({ name, x, z, w, d, gates = ['s'], gate = 8, tier = 2, mapColor = '#8a8a8a', wall = null }) {
    const hw = w / 2;
    const hd = d / 2;
    const fence = wall ? (ax, az, bx, bz) => stoneWall(ax, az, bx, bz, 2.4, wall) : fenceLine;
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

  // A little settlement out in the wilds: 2-4 buildings around a yard, loot, a few machines.
  function outposts({ names, colors, inner, outer, count = names.length, tier = 2, types = ['slotbot', 'dicer', 'shark'], avoid = () => false, extra = null, exits = [] }) {
    let placed = 0;
    for (let tries = 0; placed < count && tries < 600; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = inner + Math.random() * (outer - inner);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (Math.abs(x) > H - 30 || Math.abs(z) > H - 30) continue;
      if (zones.some((zn) => Math.abs(x - zn.x) < zn.w / 2 + 26 && Math.abs(z - zn.z) < zn.d / 2 + 26)) continue;
      if (avoid(x, z)) continue;
      if (exits.some((e) => Math.hypot(x - e.x, z - e.z) < 32)) continue;
      const name = names[placed % names.length];
      const spots = [[14, 0, 'w'], [-14, 0, 'e'], [0, 14, 'n'], [0, -14, 's']].sort(() => Math.random() - 0.5).slice(0, 2 + Math.floor(Math.random() * 3));
      spots.forEach(([dx, dz, side], i) => {
        const along = side === 'w' || side === 'e';
        const w = along ? 9 + Math.random() * 2 : 10 + Math.random() * 3;
        const d = along ? 10 + Math.random() * 3 : 9 + Math.random() * 2;
        const color = colors[Math.floor(Math.random() * colors.length)];
        building({
          name, x: x + dx, z: z + dz, w, d, h: 4.2, color, trim: 0x2b2140, tier, mapColor: `#${new THREE.Color(color).multiplyScalar(0.7).getHexString()}`,
          doors: [{ side, at: 0, width: 2.6 }], sign: i === 0 ? name.toUpperCase().slice(0, 16) : null, signColor: ['#ffd23f', '#2ee6d6', '#ff7eb6', '#5ee27a'][placed % 4],
        });
        container(i === 0 && Math.random() < 0.45 ? 'safe' : i % 2 ? 'locker' : 'crate', x + dx * 1.15, z + dz * 1.15, tier);
      });
      crateStack(x + (Math.random() - 0.5) * 6, z + (Math.random() - 0.5) * 6);
      if (Math.random() < 0.4) slotSpots.push({ x: x + 3, z, rot: Math.random() * Math.PI * 2, tier: Math.min(3, tier) });
      enemies(types[Math.floor(Math.random() * types.length)], x, z, 2 + Math.floor(Math.random() * 2), 12);
      if (extra) extra(x, z);
      placed++;
    }
  }

  // Spawn points spread around the edge of the map.
  function ringSpawns(n = 12, inset = 20) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.2;
      const r = H - inset;
      // Push to the square's edge so corners get used too.
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const k = r / Math.max(Math.abs(c), Math.abs(sn));
      out.push([Math.round(c * Math.min(k, r * 1.3)), Math.round(sn * Math.min(k, r * 1.3))]);
    }
    return out.map(([x, z]) => [Math.max(-H + inset, Math.min(H - inset, x)), Math.max(-H + inset, Math.min(H - inset, z))]);
  }

  const kit = {
    H, THREE, statics, zones, minimap, containers, slotSpots, enemySpots, solids,
    part, toon, neonSign, carpetTexture, flat, box, circle, addCollider, addRayBlocker,
    car, palm, cactus, rock, streetLight, billboard, crateStack, building, container, enemies,
    pine, snowman, cypress, reeds, pond, mountains, scatter, casino, fire, ponds, fires,
    fence, yard, waterTower, watchtower, tent, boxcar, rails, pyramid, boardTexture,
    outposts, ringSpawns, def, animate: (fn) => animated.push(fn),
  };
  const layout = BUILDERS[mapId in BUILDERS ? mapId : 'vegas'](kit);
  if (def.mountains) mountains(def.mountains);
  const { extracts, spawns } = layout;

  // Safety net: an exit circle with a building in it, or a spawn inside something solid, gets
  // nudged to the nearest clear ground.
  const solidAt = (x, z, r, minTop) => {
    // The centre, plus a grid of points across the circle (the centre always counts, even for tiny r).
    const pts = [[0, 0]];
    for (let dx = -r; dx <= r; dx += 1.5) for (let dz = -r; dz <= r; dz += 1.5) if (dx * dx + dz * dz <= r * r) pts.push([dx, dz]);
    for (const [dx, dz] of pts) {
      {
        const px = x + dx;
        const pz = z + dz;
        for (const c of grid.get(cellKey(Math.floor(px / CELL), Math.floor(pz / CELL))) || []) {
          if (c.rayOnly || c.top < minTop || (c.bottom && c.bottom > 2)) continue;
          if (c.type === 'box' ? px > c.minX && px < c.maxX && pz > c.minZ && pz < c.maxZ : Math.hypot(px - c.x, pz - c.z) < c.r) return true;
        }
      }
    }
    return false;
  };
  // ---------- dressing: props by the doors and little things on the ground ----------
  // Purely for looks (the bigger props are solid so you can't walk through them). Seeded like the
  // rest of the map, so everyone in a party gets the same props.
  if (!def.indoor && !def.safe && !def.tutorial) {
    const theme = { vegas: 'vegas', frost: 'frost', bayou: 'bayou', tequila: 'wine' }[mapId] || 'vegas';
    const R = Math.random;
    const add = (m, x, y, z, ry = 0) => { m.position.set(x, y, z); m.rotation.y = ry; statics.add(m); return m; };
    const basic = (c) => new THREE.MeshBasicMaterial({ color: c });
    const props = {
      trash(x, z, ry) {
        add(part(new THREE.CylinderGeometry(0.33, 0.3, 0.9, 12), 0x2f5d50, { ink: 0.02 }), x, 0.45, z);
        add(part(new THREE.CylinderGeometry(0.36, 0.36, 0.08, 12), 0x1f3d35, { ink: 0.015 }), x, 0.94, z, ry);
        circle(x, z, 0.38, 1);
      },
      newsbox(x, z, ry) {
        const c = R() < 0.5 ? 0xe63946 : 0x2563eb;
        add(part(new THREE.BoxGeometry(0.55, 1.0, 0.45), c, { ink: 0.02 }), x, 0.5, z, ry);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.47), basic(0xfff6e0)), x, 0.72, z, ry);
        circle(x, z, 0.35, 1.1);
      },
      hydrant(x, z) {
        add(part(new THREE.CylinderGeometry(0.15, 0.18, 0.62, 10), 0xe63946, { ink: 0.02 }), x, 0.31, z);
        add(part(new THREE.SphereGeometry(0.16, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0xe63946, { ink: 0.015 }), x, 0.62, z);
        const nub = part(new THREE.CylinderGeometry(0.06, 0.06, 0.42, 8), 0xffd23f, { ink: 0.01 });
        nub.rotation.z = Math.PI / 2;
        add(nub, x, 0.4, z);
        circle(x, z, 0.22, 0.75);
      },
      planter(x, z, ry, leaf = 0x3f8f3a) {
        add(part(new THREE.BoxGeometry(0.95, 0.5, 0.95), 0x9c5a32, { ink: 0.02 }), x, 0.25, z, ry);
        add(part(new THREE.IcosahedronGeometry(0.55, 0), leaf, { ink: 0.02 }), x, 0.85, z, R() * 3);
        box(x, z, 0.95, 0.95, 1.2);
      },
      bench(x, z, ry) {
        const g = new THREE.Group();
        const wood = 0x8b5a2b;
        const seat = part(new THREE.BoxGeometry(1.6, 0.1, 0.5), wood, { ink: 0.015 });
        seat.position.y = 0.48;
        const back = part(new THREE.BoxGeometry(1.6, 0.4, 0.08), wood, { ink: 0.015 });
        back.position.set(0, 0.78, -0.22);
        g.add(seat, back);
        for (const sx of [-0.7, 0.7]) {
          const leg = part(new THREE.BoxGeometry(0.08, 0.48, 0.45), 0x2b2140, { ink: 0 });
          leg.position.set(sx, 0.24, 0);
          g.add(leg);
        }
        add(g, x, 0, z, ry);
        const along = Math.abs(Math.sin(ry)) > 0.5;
        box(x, z, along ? 0.5 : 1.6, along ? 1.6 : 0.5, 0.6);
      },
      barrel(x, z, ry) {
        add(part(new THREE.CylinderGeometry(0.42, 0.42, 1.0, 14), 0x7c4a22, { ink: 0.02 }), x, 0.5, z, ry);
        for (const y of [0.2, 0.8]) add(new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.03, 4, 16), basic(0x374151)), x, y, z).rotation.x = Math.PI / 2;
        circle(x, z, 0.45, 1.05);
      },
      winebarrel(x, z, ry) {
        const b = part(new THREE.CylinderGeometry(0.48, 0.48, 1.1, 14), 0x8b5a2b, { ink: 0.02 });
        b.rotation.z = Math.PI / 2;
        const g = new THREE.Group();
        g.add(b);
        for (const dx of [-0.35, 0.35]) {
          const band = new THREE.Mesh(new THREE.TorusGeometry(0.49, 0.03, 4, 16), basic(0x3f2a14));
          band.rotation.y = Math.PI / 2;
          band.position.x = dx;
          g.add(band);
        }
        const cork = new THREE.Mesh(new THREE.CircleGeometry(0.12, 10), basic(0x6b1d2e));
        cork.position.set(0.56, 0, 0);
        cork.rotation.y = Math.PI / 2;
        g.add(cork);
        add(g, x, 0.5, z, ry);
        circle(x, z, 0.55, 1);
      },
      lantern(x, z) {
        add(part(new THREE.CylinderGeometry(0.06, 0.08, 2.2, 8), 0x2b2140, { ink: 0.01 }), x, 1.1, z);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.34, 0.28), basic(0xffc56b)), x, 2.3, z);
        add(part(new THREE.ConeGeometry(0.24, 0.2, 4), 0x2b2140, { ink: 0.01 }), x, 2.57, z, Math.PI / 4);
        circle(x, z, 0.15, 2.4);
      },
      crate(x, z, ry) {
        add(part(new THREE.BoxGeometry(0.85, 0.85, 0.85), 0xb07a3c, { ink: 0.02 }), x, 0.43, z, ry);
        if (R() < 0.5) add(part(new THREE.BoxGeometry(0.6, 0.6, 0.6), 0x9c6b32, { ink: 0.02 }), x + 0.08, 1.15, z - 0.05, ry + 0.4);
        box(x, z, 0.9, 0.9, 1.4);
      },
      snowpile(x, z) {
        const m = part(new THREE.SphereGeometry(0.8, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0xf8fafc, { ink: 0.02 });
        m.scale.set(1.2, 0.55, 0.9);
        add(m, x, 0, z, R() * 3);
      },
      firewood(x, z, ry) {
        const g = new THREE.Group();
        for (const [lx, ly] of [[-0.24, 0.16], [0, 0.16], [0.24, 0.16], [-0.12, 0.4], [0.12, 0.4], [0, 0.62]]) {
          const log = part(new THREE.CylinderGeometry(0.13, 0.13, 1.1, 8), 0x7c4a22, { ink: 0.015 });
          log.rotation.x = Math.PI / 2;
          log.position.set(lx, ly, 0);
          g.add(log);
        }
        add(g, x, 0, z, ry);
        box(x, z, 1.1, 1.1, 0.8);
      },
      agave(x, z) {
        add(part(new THREE.CylinderGeometry(0.35, 0.26, 0.5, 10), 0xc2410c, { ink: 0.02 }), x, 0.25, z);
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          const leaf = part(new THREE.ConeGeometry(0.08, 0.7, 5), 0x6b8f71, { ink: 0.01 });
          leaf.position.set(x + Math.cos(a) * 0.12, 0.75, z + Math.sin(a) * 0.12);
          leaf.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
          statics.add(leaf);
        }
        circle(x, z, 0.36, 1);
      },
      flowerpot(x, z) {
        add(part(new THREE.CylinderGeometry(0.32, 0.24, 0.45, 10), 0xc2410c, { ink: 0.02 }), x, 0.23, z);
        const cols = [0xff7eb6, 0xffd23f, 0xc77dff, 0xff5d5d];
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), basic(cols[i % 4])), x + Math.cos(a) * 0.15, 0.58 + (i % 2) * 0.06, z + Math.sin(a) * 0.15);
        }
        add(part(new THREE.SphereGeometry(0.22, 8, 6), 0x3f8f3a, { ink: 0 }), x, 0.48, z);
        circle(x, z, 0.32, 0.8);
      },
    };
    const sets = {
      vegas: ['trash', 'newsbox', 'hydrant', 'planter', 'bench', 'trash'],
      frost: ['snowpile', 'firewood', 'lantern', 'barrel', 'bench', 'snowpile'],
      bayou: ['barrel', 'lantern', 'crate', 'planter', 'firewood', 'barrel'],
      wine: ['winebarrel', 'flowerpot', 'bench', 'lantern', 'agave', 'flowerpot'],
    }[theme];
    for (const dr of doorFronts) {
      if (R() < 0.2) continue;
      const tx = -dr.nz;
      const tz = dr.nx;
      const ry = Math.atan2(dr.nx, dr.nz);
      for (const side of [-1, 1]) {
        if (R() < 0.25) continue;
        const off = dr.width / 2 + 1.0 + R() * 0.6;
        const x = dr.x + tx * side * off + dr.nx * 0.95;
        const z = dr.z + tz * side * off + dr.nz * 0.95;
        if (solidAt(x, z, 0.7, 0.3)) continue;
        if (Math.abs(x) > H - 3 || Math.abs(z) > H - 3) continue;
        const kind = sets[Math.floor(R() * sets.length)];
        props[kind](x, z, ry);
      }
    }
    // Little things on the ground: grass, pebbles, flowers, a dropped chip or card here and there.
    const tuftCol = { vegas: 0xc9a861, frost: 0x94a3b8, bayou: 0x4d7c2f, wine: 0x5a8f2e }[theme];
    const tuftMat = toon(tuftCol);
    const stoneMat = toon({ vegas: 0x9c7a55, frost: 0x64748b, bayou: 0x6b6b5a, wine: 0x8a7a66 }[theme]);
    const chipMats = [0xe63946, 0x2563eb, 0x1b0f2b, 0x16a34a].map((c) => basic(c));
    const flowerMats = [0xff7eb6, 0xffd23f, 0xffffff, 0xc77dff].map((c) => basic(c));
    const capMat = basic(0xe63946);
    const tuftGeo = new THREE.ConeGeometry(0.06, 0.5, 4);
    const stoneGeo = new THREE.DodecahedronGeometry(0.22, 0);
    const chipGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.04, 12);
    const bloomGeo = new THREE.SphereGeometry(0.09, 6, 5);
    const roadFree = (x, z) => !solidAt(x, z, 0.4, 0.2);
    scatter(520, (x, z) => {
      if (!roadFree(x, z)) return;
      const r = R();
      if (r < 0.5) {
        // A tuft of grass (or dry brush, or frozen reeds).
        for (let i = 0; i < 4; i++) {
          const t = new THREE.Mesh(tuftGeo, tuftMat);
          t.position.set(x + (R() - 0.5) * 0.35, 0.22, z + (R() - 0.5) * 0.35);
          t.rotation.set((R() - 0.5) * 0.7, 0, (R() - 0.5) * 0.7);
          t.scale.y = 0.6 + R() * 0.8;
          statics.add(t);
        }
      } else if (r < 0.75) {
        const st = new THREE.Mesh(stoneGeo, stoneMat);
        st.position.set(x, 0.08, z);
        st.scale.set(0.6 + R(), 0.4 + R() * 0.4, 0.6 + R());
        st.rotation.set(R() * 3, R() * 3, 0);
        statics.add(st);
      } else if (r < 0.88 && theme !== 'frost') {
        if (theme === 'bayou') {
          // A little red mushroom.
          const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.2, 6), basic(0xfff6e0));
          stem.position.set(x, 0.1, z);
          const cap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
          cap.position.set(x, 0.18, z);
          statics.add(stem, cap);
        } else {
          for (let i = 0; i < 3; i++) {
            const b = new THREE.Mesh(bloomGeo, flowerMats[Math.floor(R() * flowerMats.length)]);
            b.position.set(x + (R() - 0.5) * 0.5, 0.18 + R() * 0.1, z + (R() - 0.5) * 0.5);
            statics.add(b);
          }
        }
      } else {
        // Somebody dropped a chip.
        const c = new THREE.Mesh(chipGeo, chipMats[Math.floor(R() * chipMats.length)]);
        c.position.set(x, 0.03, z);
        c.rotation.set((R() - 0.5) * 0.3, 0, (R() - 0.5) * 0.3);
        statics.add(c);
      }
    }, () => false);
  }

  const clearSpot = (x, z, r, minTop) => {
    if (!solidAt(x, z, r, minTop)) return null;
    for (let d = 3; d <= 45; d += 3) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const nx = x + Math.cos(a) * d;
        const nz = z + Math.sin(a) * d;
        if (Math.abs(nx) > H - r - 3 || Math.abs(nz) > H - r - 3) continue;
        if (!solidAt(nx, nz, r, minTop)) return [Math.round(nx), Math.round(nz)];
      }
    }
    return null;
  };
  for (const e of extracts) {
    const to = clearSpot(e.x, e.z, 8, 2.5);
    if (to) [e.x, e.z] = to;
  }
  // Nobody starts in the middle of a road (cars, and it looks silly): step off to the side.
  const roads = minimap.filter((q) => !q.label && q.w && q.d && Math.max(q.w, q.d) > 60 && Math.min(q.w, q.d) <= 20);
  spawns.forEach((sp, i) => {
    for (const r of roads) {
      const inX = Math.abs(sp[0] - r.x) < r.w / 2 + 3;
      const inZ = Math.abs(sp[1] - r.z) < r.d / 2 + 3;
      if (!inX || !inZ) continue;
      if (r.w < r.d) sp[0] = r.x + (sp[0] >= r.x ? 1 : -1) * (r.w / 2 + 7);
      else sp[1] = r.z + (sp[1] >= r.z ? 1 : -1) * (r.d / 2 + 7);
    }
    const to = clearSpot(sp[0], sp[1], 2.5, 0.5);
    if (to) spawns[i] = to;
  });

  // ---------- landmarks: towers you can climb and one giant monument per map ----------
  if (!def.safe && !def.indoor && !def.tutorial) {
    const used = [];
    // Somewhere open for a w×d footprint: off roads and buildings, away from exits and spawns.
    const findSpot = (w, d) => {
      const r = Math.max(w, d) / 2;
      for (let tries = 0; tries < 600; tries++) {
        const x = Math.round((Math.random() * 2 - 1) * (H - r - 14));
        const z = Math.round((Math.random() * 2 - 1) * (H - r - 14));
        const hit = (q, pad) => Math.abs(x - q.x) < (q.w || 0) / 2 + w / 2 + pad && Math.abs(z - q.z) < (q.d || 0) / 2 + d / 2 + pad;
        if (zones.some((q) => hit(q, 10)) || minimap.some((q) => q.w && q.d && hit(q, 6)) || used.some((q) => hit(q, 18))) continue;
        if (extracts.some((e) => Math.hypot(x - e.x, z - e.z) < r + 30) || spawns.some((sp) => Math.hypot(x - sp[0], z - sp[1]) < r + 22)) continue;
        if (solidAt(x, z, r + 2, 0.4)) continue;
        used.push({ x, z, w, d });
        return [x, z];
      }
      return null;
    };
    const slab = (x0, x1, z0, z1, y0, y1, mat, solid = true) => {
      const m = part(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat, { ink: 0.02 });
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      statics.add(m);
      if (solid) addCollider({ type: 'box', minX: x0, maxX: x1, minZ: z0, maxZ: z1, top: y1, bottom: y0 > 0.5 ? y0 : undefined });
      return m;
    };
    // Steps from y0 up to y1 along z (dir +1 or -1) starting at z0, across x0..x1. They look like
    // steps (and stop bullets like steps), but you walk on a smooth ramp through them, so going
    // up and down is a glide instead of a hop on every step.
    const stairs = (x0, x1, z0, dir, y0, y1, mat, steps = 15) => {
      const run = 0.6;
      const floating = y0 > 0.5;
      for (let i = 0; i < steps; i++) {
        const top = y0 + ((i + 1) * (y1 - y0)) / steps;
        const za = z0 + dir * i * run;
        const zb = za + dir * run;
        const bottom = Math.max(0, floating ? top - 0.5 : 0);
        slab(x0, x1, Math.min(za, zb), Math.max(za, zb), bottom, top, mat, false);
        addRayBlocker(x0, x1, Math.min(za, zb), Math.max(za, zb), bottom, top);
      }
      const zEnd = z0 + dir * steps * run;
      addCollider({
        type: 'box', minX: x0, maxX: x1, minZ: Math.min(z0, zEnd), maxZ: Math.max(z0, zEnd), top: y1,
        bottom: floating ? y0 - 0.6 : undefined, noProxy: true,
        ramp: { z0, z1: zEnd, y0, y1, steps, rise: (y1 - y0) / steps, floating },
      });
    };

    // A climbable tower: stairs zig-zag up the east side, loot on every floor, a turret on the roof.
    const FH = 4.2;
    function tower({ x, z, name, floors, color, trim, signColor }) {
      const w = 14;
      const d = 16;
      const T = 0.5;
      const minX = x - w / 2;
      const maxX = x + w / 2;
      const minZ = z - d / 2;
      const maxZ = z + d / 2;
      const top = floors * FH + 1.2;
      const wallMat = toon(color);
      const trimMat = toon(trim);
      const doorX = x - w / 4;
      clearScenery(minX - 2, maxX + 2, minZ - 2, maxZ + 4);
      // Outer walls (full height, so the top makes a parapet around the roof).
      slab(minX, maxX, minZ, minZ + T, 0, top, wallMat);
      slab(minX, minX + T, minZ, maxZ, 0, top, wallMat);
      slab(maxX - T, maxX, minZ, maxZ, 0, top, wallMat);
      slab(minX, doorX - 1.6, maxZ - T, maxZ, 0, top, wallMat);
      slab(doorX + 1.6, maxX, maxZ - T, maxZ, 0, top, wallMat);
      slab(doorX - 1.6, doorX + 1.6, maxZ - T, maxZ, 3.4, top, wallMat);
      // Windows and trim bands on every floor.
      const glass = new THREE.MeshBasicMaterial({ color: 0x1b2a4a });
      for (let f = 0; f < floors; f++) {
        const y = f * FH + 2.4;
        for (const [fx, fz, rot, len] of [[x, minZ - 0.02, Math.PI, w], [x, maxZ + 0.02, 0, w], [minX - 0.02, z, -Math.PI / 2, d], [maxX + 0.02, z, Math.PI / 2, d]]) {
          for (let k = -1; k <= 1; k++) {
            if (f === 0 && rot === 0 && k === -1) continue; // the door
            const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.5), glass);
            const off = (k * len) / 3.4;
            pane.position.set(fx + (rot === 0 || rot === Math.PI ? off : 0), y, fz + (rot === 0 || rot === Math.PI ? 0 : off));
            pane.rotation.y = rot;
            statics.add(pane);
          }
        }
        if (f > 0) slab(minX - 0.08, maxX + 0.08, minZ - 0.08, maxZ + 0.08, f * FH - 0.05, f * FH + 0.25, trimMat, false);
      }
      // Floors with a stairwell cut out, and the stairs themselves.
      const ax0 = maxX - T - 1.8;
      const ax1 = maxX - T;
      const bx0 = maxX - T - 3.8;
      const bx1 = maxX - T - 2.0;
      const zA = minZ + T + 2.0;
      const zB = zA + 9;
      const floorMat = toon(0x6b4f3a);
      const stepMat = toon(0x8d6e63);
      for (let f = 1; f <= floors; f++) {
        const y = f * FH;
        slab(minX + T, bx0, minZ + T, maxZ - T, y - 0.3, y, floorMat);
        slab(bx0, maxX - T, minZ + T, zA, y - 0.3, y, floorMat);
        slab(bx0, maxX - T, zB, maxZ - T, y - 0.3, y, floorMat);
      }
      for (let f = 0; f < floors; f++) {
        if (f % 2 === 0) stairs(ax0, ax1, zA, 1, f * FH, (f + 1) * FH, stepMat);
        else stairs(bx0, bx1, zB, -1, f * FH, (f + 1) * FH, stepMat);
      }
      // Loot gets better the higher you climb.
      container('crate', minX + 2, minZ + 2.5, 2);
      container('locker', minX + 2, maxZ - 3, 2);
      for (let f = 1; f < floors; f++) {
        container(f % 2 ? 'locker' : 'crate', minX + 2, minZ + 2.5 + (f % 2) * 6, Math.min(3, 2 + Math.floor(f / 2)), 0, f * FH);
        if (f % 2 === 0) enemies('slotbot', x - 2, z, 1, 1, f * FH);
      }
      container('safe', minX + 2.5, z, 3, 0, floors * FH);
      enemies('turret', minX + 2.5, minZ + 2.5, 1, 0, floors * FH);
      enemies('slotbot', x - 2, z + 2, 1, 2);
      enemies('bouncer', doorX, maxZ + 4, 1, 1);
      const sign = neonSign(name.toUpperCase(), signColor, 12);
      sign.position.set(x, top + 1.4, maxZ - 0.5);
      statics.add(sign);
      zones.push({ name, x, z, w, d, tier: 2 });
      minimap.push({ x, z, w, d, color: `#${new THREE.Color(color).multiplyScalar(0.7).getHexString()}`, label: name, tier: 2 });
    }

    // A raised plaza with stairs up the south side, for monuments to stand on.
    function plaza(x, z, size, mat) {
      const h = 3;
      clearScenery(x - size / 2 - 1.5, x + size / 2 + 1.5, z - size / 2 - 1.5, z + size / 2 + 9);
      slab(x - size / 2, x + size / 2, z - size / 2, z + size / 2, 0, h, mat);
      stairs(x - 3, x + 3, z + size / 2 + 6.6, -1, 0, h, mat, 11);
      return h;
    }

    function monument(x, z) {
      const S = 26;
      const h = plaza(x, z, S, toon(0x6b7280));
      const at = (dx, dz) => [x + dx, z + dz];
      if (mapId === 'vegas') {
        // LUCKY SEVEN: a three-story slot machine.
        slab(x - 7, x + 7, z - 9, z - 1, h, h + 24, toon(0xe63946));
        slab(x - 7.5, x + 7.5, z - 9.5, z - 0.5, h + 24, h + 27, toon(0xd4a63a));
        const face = new THREE.Mesh(new THREE.PlaneGeometry(11, 6), new THREE.MeshBasicMaterial({ map: boardTexture('7  7  7', '#fff6e0', '#e63946') }));
        face.position.set(x, h + 15, z - 0.95);
        statics.add(face);
        const arm = part(new THREE.CylinderGeometry(0.6, 0.6, 14, 12), 0x9ca3af);
        arm.position.set(x + 8.5, h + 14, z - 5);
        const ball = part(new THREE.SphereGeometry(2.2, 16, 12), 0xe63946);
        ball.position.set(x + 8.5, h + 21.5, z - 5);
        statics.add(arm, ball);
        const s = neonSign('LUCKY SEVEN', '#ffd23f', 22);
        s.position.set(x, h + 30, z - 5);
        statics.add(s);
      } else if (mapId === 'frost') {
        // THE ICE CROWN: giant ice crystals around a frozen golden chip.
        const ice = new THREE.MeshBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.85 });
        for (const [dx, dz, r, hh] of [[0, -4, 4, 40], [-6, -2, 3, 26], [6, -3, 3, 30], [-3, -8, 2.5, 22], [4, -8, 2.2, 18]]) {
          const c = new THREE.Mesh(new THREE.ConeGeometry(r, hh, 6), ice);
          c.position.set(x + dx, h + hh / 2, z + dz);
          statics.add(c);
          circle(x + dx, z + dz, r * 0.8, h + hh * 0.4);
        }
        const chip = part(new THREE.CylinderGeometry(5, 5, 1.2, 32), 0xd4a63a);
        chip.rotation.x = Math.PI / 2;
        chip.position.set(x, h + 14, z + 0.5);
        statics.add(chip);
        const s = neonSign('THE ICE CROWN', '#7dd3fc', 20);
        s.position.set(x, h + 30, z + 2);
        statics.add(s);
      } else if (mapId === 'bayou') {
        // OLD CHOMPER: a giant gator statue with its jaws wide open.
        const green = toon(0x4d7c0f);
        slab(x - 4, x + 4, z - 11, z + 5, h, h + 6, green);
        const head = part(new THREE.BoxGeometry(6, 3, 9), 0x4d7c0f);
        head.position.set(x, h + 7, z + 9);
        head.rotation.x = -0.35;
        const jaw = part(new THREE.BoxGeometry(5.6, 1.4, 8.5), 0x3f6212);
        jaw.position.set(x, h + 2, z + 9);
        const tail = part(new THREE.ConeGeometry(3.4, 16, 6), 0x4d7c0f);
        tail.rotation.x = -Math.PI / 2;
        tail.position.set(x, h + 3, z - 17);
        statics.add(head, jaw, tail);
        for (const side of [-1, 1]) {
          const eye = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
          eye.position.set(x + side * 2, h + 9.4, z + 6.5);
          statics.add(eye);
        }
        const s = neonSign('OLD CHOMPER', '#5ee27a', 18);
        s.position.set(x, h + 16, z);
        statics.add(s);
      } else if (mapId === 'tequila') {
        // THE BIG POUR: a wine bottle the size of a building, tipping into a giant glass.
        const glassMat = new THREE.MeshBasicMaterial({ color: 0x14532d, transparent: true, opacity: 0.85 });
        const bottle = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 18, 24), glassMat);
        bottle.position.set(x - 4, h + 9, z - 5);
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 4.2, 8, 20), glassMat);
        neck.position.set(x - 4, h + 22, z - 5);
        const foil = part(new THREE.CylinderGeometry(1.7, 1.7, 3, 16), 0x7f1d3a);
        foil.position.set(x - 4, h + 27.5, z - 5);
        const label = new THREE.Mesh(new THREE.PlaneGeometry(7, 5), new THREE.MeshBasicMaterial({ map: boardTexture('CHATEAU\nJACKPOT', '#fff6e0', '#7f1d3a') }));
        label.position.set(x - 4, h + 8, z - 0.45);
        statics.add(bottle, neck, foil, label);
        circle(x - 4, z - 5, 4.5, h + 18);
        const clear = new THREE.MeshBasicMaterial({ color: 0xdbeafe, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
        const bowl = new THREE.Mesh(new THREE.SphereGeometry(4.5, 20, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), clear);
        bowl.position.set(x + 7, h + 12, z - 3);
        const wine = new THREE.Mesh(new THREE.CircleGeometry(4.2, 20), new THREE.MeshBasicMaterial({ color: 0x7f1d3a }));
        wine.rotation.x = -Math.PI / 2;
        wine.position.set(x + 7, h + 10.6, z - 3);
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 8, 10), clear);
        stem.position.set(x + 7, h + 4, z - 3);
        const foot = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.4, 0.5, 20), clear);
        foot.position.set(x + 7, h + 0.25, z - 3);
        statics.add(bowl, wine, stem, foot);
        circle(x + 7, z - 3, 1.2, h + 8);
        const s = neonSign('THE BIG POUR', '#ff7eb6', 18);
        s.position.set(x, h + 33, z - 5);
        statics.add(s);
      }
      // The good stuff sits on the plaza; a turret and a bouncer keep watch.
      container('safe', ...at(-9, 9), 4, 0, h);
      container('crate', ...at(9, 9), 3, 0, h);
      container('locker', ...at(-10, -10), 3, 0, h);
      enemies('turret', ...at(10, -10), 1, 0, h);
      enemies('bouncer', ...at(0, S / 2 + 10), 1, 2);
      enemies('bouncer', ...at(-6, S / 2 + 8), 1, 2);
      const name = { vegas: 'Lucky Seven', frost: 'The Ice Crown', bayou: 'Old Chomper', tequila: 'The Big Pour' }[mapId] || 'The Monument';
      zones.push({ name, x, z, w: S, d: S, tier: 3 });
      minimap.push({ x, z, w: S, d: S, color: '#d4a63a', label: name, tier: 3 });
    }

    const TOWERS = {
      vegas: [['Hotel Jackpot', 0xf1faee, 0xe63946, '#ff3fa4'], ['Neon Arms', 0x7b2cbf, 0x1b0f2b, '#2ee6d6'], ['The High Rise', 0xffd6a5, 0x6b3a1e, '#ffd23f']],
      frost: [['Summit Lodge', 0x8d6e63, 0x3e2723, '#7dd3fc'], ['Glacier Suites', 0xe2e8f0, 0x475569, '#2ee6d6'], ['Avalanche Tower', 0x94a3b8, 0x1e293b, '#ff5d5d']],
      bayou: [['Swamp Spire', 0x6b705c, 0x3f3f2f, '#5ee27a'], ['Moonshine Mill', 0x9c6644, 0x3e2723, '#ffd23f'], ['Heron Hotel', 0xa5a58d, 0x3f3f2f, '#ff7eb6']],
      tequila: [['Vineyard View Inn', 0xe9d8a6, 0x3e2716, '#ff7eb6'], ['Barrel Tower', 0x9c6644, 0x2b1a0e, '#ffd23f'], ['Grand Cru Suites', 0x7f1d3a, 0x2b0f1c, '#fff6e0']],
    }[mapId] || [];
    const m = findSpot(30, 52);
    if (m) monument(m[0], m[1] - 8);
    TOWERS.forEach(([name, color, trim, signColor], i) => {
      const t = findSpot(16, 26);
      if (t) tower({ x: t[0], z: t[1] - 4, name, floors: 3 + (i % 2), color, trim, signColor });
    });

    // ---------- extra landmarks: something new to find on every map ----------
    const mark = (name, x, z, w, d, color, tier = 2) => {
      zones.push({ name, x, z, w, d, tier });
      minimap.push({ x, z, w, d, color, label: name, tier });
    };
    const spin = (obj, speed, axis = 'z') => animated.push((dt) => { obj.rotation[axis] += dt * speed; });
    const LANDMARKS = {
      vegas: [
        // THE HIGH ROLLER: a giant observation wheel that never stops turning.
        () => {
          const at = findSpot(40, 16);
          if (!at) return;
          const [x, z] = at;
          const R = 17;
          const cy = R + 4;
          for (const dz of [-3, 3]) {
            for (const dx of [-7, 7]) {
              const leg = part(new THREE.CylinderGeometry(0.5, 0.7, Math.hypot(dx, cy), 8), 0xd1d5db);
              leg.position.set(x + dx / 2, cy / 2, z + dz);
              leg.rotation.z = Math.atan2(dx, cy);
              statics.add(leg);
            }
            circle(x - 7, z + dz, 0.8, 4);
            circle(x + 7, z + dz, 0.8, 4);
          }
          const wheel = new THREE.Group();
          wheel.position.set(x, cy, z);
          const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.45, 8, 48), toon(0xff3fa4));
          const ring2 = ring.clone();
          ring.position.z = -1.5;
          ring2.position.z = 1.5;
          wheel.add(ring, ring2);
          const cabins = [];
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.25, R, 0.25), toon(0xfff6e0));
            spoke.position.set(Math.cos(a) * R / 2, Math.sin(a) * R / 2, 0);
            spoke.rotation.z = a - Math.PI / 2;
            wheel.add(spoke);
            const cab = part(new THREE.SphereGeometry(1.5, 10, 8), [0x2ee6d6, 0xffd23f, 0xc77dff, 0x5ee27a][i % 4], { ink: 0.03 });
            cab.position.set(Math.cos(a) * R, Math.sin(a) * R - 1.6, 0);
            wheel.add(cab);
            cabins.push(cab);
          }
          const hub = part(new THREE.CylinderGeometry(1.6, 1.6, 4, 16), 0xd4a63a);
          hub.rotation.x = Math.PI / 2;
          wheel.add(hub);
          statics.add(wheel);
          animated.push((dt) => { wheel.rotation.z += dt * 0.08; });
          const sign = neonSign('THE HIGH ROLLER', '#ff3fa4', 16);
          sign.position.set(x, 3, z + 5);
          statics.add(sign);
          mark('The High Roller', x, z, 40, 16, '#ff3fa4');
          container('crate', x - 4, z + 6, 2);
          container('locker', x + 4, z + 6, 2);
          enemies('roller', x, z + 8, 2, 8);
        },
        // Little Chapel of Busts: get married, lose everything.
        () => {
          const at = findSpot(18, 26);
          if (!at) return;
          const [x, z] = at;
          building({ name: 'Little Chapel of Busts', x, z, w: 14, d: 20, h: 6, color: 0xfff6e0, trim: 0xff7eb6, tier: 2, sign: 'WEDDINGS 24/7', signColor: '#ff7eb6', mapColor: '#f9a8d4', doors: [{ side: 's', at: 0, width: 3 }] });
          const steeple = part(new THREE.ConeGeometry(2.4, 7, 4), 0xff7eb6);
          steeple.position.set(x, 10, z - 6);
          steeple.rotation.y = Math.PI / 4;
          const heart = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), new THREE.MeshBasicMaterial({ color: 0xff3fa4 }));
          heart.position.set(x, 14.2, z - 6);
          statics.add(steeple, heart);
          container('safe', x, z - 7, 2);
          container('register', x - 4, z + 4, 2);
          enemies('shark', x, z + 14, 1);
        },
        // Bust Inn Motel: a strip of rooms around a pool.
        () => {
          const at = findSpot(50, 34);
          if (!at) return;
          const [x, z] = at;
          building({ name: 'Bust Inn Motel', x, z: z - 10, w: 46, d: 10, h: 4.5, color: 0x7dd3fc, trim: 0x1e3a5f, tier: 2, sign: 'BUST INN', signColor: '#ff3fa4', mapColor: '#38bdf8', doors: [{ side: 's', at: -15, width: 2.6 }, { side: 's', at: 0, width: 2.6 }, { side: 's', at: 15, width: 2.6 }] });
          const pool = new THREE.Mesh(new THREE.PlaneGeometry(16, 8), new THREE.MeshBasicMaterial({ color: 0x22d3ee }));
          pool.rotation.x = -Math.PI / 2;
          pool.position.set(x, 0.05, z + 7);
          statics.add(pool);
          flat(x, z + 7, 20, 12, toon(0xf1f5f9), 0.03);
          for (const dx of [-8, 8]) palm(x + dx * 1.6, z + 9);
          container('locker', x - 15, z - 12, 2);
          container('crate', x, z - 12, 2);
          container('safe', x + 15, z - 12, 2);
          enemies('dicer', x, z + 12, 2, 8);
        },
        // Welcome sign: the famous diamond, Lost Vegas style.
        () => {
          const at = findSpot(14, 6);
          if (!at) return;
          const [x, z] = at;
          for (const dx of [-3, 3]) {
            const pole = part(new THREE.BoxGeometry(0.5, 6, 0.5), 0xfff6e0, { ink: 0.02 });
            pole.position.set(x + dx, 3, z);
            statics.add(pole);
            box(x + dx, z, 0.5, 0.5, 6);
          }
          const board = new THREE.Mesh(new THREE.PlaneGeometry(10, 5.5), new THREE.MeshBasicMaterial({ map: boardTexture('WELCOME TO\nFABULOUS\nLOST VEGAS', '#fff6e0', '#e63946'), side: THREE.DoubleSide }));
          board.position.set(x, 8, z);
          const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.9), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
          star.position.set(x, 11.6, z);
          statics.add(board, star);
          spin(star, 1.2, 'y');
        },
      ],
      frost: [
        // Ski lift: towers up the slope, chairs that keep on moving.
        () => {
          const L = 66;
          const at = findSpot(12, L + 6);
          if (!at) return;
          const [x, z] = at;
          for (let i = 0; i <= 4; i++) {
            const tz = z - L / 2 + (i * L) / 4;
            const tw = part(new THREE.BoxGeometry(0.7, 9, 0.7), 0x475569, { ink: 0.02 });
            tw.position.set(x, 4.5, tz);
            const arm = part(new THREE.BoxGeometry(5, 0.4, 0.4), 0x475569, { ink: 0.02 });
            arm.position.set(x, 9, tz);
            statics.add(tw, arm);
            box(x, tz, 0.8, 0.8, 9);
          }
          for (const dx of [-2.2, 2.2]) {
            const cable = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, L), new THREE.MeshBasicMaterial({ color: 0x1e293b }));
            cable.position.set(x + dx, 8.8, z);
            statics.add(cable);
          }
          const chairs = [];
          for (let i = 0; i < 14; i++) {
            const c = new THREE.Group();
            const seat = part(new THREE.BoxGeometry(1.6, 0.2, 0.8), 0xe63946, { ink: 0.02 });
            seat.position.y = -2.4;
            const back = part(new THREE.BoxGeometry(1.6, 0.9, 0.15), 0xe63946, { ink: 0.02 });
            back.position.set(0, -1.9, -0.35);
            const hang = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.4, 0.08), new THREE.MeshBasicMaterial({ color: 0x1e293b }));
            hang.position.y = -1.2;
            c.add(seat, back, hang);
            statics.add(c);
            chairs.push({ c, t: i / 14 });
          }
          animated.push((dt) => {
            for (const ch of chairs) {
              ch.t = (ch.t + dt * 0.012) % 1;
              const up = ch.t < 0.5;
              const u = up ? ch.t * 2 : (ch.t - 0.5) * 2;
              ch.c.position.set(x + (up ? 2.2 : -2.2), 8.8, up ? z - L / 2 + u * L : z + L / 2 - u * L);
              ch.c.rotation.y = up ? 0 : Math.PI;
            }
          });
          building({ name: 'Lift Shack', x: x + 7, z: z + L / 2 - 4, w: 8, d: 8, h: 3.6, color: 0x8d6e63, trim: 0x3e2723, tier: 2, mapColor: '#8d6e63', doors: [{ side: 'w', at: 0, width: 2.4 }] });
          container('locker', x + 8, z + L / 2 - 4, 2);
          container('crate', x + 4, z - L / 2 + 3, 2);
          mark('Ski Lift', x, z, 12, L, '#94a3b8');
          enemies('dicer', x + 6, z, 2, 20);
        },
        // Frozen pond turned ice rink, with boards around the edge.
        () => {
          const at = findSpot(44, 28);
          if (!at) return;
          const [x, z] = at;
          const ice = new THREE.Mesh(new THREE.PlaneGeometry(36, 20), new THREE.MeshBasicMaterial({ color: 0xcfefff }));
          ice.rotation.x = -Math.PI / 2;
          ice.position.set(x, 0.04, z);
          statics.add(ice);
          const boardMat = toon(0xfff6e0);
          for (const [bx, bz, w, d] of [[0, -10, 36, 0.4], [0, 10, 36, 0.4], [-18, 0, 0.4, 20], [18, -6, 0.4, 8], [18, 6, 0.4, 8]]) {
            const b = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, d), boardMat);
            b.position.set(x + bx, 0.55, z + bz);
            statics.add(b);
            box(x + bx, z + bz, w, d, 1.1);
          }
          for (let i = 0; i < 4; i++) snowman(x - 12 + i * 8, z + 14);
          mark('Ice Rink', x, z, 40, 24, '#cfefff', 1);
          container('crate', x, z, 2);
          container('crate', x - 12, z - 5, 1);
          enemies('roller', x, z, 2, 10);
        },
      ],
      bayou: [
        // Crawfish Shack: big boiling pots and picnic tables.
        () => {
          const at = findSpot(30, 26);
          if (!at) return;
          const [x, z] = at;
          building({ name: 'Crawfish Shack', x, z: z - 5, w: 18, d: 12, h: 4.2, color: 0xb45309, trim: 0x3f2a14, tier: 2, sign: 'CRAWFISH', signColor: '#ff5d5d', mapColor: '#b45309', doors: [{ side: 's', at: 0, width: 3 }] });
          for (const dx of [-6, 0, 6]) {
            const pot = part(new THREE.CylinderGeometry(1.1, 0.9, 1.4, 14), 0x9ca3af);
            pot.position.set(x + dx, 0.7, z + 6);
            const boil = new THREE.Mesh(new THREE.CircleGeometry(1, 14), new THREE.MeshBasicMaterial({ color: 0xff6b3d }));
            boil.rotation.x = -Math.PI / 2;
            boil.position.set(x + dx, 1.42, z + 6);
            statics.add(pot, boil);
            circle(x + dx, z + 6, 1.1, 1.4);
          }
          for (const dx of [-8, 8]) {
            const table = part(new THREE.BoxGeometry(4, 0.2, 1.6), 0x8b5a2b, { ink: 0.02 });
            table.position.set(x + dx, 1, z + 10);
            statics.add(table);
            box(x + dx, z + 10, 4, 1.6, 1);
          }
          container('register', x - 5, z - 7, 2);
          container('locker', x + 5, z - 7, 2);
          enemies('shark', x, z + 13, 2, 6);
        },
        // Ol' Shrimper: a shrimp boat beached in the muck.
        () => {
          const at = findSpot(28, 12);
          if (!at) return;
          const [x, z] = at;
          const hull = part(new THREE.BoxGeometry(20, 3, 7), 0xf1f5f9);
          hull.position.set(x, 1.5, z);
          hull.rotation.z = 0.06;
          const stripe = part(new THREE.BoxGeometry(20.2, 0.6, 7.2), 0x2563eb, { ink: 0 });
          stripe.position.set(x, 2.4, z);
          const bow = part(new THREE.ConeGeometry(3.5, 5, 4), 0xf1f5f9);
          bow.rotation.z = -Math.PI / 2;
          bow.rotation.x = Math.PI / 4;
          bow.position.set(x + 12, 1.6, z);
          const cabin = part(new THREE.BoxGeometry(6, 3.4, 5), 0xfff6e0);
          cabin.position.set(x - 3, 4.6, z);
          const mast = part(new THREE.CylinderGeometry(0.2, 0.2, 10, 8), 0x8b5a2b, { ink: 0.02 });
          mast.position.set(x + 4, 8, z);
          statics.add(hull, stripe, bow, cabin, mast);
          box(x, z, 22, 7, 3);
          box(x - 3, z, 6, 5, 6.3);
          for (const dz of [-6, 6]) for (const dx of [-8, 0, 8]) reeds(x + dx, z + dz);
          mark("Ol' Shrimper", x, z, 26, 10, '#f1f5f9');
          container('safe', x + 6, z - 5, 2);
          container('crate', x - 9, z + 5, 2);
          enemies('dicer', x, z + 8, 2, 8);
        },
      ],
    }[mapId] || [];
    for (const place of LANDMARKS) place();

    // ---------- ground detail: little things so the open ground doesn't look empty ----------
    // Purely visual (you walk right through them), merged with the scenery so they cost nothing.
    {
      const blocked = minimap.filter((q) => q.w && q.d && (q.building || !q.label));
      const free = (x, z) => !blocked.some((q) => Math.abs(x - q.x) < q.w / 2 + 1.5 && Math.abs(z - q.z) < q.d / 2 + 1.5)
        && !extracts.some((e) => Math.hypot(x - e.x, z - e.z) < 9);
      const STYLE = {
        vegas: { tuft: [0xc9a46a, 0xb08850], pebble: 0x9c7b5b, tumble: 0x9a7444, mound: null, puddle: null },
        tequila: { tuft: [0x9aa65a, 0xc9a46a, 0x7d8f4a], pebble: 0x9c8a6a, tumble: 0x9a7444, mound: null, puddle: null },
        frost: { tuft: [0x8fa3a0], pebble: 0x94a3b8, tumble: null, mound: 0xf8fbff, puddle: null },
        bayou: { tuft: [0x5a7d2a, 0x6f8f3c, 0x4d6b22], pebble: 0x6b6b5a, tumble: null, mound: null, puddle: 0x3d4a2a },
      }[mapId] || { tuft: [0x9aa65a], pebble: 0x9c8a6a, tumble: null, mound: null, puddle: null };
      const tuftMats = STYLE.tuft.map((c) => toon(c));
      const pebbleMat = toon(STYLE.pebble);
      const bladeGeo = new THREE.ConeGeometry(0.09, 0.7, 3);
      const pebbleGeo = new THREE.DodecahedronGeometry(0.28, 0);
      const count = Math.round((H * H) / 120);
      for (let i = 0; i < count; i++) {
        const x = (Math.random() * 2 - 1) * (H - 4);
        const z = (Math.random() * 2 - 1) * (H - 4);
        if (!free(x, z)) continue;
        const r = Math.random();
        if (r < 0.55) {
          // A tuft of grass: a few blades leaning out.
          const mat = tuftMats[Math.floor(Math.random() * tuftMats.length)];
          const s = 0.7 + Math.random() * 0.8;
          for (let b = 0; b < 4; b++) {
            const blade = new THREE.Mesh(bladeGeo, mat);
            const a = (b / 4) * Math.PI * 2 + Math.random();
            blade.position.set(x + Math.cos(a) * 0.12 * s, 0.32 * s, z + Math.sin(a) * 0.12 * s);
            blade.rotation.set(Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45);
            blade.scale.setScalar(s);
            statics.add(blade);
          }
        } else if (r < 0.85) {
          const pb = new THREE.Mesh(pebbleGeo, pebbleMat);
          const s = 0.5 + Math.random() * 1.2;
          pb.position.set(x, 0.08 * s, z);
          pb.scale.set(s, s * 0.55, s * (0.7 + Math.random() * 0.6));
          pb.rotation.y = Math.random() * Math.PI;
          statics.add(pb);
        } else if (STYLE.tumble && r < 0.9) {
          const tw = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45 + Math.random() * 0.3, 0), toon(STYLE.tumble));
          tw.position.set(x, 0.45, z);
          tw.rotation.set(Math.random(), Math.random(), Math.random());
          statics.add(tw);
        } else if (STYLE.mound && r < 0.97) {
          const md = new THREE.Mesh(new THREE.SphereGeometry(1 + Math.random() * 1.6, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), toon(STYLE.mound));
          md.scale.y = 0.35;
          md.position.set(x, 0, z);
          statics.add(md);
        } else if (STYLE.puddle && r < 0.95) {
          const pd = new THREE.Mesh(new THREE.CircleGeometry(0.8 + Math.random() * 1.4, 12), toon(STYLE.puddle));
          pd.rotation.x = -Math.PI / 2;
          pd.scale.set(1, 0.6 + Math.random() * 0.5, 1);
          pd.position.set(x, 0.035, z);
          statics.add(pd);
        }
      }
    }

    // New machines out in the open: Roulette Rollers roam in pairs, Bouncers guard the bigger spots.
    for (let i = 0; i < Math.round(H / 45); i++) {
      const sp = findSpot(8, 8);
      if (sp) enemies('roller', sp[0], sp[1], 2, 8);
    }
    zones.filter((q) => q.tier >= 2 && q.w * q.d < 5000).forEach((q, i) => {
      if (i % 4 === 0) enemies('bouncer', q.x, q.z + q.d / 2 + 3, 1, 2);
      // The Dealer works the better spots, mostly the dangerous ones.
      else if (i % 4 === 2 && (q.tier >= 3 || i % 8 === 2)) enemies('dealer', q.x + q.w / 2 + 4, q.z, 1, 2);
    });
  } else if (def.indoor && !def.safe) {
    // The Bunker gets a couple of Bouncers working the door.
    enemies('bouncer', -30, 50, 1, 2);
    enemies('bouncer', 30, -52, 1, 2);
    enemies('dealer', 0, 20, 1, 3);
  }
  // ---------- furnishing: stuff inside the rooms ----------
  // Shelves, desks, couches, beds, lockers, vending machines and crates against the walls, a card
  // table in the middle of the bigger rooms, posters, and clutter on the floor. Furniture keeps out
  // of doorways and away from loot so you can always get to it. Seeded like the rest of the map.
  // Real room for a body at (x, z): any collider within r blocks it (low ones too).
  const freeAt = (x, z, r) => {
    for (let cx = Math.floor((x - r - 1) / CELL); cx <= Math.floor((x + r + 1) / CELL); cx++) {
      for (let cz = Math.floor((z - r - 1) / CELL); cz <= Math.floor((z + r + 1) / CELL); cz++) {
        for (const c of grid.get(cellKey(cx, cz)) || []) {
          if (c.rayOnly || (c.bottom && c.bottom > 2)) continue;
          if (c.type === 'box') {
            const nx = Math.max(c.minX, Math.min(x, c.maxX));
            const nz = Math.max(c.minZ, Math.min(z, c.maxZ));
            if (Math.hypot(x - nx, z - nz) < r) return false;
          } else if (Math.hypot(x - c.x, z - c.z) < c.r + r) return false;
        }
      }
    }
    return Math.abs(x) < H - 2 && Math.abs(z) < H - 2;
  };
  {
    const R = Math.random;
    const mat = (c) => toon(c);
    const glow = (c) => new THREE.MeshBasicMaterial({ color: c });
    const P = (geo, color, x, y, z, ink = 0.02) => { const m = part(geo, color, { ink, shadow: false }); m.position.set(x, y, z); return m; };
    const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const itemCols = [0xe63946, 0x2a9d8f, 0xffd23f, 0x7b2cbf, 0xff9f1c, 0x4dabff, 0x5ee27a, 0xfff6e0];
    const pick = (a) => a[Math.floor(R() * a.length)];
    // Each piece: footprint along the wall (w) and out from it (d), built facing +z with its back at -d/2.
    const PIECES = {
      shelf: { w: 2.0, d: 0.55, build(g) {
        g.add(P(B(2.0, 0.08, 0.55), 0x6b4a2e, 0, 2.15, 0), P(B(0.08, 2.2, 0.55), 0x6b4a2e, -0.96, 1.1, 0), P(B(0.08, 2.2, 0.55), 0x6b4a2e, 0.96, 1.1, 0), P(B(2.0, 2.2, 0.05), 0x4a3220, 0, 1.1, -0.25, 0));
        for (const y of [0.1, 0.75, 1.4]) {
          g.add(P(B(1.9, 0.06, 0.5), 0x6b4a2e, 0, y, 0, 0));
          for (let x = -0.75; x <= 0.75; x += 0.3 + R() * 0.15) {
            if (R() < 0.25) continue;
            const tall = R() < 0.4;
            const it = tall ? P(new THREE.CylinderGeometry(0.07, 0.07, 0.32, 8), pick(itemCols), x, y + 0.2, 0.05, 0.01) : P(B(0.22 + R() * 0.1, 0.18 + R() * 0.2, 0.3), pick(itemCols), x, y + 0.15, 0.02, 0.01);
            g.add(it);
          }
        }
      } },
      desk: { w: 1.8, d: 0.8, build(g) {
        g.add(P(B(1.8, 0.08, 0.8), 0x8b5a2b, 0, 0.82, 0), P(B(0.5, 0.8, 0.7), 0x6b4a2e, -0.6, 0.4, 0), P(B(0.5, 0.8, 0.7), 0x6b4a2e, 0.6, 0.4, 0));
        const mon = P(B(0.7, 0.45, 0.06), 0x1b0f2b, 0.15, 1.2, -0.2, 0.01);
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.37), glow(pick([0x2ee6d6, 0x5ee27a, 0xff3fa4])));
        scr.position.set(0.15, 1.2, -0.165);
        g.add(mon, scr, P(B(0.08, 0.3, 0.08), 0x1b0f2b, 0.15, 0.98, -0.22, 0), P(B(0.4, 0.02, 0.3), 0xfff6e0, -0.5, 0.87, 0.1, 0));
      } },
      rack: { w: 1.2, d: 0.8, build(g) {
        g.add(P(B(1.2, 2.2, 0.8), 0x1f2937, 0, 1.1, 0));
        for (let y = 0.3; y < 2.1; y += 0.25) {
          const led = new THREE.Mesh(B(0.9, 0.05, 0.02), glow(R() < 0.3 ? 0xff5d5d : 0x5ee27a));
          led.position.set(0, y, 0.41);
          g.add(led);
        }
      } },
      couch: { w: 2.2, d: 0.9, build(g) {
        const c = pick([0x7b2cbf, 0xb5172b, 0x2a9d8f, 0x6b4a2e]);
        g.add(P(B(2.2, 0.45, 0.9), c, 0, 0.23, 0), P(B(2.2, 0.55, 0.22), c, 0, 0.7, -0.34), P(B(0.22, 0.6, 0.9), c, -1.0, 0.45, 0), P(B(0.22, 0.6, 0.9), c, 1.0, 0.45, 0));
        g.add(P(B(0.85, 0.15, 0.62), new THREE.Color(c).multiplyScalar(1.25).getHex(), -0.45, 0.52, 0.06, 0.01), P(B(0.85, 0.15, 0.62), new THREE.Color(c).multiplyScalar(1.25).getHex(), 0.45, 0.52, 0.06, 0.01));
      } },
      bed: { w: 1.4, d: 2.2, build(g) {
        g.add(P(B(1.4, 0.4, 2.2), 0x6b4a2e, 0, 0.2, 0), P(B(1.3, 0.2, 2.05), 0xfff6e0, 0, 0.5, 0.05, 0.01), P(B(1.32, 0.22, 1.2), pick([0xe63946, 0x4dabff, 0x7b2cbf, 0x2a9d8f]), 0, 0.53, 0.45, 0.01));
        g.add(P(B(0.9, 0.14, 0.4), 0xffffff, 0, 0.66, -0.75, 0.01), P(B(1.4, 0.9, 0.1), 0x4a3220, 0, 0.65, -1.07));
      } },
      vending: { w: 1.1, d: 0.85, build(g) {
        g.add(P(B(1.1, 2.0, 0.85), pick([0xe63946, 0x2563eb, 0x16a34a]), 0, 1.0, 0));
        const front = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 1.3), glow(0xbfe3f5));
        front.position.set(-0.12, 1.15, 0.43);
        g.add(front);
        for (let y = 0.65; y < 1.8; y += 0.28) for (let x = -0.35; x < 0.15; x += 0.16) g.add(P(B(0.1, 0.16, 0.05), pick(itemCols), x, y, 0.44, 0));
      } },
      lockers: { w: 2.1, d: 0.55, build(g) {
        for (let i = 0; i < 3; i++) {
          g.add(P(B(0.68, 2.0, 0.55), pick([0x6b7280, 0x4b5563, 0x52525b]), -0.7 + i * 0.7, 1.0, 0));
          for (const y of [1.7, 1.6, 1.5]) g.add(P(B(0.4, 0.03, 0.02), 0x1f2937, -0.7 + i * 0.7, y, 0.28, 0));
        }
      } },
      crates: { w: 1.7, d: 1.1, build(g) {
        g.add(P(B(0.9, 0.9, 0.9), 0xb07a3c, -0.38, 0.45, 0), P(B(0.75, 0.75, 0.75), 0x9c6b32, 0.45, 0.38, 0.1));
        if (R() < 0.6) { const t = P(B(0.65, 0.65, 0.65), 0xb07a3c, -0.3, 1.23, 0.02); t.rotation.y = 0.3; g.add(t); }
      } },
      barrels: { w: 1.7, d: 0.85, build(g) {
        for (const x of [-0.42, 0.42]) {
          g.add(P(new THREE.CylinderGeometry(0.4, 0.4, 1.0, 14), pick([0x7c4a22, 0x374151, 0xb5172b]), x, 0.5, 0));
          const band = new THREE.Mesh(new THREE.TorusGeometry(0.41, 0.03, 4, 16), glow(0x1f2937));
          band.rotation.x = Math.PI / 2;
          band.position.set(x, 0.75, 0);
          g.add(band);
        }
      } },
      counter: { w: 2.6, d: 0.8, build(g) {
        g.add(P(B(2.6, 1.0, 0.8), 0x6b3a1e, 0, 0.5, 0), P(B(2.7, 0.08, 0.9), 0xd4a63a, 0, 1.04, 0));
        for (let i = 0; i < 4; i++) g.add(P(new THREE.CylinderGeometry(0.05, 0.06, 0.3, 8), pick([0x16a34a, 0x7a1028, 0xffd23f]), -1.0 + i * 0.55 + R() * 0.2, 1.23, (R() - 0.5) * 0.4, 0.01));
      } },
    };
    const posters = ['WANTED', 'LUCKY 7', 'JACKPOT!', 'NO REFUNDS', 'BEAT THE HOUSE', 'HIGH STAKES', 'ALL IN', 'CASH ONLY'].map((text, i) => {
      const bg = ['#e63946', '#1b0f2b', '#7b2cbf', '#2a9d8f', '#ffd23f', '#b5172b', '#16a34a', '#ff9f1c'][i];
      return new THREE.MeshBasicMaterial({ map: canvasTexture(128, 170, (c, w, h) => {
        c.fillStyle = bg; c.fillRect(0, 0, w, h);
        c.strokeStyle = '#fff6e0'; c.lineWidth = 6; c.strokeRect(6, 6, w - 12, h - 12);
        c.fillStyle = bg === '#ffd23f' ? '#1b0f2b' : '#fff6e0';
        c.font = "bold 22px 'Luckiest Guy', 'Arial Black', sans-serif"; c.textAlign = 'center'; c.textBaseline = 'middle';
        const words = text.split(' ');
        words.forEach((wd, k) => c.fillText(wd, w / 2, h / 2 + (k - (words.length - 1) / 2) * 26));
        c.font = '34px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
        c.fillText(['💰', '🎰', '🃏', '🎲', '👑', '🍀', '💎', '🪙'][i], w / 2, 30);
      }) });
    });
    const posterGeo = new THREE.PlaneGeometry(0.9, 1.2);
    const loot = containers.filter((k) => k.y < 0.5);
    const nearLoot = (x, z, pad) => loot.some((k) => Math.hypot(k.x - x, k.z - z) < pad);
    const kindsFor = (name) => {
      const n = (name || '').toLowerCase();
      if (/motel|inn|cabin|lodge|chalet|shack|hut|house|mansion|suite|trailer/.test(n)) return ['bed', 'couch', 'shelf', 'crates', 'vending'];
      if (/pawn|shop|store|mart|warehouse|depot|cellar|storage|supply|garage|barn|cage/.test(n)) return ['shelf', 'shelf', 'crates', 'barrels', 'lockers'];
      if (/office|security|server|counting|bank|lab|observ|station|tower|post/.test(n)) return ['desk', 'rack', 'lockers', 'desk', 'shelf'];
      if (/bar|kitchen|saloon|diner|cafe|crawfish|snack|club|lounge|room|chapel|winery|tasting/.test(n)) return ['counter', 'couch', 'vending', 'shelf', 'barrels'];
      return ['shelf', 'crates', 'desk', 'couch', 'lockers', 'barrels', 'vending'];
    };
    for (const rm of interiors) {
      const kinds = kindsFor(rm.name);
      const sides = [
        { k: 'n', nx: 0, nz: 1, len: rm.w, ry: 0 }, { k: 's', nx: 0, nz: -1, len: rm.w, ry: Math.PI },
        { k: 'w', nx: 1, nz: 0, len: rm.d, ry: Math.PI / 2 }, { k: 'e', nx: -1, nz: 0, len: rm.d, ry: -Math.PI / 2 },
      ];
      const want = Math.max(2, Math.min(7, Math.floor((rm.w + rm.d) / 5)));
      let placed = 0;
      let posted = 0;
      for (let tries = 0; tries < want * 4 && placed < want; tries++) {
        const sd = sides[Math.floor(R() * 4)];
        const pc = PIECES[kinds[(placed + tries) % kinds.length]];
        const along = (R() - 0.5) * (sd.len - pc.w - 1.4);
        if (Math.abs(along) + pc.w / 2 > sd.len / 2 - 0.6) continue;
        // Keep doorways clear.
        if (rm.doors.some((dr) => dr.side === sd.k && Math.abs(dr.at - along) < dr.width / 2 + 1.4 + pc.w / 2)) continue;
        const inset = 0.3 + pc.d / 2;
        const ax = sd.nz ? along : 0;
        const az = sd.nx ? along : 0;
        const cx = rm.x + ax + (sd.nx ? -sd.nx * (rm.w / 2) + sd.nx * inset : 0);
        const cz = rm.z + az + (sd.nz ? -sd.nz * (rm.d / 2) + sd.nz * inset : 0);
        const fw = sd.nz ? pc.w : pc.d;
        const fd = sd.nz ? pc.d : pc.w;
        // Room around it and nothing already there (other furniture, cover, loot).
        if (!freeAt(cx, cz, Math.max(fw, fd) / 2 + 0.15) || nearLoot(cx, cz, Math.max(fw, fd) / 2 + 1.9)) continue;
        // And don't wall off the middle: something has to stay walkable in front of it.
        if (!freeAt(cx + sd.nx * (fd / 2 + 1.0), cz + sd.nz * (fw / 2 + 1.0), 0.5)) continue;
        const g = new THREE.Group();
        g.position.set(cx, 0, cz);
        g.rotation.y = sd.ry;
        pc.build(g);
        statics.add(g);
        box(cx, cz, fw, fd, 1.2);
        placed++;
        // A poster on the wall nearby.
        if (posted < 2 && rm.h >= 3.4 && R() < 0.6) {
          const along2 = Math.max(-sd.len / 2 + 1, Math.min(sd.len / 2 - 1, along + (R() < 0.5 ? -1 : 1) * (pc.w / 2 + 0.8)));
          if (!rm.doors.some((dr) => dr.side === sd.k && Math.abs(dr.at - along2) < dr.width / 2 + 0.8)) {
            const pm = new THREE.Mesh(posterGeo, pick(posters));
            pm.position.set(rm.x + (sd.nz ? along2 : -sd.nx * (rm.w / 2 - 0.28)), 2.3, rm.z + (sd.nx ? along2 : -sd.nz * (rm.d / 2 - 0.28)));
            pm.rotation.y = sd.ry;
            statics.add(pm);
            posted++;
          }
        }
      }
      // The middle of a bigger room: a card table with chairs, and whatever was left on it.
      if (Math.min(rm.w, rm.d) >= 9 && freeAt(rm.x, rm.z, 2.2) && !nearLoot(rm.x, rm.z, 3.4)) {
        const g = new THREE.Group();
        g.position.set(rm.x, 0, rm.z);
        g.add(P(new THREE.CylinderGeometry(0.95, 0.95, 0.08, 20), 0x1f8a4c, 0, 0.82, 0), P(new THREE.CylinderGeometry(0.12, 0.3, 0.8, 10), 0x2b2140, 0, 0.4, 0));
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + 0.4;
          const ch = new THREE.Group();
          ch.position.set(Math.cos(a) * 1.35, 0, Math.sin(a) * 1.35);
          ch.rotation.y = -a + Math.PI / 2;
          ch.add(P(B(0.5, 0.08, 0.5), 0x6b4a2e, 0, 0.48, 0, 0.01), P(B(0.5, 0.5, 0.06), 0x6b4a2e, 0, 0.75, -0.22, 0.01), P(B(0.06, 0.48, 0.06), 0x3f2a14, 0.18, 0.24, 0.18, 0), P(B(0.06, 0.48, 0.06), 0x3f2a14, -0.18, 0.24, 0.18, 0));
          g.add(ch);
        }
        for (let i = 0; i < 3; i++) {
          const st = P(new THREE.CylinderGeometry(0.1, 0.1, 0.08 + R() * 0.18, 12), pick([0xe63946, 0x1b0f2b, 0x2a9d8f, 0xffd23f]), (R() - 0.5) * 1.0, 0.9, (R() - 0.5) * 1.0, 0.01);
          g.add(st);
        }
        for (let i = 0; i < 4; i++) {
          const card = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.22), glow(0xfff6e0));
          card.rotation.set(-Math.PI / 2, 0, R() * 3);
          card.position.set((R() - 0.5) * 1.1, 0.87, (R() - 0.5) * 1.1);
          g.add(card);
        }
        statics.add(g);
        circle(rm.x, rm.z, 1.0, 0.9);
      }
      // Clutter on the floor: papers, chips, a bottle.
      for (let i = 0; i < 5; i++) {
        const x = rm.x + (R() - 0.5) * (rm.w - 2);
        const z = rm.z + (R() - 0.5) * (rm.d - 2);
        if (!freeAt(x, z, 0.3)) continue;
        const r = R();
        let m;
        if (r < 0.45) { m = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.4), glow(0xf1e3c8)); m.rotation.set(-Math.PI / 2, 0, R() * 3); m.position.set(x, 0.07, z); }
        else if (r < 0.8) { m = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.03, 10), glow(pick([0xe63946, 0x2563eb, 0x1b0f2b, 0x16a34a]))); m.position.set(x, 0.07, z); }
        else { m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.28, 8), glow(pick([0x16a34a, 0x7a1028]))); m.rotation.set(Math.PI / 2, 0, R() * 3); m.position.set(x, 0.1, z); }
        statics.add(m);
      }
    }
  }

  // Loot nobody can get to (boxed in by scenery) moves to the nearest open ground: somewhere with
  // room for the crate and room to stand next to it, checked with a real body-sized circle.
  const standRoom = (x, z) => {
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      if (freeAt(x + Math.cos(ang) * 1.35, z + Math.sin(ang) * 1.35, 0.5)) return true;
    }
    return false;
  };
  for (const k of containers) {
    if (k.y > 0.5 || standRoom(k.x, k.z)) continue;
    let moved = false;
    for (let r = 0.8; r <= 14 && !moved; r += 0.7) {
      for (let i = 0; i < 16 && !moved; i++) {
        const ang = (i / 16) * Math.PI * 2;
        const x = k.x + Math.cos(ang) * r;
        const z = k.z + Math.sin(ang) * r;
        if (freeAt(x, z, 0.8) && standRoom(x, z)) { k.x = x; k.z = z; moved = true; }
      }
    }
    if (!moved) { const to = clearSpot(k.x, k.z, 1.6, 0.4); if (to) [k.x, k.z] = to; }
  }
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
  // Indoors: no sun to speak of, just neon pools of light down the halls.
  if (def.indoor) {
    sun.castShadow = false;
    for (const [lx, lz, c] of layout.lights || []) {
      const l = new THREE.PointLight(c, 45, 45, 1.3);
      l.position.set(lx, 6.5, lz);
      scene.add(l);
    }
  }

  const map = {
    id: mapId,
    name: def.name,
    mapGround: def.mapGround,
    // Machines on harder maps have more health and hit harder.
    // Danger level: see DIFFICULTY.
    toughness: (DIFFICULTY[def.danger] || DIFFICULTY.Medium).hp,
    dmgScale: (DIFFICULTY[def.danger] || DIFFICULTY.Medium).dmg,
    machineScale: (DIFFICULTY[def.danger] || DIFFICULTY.Medium).count,
    raiderScale: (DIFFICULTY[def.danger] || DIFFICULTY.Medium).raiders,
    skillScale: (DIFFICULTY[def.danger] || DIFFICULTY.Medium).skill,
    boss: (DIFFICULTY[def.danger] || DIFFICULTY.Medium).boss,
    half: H,
    indoor: !!def.indoor,
    raidTime: def.raidTime || null,
    lootBonus: def.lootBonus || 0,
    lootRolls: def.lootRolls || 0,
    botSkill: def.botSkill || 1,
    botAim: def.botAim || 1,
    raiders: def.raiders ?? null,
    safe: !!def.safe,
    tutorial: !!def.tutorial,
    noBoss: !!def.noBoss,
    lounge: layout.lounge || null,
    hostile: def.hostile ?? null,
    statics,
    solids,
    zones,
    minimap,
    containers,
    slotSpots,
    enemySpots,
    extracts,
    casino: layout.casino,
    sun,
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
          if (list) for (const c of list) if (c.proxy) out.add(c.proxy);
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
        if (c.rayOnly || (c.bottom && c.bottom > 2)) continue;
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
        if (c.rayOnly) continue;
        const top = c.ramp ? topAt(c, x, z) : c.top;
        if (top > y + 0.3) continue;
        const over = c.type === 'box'
          ? x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ
          : Math.hypot(x - c.x, z - c.z) <= c.r;
        if (over) g = Math.max(g, top);
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
        buckets.get(key).geos.push(g);
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
const SKIP_LABELS = new Set(['Barrel Cellar', 'Lift Shack', 'Trailer', 'Ski Cabin', 'Stilt Shack', 'Ice Hut', 'Vault', 'Snack Bar', 'Farm Office', 'Bait Shed', 'Buried Cabin']);

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
    // The exits get drawn on top later (marker plus a name tag above or below it): keep clear of them.
    const hudK = size / 800;
    c.font = `900 ${Math.round(15 * hudK)}px Nunito, system-ui, sans-serif`;
    for (const e of map.extracts || []) {
      const w = c.measureText(`${e.name} (closed)`).width + 14 * hudK;
      const x = Math.max(w / 2 + 4, Math.min(size - w / 2 - 4, tx(e.x)));
      placed.push({ x: tx(e.x), y: tx(e.z), w: 30 * hudK });
      placed.push({ x, y: tx(e.z) + (e.z > 0 ? -26 : 26) * hudK, w });
    }
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
  flat(0, (H + 14) / 2, 16, H - 14, asphalt);
  flat(0, 40, H * 2, 14, asphalt, 0.025);
  minimap.push({ x: 0, z: (H + 14) / 2, w: 16, d: H - 14, color: '#3b3548' }, { x: 0, z: 40, w: H * 2, d: 14, color: '#3b3548' });
  const dash = toon(0xffd23f);
  for (let z = 18; z < H; z += 8) if (Math.abs(z - 40) > 9) flat(0, z, 0.4, 3.5, dash, 0.035);
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
    const tx = -42 + (i % 4) * 22 + (i % 4 > 1 ? 14 : 0);
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
  helipad.position.set(40, 0.15, -H + 18);
  statics.add(helipad);
  flat(40, -H + 18, 9, 1.4, toon(0xffffff), 0.32);
  const extracts = [
    { name: 'Helipad', x: 40, z: -H + 18 },
    { name: 'Getaway Car', x: 0, z: H - 10 },
    { name: 'Storm Drain', x: -H + 10, z: 40 },
    { name: 'Freight Train', x: H - 20, z: 40 },
  ];
  car(4, H - 15, 'z', 0x1b0f2b);

  // ----- Outskirts -----
  const blocked = (x, z, pad) => zones.some((zn) => Math.abs(x - zn.x) < zn.w / 2 + pad && Math.abs(z - zn.z) < zn.d / 2 + pad)
    || Math.abs(x) < 20 || Math.abs(z - 40) < 18 || (Math.abs(x) < 40 && z < -100) || x > H - 20 || extracts.some((e) => Math.hypot(x - e.x, z - e.z) < 22);
  // The far desert: little settlements to raid on the way in.
  k.outposts({
    exits: extracts,
    names: ['Lucky Lizard Truck Stop', 'Snake Pit Saloon', 'Ghost Town', 'Atomic Diner', 'Craps Canyon Mine', 'Jackpot Junction', 'Bust Motel', 'Desert Rose Chapel', 'Roadkill Grill'],
    colors: [0xf4a261, 0xe9c46a, 0xe76f51, 0x8ecae6, 0xf1faee, 0xcdb4db], inner: 262, outer: H - 22, count: 9,
    avoid: (x, z) => Math.abs(x) < 30 || Math.abs(z - 40) < 29 || x > H - 50,
  });
  for (let i = 0; i < 900; i++) {
    const x = (Math.random() * 2 - 1) * (H - 6);
    const z = (Math.random() * 2 - 1) * (H - 6);
    if (blocked(x, z, 6)) continue;
    const r = Math.random();
    if (r < 0.45) cactus(x, z);
    else if (r < 0.85) rock(x, z, 0.8 + Math.random() * 2.2);
    else crateStack(x, z);
  }
  // Some loose loot out in the desert.
  for (let i = 0; i < 64; i++) {
    const x = (Math.random() * 2 - 1) * (H - 20);
    const z = (Math.random() * 2 - 1) * (H - 20);
    if (blocked(x, z, 4)) continue;
    container('crate', x, z, 1);
  }
  for (let i = 0; i < 18; i++) enemies('dicer', (Math.random() * 2 - 1) * H * 0.85, (Math.random() * 2 - 1) * H * 0.85, 1);
  for (let i = 0; i < 6; i++) enemies('shark', (Math.random() * 2 - 1) * H * 0.85, (Math.random() * 2 - 1) * H * 0.85, 1);

  return {
    ...cas,
    extracts,
    spawns: k.ringSpawns(14, 24),
    // Cars cruise the strip and the cross street. Don't stand in the road.
    hazards: {
      lanes: [
        { axis: 'z', at: 3.5, from: 16, to: H - 4, dir: 1 },
        { axis: 'z', at: -3.5, from: 16, to: H - 4, dir: -1 },
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
    pine, snowman, scatter, fire, yard, watchtower, waterTower, tent, addCollider,
  } = k;
  const path = toon(0xb8c4d6);
  flat(0, (10 + H) / 2, 14, H - 10, path);
  flat(0, 40, H * 2, 12, path, 0.025);
  minimap.push({ x: 0, z: (10 + H) / 2, w: 14, d: H - 10, color: '#94a3b8' }, { x: 0, z: 40, w: H * 2, d: 12, color: '#94a3b8' });

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
  // A rocky hillside with a timber-framed shaft you can walk into: rails, lanterns, and the good
  // stuff at the back where nobody's been in years.
  {
    const mx = -175;
    const mz = 4;
    const rock = 0x64748b;
    const rockDark = 0x475569;
    // The hill: x from mx-20 to mx-3, z from mz-10 to mz+10, 9 tall. The shaft runs west from the
    // east face at z = mz, 4.4 wide and 4 tall, 13 deep.
    const HX0 = mx - 20;
    const HX1 = mx - 3;
    const SW = 4.4;
    const SH = 4;
    const SD = 13;
    const block = (x0, x1, z0, z1, y0, y1, color, collide = true) => {
      const m = part(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), color, { ink: 0.05 });
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      statics.add(m);
      if (collide) addCollider({ type: 'box', minX: x0, maxX: x1, minZ: z0, maxZ: z1, top: y1, bottom: y0 > 0.5 ? y0 : undefined });
    };
    block(HX0, HX1, mz - 10, mz - SW / 2, 0, 9, rock); // north of the shaft
    block(HX0, HX1, mz + SW / 2, mz + 10, 0, 9, rock); // south of the shaft
    block(HX0, HX1 - SD, mz - SW / 2, mz + SW / 2, 0, 9, rock); // the back wall
    block(HX1 - SD, HX1, mz - SW / 2, mz + SW / 2, SH, 9, rockDark); // the roof over the shaft
    // Rough boulders on top and around the base so it reads as a hill, not a box.
    const boulders = [[-4, 9.2, -6, 3.2], [-10, 9.5, 4, 3.8], [-15, 9, -3, 3], [-7, 8.8, 7, 2.6], [-1.5, 1.2, -9.5, 1.8], [-1.2, 1, 9.6, 1.6], [-18, 2, 9, 2.4], [-12, 9.6, -8, 2.2]];
    for (const [dx, y, dz, r] of boulders) {
      const b = part(new THREE.DodecahedronGeometry(r, 0), dx % 2 ? rock : rockDark, { ink: 0.05 });
      b.position.set(mx + dx, y, mz + dz);
      b.rotation.set(dx, dz, r);
      statics.add(b);
    }
    // Snow caps.
    for (const [dx, dz, w, d] of [[-11, -5, 14, 8], [-12, 5, 12, 7]]) {
      const cap = part(new THREE.BoxGeometry(w, 0.4, d), 0xf8fafc, { ink: 0.03 });
      cap.position.set(mx + dx, 9.2, mz + dz);
      statics.add(cap);
    }
    // Inside: a dark floor, rails, and timber frames every few steps.
    const floorM = part(new THREE.BoxGeometry(SD, 0.06, SW), 0x1f1a17, { ink: 0 });
    floorM.position.set(HX1 - SD / 2, 0.03, mz);
    const ceil = part(new THREE.BoxGeometry(SD, 0.1, SW), 0x2a2420, { ink: 0 });
    ceil.position.set(HX1 - SD / 2, SH - 0.05, mz);
    statics.add(floorM, ceil);
    for (const side of [-0.55, 0.55]) {
      const rail = part(new THREE.BoxGeometry(SD + 6, 0.08, 0.1), 0x9ca3af, { ink: 0 });
      rail.position.set(HX1 - SD / 2 + 3, 0.1, mz + side);
      statics.add(rail);
    }
    for (let i = 0; i < 9; i++) {
      const tie = part(new THREE.BoxGeometry(0.25, 0.06, 1.6), 0x5b3a1e, { ink: 0 });
      tie.position.set(HX1 + 2.5 - i * 1.9, 0.07, mz);
      statics.add(tie);
    }
    const timber = 0x8b5a2b;
    for (const dx of [0.3, 4.5, 8.7, 12.6]) {
      const x = HX1 - dx;
      for (const side of [-1, 1]) {
        const post = part(new THREE.BoxGeometry(0.35, SH, 0.35), timber, { ink: 0.03 });
        post.position.set(x, SH / 2, mz + side * (SW / 2 - 0.2));
        statics.add(post);
      }
      const beam = part(new THREE.BoxGeometry(0.4, 0.4, SW + (dx < 1 ? 0.8 : 0)), timber, { ink: 0.03 });
      beam.position.set(x, SH - 0.2, mz);
      statics.add(beam);
      // A lantern on every other frame.
      if (dx > 1 && dx < 12) {
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffc56b }));
        lamp.position.set(x - 0.3, SH - 0.55, mz + SW / 2 - 0.45);
        const glow = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.22, depthWrite: false }));
        glow.position.copy(lamp.position);
        statics.add(lamp, glow);
      }
    }
    // The sign over the entrance.
    const signTex = canvasTexture(256, 64, (c, w, h) => {
      c.fillStyle = '#5b3a1e'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#fde68a'; c.font = "bold 34px 'Luckiest Guy', 'Arial Black', sans-serif"; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('OLD MINE', w / 2, h / 2 + 2);
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9), new THREE.MeshBasicMaterial({ map: signTex }));
    sign.position.set(HX1 + 0.32, SH + 0.75, mz);
    sign.rotation.y = Math.PI / 2;
    statics.add(sign);
    // Carts out front (one on the rails), a lamp post and a water tower.
    waterTower(mx + 8, mz - 16, 0x94a3b8);
    for (let i = 0; i < 3; i++) {
      const cx = i === 0 ? HX1 + 2 : mx + 6 + i * 3.5;
      const cz = i === 0 ? mz : mz + 8;
      const cart = part(new THREE.BoxGeometry(2.2, 1.1, 1.5), 0x78350f, { ink: 0.03 });
      cart.position.set(cx, 0.85, cz);
      const ore = part(new THREE.DodecahedronGeometry(0.55, 0), i === 1 ? 0xffd23f : 0x334155, { ink: 0.03 });
      ore.position.set(cx, 1.45, cz);
      statics.add(cart, ore);
      box(cx, cz, 2.2, 1.5, 1.4);
    }
    zones.push({ name: 'Old Mine', x: mx - 8, z: mz, w: 34, d: 36, tier: 2 });
    minimap.push({ x: mx - 11.5, z: mz, w: 17, d: 20, color: '#64748b', label: 'Old Mine', tier: 2 });
    // The loot: a crate at each side of the entrance, better stuff deeper in.
    container('crate', HX1 + 3, mz - 5, 1);
    container('crate', HX1 + 3, mz + 5, 1);
    container('locker', HX1 - 7, mz + 1.4, 2, -Math.PI / 2);
    container('safe', HX1 - SD + 1.2, mz, 3, -Math.PI / 2);
    enemies('slotbot', mx + 10, mz, 1);
  }

  // Burning barrels to warm up at, spread so you can hop between them.
  for (const [x, z] of [[-15, 30], [15, 50], [-8, 100], [8, 128], [-60, 30], [65, 30], [-90, -65], [100, -70], [70, 80], [-40, 82], [40, 112],
    [-110, 0], [110, 0], [-100, 110], [100, 115], [-60, -110], [40, -110], [0, -5], [-125, 45], [-120, -85], [110, -100],
    // The outer ring.
    [-150, -130], [-130, -175], [150, 130], [125, 160], [-145, 130], [-160, 168], [60, -138], [40, -180], [150, -25], [150, 15],
    [-160, 60], [-160, 15], [0, 170], [0, 195], [-60, 165], [75, 160], [175, 80], [175, -100], [-90, -170], [100, -165], [-185, -40], [130, 190]]) fire(x, z);

  const extracts = [
    { name: 'Gondola', x: H - 35, z: -H + 25 },
    { name: 'Snowmobile Trail', x: -H + 12, z: 95 },
    { name: 'Ice Road', x: 0, z: H - 12 },
    { name: 'Ski Lift', x: -H + 10, z: -95 },
  ];
  k.outposts({
    exits: extracts,
    names: ['Yeti Lodge', 'Moose Crossing', 'Avalanche Inn', 'Black Diamond Camp', 'Frozen Fish Co.', 'Icicle Motel', 'Summit Post', 'Polar Pawn'],
    colors: [0x8b5a2b, 0x9c6644, 0x2563eb, 0xb91c1c, 0xe2e8f0, 0x7f5539], inner: 232, outer: H - 22, count: 8,
    avoid: (x, z) => Math.abs(x) < 28 || Math.abs(z - 40) < 27,
    extra: (x, z) => fire(x + 5, z - 5),
  });
  // More barrels to hop between out in the far snow.
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 215 + Math.random() * (H - 235);
    fire(Math.cos(a) * r, Math.sin(a) * r);
  }
  scatter(700, (x, z) => {
    const r = Math.random();
    if (r < 0.6) pine(x, z);
    else if (r < 0.85) rock(x, z, 0.8 + Math.random() * 2);
    else if (r < 0.92) snowman(x, z);
    else crateStack(x, z);
  }, (x, z) => Math.abs(x) < 18 || Math.abs(z - 40) < 17 || extracts.some((e) => Math.hypot(x - e.x, z - e.z) < 22) || (Math.abs(x) < 25 && z < -85));
  for (let i = 0; i < 16; i++) enemies('dicer', (Math.random() * 2 - 1) * H * 0.85, (Math.random() * 2 - 1) * H * 0.85, 1);
  for (let i = 0; i < 5; i++) enemies('shark', (Math.random() * 2 - 1) * H * 0.85, (Math.random() * 2 - 1) * H * 0.85, 1);
  for (let i = 0; i < 40; i++) {
    const x = (Math.random() * 2 - 1) * (H - 20);
    const z = (Math.random() * 2 - 1) * (H - 20);
    if (zones.some((zn) => Math.abs(x - zn.x) < zn.w / 2 + 4 && Math.abs(z - zn.z) < zn.d / 2 + 4)) continue;
    container('crate', x, z, 1);
  }

  return {
    ...cas,
    extracts,
    spawns: k.ringSpawns(12, 22),
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
  flat(0, (5 + H) / 2, 8, H - 5, planks, 0.05);
  flat(0, 30, H * 2 - 20, 7, planks, 0.055);
  minimap.push({ x: 0, z: (5 + H) / 2, w: 8, d: H - 5, color: '#8b6a43' }, { x: 0, z: 30, w: H * 2 - 20, d: 7, color: '#8b6a43' });
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
  [[-55, 55], [-75, 85], [-50, 105], [55, 60], [80, 90], [50, 110], [-95, 40], [95, 42]].forEach(([x, z], i) => {
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
    name: 'Crawdad Shack', x: -20, z: 95, w: 18, d: 12, h: 4.5, color: 0xf97316, trim: 0x431407, tier: 2, sign: 'CRAWDAD SHACK', signColor: '#ff9f43', mapColor: '#c2410c',
    doors: [{ side: 'e', at: 0, width: 3 }],
  });
  container('register', -17, 92, 2);
  container('locker', -25, 98, 2);
  slotSpots.push({ x: -26.5, z: 95, rot: Math.PI / 2, tier: 2 });
  enemies('shark', -20, 108, 1);

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
    // A steep slate roof and a covered porch over the columns.
    const roofTop = part(new THREE.ConeGeometry(1, 1, 4), 0x44403c, { ink: 0.03 });
    roofTop.rotation.y = Math.PI / 4;
    roofTop.scale.set(32 * 0.74, 7, 22 * 0.74);
    roofTop.position.set(mx, 8.4 + 3.5, mz);
    const porch = part(new THREE.BoxGeometry(33, 0.4, 4.2), 0x44403c, { ink: 0.03 });
    porch.position.set(mx, 8.2, mz - 12.9);
    statics.add(roofTop, porch);
    for (const dx of [-10, 10]) {
      const chimney = part(new THREE.BoxGeometry(1.6, 6, 1.6), 0x57534e, { ink: 0.03 });
      chimney.position.set(mx + dx, 12, mz + 4);
      statics.add(chimney);
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
    { name: 'Airboat Dock', x: -H + 25, z: -H + 20 },
    { name: 'Old Bridge', x: H - 15, z: -40 },
    { name: 'Bus Stop', x: 0, z: H - 10 },
    { name: 'Hidden Bayou', x: -H + 20, z: H - 20 },
  ];
  k.outposts({
    exits: extracts,
    names: ['Mudbug Marina', 'Hush Puppy Hut', 'Swamp Witch Shack', 'Gumbo Pot', 'Bayou Bingo Hall', 'Rusty Pelican', 'Moss Manor', 'Catfish Cannery'],
    colors: [0x9c6644, 0x6b705c, 0xa5a58d, 0x4d7c0f, 0x7f5539, 0x581c87], inner: 215, outer: H - 22, count: 8,
    avoid: (x, z) => Math.abs(z + 100) < 38 || Math.abs(x) < 26 || Math.abs(z - 30) < 26,
    // Every swamp settlement has a gator pond out back.
    extra: (x, z) => { const a = Math.random() * Math.PI * 2; pond(x + Math.cos(a) * 30, z + Math.sin(a) * 30, 8); },
  });
  scatter(650, (x, z) => {
    const r = Math.random();
    if (r < 0.5) cypress(x, z);
    else if (r < 0.75) reeds(x, z);
    else if (r < 0.9) rock(x, z, 0.8 + Math.random() * 1.8);
    else crateStack(x, z);
  }, (x, z) => Math.abs(x) < 16 || Math.abs(z - 30) < 15 || Math.abs(z + 100) < 18 || extracts.some((e) => Math.hypot(x - e.x, z - e.z) < 22));
  for (let i = 0; i < 16; i++) enemies('dicer', (Math.random() * 2 - 1) * H * 0.85, (Math.random() * 2 - 1) * H * 0.85, 1);
  for (let i = 0; i < 5; i++) enemies('shark', (Math.random() * 2 - 1) * H * 0.85, (Math.random() * 2 - 1) * H * 0.85, 1);
  for (let i = 0; i < 40; i++) {
    const x = (Math.random() * 2 - 1) * (H - 20);
    const z = (Math.random() * 2 - 1) * (H - 20);
    if (zones.some((zn) => Math.abs(x - zn.x) < zn.w / 2 + 4 && Math.abs(z - zn.z) < zn.d / 2 + 4)) continue;
    container('crate', x, z, 1);
  }

  return {
    ...cas,
    extracts,
    spawns: k.ringSpawns(12, 22),
  };
}

// ---------- The Bunker: underground, all indoors, built for gunfights ----------

function theBunker(k) {
  const {
    H, THREE, statics, zones, minimap, slotSpots, part, toon, neonSign, flat, box, circle,
    crateStack, building, container, enemies, casino,
  } = k;
  const CEIL = 11;
  // Concrete shell: perimeter walls and a ceiling over everything.
  const concrete = toon(0x3b3346);
  for (const [x, z, w, d] of [[0, -H, H * 2, 1.5], [0, H, H * 2, 1.5], [-H, 0, 1.5, H * 2], [H, 0, 1.5, H * 2]]) {
    const wall = part(new THREE.BoxGeometry(w, CEIL, d), concrete, { ink: 0 });
    wall.position.set(x, CEIL / 2, z);
    statics.add(wall);
    box(x, z, w, d, CEIL);
  }
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2), new THREE.MeshBasicMaterial({ color: 0x0d0814, side: THREE.DoubleSide }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = CEIL;
  statics.add(ceiling);
  // Hazard stripes down the main halls.
  const stripe = toon(0xffd23f);
  for (let x = -H + 6; x < H - 4; x += 6) { flat(x, 50, 2.4, 0.5, stripe, 0.04); flat(x, -52, 2.4, 0.5, stripe, 0.04); }

  const cas = casino({
    x: 0, z: -12, name: 'The High Stakes Room', sign: 'NO LIMIT', signColor: '#ff3fa4',
    color: 0x2b1640, trim: 0x0d0814, mapColor: '#3a1d5c', felt: 0x7a1028,
    plaza(px, pz) {
      // The Pit: a boxing ring where people settle things.
      const ring = part(new THREE.BoxGeometry(16, 0.5, 16), 0x1f2937, { ink: 0.04 });
      ring.position.set(px, 0.25, pz + 4);
      const mat = new THREE.Mesh(new THREE.PlaneGeometry(15, 15), new THREE.MeshBasicMaterial({ color: 0x7a1028 }));
      mat.rotation.x = -Math.PI / 2;
      mat.position.set(px, 0.52, pz + 4);
      statics.add(ring, mat);
      for (const [cx, cz] of [[-8, -8], [8, -8], [-8, 8], [8, 8]]) {
        const post = part(new THREE.CylinderGeometry(0.25, 0.25, 2.2, 8), 0xd4a63a, { ink: 0.02 });
        post.position.set(px + cx, 1.6, pz + 4 + cz);
        statics.add(post);
        circle(px + cx, pz + 4 + cz, 0.3, 2.7);
      }
      for (const y of [1.2, 1.8, 2.4]) {
        for (const [x0, z0, x1, z1] of [[-8, -8, 8, -8], [-8, 8, 8, 8], [-8, -8, -8, 8], [8, -8, 8, 8]]) {
          const len = Math.hypot(x1 - x0, z1 - z0);
          const rope = new THREE.Mesh(new THREE.BoxGeometry(x0 === x1 ? 0.06 : len, 0.06, x0 === x1 ? len : 0.06), new THREE.MeshBasicMaterial({ color: 0xe63946 }));
          rope.position.set(px + (x0 + x1) / 2, y, pz + 4 + (z0 + z1) / 2);
          statics.add(rope);
        }
      }
      zones.push({ name: 'The Pit', x: px, z: pz + 4, w: 18, d: 18, tier: 3 });
      minimap.push({ x: px, z: pz + 4, w: 16, d: 16, color: '#7a1028', label: 'The Pit', tier: 3 });
      container('safe', px, pz + 4, 4);
    },
  });

  // Rooms all the way around the poker hall, with a corridor loop in between.
  const rooms = [
    // West wing
    ['Card Room', -76, -68, 30, 34, [['e', 0], ['s', 0]]], ['Cigar Lounge', -76, -22, 30, 34, [['e', 0], ['n', 0], ['s', 6]]],
    ['Counting Room', -76, 24, 30, 34, [['e', 0], ['n', 6]]], ['Kitchen', -76, 70, 30, 30, [['e', 0], ['n', 0]]],
    // East wing
    ['VIP Suite', 76, -68, 30, 34, [['w', 0], ['s', 0]]], ['Security Office', 76, -22, 30, 34, [['w', 0], ['n', 0], ['s', -6]]],
    ['Server Room', 76, 24, 30, 34, [['w', 0], ['n', -6]]], ['Bar', 76, 70, 30, 30, [['w', 0], ['n', 0]]],
    // South wing
    ['Fight Club Lockers', -28, 78, 36, 26, [['n', 0], ['e', 4]]], ['Cash Cage', 28, 78, 36, 26, [['n', 0], ['w', 4]]],
    // North wing
    ['Boiler Room', -30, -80, 40, 22, [['s', 0], ['e', 0]]], ['Wine Cellar', 30, -80, 40, 22, [['s', 0], ['w', 0]]],
  ];
  const roomColors = [0x4c1d95, 0x7f1d1d, 0x14532d, 0x1e3a8a, 0x713f12, 0x3f3f46];
  rooms.forEach(([name, x, z, w, d, doors], i) => {
    building({
      name, x, z, w, d, h: CEIL, color: roomColors[i % roomColors.length], trim: 0x0d0814, tier: name === 'Cash Cage' || name === 'Counting Room' ? 4 : 3, roof: false,
      floor: 0x2b2238, mapColor: '#4b3a63', doors: doors.map(([side, at]) => ({ side, at, width: 3.4 })),
    });
    // Loot and cover in every room.
    container(i % 3 === 0 ? 'safe' : 'locker', x - w / 4, z - d / 4, name === 'Cash Cage' || name === 'Counting Room' ? 4 : 3);
    container('crate', x + w / 4, z + d / 4, 3);
    crateStack(x + w / 5, z - d / 5);
    const table = part(new THREE.BoxGeometry(5, 1.1, 2.6), 0x5b3a1e, { ink: 0.03 });
    table.position.set(x - w / 6, 0.55, z + d / 6);
    statics.add(table);
    box(x - w / 6, z + d / 6, 5, 2.6, 1.1);
    // A slot machine against the back wall (the side away from the corridor door), facing in.
    if (i % 4 === 1) slotSpots.push({ x: x - Math.sign(x) * (w / 2 - 1.6), z: z + d / 4 + 2, rot: -Math.PI / 2 * Math.sign(x), tier: 3 });
  });
  // Pillars and crates in the corridors for cover.
  for (const [x, z] of [[-55, -45], [55, -45], [-55, 30], [55, 30], [-55, -5], [55, -5], [-20, 50], [20, 50], [-20, -52], [20, -52]]) {
    const pillar = part(new THREE.BoxGeometry(2.4, CEIL, 2.4), 0x2b2238, { ink: 0.03 });
    pillar.position.set(x, CEIL / 2, z);
    statics.add(pillar);
    box(x, z, 2.4, 2.4, CEIL);
  }
  for (const [x, z] of [[-50, 60], [50, 60], [-52, -60], [52, -60], [0, 62]]) crateStack(x, z);
  for (const [x, z, t] of [[-56, 45, 'crate'], [56, 45, 'crate'], [-56, -50, 'locker'], [56, -50, 'locker']]) container(t, x, z, 3);
  zones.push({ name: 'Service Tunnels', x: 0, z: 0, w: H * 2, d: H * 2, tier: 3 });

  // Guards in every room and patrols in the corridors, on top of the raiders.
  const guards = ['slotbot', 'shark', 'dicer', 'bouncer', 'shark', 'dealer'];
  rooms.forEach(([, x, z], i) => enemies(guards[i % guards.length], x, z, 1, 4));
  enemies('shark', -55, 0, 2, 20);
  enemies('shark', 55, 0, 2, 20);
  enemies('dicer', 0, 55, 2, 20);
  enemies('dicer', 0, -55, 2, 20);
  enemies('slotbot', -55, -45, 1);
  enemies('slotbot', 55, 45, 1);
  enemies('roller', -20, 50, 2, 6);
  enemies('roller', 20, -52, 2, 6);

  const extracts = [
    { name: 'Freight Elevator', x: -80, z: -78 },
    { name: 'Sewer Hatch', x: 80, z: -78 },
    { name: 'Service Stairs', x: 80, z: 80 },
    { name: 'Laundry Chute', x: -80, z: 80 },
  ];
  const lights = [
    [0, 50, 0xff3fa4], [-55, 50, 0x2ee6d6], [55, 50, 0xffd23f], [-55, -52, 0xc77dff], [55, -52, 0x2ee6d6], [0, -52, 0xff3fa4],
    [-76, -45, 0xffd23f], [76, -45, 0xff3fa4], [-76, 45, 0x2ee6d6], [76, 45, 0xc77dff],
  ];
  return {
    ...cas,
    extracts,
    lights,
    spawns: [[-55, 55], [55, 55], [-55, -55], [55, -55], [0, 52], [0, -53], [-56, 10], [56, 10], [-56, -30], [56, -30]],
  };
}

// ---------- High Roller Lounge: a safe casino built around a 1v1 arena ----------

function theLounge(k) {
  const { H, THREE, statics, zones, minimap, part, toon, neonSign, flat, box, circle, carpetTexture } = k;
  const CEIL = 10;
  const wallMat = toon(0x2b1640);
  for (const [x, z, w, d] of [[0, -H, H * 2, 1.5], [0, H, H * 2, 1.5], [-H, 0, 1.5, H * 2], [H, 0, 1.5, H * 2]]) {
    const wall = part(new THREE.BoxGeometry(w, CEIL, d), wallMat, { ink: 0 });
    wall.position.set(x, CEIL / 2, z);
    statics.add(wall);
    box(x, z, w, d, CEIL);
  }
  const carpet = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2), toon(0xffffff, { map: carpetTexture() }));
  carpet.rotation.x = -Math.PI / 2;
  carpet.position.y = 0.03;
  carpet.receiveShadow = true;
  statics.add(carpet);
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2), new THREE.MeshBasicMaterial({ color: 0x120818, side: THREE.DoubleSide }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = CEIL;
  statics.add(ceiling);

  // ----- The Pit: a sunken arena in the middle -----
  // A ring-shaped gallery 4m up runs all the way round, so the fight happens down in a pit with
  // stadium walls and everyone watches from the rail above. Ramps lead up from the casino floor at
  // the north and south. Duelists drop in on opposite pads, each behind a giant playing card, with a
  // chip tower in the middle so nobody gets a clean shot off the bell.
  const R = 14;
  const GH = 4; // gallery height
  const GW = 4; // gallery width
  const RO = R + GW;
  // An LED floor: a dark grid of glowing tiles that brighten toward the middle, gold rings and the
  // house spade in the centre.
  const wedges = canvasTexture(1024, 1024, (c, w) => {
    const r = w / 2;
    c.fillStyle = '#0c0718';
    c.fillRect(0, 0, w, w);
    const n = 28;
    const cell = w / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const cx = (i + 0.5) * cell;
        const cy = (j + 0.5) * cell;
        const d = Math.hypot(cx - r, cy - r) / r;
        if (d > 0.97) continue;
        const ring = Math.floor(d * 7);
        c.fillStyle = ring % 2 ? `rgba(46, 230, 214, ${0.1 + 0.25 * (1 - d)})` : `rgba(255, 63, 164, ${0.12 + 0.28 * (1 - d)})`;
        c.fillRect(cx - cell * 0.42, cy - cell * 0.42, cell * 0.84, cell * 0.84);
      }
    }
    c.lineWidth = 12;
    c.shadowBlur = 24;
    for (const [rr, col] of [[r * 0.97, '#ffd23f'], [r * 0.62, '#2ee6d6'], [r * 0.3, '#ffd23f']]) {
      c.shadowColor = col;
      c.strokeStyle = col;
      c.beginPath(); c.arc(r, r, rr, 0, Math.PI * 2); c.stroke();
    }
    c.shadowBlur = 0;
    c.fillStyle = '#1b0f2b';
    c.beginPath(); c.arc(r, r, r * 0.3 - 6, 0, Math.PI * 2); c.fill();
    // Lane stripes from each spawn pad toward the middle.
    c.fillStyle = 'rgba(255, 210, 63, 0.35)';
    for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) c.fillRect(r + sx * (r * 0.38 + k * 34) - 8, r - 30, 16, 60);
  });
  // Spawn pads: red on the west, blue on the east.
  for (const [side, col] of [[-1, 0xff3f5f], [1, 0x3fa9ff]]) {
    const pad = new THREE.Mesh(new THREE.CircleGeometry(1.6, 32), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(side * (R - 4), 0.08, 0);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 1.85, 32), new THREE.MeshBasicMaterial({ color: col }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(side * (R - 4), 0.09, 0);
    statics.add(pad, ring);
  }
  // The stadium wall inside the pit: padded panels with banners all the way round.
  const banner = canvasTexture(2048, 128, (c, w, h) => {
    c.fillStyle = '#1b0f2b';
    c.fillRect(0, 0, w, h);
    const bits = ['THE PIT', '♠', 'WINNER TAKES ALL', '♥', 'NO REFUNDS', '♦', 'HIGH STAKES', '♣'];
    c.font = "bold 64px 'Luckiest Guy', 'Arial Black', sans-serif";
    c.textBaseline = 'middle';
    let x = 20;
    let k = 0;
    while (x < w) {
      const t = bits[k % bits.length];
      c.fillStyle = t.length === 1 ? (t === '♥' || t === '♦' ? '#ff3f5f' : '#fff6e0') : ['#ffd23f', '#ff3fa4', '#2ee6d6'][k % 3];
      c.fillText(t, x, h / 2 + 4);
      x += c.measureText(t).width + 60;
      k++;
    }
  });
  banner.wrapS = THREE.RepeatWrapping;
  banner.repeat.set(-2, 1); // negative so the words read the right way from inside the pit
  const innerWall = new THREE.Mesh(new THREE.CylinderGeometry(R, R, GH, 64, 1, true), toon(0x1a0d2e, { side: THREE.BackSide }));
  innerWall.position.y = GH / 2;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.05, R - 0.05, 1.0, 64, 1, true), new THREE.MeshBasicMaterial({ map: banner, side: THREE.BackSide }));
  band.position.y = 2.4;
  const pad = part(new THREE.TorusGeometry(R - 0.1, 0.22, 8, 64), 0x2a1748, { ink: 0.01, shadow: false });
  pad.rotation.x = Math.PI / 2;
  pad.position.y = 0.9;
  statics.add(innerWall, band, pad);
  // Neon strips round the inside of the pit wall: cyan at the floor, pink under the gallery lip.
  for (const [y, col] of [[0.25, 0x2ee6d6], [1.75, 0xff3fa4], [3.1, 0xff3fa4], [GH - 0.12, 0x2ee6d6]]) {
    const strip = new THREE.Mesh(new THREE.TorusGeometry(R - 0.12, 0.06, 6, 96), new THREE.MeshBasicMaterial({ color: col }));
    strip.rotation.x = Math.PI / 2;
    strip.position.y = y;
    statics.add(strip);
  }
  // The gallery: a ring floor 4m up, an outer wall down to the casino floor, and a gold rail on
  // the inside edge.
  const deck = new THREE.Mesh(new THREE.RingGeometry(R, RO, 64), toon(0x2a1748, { side: THREE.DoubleSide }));
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = GH;
  const carpetRing = new THREE.Mesh(new THREE.RingGeometry(R + 0.8, RO - 0.6, 64), new THREE.MeshBasicMaterial({ color: 0x6a0f2c, side: THREE.DoubleSide }));
  carpetRing.rotation.x = -Math.PI / 2;
  carpetRing.position.y = GH + 0.02;
  // The outside of the stadium, seen from the casino floor: a dark facade with a lit marquee band,
  // gold columns and neon at the top and bottom.
  const outerWall = new THREE.Mesh(new THREE.CylinderGeometry(RO, RO, GH, 64, 1, true), toon(0x1a0d2e));
  outerWall.position.y = GH / 2;
  const marqueeTex = canvasTexture(2048, 160, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#2a0f3a'); g.addColorStop(0.5, '#4a1a5c'); g.addColorStop(1, '#2a0f3a');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    for (let x = 12; x < w; x += 32) for (const y of [10, h - 10]) { c.fillStyle = (x / 32) % 2 < 1 ? '#ffd23f' : '#fff6e0'; c.beginPath(); c.arc(x, y, 6, 0, Math.PI * 2); c.fill(); }
    const bits = ['THE PIT', '★', '1 v 1', '★', 'WINNER TAKES ALL', '★', 'PLACE YOUR BETS', '★'];
    c.font = "bold 76px 'Luckiest Guy', 'Arial Black', sans-serif";
    c.textBaseline = 'middle';
    c.shadowBlur = 18;
    let x = 30;
    let k = 0;
    while (x < w) {
      const t = bits[k % bits.length];
      const col = t === '★' ? '#ffd23f' : ['#ff3fa4', '#2ee6d6', '#fff6e0'][Math.floor(k / 2) % 3];
      c.shadowColor = col;
      c.fillStyle = col;
      c.fillText(t, x, h / 2 + 4);
      x += c.measureText(t).width + 50;
      k++;
    }
  });
  marqueeTex.wrapS = THREE.RepeatWrapping;
  marqueeTex.repeat.set(3, 1);
  const marquee = new THREE.Mesh(new THREE.CylinderGeometry(RO + 0.06, RO + 0.06, 1.3, 96, 1, true), new THREE.MeshBasicMaterial({ map: marqueeTex }));
  marquee.position.y = 2.3;
  statics.add(deck, carpetRing, outerWall, marquee);
  for (const [y, col] of [[0.12, 0xff3fa4], [1.55, 0xffd23f], [3.05, 0xffd23f], [GH - 0.06, 0x2ee6d6]]) {
    const strip = new THREE.Mesh(new THREE.TorusGeometry(RO + 0.08, 0.07, 6, 96), new THREE.MeshBasicMaterial({ color: col }));
    strip.rotation.x = Math.PI / 2;
    strip.position.y = y;
    statics.add(strip);
  }
  for (let i = 0; i < 12; i++) {
    const a = ((i + 0.5) / 12) * Math.PI * 2;
    const col = part(new THREE.BoxGeometry(0.5, GH, 0.5), 0xd4a63a, { ink: 0.02, shadow: false });
    col.position.set(Math.cos(a) * (RO + 0.2), GH / 2, Math.sin(a) * (RO + 0.2));
    col.rotation.y = -a;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xff3fa4 : 0x2ee6d6 }));
    cap.position.set(Math.cos(a) * (RO + 0.2), GH + 0.3, Math.sin(a) * (RO + 0.2));
    statics.add(col, cap);
  }
  // A glass rail round the inside edge of the gallery, with a neon top bar.
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.15, R + 0.15, 1.1, 96, 1, true), new THREE.MeshBasicMaterial({ color: 0x9be7ff, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide }));
  glass.position.y = GH + 0.55;
  const topBar = new THREE.Mesh(new THREE.TorusGeometry(R + 0.15, 0.08, 6, 96), new THREE.MeshBasicMaterial({ color: 0x2ee6d6 }));
  topBar.rotation.x = Math.PI / 2;
  topBar.position.y = GH + 1.1;
  const footBar = part(new THREE.TorusGeometry(R + 0.15, 0.06, 6, 96), 0xd4a63a, { ink: 0, shadow: false });
  footBar.rotation.x = Math.PI / 2;
  footBar.position.y = GH + 0.05;
  statics.add(glass, topBar, footBar);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const post = part(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 6), 0xd8dce6, { ink: 0, shadow: false });
    post.position.set(Math.cos(a) * (R + 0.15), GH + 0.55, Math.sin(a) * (R + 0.15));
    statics.add(post);
  }
  // Solid gallery: overlapping posts of floor round the ring (you can walk on top), a rail you
  // can't fall over, and walls that keep the fight in the pit.
  for (let i = 0; i < 44; i++) {
    const a = (i / 44) * Math.PI * 2;
    const rc = (R + RO) / 2;
    circle(Math.cos(a) * rc, Math.sin(a) * rc, GW / 2 + 0.25, GH);
  }
  // The rail is a solid, tall ring (posts close enough to overlap) so nobody falls or jumps in.
  for (let i = 0; i < 132; i++) {
    const a = (i / 132) * Math.PI * 2;
    k.addCollider({ type: 'circle', x: Math.cos(a) * (R + 0.3), z: Math.sin(a) * (R + 0.3), r: 0.45, top: GH + 3, noProxy: true });
  }
  // Ramps up to the gallery from the casino floor, north and south.
  for (const dir of [1, -1]) {
    const z0 = dir * (RO + 8);
    const z1 = dir * (RO - 0.2);
    const len = Math.abs(z1 - z0);
    const ramp = part(new THREE.BoxGeometry(4, 0.3, Math.hypot(len, GH)), 0x5a2a6a, { ink: 0.02 });
    ramp.position.set(0, GH / 2 - 0.1, (z0 + z1) / 2);
    ramp.rotation.x = dir * Math.atan2(GH, len);
    const runner = new THREE.Mesh(new THREE.PlaneGeometry(2.4, Math.hypot(len, GH)), new THREE.MeshBasicMaterial({ color: 0x7a1028 }));
    runner.position.set(0, GH / 2 + 0.07, (z0 + z1) / 2);
    runner.rotation.x = -Math.PI / 2 + dir * Math.atan2(GH, len);
    statics.add(ramp, runner);
    for (const side of [-1, 1]) {
      const rail = part(new THREE.BoxGeometry(0.12, 0.12, Math.hypot(len, GH)), 0xd4a63a, { ink: 0, shadow: false });
      rail.position.set(side * 2.05, GH / 2 + 1.0, (z0 + z1) / 2);
      rail.rotation.x = ramp.rotation.x;
      statics.add(rail);
    }
    k.addCollider({
      type: 'box', minX: -2, maxX: 2, minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1), top: GH, noProxy: true,
      ramp: { z0, z1, y0: 0, y1: GH, steps: 12, rise: GH / 12, floating: false },
    });
    k.addRayBlocker(-2, 2, Math.min(z0, z1), Math.max(z0, z1), 0, GH);
  }
  // Spotlights from the ceiling down onto the pit floor.
  for (const [x, z, col] of [[-6, -6, 0xff3fa4], [6, 6, 0xff3fa4], [-6, 6, 0x2ee6d6], [6, -6, 0x2ee6d6]]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(3.2, CEIL - 0.5, 24, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide }));
    cone.position.set(x, (CEIL - 0.5) / 2, z);
    statics.add(cone);
  }
  // Giant playing cards standing in front of each spawn: rounded corners, a big suit, corner
  // indices, on a gold stand.
  const cardFace = (suit, red) => canvasTexture(320, 448, (c, w, h) => {
    const rr = 34;
    c.beginPath();
    c.roundRect(4, 4, w - 8, h - 8, rr);
    c.fillStyle = '#fffdf5';
    c.fill();
    c.lineWidth = 8;
    c.strokeStyle = '#1b0f2b';
    c.stroke();
    c.beginPath();
    c.roundRect(26, 26, w - 52, h - 52, 18);
    c.lineWidth = 4;
    c.strokeStyle = red ? '#d62828' : '#1b0f2b';
    c.stroke();
    c.fillStyle = red ? '#d62828' : '#1b0f2b';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = 'bold 220px Georgia, serif';
    c.fillText(suit, w / 2, h / 2 + 14);
    c.font = "bold 60px 'Luckiest Guy', 'Arial Black', sans-serif";
    c.fillText('A', 52, 66);
    c.font = 'bold 44px Georgia, serif';
    c.fillText(suit, 52, 118);
    c.save();
    c.translate(w - 52, h - 66);
    c.rotate(Math.PI);
    c.font = "bold 60px 'Luckiest Guy', 'Arial Black', sans-serif";
    c.fillText('A', 0, 0);
    c.font = 'bold 44px Georgia, serif';
    c.fillText(suit, 0, -52);
    c.restore();
  });
  const cardShape = new THREE.Shape();
  {
    const cw = 2.2;
    const ch = 3.1;
    const rr = 0.25;
    cardShape.moveTo(-cw + rr, -ch);
    cardShape.lineTo(cw - rr, -ch);
    cardShape.quadraticCurveTo(cw, -ch, cw, -ch + rr);
    cardShape.lineTo(cw, ch - rr);
    cardShape.quadraticCurveTo(cw, ch, cw - rr, ch);
    cardShape.lineTo(-cw + rr, ch);
    cardShape.quadraticCurveTo(-cw, ch, -cw, ch - rr);
    cardShape.lineTo(-cw, -ch + rr);
    cardShape.quadraticCurveTo(-cw, -ch, -cw + rr, -ch);
  }
  const cardBody = new THREE.ExtrudeGeometry(cardShape, { depth: 0.18, bevelEnabled: false });
  cardBody.translate(0, 0, -0.09);
  cardBody.scale(0.5, 0.5, 1);
  for (const [side, suit, red] of [[-1, '♥', true], [1, '♠', false]]) {
    const cx = side * 6.8;
    const g = new THREE.Group();
    g.position.set(cx, 0, 0);
    g.rotation.y = Math.PI / 2;
    const body = part(cardBody, 0xfffdf5, { ink: 0.03 });
    body.position.y = 1.75;
    const faceMat = new THREE.MeshBasicMaterial({ map: cardFace(suit, red), transparent: true });
    for (const f of [1, -1]) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3.1), faceMat);
      face.position.set(0, 1.75, f * 0.1);
      if (f < 0) face.rotation.y = Math.PI;
      g.add(face);
    }
    const stand = part(new THREE.BoxGeometry(2.6, 0.3, 0.8), 0xd4a63a, { ink: 0.02 });
    stand.position.y = 0.15;
    g.add(body, stand);
    g.rotation.z = side * 0.04;
    statics.add(g);
    box(cx, 0, 0.6, 2.4, 3.3);
  }
  // The chip tower in the middle: taller than anyone, so you can't see across it.
  const chipCols = [0xe63946, 0x1b0f2b, 0x2a9d8f, 0x7b2cbf, 0xffd23f, 0xe63946, 0xfff6e0];
  for (let i = 0; i < 7; i++) {
    const chip = part(new THREE.CylinderGeometry(2.0, 2.0, 0.5, 28), chipCols[i], { ink: 0.02 });
    chip.position.set(Math.sin(i * 2.1) * 0.1, 0.25 + i * 0.52, Math.cos(i * 2.1) * 0.1);
    statics.add(chip);
  }
  circle(0, 0, 2.05, 3.7);
  // Giant dice to duck behind on the way round.
  for (const [x, z, ry] of [[-4.5, -7, 0.4], [4.5, 7, -0.5], [4.5, -7, 0.9], [-4.5, 7, -0.2]]) {
    const holder = new THREE.Group();
    holder.position.set(x, 0, z);
    holder.rotation.y = ry;
    const die = part(new THREE.BoxGeometry(2.2, 2.2, 2.2), 0xfff6e0, { ink: 0.03 });
    die.position.y = 1.1;
    holder.add(die);
    for (const [px, py] of [[-0.5, 0.5], [0, 0], [0.5, -0.5]]) {
      for (const f of [1, -1]) {
        const pip = new THREE.Mesh(new THREE.CircleGeometry(0.18, 12), new THREE.MeshBasicMaterial({ color: 0xd62828 }));
        pip.position.set(px, 1.1 + py, f * 1.115);
        if (f < 0) pip.rotation.y = Math.PI;
        holder.add(pip);
      }
    }
    statics.add(holder);
    circle(x, z, 1.35, 2.2);
  }
  // A jumbotron hanging over the middle of the pit, a screen on each side.
  const screenTex = canvasTexture(512, 192, (c, w, h) => {
    c.fillStyle = '#07040f';
    c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(46, 230, 214, 0.08)';
    for (let y = 0; y < h; y += 4) c.fillRect(0, y, w, 2);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.shadowBlur = 20;
    c.shadowColor = '#ff3fa4';
    c.fillStyle = '#ff3fa4';
    c.font = "bold 88px 'Luckiest Guy', 'Arial Black', sans-serif";
    c.fillText('THE PIT', w / 2, h * 0.42);
    c.shadowColor = '#2ee6d6';
    c.fillStyle = '#2ee6d6';
    c.font = "bold 30px 'Luckiest Guy', 'Arial Black', sans-serif";
    c.fillText('♠ 1v1 · WINNER TAKES ALL ♠', w / 2, h * 0.8);
  });
  const jumbo = new THREE.Group();
  jumbo.position.set(0, 8.1, 0);
  const jbody = part(new THREE.BoxGeometry(6, 2.3, 6), 0x1b0f2b, { ink: 0.02, shadow: false });
  jumbo.add(jbody);
  const screenMat = new THREE.MeshBasicMaterial({ map: screenTex });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 2.0), screenMat);
    scr.position.set(Math.sin(a) * 3.02, 0, Math.cos(a) * 3.02);
    scr.rotation.y = a;
    jumbo.add(scr);
  }
  for (const y of [1.2, -1.2]) {
    const trim = part(new THREE.BoxGeometry(6.3, 0.18, 6.3), 0xd4a63a, { ink: 0, shadow: false });
    trim.position.y = y;
    jumbo.add(trim);
  }
  const under = new THREE.Mesh(new THREE.CircleGeometry(2.2, 32), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
  under.rotation.x = Math.PI / 2;
  under.position.y = -1.3;
  jumbo.add(under);
  for (const [cx, cz] of [[-2.5, -2.5], [2.5, 2.5], [-2.5, 2.5], [2.5, -2.5]]) {
    const cable = part(new THREE.CylinderGeometry(0.04, 0.04, CEIL - 9.25, 4), 0x0a0614, { ink: 0, shadow: false });
    cable.position.set(cx, (CEIL - 8.1 + 1.15) / 2, cz);
    jumbo.add(cable);
  }
  statics.add(jumbo);
  zones.push({ name: 'The Pit', x: 0, z: 0, w: R * 2, d: R * 2, tier: 1 });
  minimap.push({ x: 0, z: 0, w: R * 2, d: R * 2, color: '#7a1028', label: 'The Pit' });

  // ----- Casino dressing around the edges (just for show) -----
  const slotColors = [0x2a9d8f, 0xe63946, 0x7b2cbf, 0xffb703];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 12; i++) {
      const g = new THREE.Group();
      const sx = side * (H - 2.5);
      const sz = -40 + i * 7;
      g.position.set(sx, 0, sz);
      g.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      const body = part(new THREE.BoxGeometry(1.6, 2.2, 1.2), slotColors[i % 4]);
      body.position.y = 1.1;
      const screen = part(new THREE.BoxGeometry(1.2, 0.6, 0.05), 0xfff6e0, { ink: 0.02 });
      screen.position.set(0, 1.6, 0.62);
      g.add(body, screen);
      statics.add(g);
      box(sx, sz, 1.4, 1.8, 2.4);
    }
  }
  // Every Back Room game has a table here, plus the Showdown table for poker. The games themselves
  // (wheels, cards, rockets, reels) are built on top by tables.js; the reels and Plinko are full
  // cabinets of their own, so they get no round table.
  // Two rows down the east and west sides, well clear of The Pit and its ramps.
  const tables = [
    { x: -38, z: -28, game: 'blackjack', label: 'BLACKJACK', color: '#5ee27a' },
    { x: -40, z: 0, game: 'plinko', label: 'PLINKO', color: '#ff9f1c' },
    { x: -38, z: 28, game: 'crash', label: 'CRASH', color: '#2ee6d6' },
    { x: 38, z: -28, game: 'roulette', label: 'ROULETTE', color: '#ff5d5d' },
    { x: 38, z: 0, game: 'poker', label: 'POKER SHOWDOWN', color: '#ffd23f' },
    { x: 38, z: 28, game: 'mines', label: 'MINES', color: '#c77dff' },
    { x: 0, z: -40, game: 'slots', label: 'LOOT REELS', color: '#ff3fa4' },
  ];
  const CABINETS = ['slots', 'plinko'];
  const felt = toon(0x1f8a4c);
  for (const { x: tx, z: tz } of tables.filter((t) => !CABINETS.includes(t.game))) {
    const leg = part(new THREE.CylinderGeometry(0.8, 1.1, 0.9, 14), 0x2b2140);
    leg.position.set(tx, 0.45, tz);
    const rimT = part(new THREE.CylinderGeometry(2.6, 2.6, 0.22, 28), 0x6b3a1e);
    rimT.position.set(tx, 1, tz);
    const top = part(new THREE.CylinderGeometry(2.4, 2.4, 0.06, 28), felt, { ink: 0 });
    top.position.set(tx, 1.12, tz);
    statics.add(leg, rimT, top);
    circle(tx, tz, 2.6, 1.15);
  }
  // Every game sits on its own round rug with a glowing edge, with brass lamps round it.
  for (const t of tables) {
    const col = new THREE.Color(t.color);
    const rug = new THREE.Mesh(new THREE.CircleGeometry(5.4, 40), new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(0.22) }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(t.x, 0.045, t.z);
    const edge = new THREE.Mesh(new THREE.RingGeometry(5.4, 5.75, 48), new THREE.MeshBasicMaterial({ color: col }));
    edge.rotation.x = -Math.PI / 2;
    edge.position.set(t.x, 0.05, t.z);
    const inner = new THREE.Mesh(new THREE.RingGeometry(4.7, 4.82, 48), new THREE.MeshBasicMaterial({ color: 0xd4a63a }));
    inner.rotation.x = -Math.PI / 2;
    inner.position.set(t.x, 0.05, t.z);
    statics.add(rug, edge, inner);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const lx = t.x + Math.cos(a) * 5.2;
      const lz = t.z + Math.sin(a) * 5.2;
      const pole = part(new THREE.CylinderGeometry(0.07, 0.1, 2.4, 8), 0xd4a63a, { ink: 0.02, shadow: false });
      pole.position.set(lx, 1.2, lz);
      const foot = part(new THREE.CylinderGeometry(0.3, 0.35, 0.12, 12), 0xd4a63a, { ink: 0, shadow: false });
      foot.position.set(lx, 0.06, lz);
      const globe = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), new THREE.MeshBasicMaterial({ color: col.clone().lerp(new THREE.Color(0xffffff), 0.45) }));
      globe.position.set(lx, 2.55, lz);
      statics.add(pole, foot, globe);
      circle(lx, lz, 0.25, 2.4);
    }
  }
  // A long bar on the north wall.
  const bar = part(new THREE.BoxGeometry(30, 1.25, 2.2), 0x6b3a1e);
  bar.position.set(0, 0.62, -H + 6);
  statics.add(bar);
  box(0, -H + 6, 30, 2.2, 1.3);
  const barSign = neonSign('HIGH ROLLER LOUNGE', '#ffd23f', 34);
  barSign.position.set(0, 7, -H + 1);
  statics.add(barSign);
  // The way out.
  const door = part(new THREE.BoxGeometry(6, 4.2, 0.4), 0xd4a63a, { ink: 0.04 });
  door.position.set(0, 2.1, H - 0.9);
  const exitSign = neonSign('CASH OUT', '#5ee27a', 10);
  exitSign.position.set(0, 5.6, H - 1.2);
  exitSign.rotation.y = Math.PI;
  statics.add(door, exitSign);
  flat(0, H - 3.5, 8, 5, toon(0x5ee27a), 0.04);
  minimap.push({ x: 0, z: H - 3, w: 8, d: 4, color: '#5ee27a', label: 'Cash Out' });
  // The House Champion's corner.
  flat(0, 22, 6, 6, toon(0xffd23f), 0.05);
  zones.push({ name: 'High Roller Lounge', x: 0, z: 0, w: H * 2, d: H * 2, tier: 1 });

  for (const t of tables) {
    // Hung up high, above the scoreboard each game puts over its table.
    const y = CABINETS.includes(t.game) ? 7.2 : 6.2;
    const sg = neonSign(t.label, t.color, Math.max(6, t.label.length * 0.75));
    sg.position.set(t.x, y, t.z);
    statics.add(sg);
    const sg2 = neonSign(t.label, t.color, Math.max(6, t.label.length * 0.75));
    sg2.position.set(t.x, y, t.z);
    sg2.rotation.y = Math.PI;
    statics.add(sg2);
  }
  // Betting windows on both sides of The Pit.
  for (const [bx, bz] of [[7, R + 8], [-7, -R - 8]]) {
    const booth = part(new THREE.BoxGeometry(3, 1.2, 0.8), 0xd4a63a, { ink: 0.03 });
    booth.position.set(bx, 0.6, bz + Math.sign(bz) * 1.2);
    statics.add(booth);
    box(bx, bz + Math.sign(bz) * 1.2, 3, 0.8, 1.2);
    const bs = neonSign('🎟️ BETS', '#ffd23f', 5);
    bs.position.set(bx, 2.6, bz + Math.sign(bz) * 1.2);
    if (bz < 0) bs.rotation.y = Math.PI;
    statics.add(bs);
  }
  const lights = [[0, 0, 0xff3fa4], [-38, -14, 0xffd23f], [38, -14, 0x2ee6d6], [-38, 14, 0xc77dff], [38, 14, 0xffd23f], [0, -40, 0xff3fa4], [0, 45, 0x5ee27a]];
  return {
    casino: { x: 0, z: 0, w: 0, d: 0, doors: [] },
    vault: { x: 0, z: -5000, doorZ: -5000 },
    extracts: [],
    lights,
    spawns: [[-40, 42], [40, 42], [-40, -42], [40, -42], [-20, 45], [20, 45], [-22, 0], [22, 0]],
    lounge: { arena: { x: 0, z: 0, r: R }, champion: { x: 8, z: 25 }, exit: { x: 0, z: H - 3.5 }, tables, armory: { x: -26, z: H - 4.5, rot: Math.PI } },
  };
}

// ---------- The Training Floor: the tutorial, one station after another up a fenced lane ----------

function trainingFloor(k) {
  const { H, THREE, statics, zones, minimap, part, toon, neonSign, flat, box, circle, container } = k;
  const wallMat = toon(0x3a1d5c);
  const trimMat = toon(0xffd23f);
  // The lane: x from -11 to 11, spawn at the south end, the exit at the north end.
  const L = 11;
  const wall = (x0, x1, z0, z1, h, mat = wallMat) => {
    const m = part(new THREE.BoxGeometry(x1 - x0, h, z1 - z0), mat, { ink: 0.03 });
    m.position.set((x0 + x1) / 2, h / 2, (z0 + z1) / 2);
    statics.add(m);
    box((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, h);
  };
  wall(-L - 1, -L, -48, 48, 3.2);
  wall(L, L + 1, -48, 48, 3.2);
  wall(-L - 1, L + 1, 48, 49, 3.2);
  wall(-L - 1, L + 1, -49, -48, 3.2);
  // Gold trim along the top and a striped runway down the middle.
  for (const x of [-L - 0.5, L + 0.5]) {
    const t = part(new THREE.BoxGeometry(1.2, 0.25, 97), trimMat, { ink: 0.02 });
    t.position.set(x, 3.3, 0);
    statics.add(t);
  }
  flat(0, 0, 2 * L, 96, toon(0x5a2a6a), 0.03);
  for (let z = -44; z <= 44; z += 6) flat(0, z, 1.2, 3, toon(0xffd23f), 0.04);
  // Station pads: a numbered circle on the floor and a sign over each one.
  const stations = [
    [32, '1 · MOVE', '#5ee27a'], [24, '2 · JUMP & ROLL', '#2ee6d6'], [16, '3 · LOOT', '#ffd23f'], [4, '4 · SHOOT', '#ff3fa4'],
    [-6, '5 · HEAL', '#ff7eb6'], [-16, '6 · THROW', '#ff9f1c'], [-28, '7 · FIGHT', '#e63946'], [-42, '8 · GET OUT', '#5ee27a'],
  ];
  for (const [z, label, color] of stations) {
    const sign = neonSign(label, color, 9);
    sign.position.set(0, 5.4, z + 2);
    statics.add(sign);
    for (const x of [-L + 0.4, L - 0.4]) {
      const post = part(new THREE.BoxGeometry(0.3, 5.6, 0.3), 0x1b0f2b, { ink: 0 });
      post.position.set(x, 2.8, z + 2);
      statics.add(post);
    }
    const bar = part(new THREE.BoxGeometry(2 * L - 0.8, 0.2, 0.2), 0x1b0f2b, { ink: 0 });
    bar.position.set(0, 5.6, z + 2);
    statics.add(bar);
  }
  // 2: a low barrier across the lane to hop over.
  const barrier = part(new THREE.BoxGeometry(2 * L, 0.6, 0.8), 0xe63946, { ink: 0.03 });
  barrier.position.set(0, 0.3, 24);
  statics.add(barrier);
  for (let x = -L + 1; x < L; x += 2) {
    const stripe = part(new THREE.BoxGeometry(0.9, 0.62, 0.82), 0xfff6e0, { ink: 0 });
    stripe.position.set(x, 0.3, 24);
    statics.add(stripe);
  }
  box(0, 24, 2 * L, 0.8, 0.6);
  // 3: three chests, three badge colors: gray, blue, purple (the tutorial fills the purple one).
  flat(0, 15, 14, 4, toon(0x7a1028), 0.05);
  container('crate', -5, 15, 1);
  container('crate', 0, 15, 2);
  container('crate', 5, 15, 3);
  // 4: the range: a sandbag line to shoot from and a backstop.
  for (const x of [-8, 8]) wall(x - 2.5, x + 2.5, 8.6, 9.4, 1.0, toon(0xb08968));
  wall(-L, -2.5, -2.6, -2, 3, toon(0x6b3a1e));
  wall(2.5, L, -2.6, -2, 3, toon(0x6b3a1e));
  // 6: a low wall to throw over.
  wall(-6, 6, -15, -14.3, 1.4, toon(0x6b7280));
  // 7: some cover in the fight pit.
  for (const [x, z] of [[-6, -26], [6, -30], [-3, -33]]) {
    const c = part(new THREE.BoxGeometry(2, 1.4, 2), 0xb07a3c, { ink: 0.03 });
    c.position.set(x, 0.7, z);
    statics.add(c);
    box(x, z, 2, 2, 1.4);
  }
  zones.push({ name: 'Training Floor', x: 0, z: 0, w: 2 * L, d: 96, tier: 1 });
  minimap.push({ x: 0, z: 0, w: 2 * L, d: 96, color: '#5a2a6a', label: 'Training' });
  return {
    casino: { x: 0, z: 0, w: 0, d: 0, doors: [] },
    vault: { x: 0, z: -5000, doorZ: -5000 },
    extracts: [{ name: 'Training Exit', x: 0, z: -42 }],
    spawns: [[0, 42]],
    lights: [[0, 30, 0xff3fa4], [0, 0, 0xffd23f], [0, -30, 0x5ee27a]],
  };
}

// ---------- Temakilla: Temecula wine country. Vineyards, hot air balloons and Old Town ----------

function wineCountry(k) {
  const {
    H, THREE, statics, zones, minimap, slotSpots, part, toon, neonSign, flat, box, circle,
    car, palm, cactus, rock, streetLight, billboard, crateStack, building, container, enemies, casino,
    scatter, yard, watchtower, waterTower, boardTexture, animate,
  } = k;
  const road = toon(0x4a4453);
  const dirt = toon(0xc9a37a);
  const boards = toon(0x8b5a2b);
  // Highway 79 runs north-south past the casino; Front Street (Old Town) runs east-west.
  flat(0, (H + 14) / 2, 14, H - 14, road);
  flat(0, 60, H * 2, 14, road, 0.025);
  minimap.push({ x: 0, z: (H + 14) / 2, w: 14, d: H - 14, color: '#4a4453' }, { x: 0, z: 60, w: H * 2, d: 14, color: '#4a4453' });
  const dash = toon(0xfff6e0);
  for (let z = 18; z < H; z += 8) if (Math.abs(z - 60) > 9) flat(0, z, 0.4, 3.5, dash, 0.035);

  // ----- props -----
  const leaf = [toon(0x4d7c0f), toon(0x3f6212), toon(0x65a30d)];
  // A big California live oak: a fat trunk and a wide, lumpy canopy.
  function oak(x, z, s = 1) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.scale.setScalar(s);
    const trunk = part(new THREE.CylinderGeometry(0.5, 0.75, 4, 8), 0x6b4423, { ink: 0.03 });
    trunk.position.y = 2;
    g.add(trunk);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + Math.random();
      const blob = new THREE.Mesh(new THREE.DodecahedronGeometry(2.2 + Math.random() * 0.8, 0), leaf[i % 3]);
      blob.position.set(Math.cos(a) * 2, 4.6 + Math.random() * 1.2, Math.sin(a) * 2);
      g.add(blob);
    }
    const top = new THREE.Mesh(new THREE.DodecahedronGeometry(2.6, 0), leaf[0]);
    top.position.y = 6;
    g.add(top);
    statics.add(g);
    circle(x, z, 0.7 * s, 4 * s);
  }
  // Chaparral: low grey-green scrub.
  const scrubMat = toon(0x8a9a5b);
  function scrub(x, z) {
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.8 + Math.random() * 0.7, 0), scrubMat);
    m.position.set(x, 0.4, z);
    m.scale.y = 0.6;
    statics.add(m);
  }
  // A wine barrel (lying down or standing up).
  function barrel(x, z, lying = true) {
    const b = part(new THREE.CylinderGeometry(0.85, 0.85, 1.8, 12), 0x7c4a1e, { ink: 0.02 });
    if (lying) { b.rotation.z = Math.PI / 2; b.position.set(x, 0.85, z); } else b.position.set(x, 0.9, z);
    for (const o of [-0.55, 0.55]) {
      const hoop = part(new THREE.TorusGeometry(0.86, 0.06, 6, 16), 0x2b2140, { ink: 0 });
      if (lying) { hoop.rotation.y = Math.PI / 2; hoop.position.set(x + o, 0.85, z); } else { hoop.rotation.x = Math.PI / 2; hoop.position.set(x, 0.9 + o, z); }
      statics.add(hoop);
    }
    statics.add(b);
    if (lying) box(x, z, 1.8, 1.7, 1.7); else circle(x, z, 0.85, 1.8);
  }
  // Vineyard rows: trellis posts with a hedge of vines and purple grapes, gaps to run through.
  const vineMat = toon(0x4f7a28);
  const grapeMat = new THREE.MeshBasicMaterial({ color: 0x6b21a8 });
  const postMat = toon(0x8b6b4a);
  const soilMat = toon(0x9c7650);
  function vineyard(name, fx, fz, w, d, rowsAlong = 'x', tier = 1) {
    const rows = rowsAlong === 'x';
    flat(fx, fz, w, d, soilMat, 0.03);
    const len = rows ? w : d;
    const across = rows ? d : w;
    for (let r = -across / 2 + 3; r <= across / 2 - 2; r += 6) {
      // Each row is a few segments with gaps between them.
      let a = -len / 2 + 2;
      while (a < len / 2 - 4) {
        const seg = Math.min(14 + Math.random() * 10, len / 2 - 2 - a);
        if (seg < 4) break;
        const cx = rows ? fx + a + seg / 2 : fx + r;
        const cz = rows ? fz + r : fz + a + seg / 2;
        const hedge = new THREE.Mesh(new THREE.BoxGeometry(rows ? seg : 1.1, 1.5, rows ? 1.1 : seg), vineMat);
        hedge.position.set(cx, 0.95, cz);
        statics.add(hedge);
        for (let p = 0; p <= seg; p += 4.5) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2, 0.18), postMat);
          post.position.set(rows ? fx + a + p : fx + r, 1, rows ? fz + r : fz + a + p);
          statics.add(post);
        }
        for (let gq = 0; gq < seg / 2.5; gq++) {
          const bunch = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 5), grapeMat);
          const t = Math.random() * seg;
          bunch.position.set(rows ? fx + a + t : fx + r + (Math.random() < 0.5 ? -0.6 : 0.6), 0.6 + Math.random() * 0.5, rows ? fz + r + (Math.random() < 0.5 ? -0.6 : 0.6) : fz + a + t);
          statics.add(bunch);
        }
        box(cx, cz, rows ? seg : 1.1, rows ? 1.1 : seg, 1.6);
        a += seg + 3.5;
      }
    }
    zones.push({ name, x: fx, z: fz, w, d, tier });
    minimap.push({ x: fx, z: fz, w, d, color: '#6d8f3a', label: name, tier });
    container('crate', fx - w / 2 + 2, fz - d / 2 + 2, tier);
    container('crate', fx + w / 2 - 2, fz + d / 2 - 2, tier);
    enemies('dicer', fx, fz, 2, Math.min(w, d) * 0.4);
  }
  // A hot air balloon: striped envelope, a basket underneath.
  const BALLOON = [[0xe63946, 0xffd23f], [0x2ee6d6, 0xfff6e0], [0xc77dff, 0xff7eb6], [0xff9f43, 0x4dabff], [0x5ee27a, 0xffd23f], [0xff3fa4, 0x7b2cbf]];
  // Balloon fabric ignores the haze so they stay bright even far away.
  const balloonMats = new Map();
  const balloonMat = (c) => {
    if (!balloonMats.has(c)) balloonMats.set(c, toon(c, { unique: true, fog: false }));
    return balloonMats.get(c);
  };
  function balloonModel(i, s = 1) {
    const g = new THREE.Group();
    const [c1, c2] = BALLOON[i % BALLOON.length];
    for (let k2 = 0; k2 < 8; k2++) {
      const gore = new THREE.Mesh(new THREE.SphereGeometry(5 * s, 6, 12, (k2 / 8) * Math.PI * 2, Math.PI / 4), balloonMat(k2 % 2 ? c1 : c2));
      gore.scale.y = 1.2;
      gore.position.y = 9 * s;
      g.add(gore);
    }
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(1.6 * s, 2.6 * s, 2 * s, 12, 1, true), balloonMat(c1));
    skirt.position.y = 3.6 * s;
    const basket = part(new THREE.BoxGeometry(2 * s, 1.4 * s, 2 * s), 0x8b5a2b, { ink: 0.03 });
    basket.position.y = 0.7 * s;
    g.add(skirt, basket);
    for (const [dx, dz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) {
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.4 * s, 4), new THREE.MeshBasicMaterial({ color: 0x2b2140 }));
      rope.position.set(dx * s, 2.4 * s, dz * s);
      g.add(rope);
    }
    return g;
  }
  // String lights between two points.
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff1b8 });
  function lights(x0, z0, x1, z1, y = 6) {
    const n = Math.max(4, Math.round(Math.hypot(x1 - x0, z1 - z0) / 2));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), bulbMat);
      b.position.set(x0 + (x1 - x0) * t, y - Math.sin(t * Math.PI) * 1.2, z0 + (z1 - z0) * t);
      statics.add(b);
    }
  }

  // ----- the casino: Grand Vine Casino & Winery -----
  const cas = casino({
    x: 0, z: -55, name: 'Grand Vine Casino', sign: 'GRAND VINE CASINO', signColor: '#ff7eb6',
    color: 0x7f1d3a, trim: 0x2b0f1c, mapColor: '#7f1d3a', felt: 0x14532d,
    plaza(px, pz) {
      // A fountain shaped like a giant wine glass, and a ring of barrels.
      const bowl = new THREE.Mesh(new THREE.SphereGeometry(3.4, 18, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xdbeafe, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
      bowl.position.set(px, 6.8, pz);
      const wine = new THREE.Mesh(new THREE.CircleGeometry(3.2, 20), new THREE.MeshBasicMaterial({ color: 0x7f1d3a }));
      wine.rotation.x = -Math.PI / 2;
      wine.position.set(px, 6.15, pz);
      const stem = part(new THREE.CylinderGeometry(0.3, 0.3, 3.4, 10), 0xdbeafe, { ink: 0.02 });
      stem.position.set(px, 1.9, pz);
      const foot = part(new THREE.CylinderGeometry(2.4, 2.6, 0.4, 20), 0xdbeafe, { ink: 0.02 });
      foot.position.set(px, 0.2, pz);
      statics.add(bowl, wine, stem, foot);
      circle(px, pz, 2.6, 2);
      for (const [dx, dz] of [[-14, 8], [14, 8], [-14, -6], [14, -6]]) barrel(px + dx, pz + dz, false);
      for (const [dx, dz] of [[-18, 12], [18, 12]]) oak(px + dx, pz + dz, 0.9);
      lights(px - 16, pz + 10, px + 16, pz + 10, 7);
      enemies('dicer', px, pz + 4, 2, 16);
    },
  });

  // ----- Old Town Temecula: wooden false-front shops along Front Street -----
  const woods = [0xb5835a, 0x9c6644, 0xd4a373, 0x8d5524, 0xe9c46a, 0xcb997e, 0x7f5539];
  const shops = [
    ['Front St. Saloon', 'SALOON', '#ffd23f'], ['General Store', 'GENERAL STORE', '#5ee27a'], ['Olive Oil Co.', 'OLIVE OIL CO', '#a3e635'],
    ['Old Town Candy', 'CANDY', '#ff7eb6'], ['Sheriff', 'SHERIFF', '#7dd3fc'], ['Antiques', 'ANTIQUES', '#c77dff'],
    ['Tasting Room', 'WINE TASTING', '#ff3fa4'], ['Mercantile Hotel', 'HOTEL', '#ff9f1c'],
  ];
  shops.forEach(([name, sign, sc], i) => {
    const side = i % 2 ? 1 : -1; // north or south of Front Street
    const x = -110 + Math.floor(i / 2) * 40 + (Math.floor(i / 2) >= 2 ? 60 : 0);
    const z = 60 + side * 20;
    const w = 18;
    const d = 14;
    const h = i === 7 ? 9 : 5.5;
    building({ name, x, z, w, d, h, color: woods[i % woods.length], trim: 0x3e2716, tier: 2, sign, signColor: sc, mapColor: '#8b5a2b', doors: [{ side: side < 0 ? 's' : 'n', at: 0, width: 3 }] });
    // The tall false front, a boardwalk and a porch roof on posts.
    const fz = z - side * (d / 2 + 0.3);
    const facade = part(new THREE.BoxGeometry(w + 1, 3, 0.4), woods[(i + 3) % woods.length], { ink: 0.03 });
    facade.position.set(x, h + 1.2, fz);
    statics.add(facade);
    flat(x, z - side * (d / 2 + 2), w + 2, 4, boards, 0.04);
    const awning = part(new THREE.BoxGeometry(w + 2, 0.25, 4), 0x5b3a1e, { ink: 0.03 });
    awning.position.set(x, 3.4, z - side * (d / 2 + 2));
    statics.add(awning);
    for (const dx of [-w / 2, 0, w / 2]) {
      const post = part(new THREE.CylinderGeometry(0.14, 0.14, 3.4, 6), 0x5b3a1e, { ink: 0.02 });
      post.position.set(x + dx, 1.7, z - side * (d / 2 + 3.8));
      statics.add(post);
      circle(x + dx, z - side * (d / 2 + 3.8), 0.15, 3.4);
    }
    container(i % 3 === 0 ? 'register' : 'locker', x - 5, z + side * 3, 2);
    container('crate', x + 5, z + side * 3, 2);
    if (i === 6) for (let b = 0; b < 4; b++) barrel(x - 6 + b * 4, z + side * (d / 2 + 7), false);
    if (i % 3 === 1) slotSpots.push({ x: x + 5, z: z - side * (d / 2 + 2.2), rot: side < 0 ? 0 : Math.PI, tier: 2 });
    enemies(['slotbot', 'shark', 'dicer'][i % 3], x, z - side * 14, 1);
  });
  // Hitching posts, troughs and string lights across the street.
  for (let x = -120; x <= 120; x += 30) {
    if (Math.abs(x) < 12) continue;
    lights(x, 46, x + 10, 74, 7);
    const rail = part(new THREE.BoxGeometry(4, 0.2, 0.2), 0x5b3a1e, { ink: 0.02 });
    rail.position.set(x + 4, 1.1, 51.5);
    statics.add(rail);
    const trough = part(new THREE.BoxGeometry(3, 0.8, 1.2), 0x6b4423, { ink: 0.02 });
    trough.position.set(x + 4, 0.4, 68.5);
    statics.add(trough);
    box(x + 4, 68.5, 3, 1.2, 0.8);
  }
  for (const x of [-125, -90, 90, 125]) palm(x, 47);
  waterTower(-40, 108, 0xd1d5db, 'TEMECULA');
  zones.push({ name: 'Old Town Temecula', x: 0, z: 60, w: 300, d: 60, tier: 2 });
  billboard(-20, 110, Math.PI / 2, 'OLD TOWN\nTEMECULA\nEST. 1859', '#7f1d3a', '#fff6e0');
  billboard(20, 170, -Math.PI / 2, 'SIP. SPIN.\nREPEAT.', '#14532d', '#ffd23f');
  for (let i = 0; i < 8; i++) car(-130 + i * 34 + (i > 3 ? 20 : 0), i % 2 ? 64 : 56, 'x', undefined, i % 4 === 0);

  // ----- vineyards all over the hills -----
  vineyard('Cabernet Rows', 150, -40, 90, 80, 'x', 1);
  vineyard('Merlot Hill', -150, -60, 80, 90, 'z', 1);
  vineyard('Zinfandel Slope', 140, 170, 100, 60, 'x', 1);
  vineyard('Syrah Bench', -75, 205, 70, 60, 'z', 1);

  // ----- wineries -----
  function winery({ name, sign, x, z, color, tier = 2, deadly = false }) {
    building({ name, x, z, w: 26, d: 18, h: 6, color, trim: 0x3e2716, tier, sign, signColor: '#ff7eb6', mapColor: '#9c6644', doors: [{ side: 's', at: 0, width: 4 }, { side: 'e', at: 0, width: 3 }] });
    // Barrel room out back and a tasting patio out front.
    building({ name: 'Barrel Cellar', x: x - 4, z: z - 18, w: 18, d: 12, h: 4, color: 0x6b4423, trim: 0x2b1a0e, tier: tier + (deadly ? 0 : 0), mapColor: '#5b3a1e', doors: [{ side: 'e', at: 0, width: 3 }] });
    for (let b = 0; b < 3; b++) barrel(x - 10 + b * 3.4, z - 21.5, true);
    for (const [dx, dz] of [[-8, 13], [0, 13], [8, 13]]) {
      const table = part(new THREE.CylinderGeometry(1.1, 1.1, 0.12, 12), 0xfff6e0, { ink: 0.02 });
      table.position.set(x + dx, 1.05, z + dz);
      const leg = part(new THREE.CylinderGeometry(0.1, 0.1, 1, 6), 0x2b2140, { ink: 0 });
      leg.position.set(x + dx, 0.5, z + dz);
      statics.add(table, leg);
      circle(x + dx, z + dz, 1.1, 1.1);
    }
    lights(x - 13, z + 10, x + 13, z + 10, 5.5);
    oak(x + 18, z + 8, 1.1);
    container('safe', x - 9, z - 4, tier);
    container('locker', x + 9, z - 4, tier);
    container('crate', x + 1, z - 16.5, tier);
    container(deadly ? 'safe' : 'crate', x + 2, z - 21, tier);
    enemies('slotbot', x, z + 6, deadly ? 2 : 1);
    enemies('shark', x - 4, z - 12, deadly ? 2 : 1, 6);
  }
  winery({ name: 'Bust & Barrel Cellars', sign: 'BUST & BARREL', x: 110, z: -120, color: 0xe9d8a6 });
  winery({ name: 'Vino Bandito', sign: 'VINO BANDITO', x: -100, z: -150, color: 0xcb997e });
  // Château Jackpot: the deadly estate, walled in with watchtowers.
  {
    const cx = -200;
    const cz = 150;
    yard({ name: 'Château Jackpot', x: cx, z: cz, w: 64, d: 70, gates: ['e', 's'], tier: 3, mapColor: '#7f1d3a', wall: 0xe9d8a6 });
    winery({ name: 'Château Jackpot', sign: 'CHATEAU JACKPOT', x: cx, z: cz + 6, color: 0xfff6e0, tier: 3, deadly: true });
    for (const [wx, wz] of [[-28, -31], [28, -31], [-28, 31], [28, 31]]) watchtower(cx + wx, cz + wz, 0x7f1d3a);
    enemies('dicer', cx, cz + 24, 3, 14);
  }

  // ----- Balloon Launch Park: balloons on the ground, ready to go -----
  {
    const bx = 160;
    const bz = 108;
    flat(bx, bz, 70, 50, toon(0x9bc26b), 0.03);
    for (let i = 0; i < 4; i++) {
      const g = balloonModel(i, 0.9);
      const x = bx - 24 + i * 16;
      const z = bz + (i % 2 ? 8 : -8);
      g.position.set(x, 0, z);
      statics.add(g);
      box(x, z, 2, 2, 1.3);
      circle(x, z, 4.4, 14);
    }
    zones.push({ name: 'Balloon Launch Park', x: bx, z: bz, w: 70, d: 50, tier: 2 });
    minimap.push({ x: bx, z: bz, w: 70, d: 50, color: '#9bc26b', label: 'Balloon Launch Park', tier: 2 });
    container('crate', bx - 30, bz + 20, 2);
    container('locker', bx + 30, bz - 20, 2);
    container('safe', bx, bz + 22, 2);
    crateStack(bx + 20, bz + 20);
    enemies('roller', bx, bz, 2, 14);
  }
  // Balloons drifting high over the valley.
  {
    const drifting = [];
    for (let i = 0; i < 9; i++) {
      const g = balloonModel(i + 1, 1.2 + Math.random() * 0.6);
      const r = 60 + Math.random() * (H - 60);
      const a = Math.random() * Math.PI * 2;
      g.position.set(Math.cos(a) * r, 45 + Math.random() * 45, Math.sin(a) * r);
      statics.add(g);
      drifting.push({ g, vx: 0.6 + Math.random() * 0.8, vz: (Math.random() - 0.5) * 0.6, bob: Math.random() * 6, y: g.position.y });
    }
    animate((dt) => {
      const t = performance.now() / 1000;
      for (const b of drifting) {
        b.g.position.x += b.vx * dt;
        b.g.position.z += b.vz * dt;
        if (b.g.position.x > H + 80) b.g.position.x = -H - 80;
        b.g.position.y = b.y + Math.sin(t * 0.3 + b.bob) * 2;
      }
    });
  }

  // ----- Lake Skinner: a reservoir with a boat dock -----
  {
    const lx = 85;
    const lz = 240;
    const LR = 22;
    const water = new THREE.Mesh(new THREE.CircleGeometry(LR, 32), new THREE.MeshBasicMaterial({ color: 0x4dabff }));
    water.rotation.x = -Math.PI / 2;
    water.scale.set(1.4, 1, 1);
    water.position.set(lx, 0.04, lz);
    statics.add(water);
    // Too deep to wade into.
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      circle(lx + Math.cos(a) * LR * 0.9, lz + Math.sin(a) * LR * 0.6, LR * 0.42, 1.2);
    }
    circle(lx, lz, LR * 0.6, 1.2);
    zones.push({ name: 'Lake Skinner', x: lx, z: lz, w: LR * 2.8 + 6, d: LR * 2 + 6, tier: 1 });
    minimap.push({ x: lx, z: lz, w: LR * 2.6, d: LR * 1.9, color: '#4dabff', label: 'Lake Skinner', tier: 1 });
    flat(lx - LR * 1.4 - 4, lz, 10, 3, boards, 0.05);
    building({ name: 'Bait & Tackle', x: lx - LR * 1.4 - 12, z: lz - 12, w: 10, d: 9, h: 4, color: 0x9c6644, trim: 0x3e2716, tier: 1, mapColor: '#8b5a2b', doors: [{ side: 'e', at: 0, width: 2.6 }] });
    container('locker', lx - LR * 1.4 - 14, lz - 12, 1);
    enemies('shark', lx - LR * 1.4 - 6, lz + 12, 1);
  }

  const extracts = [
    { name: 'Balloon Ride', x: 215, z: 108 },
    { name: 'I-15 On-Ramp', x: -H + 14, z: -20 },
    { name: 'Wine Train', x: 40, z: -H + 15 },
    { name: 'Vail Lake Trail', x: -40, z: H - 12 },
  ];
  k.outposts({
    exits: extracts,
    names: ['Rancho California', 'Pala Ranch', 'Oak Grove Stables', 'Desert Rose Inn', 'Murrieta Hot Springs', 'Coyote Cantina', 'Grape Stomp Barn', 'Avocado Stand'],
    colors: woods, inner: 205, outer: H - 22, count: 8,
    avoid: (x, z) => Math.abs(x) < 26 || Math.abs(z - 60) < 40,
    extra: (x, z) => { for (let i = 0; i < 3; i++) oak(x + (Math.random() - 0.5) * 40, z + (Math.random() - 0.5) * 40, 0.8 + Math.random() * 0.4); },
  });
  // Rolling hills: oaks and chaparral, plus some desert (cactus and rocks) toward the edges.
  scatter(700, (x, z) => {
    const edge = Math.max(Math.abs(x), Math.abs(z)) / H;
    const r = Math.random();
    if (edge > 0.75 && r < 0.35) cactus(x, z);
    else if (r < 0.2) oak(x, z, 0.8 + Math.random() * 0.5);
    else if (r < 0.62) scrub(x, z);
    else if (r < 0.92) rock(x, z, 0.8 + Math.random() * 1.8);
    else crateStack(x, z);
  }, (x, z) => Math.abs(x) < 16 || Math.abs(z - 60) < 40 || extracts.some((e) => Math.hypot(x - e.x, z - e.z) < 22));
  for (let i = 0; i < 14; i++) enemies('dicer', (Math.random() * 2 - 1) * H * 0.85, (Math.random() * 2 - 1) * H * 0.85, 1);
  for (let i = 0; i < 6; i++) enemies('shark', (Math.random() * 2 - 1) * H * 0.85, (Math.random() * 2 - 1) * H * 0.85, 1);
  for (let i = 0; i < 36; i++) {
    const x = (Math.random() * 2 - 1) * (H - 20);
    const z = (Math.random() * 2 - 1) * (H - 20);
    if (zones.some((zn) => Math.abs(x - zn.x) < zn.w / 2 + 4 && Math.abs(z - zn.z) < zn.d / 2 + 4)) continue;
    container('crate', x, z, 1);
  }
  return {
    ...cas,
    extracts,
    spawns: k.ringSpawns(12, 22),
    // Tour buses and wine-tasting limos cruise Highway 79, and Santa Ana dust storms blow in off the desert.
    hazards: {
      dust: true,
      lanes: [
        { axis: 'z', at: 3.5, from: 16, to: H - 4, dir: 1 },
        { axis: 'z', at: -3.5, from: 16, to: H - 4, dir: -1 },
      ],
    },
  };
}

const BUILDERS = { training: trainingFloor, vegas: lostVegas, frost: frostbitePeaks, bayou: bayouRoyale, tequila: wineCountry, bunker: theBunker, lounge: theLounge };
