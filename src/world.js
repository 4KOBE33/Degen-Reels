// Builds the casino: carpet, walls, tables, roulette, bar, pillars and lights.
import * as THREE from 'three';
import { WORLD } from './config.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { part, toon, canvasTexture } from './toon.js';

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
    for (const [x, y] of [[128, 0], [0, 128], [256, 128], [128, 256]]) diamond(x, y, 12, '#6b1422');
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(WORLD.halfW / 2, WORLD.halfD / 2);
  return tex;
}

function neonSign(text, color) {
  const tex = canvasTexture(1024, 200, (c, w, h) => {
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = "130px 'Luckiest Guy', 'Arial Black', sans-serif";
    c.shadowColor = color;
    c.shadowBlur = 40;
    c.lineWidth = 10;
    c.strokeStyle = color;
    c.strokeText(text, w / 2, h / 2 + 8);
    c.shadowBlur = 10;
    c.fillStyle = '#fff6e0';
    c.fillText(text, w / 2, h / 2 + 8);
  });
  return new THREE.Mesh(
    new THREE.PlaneGeometry(18, 3.5),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
}

function rouletteTexture() {
  return canvasTexture(256, 256, (c, w) => {
    const n = 18;
    for (let i = 0; i < n; i++) {
      c.beginPath();
      c.moveTo(w / 2, w / 2);
      c.arc(w / 2, w / 2, w / 2, (i / n) * Math.PI * 2, ((i + 1) / n) * Math.PI * 2);
      c.fillStyle = i === 0 ? '#1f8a4c' : i % 2 ? '#e63946' : '#1b0f2b';
      c.fill();
    }
    c.fillStyle = '#d4a63a';
    c.beginPath();
    c.arc(w / 2, w / 2, w * 0.22, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#8b5a2b';
    c.beginPath();
    c.arc(w / 2, w / 2, w * 0.12, 0, Math.PI * 2);
    c.fill();
  });
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

export function buildWorld(scene) {
  const solids = [];
  const colliders = [];
  const animated = [];
  // Everything that never moves goes in here, then gets merged into a few big meshes by `bake()`.
  const statics = new THREE.Group();
  scene.add(statics);
  const addCollider = (c) => {
    colliders.push(c);
    solids.push(proxyFor(c));
  };
  const W = WORLD.halfW;
  const D = WORLD.halfD;
  const H = WORLD.wallH;

  // Floor.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 2, D * 2),
    toon(0xffffff, { map: carpetTexture() }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  statics.add(floor);
  const ground = new THREE.Mesh(new THREE.BoxGeometry(W * 2, 0.2, D * 2), proxyMat);
  ground.position.y = -0.1;
  ground.updateMatrixWorld(true);
  solids.push(ground);

  // Walls with a gold trim stripe.
  const wallMat = toon(0x3a1d5c);
  const lowerMat = toon(0x24103d);
  const walls = [
    [0, -D, W * 2 + 1, 1],
    [0, D, W * 2 + 1, 1],
    [-W, 0, 1, D * 2 + 1],
    [W, 0, 1, D * 2 + 1],
  ];
  for (const [x, z, w, d] of walls) {
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
    const trim = part(new THREE.BoxGeometry(w + 0.2, 0.18, d + 0.2), 0xd4a63a, { ink: 0.02, shadow: false });
    trim.position.set(x, 1.65, z);
    statics.add(trim);
  }

  const sign = neonSign('LUCKY DUMP CASINO', '#ff3fa4');
  sign.position.set(0, 5.6, -D + 0.52);
  statics.add(sign);
  const sign2 = neonSign('NO REFUNDS', '#2ee6d6');
  sign2.scale.setScalar(0.6);
  sign2.position.set(0, 5, D - 0.52);
  sign2.rotation.y = Math.PI;
  statics.add(sign2);

  const addBox = (x, z, w, d, top) => {
    addCollider({ type: 'box', minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top });
  };

  // Round card tables with chip stacks and cards.
  const chipColors = [0xe63946, 0x1d4ed8, 0x2a9d8f, 0x1b0f2b];
  function cardTable(x, z, r) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const base = part(new THREE.CylinderGeometry(r * 0.3, r * 0.45, 0.85, 16), 0x2b2140);
    base.position.y = 0.42;
    const rim = part(new THREE.CylinderGeometry(r, r, 0.22, 32), 0x6b3a1e);
    rim.position.y = 0.95;
    const felt = part(new THREE.CylinderGeometry(r - 0.22, r - 0.22, 0.06, 32), 0x1f8a4c, { ink: 0 });
    felt.position.y = 1.07;
    g.add(base, rim, felt);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const stack = new THREE.Group();
      const n = 2 + Math.floor(Math.random() * 5);
      for (let k = 0; k < n; k++) {
        const chip = part(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 14), chipColors[(i + k) % 4], { ink: 0.015, shadow: false });
        chip.position.y = k * 0.065;
        stack.add(chip);
      }
      stack.position.set(Math.cos(a) * r * 0.55, 1.13, Math.sin(a) * r * 0.55);
      g.add(stack);
      const card = part(new THREE.BoxGeometry(0.32, 0.02, 0.45), 0xfff6e0, { ink: 0.012, shadow: false });
      card.position.set(Math.cos(a + 0.7) * r * 0.4, 1.11, Math.sin(a + 0.7) * r * 0.4);
      card.rotation.y = a;
      g.add(card);
    }
    statics.add(g);
    addCollider({ type: 'circle', x, z, r, top: 1.1 });
  }
  cardTable(-17, -5, 2.3);
  cardTable(17, -5, 2.3);
  cardTable(-17, 11, 2.3);
  cardTable(17, 11, 2.3);

  // Center roulette table with a spinning wheel.
  {
    const g = new THREE.Group();
    g.position.set(0, 0, 4);
    const base = part(new THREE.CylinderGeometry(1.4, 1.8, 0.85, 20), 0x2b2140);
    base.position.y = 0.42;
    const rim = part(new THREE.CylinderGeometry(3.2, 3.2, 0.25, 40), 0x6b3a1e);
    rim.position.y = 0.95;
    const felt = part(new THREE.CylinderGeometry(3, 3, 0.06, 40), 0x1f8a4c, { ink: 0 });
    felt.position.y = 1.09;
    const bowl = part(new THREE.CylinderGeometry(1.7, 1.5, 0.3, 36), 0x8b5a2b);
    bowl.position.y = 1.2;
    const wheel = new THREE.Mesh(new THREE.CircleGeometry(1.45, 36), toon(0xffffff, { map: rouletteTexture() }));
    wheel.rotation.x = -Math.PI / 2;
    wheel.position.y = 1.36;
    const spindle = part(new THREE.ConeGeometry(0.15, 0.4, 8), 0xd4a63a, { ink: 0.02 });
    spindle.position.y = 1.5;
    const ball = part(new THREE.SphereGeometry(0.09, 10, 8), 0xffffff, { ink: 0.015 });
    g.add(base, rim, felt, bowl, spindle);
    statics.add(g);
    const spinning = new THREE.Group();
    spinning.position.copy(g.position);
    spinning.add(wheel, ball);
    scene.add(spinning);
    addCollider({ type: 'circle', x: 0, z: 4, r: 3.2, top: 1.1 });
    let t = 0;
    animated.push((dt) => {
      t += dt;
      wheel.rotation.z += dt * 1.2;
      ball.position.set(Math.cos(-t * 2.5) * 1.25, 1.42, Math.sin(-t * 2.5) * 1.25);
    });
  }

  // Gold pillars.
  for (const [x, z] of [[-9, -11], [9, -11], [-9, 15], [9, 15], [-26, 3], [26, 3]]) {
    const pillar = part(new THREE.CylinderGeometry(0.7, 0.7, H, 16), 0xd4a63a);
    pillar.position.set(x, H / 2, z);
    const foot = part(new THREE.CylinderGeometry(0.95, 1, 0.6, 16), 0x24103d);
    foot.position.set(x, 0.3, z);
    statics.add(pillar, foot);
    addCollider({ type: 'circle', x, z, r: 0.75, top: 99 });
  }

  // The bar along the right wall, with bottles.
  {
    const x = 28.5;
    const bar = part(new THREE.BoxGeometry(2, 1.25, 14), 0x6b3a1e);
    bar.position.set(x, 0.62, 3);
    const top = part(new THREE.BoxGeometry(2.3, 0.14, 14.3), 0x24103d, { ink: 0.02 });
    top.position.set(x, 1.3, 3);
    statics.add(bar, top);
    addBox(x, 3, 2.3, 14.3, 1.37);
    const bottleColors = [0x5ee27a, 0xff9f43, 0x4dabff, 0xff5d5d];
    for (let i = 0; i < 9; i++) {
      const bottle = part(new THREE.CylinderGeometry(0.1, 0.13, 0.5, 10), bottleColors[i % 4], { ink: 0.015 });
      bottle.position.set(x + (Math.random() - 0.5) * 0.8, 1.62, -3 + i * 1.5);
      statics.add(bottle);
    }
  }

  // Cashier cage on the left wall.
  {
    const x = -28.5;
    const cage = part(new THREE.BoxGeometry(2, 1.3, 10), 0x24103d);
    cage.position.set(x, 0.65, 3);
    statics.add(cage);
    addBox(x, 3, 2, 10, 1.3);
    for (let i = 0; i < 11; i++) {
      const bar = part(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6), 0xd4a63a, { ink: 0.012, shadow: false });
      bar.position.set(x + 0.9, 2.4, -2 + i);
      statics.add(bar);
    }
    const sign = part(new THREE.BoxGeometry(0.1, 0.6, 4), 0xd4a63a, { ink: 0.02 });
    sign.position.set(x + 0.95, 3.7, 3);
    statics.add(sign);
  }

  // Crates of chips to hide behind and jump on.
  for (const [x, z, s] of [[-6, -10, 1.4], [6, -10, 1.4], [-4, 17, 1.6], [4, 17, 1.2], [-23, -15, 1.5], [23, -15, 1.5], [-22, 18, 1.4], [22, 18, 1.4]]) {
    const crate = part(new THREE.BoxGeometry(s, s, s), 0xb7791f);
    crate.position.set(x, s / 2, z);
    const strap = part(new THREE.BoxGeometry(s + 0.04, 0.2, s + 0.04), 0x6b3a1e, { ink: 0, shadow: false });
    strap.position.y = 0;
    crate.add(strap);
    statics.add(crate);
    addBox(x, z, s, s, s);
  }

  // Chandeliers.
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff1b8 });
  for (const [x, z] of [[-14, 3], [14, 3], [0, -12], [0, 16]]) {
    const g = new THREE.Group();
    g.position.set(x, 6.6, z);
    const ring = part(new THREE.TorusGeometry(1.2, 0.08, 8, 24), 0xd4a63a, { ink: 0.02, shadow: false });
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), bulbMat);
      bulb.position.set(Math.cos(a) * 1.2, 0.15, Math.sin(a) * 1.2);
      g.add(bulb);
    }
    const chain = part(new THREE.CylinderGeometry(0.03, 0.03, 2, 4), 0xd4a63a, { ink: 0, shadow: false });
    chain.position.y = 1;
    g.add(chain);
    statics.add(g);
  }

  // Lighting: warm sky/ground fill, one shadow-casting key light, and neon accents.
  scene.add(new THREE.HemisphereLight(0xffe9c4, 0x5a2340, 1.6));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
  sun.position.set(12, 30, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -36, right: 36, top: 26, bottom: -26, near: 1, far: 80 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  const pink = new THREE.PointLight(0xff3fa4, 40, 22, 1.6);
  pink.position.set(0, 5, -18);
  const teal = new THREE.PointLight(0x2ee6d6, 25, 20, 1.6);
  teal.position.set(0, 4.5, 19);
  scene.add(pink, teal);

  return {
    solids,
    colliders,
    spawnPoints: [
      [0, 15], [-12, 15], [12, 15], [-24, 9], [24, 9], [-12, -3], [12, -3], [-24, -9], [24, -9], [0, -6],
    ],
    statics,
    addCollider,
    // Merge every static mesh into one mesh per material: hundreds of draw calls become a few dozen.
    bake() {
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
        const indexed = geos.filter((g) => g.index);
        const loose = geos.filter((g) => !g.index);
        for (const list of [indexed, loose]) {
          if (!list.length) continue;
          const merged = mergeGeometries(list);
          if (!merged) continue;
          const mesh = new THREE.Mesh(merged, material);
          mesh.castShadow = cast;
          mesh.receiveShadow = true;
          mesh.matrixAutoUpdate = false;
          scene.add(mesh);
        }
      }
    },
    update(dt) {
      for (const fn of animated) fn(dt);
    },
    // Height of whatever you'd land on at (x, z) when falling from height y.
    groundAt(x, z, y) {
      let ground = 0;
      for (const c of colliders) {
        if (c.top > y + 0.3) continue;
        const over = c.type === 'box'
          ? x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ
          : Math.hypot(x - c.x, z - c.z) <= c.r;
        if (over) ground = Math.max(ground, c.top);
      }
      return ground;
    },
  };
}
