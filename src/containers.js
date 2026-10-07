// Things you can search for loot: hold E next to one. Safes take longer but pay better.
import * as THREE from 'three';
import { save } from './save.js';
import { part, toon } from './toon.js';
import { rollLoot, randInt } from './items.js';
import { sfx } from './audio.js';
import { keyName } from './keys.js';

const ICONS = { register: '💵', crate: '📦', locker: '🗄️', safe: '🔒', vault: '💎', drop: '🪂' };
// Loot tier colors, matching item rarity: common, rare, epic, legendary.
export const TIER_COLORS = ['#cbd5e1', '#cbd5e1', '#4ea8ff', '#b56cff', '#ffc83d'];
const TIER_DARK = ['#64748b', '#64748b', '#1d4ed8', '#6d28d9', '#b45309'];

// One badge texture per kind + tier, shared by every container: the whole badge is the rarity
// color (so you can tell a gold one from across the map), with the container's icon on it. No
// words: the color says it.
const badgeCache = new Map();
function badgeTexture(kind, tier) {
  const key = `${kind}:${tier}`;
  if (badgeCache.has(key)) return badgeCache.get(key);
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  const col = TIER_COLORS[tier] || TIER_COLORS[1];
  const dark = TIER_DARK[tier] || TIER_DARK[1];
  // Glow for the good stuff.
  if (tier >= 3) {
    const glow = g.createRadialGradient(128, 112, 60, 128, 112, 124);
    glow.addColorStop(0, `${col}aa`);
    glow.addColorStop(1, `${col}00`);
    g.fillStyle = glow;
    g.fillRect(0, 0, 256, 256);
  }
  // Pointer so it reads as "down here".
  g.beginPath();
  g.moveTo(98, 196);
  g.lineTo(158, 196);
  g.lineTo(128, 246);
  g.closePath();
  g.fillStyle = '#1b0f2b';
  g.fill();
  g.beginPath();
  g.moveTo(108, 196);
  g.lineTo(148, 196);
  g.lineTo(128, 232);
  g.closePath();
  g.fillStyle = col;
  g.fill();
  // The disc: rarity color, darker rim, ink outline.
  g.beginPath();
  g.arc(128, 112, 88, 0, Math.PI * 2);
  g.fillStyle = '#1b0f2b';
  g.fill();
  const fill = g.createLinearGradient(0, 30, 0, 200);
  fill.addColorStop(0, col);
  fill.addColorStop(1, dark);
  g.beginPath();
  g.arc(128, 112, 78, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
  g.beginPath();
  g.arc(128, 112, 62, 0, Math.PI * 2);
  g.fillStyle = 'rgba(27,15,43,0.55)';
  g.fill();
  g.font = '82px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(ICONS[kind] || '📦', 128, 116);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  badgeCache.set(key, tex);
  return tex;
}

const KINDS = {
  register: { name: 'Cash Register', time: 1.0, rolls: [1, 2], tierBonus: 0, color: 0x4b5563, lid: 0xffd23f },
  crate: { name: 'Chip Crate', time: 1.2, rolls: [1, 2], tierBonus: 0, color: 0xb7791f, lid: 0x6b3a1e },
  locker: { name: 'Locker', time: 1.6, rolls: [2, 2], tierBonus: 0, color: 0x64748b, lid: 0x94a3b8 },
  safe: { name: 'Safe', time: 2.6, rolls: [2, 3], tierBonus: 1, color: 0x1f2937, lid: 0xd4a63a },
  vault: { name: 'Vault Chest', time: 3.0, rolls: [3, 4], tierBonus: 0, color: 0x6b3a1e, lid: 0x7a4a1e },
  // Parachuted in mid-raid (raid.js): big search, big loot.
  drop: { name: 'Supply Drop', time: 2.4, rolls: [3, 4], tierBonus: 1, color: 0x1f2937, lid: 0xd4a63a },
};

// Every map dresses its loot differently: chip crates in Vegas, wine crates and barrels in
// Temakilla, snowy supply crates up the mountain, mossy tackle crates in the swamp, ammo crates
// in the Bunker. Same kinds (and the same loot), different look.
const THEMES = {
  vegas: { wood: 0xc68a45, dark: 0x6b3a1e, metal: 0x7b8798, door: 0x9aa6b8, accent: 0xe63946, trim: 0xd4a63a, extra: 'chips', names: {} },
  lounge: { wood: 0x7a3b1e, dark: 0x3b1a0e, metal: 0x3b2a4a, door: 0x5b4370, accent: 0xffd23f, trim: 0xd4a63a, extra: 'chips', names: {} },
  tequila: { wood: 0xd9b27c, dark: 0x6b4423, metal: 0x8b6b4a, door: 0xa47e58, accent: 0x7f1d3a, trim: 0xb08d57, extra: 'wine', names: { crate: 'Wine Crate', locker: 'Wine Barrel', safe: 'Strongbox' } },
  frost: { wood: 0x9c7b5b, dark: 0x4e342e, metal: 0x4f7cac, door: 0x6b98c8, accent: 0x2ee6d6, trim: 0xcbd5e1, extra: 'snow', names: { crate: 'Supply Crate', locker: 'Ski Locker' } },
  bayou: { wood: 0x8a7a48, dark: 0x4a3f22, metal: 0x4f6b4a, door: 0x6b8a5e, accent: 0xffd23f, trim: 0x8a7a5a, extra: 'moss', names: { crate: 'Tackle Crate', locker: 'Rusty Locker' } },
  bunker: { wood: 0x5b6b34, dark: 0x343f1f, metal: 0x4b5563, door: 0x6b7280, accent: 0xff3fa4, trim: 0xa3a3a3, extra: 'stencil', names: { crate: 'Ammo Crate', locker: 'Gun Locker' } },
};

const box3 = (w, h, d, color, x, y, z, ink = 0.02) => { const m = part(new THREE.BoxGeometry(w, h, d), color, { ink }); m.position.set(x, y, z); return m; };
const flatMat = (c) => new THREE.MeshBasicMaterial({ color: c });
const snowMat = toon(0xf8fbff);
const mossMat = toon(0x5a7d2a);

// Builds the static body into `g` and returns { h, lid, hw }.
function buildModel(kind, T, g) {
  const add = (...m) => g.add(...m);
  if (kind === 'crate') {
    const S = 1.1;
    add(box3(S - 0.06, S - 0.06, S - 0.06, T.wood, 0, S / 2, 0));
    // Corner posts and a diagonal brace on each face, like a real shipping crate.
    for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(box3(0.14, S, 0.14, T.dark, (cx * S) / 2 - cx * 0.07, S / 2, (cz * S) / 2 - cz * 0.07, 0.01));
    for (const side of [-1, 1]) {
      const br = box3(S * 1.2, 0.12, 0.06, T.dark, 0, S / 2, side * (S / 2 + 0.01), 0.01);
      br.rotation.z = side * 0.75;
      const br2 = box3(0.06, 0.12, S * 1.2, T.dark, side * (S / 2 + 0.01), S / 2, 0, 0.01);
      br2.rotation.x = side * 0.75;
      add(br, br2);
    }
    if (T.extra === 'chips') {
      // A big casino chip painted on the front.
      const chip = part(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 16), T.accent, { ink: 0.01 });
      chip.rotation.x = Math.PI / 2;
      chip.position.set(0, S / 2, S / 2 + 0.05);
      const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.06, 12), flatMat(0xfff6e0));
      dot.rotation.x = Math.PI / 2;
      dot.position.set(0, S / 2, S / 2 + 0.06);
      add(chip, dot);
    } else if (T.extra === 'wine') {
      // Bottle necks poking out of the straw, and a bunch of grapes on the label.
      for (const [bx, bz] of [[-0.25, -0.2], [0, 0.1], [0.25, -0.15], [-0.1, 0.25]]) {
        const neck = part(new THREE.CylinderGeometry(0.06, 0.09, 0.4, 8), 0x14532d, { ink: 0.01 });
        neck.position.set(bx, S + 0.05, bz);
        const cork = part(new THREE.CylinderGeometry(0.065, 0.065, 0.08, 8), T.accent, { ink: 0 });
        cork.position.set(bx, S + 0.27, bz);
        add(neck, cork);
      }
      const label = box3(0.5, 0.36, 0.04, 0xfff6e0, 0, S / 2, S / 2 + 0.05, 0.01);
      add(label);
      for (let i = 0; i < 6; i++) {
        const grape = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), flatMat(0x6b21a8));
        grape.position.set(-0.06 + (i % 3) * 0.06, S / 2 + 0.08 - Math.floor(i / 3) * 0.08 - (i > 4 ? 0.06 : 0), S / 2 + 0.09);
        add(grape);
      }
    } else if (T.extra === 'stencil') {
      add(box3(0.7, 0.14, 0.03, 0xffd23f, 0, S * 0.72, S / 2 + 0.05, 0));
      const star = new THREE.Mesh(new THREE.CircleGeometry(0.16, 5), flatMat(0xfff6e0));
      star.position.set(0, S * 0.4, S / 2 + 0.06);
      add(star);
    } else if (T.extra === 'moss') {
      for (const [mx, mz] of [[-0.5, 0.5], [0.45, -0.5], [0.5, 0.45]]) {
        const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22, 0), mossMat);
        m.position.set(mx, 0.1, mz);
        m.scale.y = 0.5;
        add(m);
      }
      const rope = part(new THREE.TorusGeometry(0.22, 0.04, 6, 12), 0xd6c08a, { ink: 0 });
      rope.position.set(S / 2 + 0.04, S * 0.55, 0);
      rope.rotation.y = Math.PI / 2;
      add(rope);
    } else if (T.extra === 'snow') {
      for (const [mx, mz] of [[-0.55, 0.3], [0.5, -0.45]]) {
        const drift = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), snowMat);
        drift.position.set(mx, 0.05, mz);
        drift.scale.y = 0.45;
        add(drift);
      }
    }
    const lid = new THREE.Group();
    lid.add(box3(S + 0.04, 0.12, S + 0.04, T.dark, 0, 0, 0, 0.015));
    if (T.extra === 'snow') {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(S - 0.05, 0.16, S - 0.05), snowMat);
      cap.position.y = 0.13;
      lid.add(cap);
    }
    return { h: S, lid, hw: 0.56 };
  }

  if (kind === 'locker' && T.extra === 'wine') {
    // A wine barrel standing on end.
    const barrel = part(new THREE.CylinderGeometry(0.55, 0.55, 1.5, 14), T.wood, { ink: 0.03 });
    barrel.position.y = 0.75;
    const bulge = part(new THREE.CylinderGeometry(0.62, 0.62, 0.7, 14), T.wood, { ink: 0 });
    bulge.position.y = 0.75;
    add(barrel, bulge);
    for (const y of [0.18, 0.5, 1.0, 1.32]) {
      const hoop = part(new THREE.TorusGeometry(y > 0.4 && y < 1.1 ? 0.62 : 0.56, 0.035, 6, 18), 0x2b2140, { ink: 0 });
      hoop.rotation.x = Math.PI / 2;
      hoop.position.y = y;
      add(hoop);
    }
    const stamp = new THREE.Mesh(new THREE.CircleGeometry(0.2, 12), flatMat(T.accent));
    stamp.position.set(0, 0.85, 0.63);
    add(stamp);
    const lid = new THREE.Group();
    const top = part(new THREE.CylinderGeometry(0.54, 0.54, 0.08, 14), T.dark, { ink: 0.015 });
    lid.add(top);
    return { h: 1.5, lid, hw: 0.62 };
  }

  if (kind === 'locker') {
    const H = 2.1;
    add(box3(0.9, H, 0.7, T.metal, 0, H / 2, 0, 0.03));
    // The door, its vents, a handle and a colored stripe.
    add(box3(0.78, H - 0.2, 0.04, T.door, 0, H / 2, 0.36, 0.01));
    for (let i = 0; i < 4; i++) add(box3(0.5, 0.04, 0.02, 0x1b0f2b, 0, H - 0.3 - i * 0.1, 0.39, 0));
    add(box3(0.06, 0.26, 0.06, 0xd1d5db, 0.28, H * 0.5, 0.41, 0.005));
    add(box3(0.79, 0.12, 0.02, T.accent, 0, H * 0.3, 0.39, 0));
    if (T.extra === 'snow') {
      // A pair of skis leaning on the side.
      for (const dz of [-0.12, 0.12]) {
        const ski = box3(0.08, 1.9, 0.05, [0xe63946, 0xffd23f][dz > 0 ? 1 : 0], 0.52, 0.95, dz, 0.01);
        ski.rotation.z = -0.12;
        add(ski);
      }
    } else if (T.extra === 'moss') {
      for (const [mx, my] of [[-0.3, 0.1], [0.32, 0.12]]) {
        const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2, 0), mossMat);
        m.position.set(mx, my, 0.3);
        m.scale.y = 0.6;
        add(m);
      }
      const rust = new THREE.Mesh(new THREE.CircleGeometry(0.16, 8), flatMat(0x9a4a1a));
      rust.position.set(-0.18, H * 0.68, 0.39);
      add(rust);
    } else if (T.extra === 'stencil') {
      add(box3(0.5, 0.18, 0.02, 0xffd23f, 0, H * 0.78, 0.39, 0));
    }
    const lid = new THREE.Group();
    lid.add(box3(0.94, 0.1, 0.74, T.metal, 0, 0, 0, 0.015));
    if (T.extra === 'snow') {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.14, 0.68), snowMat);
      cap.position.y = 0.11;
      lid.add(cap);
    }
    return { h: H, lid, hw: 0.5 };
  }

  if (kind === 'safe' && T.extra === 'wine') {
    // An old Wells Fargo-style strongbox: dark wood with iron bands.
    add(box3(1.2, 0.8, 0.8, T.dark, 0, 0.4, 0, 0.03));
    for (const bx of [-0.42, 0.42]) add(box3(0.1, 0.84, 0.84, 0x2b2140, bx, 0.4, 0, 0.01));
    const plate = box3(0.28, 0.3, 0.05, T.trim, 0, 0.48, 0.42, 0.01);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.05, 8), flatMat(0x1b0f2b));
    hole.position.set(0, 0.48, 0.45);
    add(plate, hole);
    const lid = new THREE.Group();
    const dome = part(new THREE.CylinderGeometry(0.4, 0.4, 1.2, 14, 1, false, 0, Math.PI), T.dark, { ink: 0.015 });
    dome.rotation.z = Math.PI / 2;
    dome.rotation.y = Math.PI / 2;
    lid.add(dome);
    for (const bx of [-0.42, 0.42]) {
      const band = part(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 14, 1, false, 0, Math.PI), 0x2b2140, { ink: 0 });
      band.rotation.z = Math.PI / 2;
      band.rotation.y = Math.PI / 2;
      band.position.x = bx;
      lid.add(band);
    }
    return { h: 0.8, lid, hw: 0.64 };
  }

  if (kind === 'safe') {
    const S = 1.05;
    const body = T.extra === 'stencil' ? 0x111827 : 0x1f2937;
    add(box3(S, S, S * 0.9, body, 0, S / 2 + 0.08, 0, 0.03));
    for (const [fx, fz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(box3(0.14, 0.1, 0.14, 0x111111, fx * 0.4, 0.05, fz * 0.34, 0));
    // A gold-trimmed door with a dial and a spoked handle.
    add(box3(S - 0.16, S - 0.16, 0.05, 0x374151, 0, S / 2 + 0.08, S * 0.45 + 0.02, 0.01));
    add(box3(S - 0.1, 0.05, 0.03, T.trim, 0, S - 0.02, S * 0.45 + 0.05, 0), box3(S - 0.1, 0.05, 0.03, T.trim, 0, 0.18, S * 0.45 + 0.05, 0));
    const dial = part(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 16), 0xd1d5db, { ink: 0.01 });
    dial.rotation.x = Math.PI / 2;
    dial.position.set(-0.18, S * 0.62, S * 0.45 + 0.07);
    const wheel = part(new THREE.TorusGeometry(0.15, 0.025, 6, 14), T.trim, { ink: 0 });
    wheel.position.set(0.2, S * 0.48, S * 0.45 + 0.08);
    add(dial, wheel);
    for (let i = 0; i < 3; i++) {
      const spoke = box3(0.03, 0.3, 0.03, T.trim, 0.2, S * 0.48, S * 0.45 + 0.08, 0);
      spoke.rotation.z = (i / 3) * Math.PI;
      add(spoke);
    }
    if (T.extra === 'stencil') add(new THREE.Mesh(new THREE.BoxGeometry(S - 0.1, 0.04, 0.02), flatMat(T.accent)).translateY(S * 0.85).translateZ(S * 0.45 + 0.06));
    const lid = new THREE.Group();
    lid.add(box3(S + 0.04, 0.08, S * 0.9 + 0.04, body, 0, 0, 0, 0.015));
    if (T.extra === 'snow') {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(S - 0.05, 0.14, S * 0.85), snowMat);
      cap.position.y = 0.1;
      lid.add(cap);
    }
    return { h: S + 0.08, lid, hw: 0.56 };
  }

  if (kind === 'register') {
    // A counter with a chunky old register on it.
    add(box3(0.95, 1.0, 0.7, T.extra === 'chips' ? 0x2b2140 : T.dark, 0, 0.5, 0, 0.03));
    const reg = T.extra === 'chips' ? T.trim : T.extra === 'wine' ? 0xb08d57 : 0x4b5563;
    add(box3(0.72, 0.3, 0.5, reg, 0, 1.15, -0.04, 0.02));
    const keys = box3(0.72, 0.06, 0.32, 0x1f2937, 0, 1.2, 0.26, 0.01);
    keys.rotation.x = 0.45;
    add(keys);
    for (let i = 0; i < 6; i++) add(box3(0.08, 0.04, 0.08, 0xfff6e0, -0.22 + (i % 3) * 0.22, 1.26, 0.18 + Math.floor(i / 3) * 0.12, 0));
    const screen = box3(0.3, 0.18, 0.06, 0x111827, 0, 1.45, -0.18, 0.01);
    const digits = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.1), flatMat(0x5ee27a));
    digits.position.set(0, 1.45, -0.145);
    add(screen, digits);
    add(box3(0.6, 0.1, 0.05, reg, 0, 0.92, 0.37, 0.01));
    const lid = new THREE.Group();
    const roll = part(new THREE.CylinderGeometry(0.07, 0.07, 0.3, 10), 0xfff6e0, { ink: 0.01 });
    roll.rotation.z = Math.PI / 2;
    lid.add(roll);
    return { h: 1.3, lid, hw: 0.5 };
  }

  // The vault chest: dark wood, gold bands, a jewel on the lock.
  add(box3(1.5, 0.8, 1.0, 0x6b3a1e, 0, 0.4, 0, 0.03));
  for (const bx of [-0.55, 0, 0.55]) add(box3(0.12, 0.84, 1.04, 0xd4a63a, bx, 0.4, 0, 0.01));
  add(box3(0.3, 0.32, 0.08, 0xd4a63a, 0, 0.62, 0.52, 0.01));
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.1), flatMat(0x2ee6d6));
  gem.position.set(0, 0.62, 0.58);
  add(gem);
  const lid = new THREE.Group();
  const dome = part(new THREE.CylinderGeometry(0.5, 0.5, 1.5, 16, 1, false, 0, Math.PI), 0x7a4a1e);
  dome.rotation.z = Math.PI / 2;
  dome.rotation.y = Math.PI / 2;
  lid.add(dome, box3(1.56, 0.08, 1.06, 0xd4a63a, 0, 0, 0, 0.01));
  return { h: 0.8, lid, hw: 0.78 };
}

export class Container {
  constructor(raid, { kind, x, z, tier, rot = 0, y = 0 }) {
    this.raid = raid;
    this.kind = kind;
    this.def = KINDS[kind];
    this.tier = Math.min(4, tier + this.def.tierBonus + (raid.map.lootBonus || 0));
    this.spot = new THREE.Vector3(x, y, z);
    this.range = 1.9;
    this.opened = false;

    // The body is static scenery; the lid is the only moving part.
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = rot;
    this.theme = THEMES[raid.mapId] || THEMES.vegas;
    const { h, lid, hw } = buildModel(kind === 'drop' ? 'safe' : kind, this.theme, g);
    raid.map.statics.add(g);
    this.group = g;
    this.collider = { type: 'box', minX: x - hw, maxX: x + hw, minZ: z - 0.5, maxZ: z + 0.5, top: y + h, bottom: y || undefined };
    raid.map.addCollider(this.collider);
    this.lid = lid;
    this.lid.position.set(x, y + h + 0.06, z);
    this.lid.rotation.y = rot;
    raid.scene.add(this.lid);
    this.h = h;

    // Make it easy to spot: a floating badge and a glowing ring until it's been searched.
    const col = new THREE.Color(TIER_COLORS[this.tier] || TIER_COLORS[1]);
    this.badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: badgeTexture(kind, this.tier), transparent: true, depthWrite: false }));
    this.badge.scale.set(1.2 + (this.tier - 1) * 0.1, 1.2 + (this.tier - 1) * 0.1, 1);
    this.badgeScale = this.badge.scale.x;
    this.badgeY = y + h + 1.3;
    this.badge.position.set(x, this.badgeY, z);
    this.badge.renderOrder = 5;
    raid.scene.add(this.badge);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.25, 28), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.set(x, y + 0.06, z);
    raid.scene.add(this.ring);
    this.phase = (x * 0.37 + z * 0.61) % (Math.PI * 2);
  }

  get name() { return this.theme.names[this.kind] || this.def.name; }

  prompt() {
    if (this.opened) return null;
    return `<b>Hold ${keyName('use')}</b> Search the ${this.name}`;
  }

  // Containers are searched by holding E; the controller calls open() when it's done.
  get searchTime() { return this.def.time; }

  // Just the lid and sound (multiplayer: the host rolled the loot).
  showOpened() {
    if (this.opened) return;
    this.opened = true;
    this.badge.visible = false;
    this.ring.visible = false;
    this.lid.position.y = this.spot.y + this.h + 0.5;
    this.lid.rotation.x = -0.9;
    sfx.open(this.spot, this.raid.listener);
  }

  open(c) {
    if (this.opened) return;
    const raid = this.raid;
    // Party client: the host opens it and rolls the loot.
    if (raid.isClient) {
      if (c && c.isPlayer) {
        raid.net.send({ k: 'open', i: raid.containers.indexOf(this) });
        raid.run.containers++;
        if (this.kind === 'drop') save.update((d) => { d.stats.supplyDrops = (d.stats.supplyDrops || 0) + 1; });
      }
      return;
    }
    if (raid.isHost) raid.net.rel({ k: 'ko', i: raid.containers.indexOf(this) });
    this.opened = true;
    this.badge.visible = false;
    this.ring.visible = false;
    if (c && c.isPlayer && this.raid.run) this.raid.run.containers++;
    if (c && c.isPlayer && this.kind === 'drop') save.update((d) => { d.stats.supplyDrops = (d.stats.supplyDrops || 0) + 1; });
    this.lid.position.y = this.spot.y + this.h + 0.5;
    this.lid.rotation.x = -0.9;
    sfx.open(this.spot, this.raid.listener);
    const [a, b] = this.def.rolls;
    // A crate set up with exactly what's in it (the tutorial's), otherwise a roll of the dice.
    const fixed = this.fixedLoot;
    this.fixedLoot = null;
    const n = fixed ? fixed.length : randInt(a, b) + (raid.map.lootRolls || 0);
    for (let i = 0; i < n; i++) {
      const loot = fixed ? fixed[i] : rollLoot(this.tier);
      const at = this.spot.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2));
      if (loot.chips) this.raid.chips.spawnBurst(at.setY(this.spot.y + this.h + 0.3), loot.chips, null, { speed: 1.5 });
      else {
        // Spill out toward the person who opened it, fanned out a little.
        const dir = c ? new THREE.Vector3(c.pos.x - this.spot.x, 0, c.pos.z - this.spot.z) : new THREE.Vector3(0, 0, 1);
        if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
        dir.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), (i - (n - 1) / 2) * 0.6);
        this.raid.dropItem(this.spot.clone().addScaledVector(dir, 1.4), loot, this.spot);
      }
    }
  }

  // Take it out of the world for good (a supply drop, once its raid is over).
  dispose() {
    const raid = this.raid;
    raid.map.statics.remove(this.group);
    raid.scene.remove(this.lid, this.badge, this.ring);
    raid.map.removeCollider(this.collider);
  }

  reset() {
    this.opened = false;
    this.claimedBy = null;
    this.lid.position.y = this.spot.y + this.h + 0.06;
    this.lid.rotation.x = 0;
  }

  // Only draw lids and markers near the camera; bob the badge.
  cull(focus) {
    const dx = Math.abs(focus.x - this.spot.x);
    const dz = Math.abs(focus.z - this.spot.z);
    this.lid.visible = dx < 70 && dz < 70;
    const show = !this.opened && dx < 60 && dz < 60;
    this.badge.visible = show;
    this.ring.visible = show;
    if (show) {
      const t = performance.now() / 1000 + this.phase;
      this.badge.position.y = this.badgeY + Math.sin(t * 2.2) * 0.18;
      // Grow a bit with distance so far-off crates still read.
      // Rarer chests get a slightly bigger badge.
      const d = Math.hypot(dx, dz);
      // Right next to it: shrink and fade the badge so it isn't a giant sign in your face (the
      // "hold E" prompt says what it is by then).
      const near = Math.max(0, Math.min(1, (d - 1.5) / 3));
      const s = (1.3 + Math.min(2.4, d / 16)) * (1 + (this.tier - 1) * 0.08) * (0.55 + 0.45 * near);
      this.badge.scale.set(s, s, 1);
      this.badge.material.opacity = 0.3 + 0.7 * near;
      this.ring.material.opacity = 0.35 + Math.sin(t * 3) * 0.2;
    }
  }
}
