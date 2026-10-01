// Builds one casino floor: carpet, walls, pillars, cover, lighting, and the layout of where
// each game goes. The games themselves (tables, slots, elevator) are built by their own modules.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WALL_H } from './config.js';
import { part, toon, canvasTexture } from './toon.js';

function carpetTexture(theme, halfW, halfD) {
  const tex = canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = theme.carpet;
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
      diamond(x, y, 70, theme.carpet2);
      diamond(x, y, 22, theme.accent);
    }
    for (const [x, y] of [[128, 0], [0, 128], [256, 128], [128, 256]]) diamond(x, y, 12, 'rgba(0,0,0,0.25)');
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(halfW / 2, halfD / 2);
  return tex;
}

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
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
}

// Invisible low-poly stand-in for a collider, used for bullets and line-of-sight rays.
const proxyMat = new THREE.MeshBasicMaterial();
function proxyFor(c) {
  const mesh = c.type === 'box'
    ? new THREE.Mesh(new THREE.BoxGeometry(c.maxX - c.minX, c.top, c.maxZ - c.minZ), proxyMat)
    : new THREE.Mesh(new THREE.CylinderGeometry(c.r, c.r, c.top, 10), proxyMat);
  if (c.type === 'box') mesh.position.set((c.minX + c.maxX) / 2, c.top / 2, (c.minZ + c.maxZ) / 2);
  else mesh.position.set(c.x, c.top / 2, c.z);
  mesh.updateMatrixWorld(true);
  return mesh;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function buildWorld(scene, floor, floorNumber) {
  const solids = [];
  const colliders = [];
  const animated = [];
  const theme = floor.theme;
  const W = floor.halfW;
  const D = floor.halfD;
  const H = WALL_H;
  // Everything that never moves goes in here, then gets merged into a few big meshes by `bake()`.
  const statics = new THREE.Group();
  scene.add(statics);
  const addCollider = (c) => {
    colliders.push(c);
    solids.push(proxyFor(c));
  };
  const addBox = (x, z, w, d, top) => addCollider({ type: 'box', minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top });

  scene.background = new THREE.Color(theme.fog);
  scene.fog = new THREE.Fog(theme.fog, 45, 120);

  // Floor.
  const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, D * 2), toon(0xffffff, { map: carpetTexture(theme, W, D) }));
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.receiveShadow = true;
  statics.add(floorMesh);
  const ground = new THREE.Mesh(new THREE.BoxGeometry(W * 2, 0.2, D * 2), proxyMat);
  ground.position.y = -0.1;
  ground.updateMatrixWorld(true);
  solids.push(ground);

  // Walls with a trim stripe.
  const wallMat = toon(theme.wall);
  const lowerMat = toon(theme.wallLow);
  for (const [x, z, w, d] of [[0, -D, W * 2 + 1, 1], [0, D, W * 2 + 1, 1], [-W, 0, 1, D * 2 + 1], [W, 0, 1, D * 2 + 1]]) {
    const wall = part(new THREE.BoxGeometry(w, H, d), wallMat, { ink: 0 });
    wall.position.set(x, H / 2, z);
    statics.add(wall);
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(w, H * 3, d), proxyMat);
    proxy.position.set(x, H / 2, z);
    proxy.updateMatrixWorld(true);
    solids.push(proxy);
    const lower = part(new THREE.BoxGeometry(w + 0.1, 1.6, d + 0.1), lowerMat, { ink: 0, shadow: false });
    lower.position.set(x, 0.8, z);
    statics.add(lower);
    const trim = part(new THREE.BoxGeometry(w + 0.2, 0.18, d + 0.2), theme.trim, { ink: 0.02, shadow: false });
    trim.position.set(x, 1.65, z);
    statics.add(trim);
  }

  const sign = neonSign(floor.name.toUpperCase(), theme.neon, Math.min(26, W * 0.6));
  sign.position.set(0, 5.8, -D + 0.52);
  statics.add(sign);
  const floorSign = neonSign(`FLOOR ${floorNumber}`, '#2ee6d6', 10);
  floorSign.position.set(-W + 0.52, 5.4, 0);
  floorSign.rotation.y = Math.PI / 2;
  statics.add(floorSign);
  const rules = neonSign('NO REFUNDS', '#2ee6d6', 10);
  rules.position.set(W - 0.52, 5.4, 0);
  rules.rotation.y = -Math.PI / 2;
  statics.add(rules);

  // The bar along the right wall.
  {
    const x = W - 3.5;
    const len = Math.min(16, D);
    const bar = part(new THREE.BoxGeometry(2, 1.25, len), 0x6b3a1e);
    bar.position.set(x, 0.62, 0);
    const top = part(new THREE.BoxGeometry(2.3, 0.14, len + 0.3), theme.wallLow, { ink: 0.02 });
    top.position.set(x, 1.3, 0);
    statics.add(bar, top);
    addBox(x, 0, 2.3, len + 0.3, 1.37);
    const bottleColors = [0x5ee27a, 0xff9f43, 0x4dabff, 0xff5d5d];
    for (let i = 0; i < Math.floor(len / 1.6); i++) {
      const bottle = part(new THREE.CylinderGeometry(0.1, 0.13, 0.5, 10), bottleColors[i % 4], { ink: 0.015 });
      bottle.position.set(x + (Math.random() - 0.5) * 0.8, 1.62, -len / 2 + 1 + i * 1.6);
      statics.add(bottle);
    }
  }

  // Interior grid: each cell gets a table game or a bit of cover.
  const minX = -W + 8;
  const maxX = W - 8;
  const minZ = -D + 7;
  const maxZ = D - 7.5;
  const cols = Math.max(2, Math.floor((maxX - minX) / 13));
  const rows = Math.max(2, Math.floor((maxZ - minZ) / 12.5));
  const cellW = (maxX - minX) / cols;
  const cellD = (maxZ - minZ) / rows;
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({ x: minX + cellW * (c + 0.5), z: minZ + cellD * (r + 0.5) });
    }
  }
  const kinds = [
    ...Array(floor.roulette).fill('roulette'),
    ...Array(floor.blackjack).fill('blackjack'),
    ...Array(floor.crash).fill('crash'),
  ];
  while (kinds.length < cells.length) kinds.push('cover');
  const assigned = shuffle(kinds).slice(0, cells.length);
  const sites = { roulette: [], blackjack: [], crash: [] };
  const spawnPoints = [];

  cells.forEach((cell, i) => {
    const kind = assigned[i];
    if (kind !== 'cover') {
      sites[kind].push({ x: cell.x, z: cell.z });
      return;
    }
    // Cover: a pillar with crates around it, in a random arrangement.
    const px = cell.x + (Math.random() - 0.5) * 3;
    const pz = cell.z + (Math.random() - 0.5) * 3;
    const pillar = part(new THREE.CylinderGeometry(0.7, 0.7, H, 16), theme.trim);
    pillar.position.set(px, H / 2, pz);
    const foot = part(new THREE.CylinderGeometry(0.95, 1, 0.6, 16), theme.wallLow);
    foot.position.set(px, 0.3, pz);
    statics.add(pillar, foot);
    addCollider({ type: 'circle', x: px, z: pz, r: 0.75, top: 99 });
    const n = 2 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const dist = 2.5 + Math.random() * 2;
      const s = 1.1 + Math.random() * 0.6;
      const x = px + Math.cos(a) * dist;
      const z = pz + Math.sin(a) * dist;
      const crate = part(new THREE.BoxGeometry(s, s, s), 0xb7791f);
      crate.position.set(x, s / 2, z);
      const strap = part(new THREE.BoxGeometry(s + 0.04, 0.2, s + 0.04), 0x6b3a1e, { ink: 0, shadow: false });
      crate.add(strap);
      statics.add(crate);
      addBox(x, z, s, s, s);
    }
    spawnPoints.push([cell.x + cellW * 0.35, cell.z - cellD * 0.35], [cell.x - cellW * 0.35, cell.z + cellD * 0.35]);
  });

  // Extra spawns along the open lanes between cells.
  for (let r = 0; r <= rows; r++) {
    for (let c = 1; c < cols; c++) spawnPoints.push([minX + cellW * c, minZ + cellD * r]);
  }

  // Chandeliers over every cell.
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff1b8 });
  for (const cell of cells) {
    const g = new THREE.Group();
    g.position.set(cell.x, 6.6, cell.z);
    const ring = part(new THREE.TorusGeometry(1.2, 0.08, 8, 24), theme.trim, { ink: 0.02, shadow: false });
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), bulbMat);
      bulb.position.set(Math.cos(a) * 1.2, 0.15, Math.sin(a) * 1.2);
      g.add(bulb);
    }
    const chain = part(new THREE.CylinderGeometry(0.03, 0.03, 2, 4), theme.trim, { ink: 0, shadow: false });
    chain.position.y = 1;
    g.add(chain);
    statics.add(g);
  }

  // Lighting: warm fill, one shadow-casting key light, neon accents at both ends.
  scene.add(new THREE.HemisphereLight(0xffe9c4, 0x5a2340, 1.6));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
  sun.position.set(W * 0.35, 34, D * 0.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -W - 4, right: W + 4, top: D + 4, bottom: -D - 4, near: 1, far: 100 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  const back = new THREE.PointLight(new THREE.Color(theme.neon), 40, 24, 1.6);
  back.position.set(0, 5, -D + 4);
  const front = new THREE.PointLight(0x2ee6d6, 30, 22, 1.6);
  front.position.set(0, 4.5, D - 4);
  scene.add(back, front);

  const world = {
    floor,
    halfW: W,
    halfD: D,
    solids,
    colliders,
    statics,
    sites,
    // Where fixed stations go.
    slotZ: -D + 1.4,
    elevator: { x: 0, z: D - 1.2 },
    cashier: { x: -W + 1.6, z: 0 },
    arrival: { x: 0, z: D - 4.5 },
    spawnPoints,
    addCollider,
    animate(fn) { animated.push(fn); },

    // Is this spot clear of furniture?
    isFree(x, z, r = 1) {
      for (const c of colliders) {
        if (c.type === 'box') {
          const nx = Math.max(c.minX, Math.min(x, c.maxX));
          const nz = Math.max(c.minZ, Math.min(z, c.maxZ));
          if (Math.hypot(x - nx, z - nz) < r) return false;
        } else if (Math.hypot(x - c.x, z - c.z) < c.r + r) return false;
      }
      return Math.abs(x) < W - 1.5 && Math.abs(z) < D - 1.5;
    },

    // Merge every static mesh into one mesh per material: hundreds of draw calls become a few dozen.
    bake() {
      world.spawnPoints = spawnPoints.filter(([x, z]) => world.isFree(x, z, 1.2));
      statics.updateMatrixWorld(true);
      const buckets = new Map();
      statics.traverse((o) => {
        if (!o.isMesh) return;
        const key = `${o.material.uuid}|${o.castShadow}`;
        if (!buckets.has(key)) buckets.set(key, { material: o.material, cast: o.castShadow, geos: [] });
        const g = o.geometry.clone();
        g.applyMatrix4(o.matrixWorld);
        for (const name of Object.keys(g.attributes)) {
          if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        }
        buckets.get(key).geos.push(g.index ? g : g.toNonIndexed());
      });
      scene.remove(statics);
      for (const { material, cast, geos } of buckets.values()) {
        for (const list of [geos.filter((g) => g.index), geos.filter((g) => !g.index)]) {
          if (!list.length) continue;
          const merged = mergeGeometries(list);
          if (!merged) continue;
          const mesh = new THREE.Mesh(merged, material);
          mesh.castShadow = cast;
          mesh.receiveShadow = true;
          mesh.matrixAutoUpdate = false;
          scene.add(mesh);
        }
        for (const g of geos) g.dispose();
      }
    },

    update(dt) {
      for (const fn of animated) fn(dt);
    },

    // Height of whatever you'd land on at (x, z) when falling from height y.
    groundAt(x, z, y) {
      let groundY = 0;
      for (const c of colliders) {
        if (c.top > y + 0.3) continue;
        const over = c.type === 'box'
          ? x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ
          : Math.hypot(x - c.x, z - c.z) <= c.r;
        if (over) groundY = Math.max(groundY, c.top);
      }
      return groundY;
    },
  };
  return world;
}
