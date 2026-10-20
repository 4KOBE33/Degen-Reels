// Your Casino: an empty hall you fill with games and decor bought with chips. Customers (little
// NPC beans) wander in, play your games and lose (mostly) to the house, and that money piles up in
// your vault at the cashier's cage. Friends in your party can visit and play for real, and you can
// rig any table on them: a rigged table quietly eats their wins, and tells them who did it.
//
// The games themselves are the Lounge's (tables.js), placed on a grid. The owner is whoever's
// casino it is: you solo, or the party leader (the host) when friends come along.
import * as THREE from 'three';
import { save } from './save.js';
import { createCharacter } from './character.js';
import { randomLook } from './looks.js';
import { part, toon, canvasTexture } from './toon.js';
import { keyName } from './keys.js';
import { sfx } from './audio.js';
import { LoungeTables, CABINET_GAMES } from './tables.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The floor: six spots a row (three each side of the middle aisle), four rows. The row nearest the
// door is open from the start; the rest you buy as the place grows.
export const CASINO_COLS = [-36, -24, -12, 12, 24, 36];
export const CASINO_ROWS = [2, -10, -22, -34];
export const ROW_COST = [0, 12000, 40000, 120000];
export const SLOT_COUNT = CASINO_COLS.length * CASINO_ROWS.length;
export const slotXZ = (i) => [CASINO_COLS[i % CASINO_COLS.length], CASINO_ROWS[Math.floor(i / CASINO_COLS.length)]];
const DOOR = new THREE.Vector3(0, 0, 44);

// What you can buy. Games earn their edge (on average) every time a customer plays; decor just
// makes the place nicer, which brings more customers in.
export const CASINO_ITEMS = {
  slots: { name: 'Lucky Slots', icon: '🎰', cost: 1500, game: 'slots', edge: 18, appeal: 3, color: '#ff3fa4', blurb: 'Cheap, cheerful, always busy.' },
  plinko: { name: 'Plinko Wall', icon: '🔴', cost: 3500, game: 'plinko', edge: 30, appeal: 5, color: '#ff9f1c', blurb: 'Customers love watching the ball bounce.' },
  roulette: { name: 'Roulette Table', icon: '🎡', cost: 6000, game: 'roulette', edge: 45, appeal: 6, color: '#ff5d5d', blurb: 'A classic. The green zero pays your bills.' },
  mines: { name: 'Mines Table', icon: '💎', cost: 7500, game: 'mines', edge: 52, appeal: 6, color: '#c77dff', blurb: 'One more tile... one more tile...' },
  blackjack: { name: 'Blackjack Table', icon: '🃏', cost: 9000, game: 'blackjack', edge: 60, appeal: 8, color: '#5ee27a', blurb: 'High rollers sit here. Big edge, big crowds.' },
  crash: { name: 'Crash Rocket', icon: '🚀', cost: 12000, game: 'crash', edge: 75, appeal: 10, color: '#2ee6d6', blurb: 'Nobody ever cashes out in time.' },
  bar: { name: 'Cocktail Bar', icon: '🍸', cost: 5000, edge: 25, appeal: 12, color: '#ffd23f', bar: true, blurb: 'Customers grab a drink. You keep the tab.' },
  plant: { name: 'Potted Palm', icon: '🌴', cost: 400, appeal: 6, color: '#5ee27a', decor: true, blurb: 'A little green. +6 appeal.' },
  couch: { name: 'Velvet Couch', icon: '🛋️', cost: 900, appeal: 10, color: '#c77dff', decor: true, blurb: 'Somewhere to sit and regret. +10 appeal.' },
  arch: { name: 'Neon Arch', icon: '🌈', cost: 2200, appeal: 18, color: '#ff3fa4', decor: true, blurb: 'Glows. Customers love it. +18 appeal.' },
  fountain: { name: 'Champagne Fountain', icon: '⛲', cost: 3000, appeal: 25, color: '#2ee6d6', decor: true, blurb: 'Bubbly on tap. +25 appeal.' },
  aquarium: { name: 'Shark Tank', icon: '🦈', cost: 6500, appeal: 30, color: '#2e9bd6', decor: true, blurb: 'A giant aquarium with a (small) shark. +30 appeal.' },
  piano: { name: 'Piano Bar', icon: '🎹', cost: 8000, appeal: 35, color: '#f1e3c8', decor: true, blurb: 'A pianist plays all night. +35 appeal.' },
  disco: { name: 'Disco Floor', icon: '🪩', cost: 14000, appeal: 55, color: '#c77dff', decor: true, blurb: 'Flashing floor, spinning ball, customers dance. +55 appeal.' },
  statue: { name: 'Golden Bean Statue', icon: '🗿', cost: 10000, appeal: 45, color: '#ffd23f', decor: true, blurb: 'A solid gold you. +45 appeal.' },
};
const GAME_IDS = ['slots', 'plinko', 'roulette', 'mines', 'blackjack', 'crash', 'bar'];
const DECOR_IDS = ['plant', 'couch', 'arch', 'fountain', 'aquarium', 'piano', 'statue', 'disco'];

// Your casino in the save, with anything missing filled in. New casinos come with a free slot
// machine and a palm, so there's something to watch from the first minute.
export function casinoData(d = save.get()) {
  const c = d.casino || {};
  return {
    name: c.name || `${((d.look && d.look.name) || '').trim() || 'High Roller'}'s Casino`,
    slots: c.slots || { 2: { id: 'slots' }, 3: { id: 'slots' }, 0: { id: 'plant' } },
    rows: c.rows || 1,
    vault: c.vault || 0,
    lastSeen: c.lastSeen || 0,
    earned: c.earned || 0,
    visits: c.visits || 0,
    rigWins: c.rigWins || 0,
    cover: c.cover || 0,
    up: c.up || {},
  };
}
export function updateCasino(fn) { save.update((x) => { const c = casinoData(x); fn(c, x); x.casino = c; }); }

// One to five stars, from how nice the place is.
export function starsOf(c) { return Math.max(1, Math.min(5, 1 + Math.floor((appealOf(c) - 10) / 35))); }
export const starText = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
export const COVER_CHARGES = [0, 50, 250, 1000];

// Upgrades for the whole place (bought once per level, kept forever).
export const UPGRADES = {
  ads: { name: '📣 Billboards', costs: [4000, 15000, 50000], blurb: '+25% more customers walking in, per level.' },
  staff: { name: '💃 Cocktail service', costs: [6000, 25000], blurb: 'A waitress works the floor: customers bet 15% more, per level.' },
  security: { name: '🕶️ Security', costs: [8000], blurb: 'A bouncer on the door. Customers never catch a rigged table.' },
};
export const upLevel = (c, k) => Math.min(UPGRADES[k].costs.length, (c.up && c.up[k]) || 0);

// Things the owner can do to friends visiting. All harmless. Mostly.
export const PRANKS = [
  ['jackpot', '💎 Fake jackpot', 'A million chips! For about two seconds.'],
  ['boot', '🚪 Bouncer', 'Thrown out the front door.'],
  ['horn', '📯 Air horn', 'HOOOONK.'],
  ['spin', '🌀 Dizzy', 'Round and round they go.'],
  ['shrink', '🐜 Tiny', 'Shrunk to bug size for 20 seconds.'],
];

export function appealOf(c) {
  let a = 10;
  for (const s of Object.values(c.slots)) a += (CASINO_ITEMS[s.id] && CASINO_ITEMS[s.id].appeal) || 0;
  return a;
}
// Roughly what the place makes in an hour with you there, and while you're away (a fifth of it,
// for up to six hours).
export function incomeRate(c) {
  const earners = Object.values(c.slots).map((s) => CASINO_ITEMS[s.id]).filter((it) => it && it.edge);
  if (!earners.length) return 0;
  const busy = Math.min(1, (0.35 + appealOf(c) / 220) * (1 + upLevel(c, 'ads') * 0.25));
  return Math.round(earners.reduce((n, it) => n + it.edge, 0) * 150 * busy * (1 + upLevel(c, 'staff') * 0.15));
}
export const AWAY_SHARE = 0.2;
export const AWAY_HOURS = 6;
// Add what came in while you were away to the vault. Returns how much that was.
export function accrueAway(now = Date.now()) {
  let got = 0;
  updateCasino((c) => {
    if (c.lastSeen) {
      const hrs = Math.min(AWAY_HOURS, Math.max(0, (now - c.lastSeen) / 3600000));
      got = Math.floor(incomeRate(c) * AWAY_SHARE * hrs);
      c.vault += got;
      c.earned += got;
    }
    c.lastSeen = now;
  });
  return got;
}

// What goes over the wire (and to the raid) to build the place.
export function casinoLayout(d = save.get()) {
  const c = casinoData(d);
  return { name: c.name, slots: c.slots, rows: c.rows, cover: c.cover, up: c.up };
}

// ---------- decor meshes ----------

function buildDecor(id, g) {
  const add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; };
  if (id === 'plant') {
    add(part(new THREE.CylinderGeometry(0.7, 0.55, 1.1, 12), 0xb5652d), 0, 0.55, 0);
    for (let i = 0; i < 6; i++) {
      const leaf = part(new THREE.ConeGeometry(0.35, 2.4, 6), 0x2f9e44);
      leaf.position.set(0, 2, 0);
      leaf.rotation.set(0.9, (i / 6) * Math.PI * 2, 0, 'YXZ');
      g.add(leaf);
    }
    add(part(new THREE.CylinderGeometry(0.12, 0.16, 1.4, 8), 0x8d6e63), 0, 1.6, 0);
  } else if (id === 'couch') {
    add(part(new THREE.BoxGeometry(4, 0.8, 1.6), 0x7b2cbf), 0, 0.6, 0);
    add(part(new THREE.BoxGeometry(4, 1.2, 0.4), 0x7b2cbf), 0, 1.3, -0.65);
    for (const s of [-1, 1]) add(part(new THREE.BoxGeometry(0.4, 1, 1.6), 0x5a189a), s * 2, 0.9, 0);
  } else if (id === 'arch') {
    const arch = new THREE.Mesh(new THREE.TorusGeometry(3, 0.25, 10, 40, Math.PI), new THREE.MeshBasicMaterial({ color: 0xff3fa4 }));
    arch.position.y = 0.2;
    g.add(arch);
    const inner = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.18, 10, 40, Math.PI), new THREE.MeshBasicMaterial({ color: 0x2ee6d6 }));
    inner.position.y = 0.2;
    g.add(inner);
    const in2 = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.14, 10, 40, Math.PI), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
    in2.position.y = 0.2;
    g.add(in2);
  } else if (id === 'fountain') {
    add(part(new THREE.CylinderGeometry(2.4, 2.6, 0.8, 24), 0xe5e7eb), 0, 0.4, 0);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 0.1, 24), new THREE.MeshBasicMaterial({ color: 0xffe9a8 }));
    add(water, 0, 0.82, 0);
    add(part(new THREE.CylinderGeometry(0.25, 0.35, 2.2, 10), 0xd4a63a), 0, 1.6, 0);
    add(part(new THREE.CylinderGeometry(1.1, 0.4, 0.35, 16), 0xd4a63a), 0, 2.6, 0);
    const fizz = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff4c2 }));
    add(fizz, 0, 3.1, 0);
    g.userData.spin = fizz;
  } else if (id === 'statue') {
    add(part(new THREE.BoxGeometry(2.4, 1, 2.4), 0x3a1650), 0, 0.5, 0);
    const bean = part(new THREE.CapsuleGeometry(0.8, 1.6, 6, 14), 0xffc83d);
    add(bean, 0, 2.6, 0);
    const hat = part(new THREE.CylinderGeometry(0.55, 0.55, 0.9, 14), 0xffc83d);
    add(hat, 0, 4.25, 0);
    add(part(new THREE.CylinderGeometry(0.9, 0.9, 0.08, 16), 0xffc83d), 0, 3.82, 0);
  } else if (id === 'aquarium') {
    add(part(new THREE.BoxGeometry(5.2, 0.8, 2.4), 0x2b2140), 0, 0.4, 0);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(5, 2.6, 2.2), new THREE.MeshBasicMaterial({ color: 0x2e9bd6, transparent: true, opacity: 0.45, depthWrite: false }));
    add(glass, 0, 2.1, 0);
    add(part(new THREE.BoxGeometry(5.2, 0.2, 2.4), 0x2b2140), 0, 3.5, 0);
    const fish = [];
    for (let i = 0; i < 5; i++) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.45, 6), new THREE.MeshBasicMaterial({ color: [0xff9f43, 0xffd23f, 0xff5d5d, 0x5ee27a, 0xff7eb6][i] }));
      f.rotation.z = Math.PI / 2;
      add(f, 0, 1.4 + (i % 3) * 0.6, -0.6 + (i % 2) * 1.2);
      fish.push(f);
    }
    const shark = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.2, 8), new THREE.MeshBasicMaterial({ color: 0x8a9ba8 }));
    shark.rotation.z = Math.PI / 2;
    add(shark, 0, 2.6, 0);
    fish.push(shark);
    g.userData.tick = (t) => fish.forEach((f, i) => {
      const k = t * (0.5 + i * 0.13) + i;
      f.position.x = Math.sin(k) * 2.1;
      f.rotation.z = Math.cos(k) > 0 ? -Math.PI / 2 : Math.PI / 2;
    });
  } else if (id === 'piano') {
    add(part(new THREE.BoxGeometry(2.6, 1.1, 1.4), 0x111111), 0, 1, 0);
    const keys = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 0.4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    add(keys, 0, 1.2, 0.75);
    const lid = part(new THREE.BoxGeometry(2.6, 0.06, 1.4), 0x111111);
    lid.position.set(0, 1.95, -0.3);
    lid.rotation.x = -0.6;
    g.add(lid);
    for (const lx of [-1.1, 1.1]) add(part(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 6), 0x111111), lx, 0.25, 0);
    const pianist = createCharacter({ color: 0x2b2140, hat: 'top', eyes: 'happy', mouth: 'smile', glasses: 'none', neck: 'bowtie' });
    pianist.showTag(false);
    pianist.root.position.set(0, 0, 1.7);
    pianist.root.rotation.y = Math.PI;
    g.add(pianist.root);
    const note = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTexture('🎵'), transparent: true, depthWrite: false }));
    note.scale.set(0.8, 0.8, 1);
    g.add(note);
    g.userData.tick = (t, dt) => {
      pianist.animate(dt, { speed: 0, forward: 0, side: 0, onGround: true, pitch: 0, dead: false, showTag: false });
      pianist.root.rotation.z = Math.sin(t * 6) * 0.06;
      note.position.set(Math.sin(t * 1.3) * 1.2, 2.6 + ((t * 0.8) % 1.5), 0.3);
      note.material.opacity = 1 - ((t * 0.8) % 1.5) / 1.5;
    };
  } else if (id === 'disco') {
    const tiles = [];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const tile = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        tile.rotation.x = -Math.PI / 2;
        add(tile, -2.7 + i * 1.8, 0.07, -2.7 + j * 1.8);
        tiles.push(tile);
      }
    }
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8, 1), new THREE.MeshBasicMaterial({ color: 0xe5e7eb, wireframe: false }));
    add(ball, 0, 8.5, 0);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4), new THREE.MeshBasicMaterial({ color: 0x222222 }));
    add(cord, 0, 10, 0);
    const dancers = [];
    for (let i = 0; i < 3; i++) {
      const d = createCharacter(randomLook());
      d.showTag(false);
      d.root.position.set(-1.6 + i * 1.6, 0, (i % 2) * 1.2 - 0.6);
      g.add(d.root);
      dancers.push(d);
    }
    const cols = [0xff3fa4, 0x2ee6d6, 0xffd23f, 0xc77dff, 0x5ee27a, 0xff9f43];
    g.userData.tick = (t, dt) => {
      const beat = Math.floor(t * 2.2);
      tiles.forEach((tile, i) => tile.material.color.setHex(cols[(i * 7 + beat) % cols.length]));
      ball.rotation.y = t * 1.5;
      ball.material.color.setHSL((t * 0.2) % 1, 0.4, 0.85);
      dancers.forEach((d, i) => {
        d.animate(dt, { speed: 0, forward: 0, side: 0, onGround: true, pitch: 0, dead: false, showTag: false });
        d.root.position.y = Math.abs(Math.sin(t * 4.4 + i)) * 0.35;
        d.root.rotation.y = Math.sin(t * 2 + i * 2) * 0.9;
      });
    };
  } else if (id === 'bar') {
    add(part(new THREE.BoxGeometry(5, 1.2, 1.4), 0x6b3a1e), 0, 0.6, 0);
    add(part(new THREE.BoxGeometry(5.2, 0.12, 1.6), 0xd4a63a), 0, 1.25, 0);
    add(part(new THREE.BoxGeometry(5, 2.6, 0.5), 0x2b1640), 0, 1.3, -1.6);
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.6, 8), new THREE.MeshBasicMaterial({ color: [0x5ee27a, 0xffd23f, 0xff3fa4, 0x2ee6d6][i % 4] }));
      add(b, -2 + i * 0.8, 2.15, -1.45);
    }
    for (const sx of [-1.6, 0, 1.6]) add(part(new THREE.CylinderGeometry(0.35, 0.3, 0.9, 10), 0xc81d4a), sx, 0.45, 1.3);
  }
}

// A round felt table under the games that aren't cabinets.
function buildTableBase(g) {
  const leg = part(new THREE.CylinderGeometry(0.8, 1.1, 0.9, 14), 0x2b2140);
  leg.position.y = 0.45;
  const rim = part(new THREE.CylinderGeometry(2.6, 2.6, 0.22, 28), 0x6b3a1e);
  rim.position.y = 1;
  const top = part(new THREE.CylinderGeometry(2.4, 2.4, 0.06, 28), toon(0x1f8a4c), { ink: 0 });
  top.position.y = 1.12;
  g.add(leg, rim, top);
}

// Emoji bubbles, drawn once each.
const BUBBLES = new Map();
function bubbleTexture(emoji) {
  if (BUBBLES.has(emoji)) return BUBBLES.get(emoji);
  const tex = canvasTexture(128, 128, (c) => {
    c.fillStyle = 'rgba(255,246,224,0.95)';
    c.beginPath();
    c.arc(64, 58, 50, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.moveTo(54, 100);
    c.lineTo(64, 124);
    c.lineTo(76, 100);
    c.fill();
    c.font = '64px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(emoji, 64, 62);
  });
  BUBBLES.set(emoji, tex);
  return tex;
}

// A floating sign: text on a canvas, facing the door.
function signSprite(w, h, scale) {
  const tex = canvasTexture(w, h, () => {});
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(scale, (scale * h) / w, 1);
  s.renderOrder = 6;
  s.userData.draw = (fn) => { const { ctx } = tex.userData; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, w, h); fn(ctx, w, h); tex.needsUpdate = true; };
  return s;
}

// ---------- the casino, live ----------

export class MyCasino {
  constructor(raid, layout, owner) {
    this.raid = raid;
    this.L = raid.map.mycasino;
    this.owner = owner; // { name, me }
    this.layout = layout || casinoLayout();
    this.items = new Map(); // slot -> { id, group, colliders }
    this.customers = [];
    this.spawnT = 2;
    this.signT = 0;
    this.grumpy = 0; // seconds of bad word-of-mouth after a customer caught a rigged table
    this.sel = null; // the spot picked in the build panel
    this.markers = new THREE.Group();
    raid.scene.add(this.markers);
    this.buildSigns();
    this.rebuild();
    this.spots = [
      {
        spot: new THREE.Vector3(this.L.exit.x, 0, this.L.exit.z), range: 4, searchTime: 0.6, searchLabel: 'Heading out…',
        prompt: () => `<b>Hold ${keyName('use')}</b> Leave the casino`, open: (by) => { if (by.isPlayer) raid.extract('Cash Out'); },
      },
      {
        spot: new THREE.Vector3(this.L.cage.x, 0, this.L.cage.z), range: 4, searchTime: 0.4, searchLabel: 'Counting it up…',
        prompt: () => (this.owner.me ? `<b>Hold ${keyName('use')}</b> 🪙 Collect the vault (${fmt(casinoData().vault)})` : `💰 ${esc(this.owner.name)}'s vault. Every chip you lose here ends up in it.`),
        open: (by) => { if (by.isPlayer && this.owner.me) this.collect(); },
      },
      {
        spot: new THREE.Vector3(this.L.desk.x, 0, this.L.desk.z), range: 4, searchTime: 0.3, searchLabel: 'Unrolling the blueprints…',
        prompt: () => (this.owner.me ? `<b>Hold ${keyName('use')}</b> 🔨 Build, rig and manage your casino` : `🔨 ${esc(this.owner.name)}'s desk. Only the owner builds here.`),
        open: (by) => { if (by.isPlayer && this.owner.me) this.openPanel(); },
      },
    ];
    // Hooks into the games: rigged tables and the owner's cut of what friends lose.
    this.hookTables();
    // Visiting: pay the cover charge at the door, straight into the owner's vault.
    const cover = this.layout.cover || 0;
    if (!this.owner.me && cover > 0 && raid.isClient) {
      if (save.get().stash.chips >= cover && raid.casino.spend(cover)) {
        raid.net.send({ k: 'cvault', n: cover, cover: 1 });
        raid.hud.toast(`🎟️ ${esc(this.owner.name)} charged you a 🪙 ${fmt(cover)} cover to get in.`);
      } else raid.hud.toast(`🎟️ You couldn't pay ${esc(this.owner.name)}'s 🪙 ${fmt(cover)} cover. The bouncer lets it slide. This time.`);
    }
    this.prankCd = 0;
    if (this.owner.me && !raid.isClient) {
      const got = accrueAway();
      if (got > 0) raid.hud.toast(`🏰 While you were out, your casino made 🪙 ${fmt(got)}. It's in the vault at the cashier.`, 'big');
    }
  }

  get tables() { return this.T; }

  buildSigns() {
    const scene = this.raid.scene;
    this.nameSign = signSprite(1024, 200, 30);
    this.nameSign.position.set(0, 8.4, -46);
    scene.add(this.nameSign);
    this.vaultSign = signSprite(512, 160, 7);
    this.vaultSign.position.set(this.L.cage.x, 8.4, this.L.cage.z - 3);
    scene.add(this.vaultSign);
    this.drawSigns();
  }

  drawSigns() {
    const name = this.layout.name;
    this.nameSign.userData.draw((c, w, h) => {
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const text = name.toUpperCase().slice(0, 26);
      let size = 120;
      c.font = `${size}px 'Luckiest Guy', 'Arial Black', sans-serif`;
      while (size > 40 && c.measureText(text).width > w - 60) { size -= 6; c.font = `${size}px 'Luckiest Guy', 'Arial Black', sans-serif`; }
      c.lineWidth = 16;
      c.strokeStyle = '#1b0f2b';
      c.fillStyle = '#ffd23f';
      c.shadowColor = '#ff3fa4';
      c.shadowBlur = 30;
      c.strokeText(text, w / 2, h / 2);
      c.fillText(text, w / 2, h / 2);
    });
    const v = this.owner.me ? casinoData().vault : null;
    this.vaultSign.userData.draw((c, w, h) => {
      c.fillStyle = 'rgba(20,10,34,0.86)';
      c.fillRect(8, 8, w - 16, h - 16);
      c.strokeStyle = '#ffd23f';
      c.lineWidth = 8;
      c.strokeRect(8, 8, w - 16, h - 16);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = '#ffd23f';
      c.font = "54px 'Luckiest Guy', 'Arial Black', sans-serif";
      c.fillText(v === null ? '💰 THE VAULT' : `🪙 ${fmt(v)}`, w / 2, h / 2 + 4);
    });
  }

  // ---------- building the floor ----------

  rebuild() {
    const raid = this.raid;
    if (this.T && this.T.seat) { this.T.leave(); raid.setOverlay(null); }
    if (this.T) this.T.dispose();
    for (const it of this.items.values()) this.removeItem(it);
    this.items.clear();
    const defs = [];
    for (const [k, s] of Object.entries(this.layout.slots)) {
      const i = Number(k);
      const def = CASINO_ITEMS[s.id];
      if (!def || i >= this.layout.rows * CASINO_COLS.length) continue;
      const [x, z] = slotXZ(i);
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      // Every spot sits on a round rug in its own colour (red-tinged if it's rigged, owner's eyes only).
      const col = new THREE.Color(s.rig && this.owner.me ? '#ff2a2a' : def.color);
      const rug = new THREE.Mesh(new THREE.CircleGeometry(4.6, 36), new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(0.22) }));
      rug.rotation.x = -Math.PI / 2;
      rug.position.y = 0.05;
      const edge = new THREE.Mesh(new THREE.RingGeometry(4.6, 4.9, 40), new THREE.MeshBasicMaterial({ color: col }));
      edge.rotation.x = -Math.PI / 2;
      edge.position.y = 0.055;
      g.add(rug, edge);
      const colliders = [];
      if (def.game) {
        if (!CABINET_GAMES.has(def.game)) {
          buildTableBase(g);
          colliders.push(raid.map.addCollider({ type: 'circle', x, z, r: 2.6, top: 1.15 }));
        }
        defs.push({ x, z, game: def.game, color: def.color, front: [0, 1], slot: i });
      } else {
        buildDecor(s.id, g);
        if (s.id === 'bar') colliders.push(raid.map.addCollider({ type: 'box', minX: x - 2.6, maxX: x + 2.6, minZ: z - 2, maxZ: z + 0.8, top: 1.3 }));
        else if (s.id === 'fountain') colliders.push(raid.map.addCollider({ type: 'circle', x, z, r: 2.6, top: 0.9 }));
        else if (s.id === 'statue') colliders.push(raid.map.addCollider({ type: 'box', minX: x - 1.2, maxX: x + 1.2, minZ: z - 1.2, maxZ: z + 1.2, top: 4.5 }));
        else if (s.id === 'couch') colliders.push(raid.map.addCollider({ type: 'box', minX: x - 2.2, maxX: x + 2.2, minZ: z - 0.9, maxZ: z + 0.8, top: 1 }));
        else if (s.id === 'plant') colliders.push(raid.map.addCollider({ type: 'circle', x, z, r: 0.8, top: 1.2 }));
        else if (s.id === 'aquarium') colliders.push(raid.map.addCollider({ type: 'box', minX: x - 2.6, maxX: x + 2.6, minZ: z - 1.2, maxZ: z + 1.2, top: 3.6 }));
        else if (s.id === 'piano') colliders.push(raid.map.addCollider({ type: 'box', minX: x - 1.3, maxX: x + 1.3, minZ: z - 0.8, maxZ: z + 1, top: 1.6 }));
      }
      raid.scene.add(g);
      this.items.set(i, { id: s.id, rig: !!s.rig, group: g, colliders, x, z });
    }
    this.T = new LoungeTables(raid, defs, null);
    this.T.tables.forEach((t) => { t.slot = t.def.slot; });
    this.hookTables();
    this.drawMarkers();
    this.buildStaff();
    // Customers at a game that's gone: send them home.
    for (const cu of this.customers) if (cu.slot !== null && !this.items.has(cu.slot)) this.leave(cu);
  }

  removeItem(it) {
    this.raid.scene.remove(it.group);
    for (const c of it.colliders) this.raid.map.removeCollider(c);
  }

  // Empty spots glow faintly on the floor (for the owner), so you can see where things go.
  drawMarkers() {
    this.markers.clear();
    if (!this.owner.me) return;
    const open = this.layout.rows * CASINO_COLS.length;
    for (let i = 0; i < SLOT_COUNT; i++) {
      if (this.items.has(i)) continue;
      const [x, z] = slotXZ(i);
      const locked = i >= open;
      const ring = new THREE.Mesh(new THREE.RingGeometry(3.6, 3.8, 4, 1), new THREE.MeshBasicMaterial({ color: locked ? 0x6b5b7b : 0x2ee6d6, transparent: true, opacity: locked ? 0.25 : 0.55 }));
      ring.rotation.x = -Math.PI / 2;
      ring.rotation.z = Math.PI / 4;
      ring.position.set(x, 0.06, z);
      this.markers.add(ring);
    }
  }

  // ---------- rigging, and the owner's cut ----------

  hookTables() {
    const T = this.T;
    if (!T) return;
    // Someone who isn't the owner is about to win at a rigged table: 70% of the time, they don't.
    T.denyWin = (t) => {
      if (this.owner.me || !t) return false;
      const s = this.layout.slots[t.slot];
      if (!s || !s.rig || Math.random() > 0.7) return false;
      this.rigReveal(t);
      return true;
    };
    // A friend's losses (or the stake of a win the rig ate) go in the owner's vault.
    T.onResult = (t, wager, payout) => {
      if (this.owner.me) return;
      const lost = wager - payout;
      if (lost > 0 && this.raid.isClient) this.raid.net.send({ k: 'cvault', n: Math.round(lost), rig: payout === 0 && t && this.layout.slots[t.slot] && this.layout.slots[t.slot].rig ? 1 : 0 });
    };
  }

  rigReveal(t) {
    const raid = this.raid;
    raid.fx.number(t.pos.clone().setY(4.6), '😈 RIGGED!', '#ff2a2a', 2.2);
    raid.fx.confetti(t.pos.clone().setY(3));
    sfx.deny();
    raid.hud.toast(`😈 You'd have won... but ${esc(this.owner.name)} RIGGED this table. The House always wins.`, 'big');
  }

  // Host: a friend lost chips in our casino.
  friendLost(n, rigged, who, cover = false) {
    if (!this.owner.me) return;
    updateCasino((c) => { c.vault += n; c.earned += n; if (rigged) c.rigWins += 1; });
    this.drawSigns();
    if (cover) this.raid.feed(`🎟️ ${who} paid the 🪙 ${fmt(n)} cover`);
    if (rigged) this.raid.feed(`😈 Your rigged table just ate ${who}'s win (+🪙 ${fmt(n)})`);
  }

  // ---------- money ----------

  collect() {
    const v = casinoData().vault;
    if (v <= 0) { this.raid.hud.toast('The vault is empty. Give the customers a minute.'); return; }
    updateCasino((c, x) => { x.stash.chips += c.vault; c.vault = 0; });
    sfx.cashout();
    this.raid.fx.confetti(new THREE.Vector3(this.L.cage.x, 2.5, this.L.cage.z));
    this.raid.hud.toast(`💰 Collected 🪙 ${fmt(v)} from the vault!`, 'big');
    this.drawSigns();
    if (this.panelOpen()) this.renderPanel();
  }

  earn(n, at, big = false) {
    if (!this.owner.me || this.raid.isClient) return;
    updateCasino((c) => { c.vault = Math.max(0, c.vault + n); c.earned += n; c.visits += 1; });
    const p = this.raid.player;
    if (p && p.pos.distanceTo(at) < 40) this.raid.fx.number(at.clone().setY(4), n >= 0 ? `+🪙${fmt(n)}` : `-🪙${fmt(-n)}`, n >= 0 ? '#5ee27a' : '#ff5d5d', big ? 1.6 : 1);
    this.signT = 0;
  }

  // ---------- customers ----------

  maxCustomers() {
    let n = 4;
    for (const it of this.items.values()) if (CASINO_ITEMS[it.id].edge) n += 2;
    return Math.min(32, n + Math.floor(appealOf(this.layout) / 25) + upLevel({ up: this.layout.up }, 'ads') * 2);
  }

  spawnCustomer() {
    // Now and then a VIP high roller: gold, crowned, and they bet big.
    const vip = Math.random() < 0.03 + appealOf(this.layout) / 4000;
    const look = randomLook();
    if (vip) { look.color = 0xffc83d; look.hat = 'crown'; look.glasses = 'shades'; }
    const char = createCharacter(look);
    char.showTag(false);
    const pos = DOOR.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, 0, 0));
    char.root.position.copy(pos);
    this.raid.scene.add(char.root);
    const cu = { char, pos, path: [], state: 'walk', slot: null, t: 0, yaw: Math.PI, hop: 0, after: null, vip };
    const now = performance.now();
    if (vip && this.owner.me && now - (this.vipSaid || -1e9) > 30000) { this.vipSaid = now; this.raid.feed('💎 A VIP high roller just walked in!'); }
    if (vip) this.react(cu, '💎');
    this.customers.push(cu);
    this.pickTarget(cu);
  }

  // Somewhere to go: a free game first, else the bar, else something nice to look at.
  pickTarget(cu) {
    const busy = new Set(this.customers.filter((o) => o !== cu && o.slot !== null).map((o) => o.slot));
    const seated = this.T && this.T.seat ? this.T.seat.slot : null;
    const taken = (t) => busy.has(t.slot) || t.slot === seated || (t.owner && !t.stale);
    const games = this.T ? this.T.tables.filter((t) => !taken(t)) : [];
    const other = [...this.items.entries()].filter(([i, it]) => !busy.has(i) && !CASINO_ITEMS[it.id].game);
    let goal = null;
    if (games.length && Math.random() < 0.8) {
      const t = games[Math.floor(Math.random() * games.length)];
      cu.slot = t.slot;
      cu.kind = 'game';
      goal = t.seatPos.clone();
    } else if (other.length) {
      const [i, it] = other[Math.floor(Math.random() * other.length)];
      cu.slot = i;
      cu.kind = CASINO_ITEMS[it.id].bar ? 'bar' : 'look';
      goal = new THREE.Vector3(it.x + (Math.random() - 0.5) * 3, 0, it.z + (it.id === 'bar' ? 2.4 : 3.6));
    } else {
      cu.slot = null;
      cu.kind = 'look';
      goal = new THREE.Vector3((Math.random() - 0.5) * 10, 0, 20 + Math.random() * 10);
    }
    // Up the red carpet, along the row's aisle, then over to the spot.
    const az = goal.z + 2.2;
    cu.path = [new THREE.Vector3((Math.random() - 0.5) * 3, 0, az), new THREE.Vector3(goal.x, 0, az), goal];
    cu.state = 'walk';
  }

  leave(cu) {
    cu.slot = null;
    cu.state = 'leave';
    const az = cu.pos.z + 2.2;
    cu.path = [new THREE.Vector3(cu.pos.x, 0, az), new THREE.Vector3((Math.random() - 0.5) * 3, 0, az), DOOR.clone()];
  }

  // A customer finished a go on something: the house (mostly) wins.
  settle(cu) {
    const it = this.items.get(cu.slot);
    if (!it) return;
    const def = CASINO_ITEMS[it.id];
    const at = new THREE.Vector3(it.x, 0, it.z);
    if (!def.edge) return;
    const rig = this.layout.slots[cu.slot] && this.layout.slots[cu.slot].rig;
    // Every so often a customer hits it big (that's what keeps them coming back).
    if (!rig && Math.random() < 0.08) {
      this.earn(-Math.round(def.edge * (2 + Math.random() * 2)), at, true);
      cu.hop = 1;
      this.raid.fx.confetti(at.clone().setY(3), 18);
      this.react(cu, '🤑');
      return;
    }
    const c = casinoData();
    let n = Math.round(def.edge * (0.3 + Math.random() * 1.4) * (rig ? 1.8 : 1) * (cu.vip ? 3 : 1) * (1 + upLevel(c, 'staff') * 0.15));
    if (Math.random() < 0.45) this.react(cu, ['😭', '😤', '🙃', '💸', '😩', '🤡'][Math.floor(Math.random() * 6)]);
    if (rig && !upLevel(c, 'security') && Math.random() < 0.15) {
      this.react(cu, '😠');
      // Caught it. Word gets round.
      if (this.owner.me && this.grumpy <= 0) this.raid.hud.toast('😠 A customer figured out your table is rigged! Fewer people will show up for a bit.');
      this.grumpy = 60;
      this.raid.fx.number(at.clone().setY(5), '😠 RIGGED?!', '#ff5d5d', 1.4);
      n = Math.round(n * 0.5);
    }
    this.earn(n, at);
  }

  updateCustomers(dt) {
    // New faces come in through the door (more of them the nicer the place is).
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      const appeal = appealOf(this.layout) * (this.grumpy > 0 ? 0.4 : 1);
      this.spawnT = 5 / (1 + appeal / 70) / (1 + upLevel(casinoData(), 'ads') * 0.25) * (0.6 + Math.random() * 0.8);
      if (this.customers.length < this.maxCustomers()) this.spawnCustomer();
    }
    this.grumpy = Math.max(0, this.grumpy - dt);
    const seated = this.T && this.T.seat ? this.T.seat.slot : null;
    for (let i = this.customers.length - 1; i >= 0; i--) {
      const cu = this.customers[i];
      let speed = 0;
      if (cu.state === 'walk' || cu.state === 'leave') {
        const wp = cu.path[0];
        if (!wp) {
          if (cu.state === 'leave') {
            this.raid.scene.remove(cu.char.root);
            this.customers.splice(i, 1);
            continue;
          }
          cu.state = 'use';
          cu.t = cu.kind === 'game' ? 8 + Math.random() * 10 : cu.kind === 'bar' ? 6 + Math.random() * 6 : 3 + Math.random() * 4;
          if (cu.slot !== null) {
            const it = this.items.get(cu.slot);
            if (it) cu.yaw = Math.atan2(it.x - cu.pos.x, it.z - cu.pos.z);
          }
        } else {
          const dx = wp.x - cu.pos.x;
          const dz = wp.z - cu.pos.z;
          const d = Math.hypot(dx, dz);
          if (d < 0.3) cu.path.shift();
          else {
            speed = 4;
            const step = Math.min(d, speed * dt);
            cu.pos.x += (dx / d) * step;
            cu.pos.z += (dz / d) * step;
            cu.yaw = Math.atan2(dx, dz);
          }
        }
      } else if (cu.state === 'use') {
        cu.t -= dt;
        // You sat down at their game: they let you have it.
        if (cu.slot !== null && cu.slot === seated) { this.leave(cu); continue; }
        if (cu.t <= 0) {
          if (cu.kind !== 'look') this.settle(cu);
          // Another go somewhere else, or home.
          if (Math.random() < 0.45) this.pickTarget(cu); else this.leave(cu);
        }
      }
      if (cu.bubble && (cu.bubbleT -= dt) <= 0) { cu.char.root.remove(cu.bubble); cu.bubble = null; }
      cu.hop = Math.max(0, cu.hop - dt * 1.6);
      const hopY = Math.sin(cu.hop * Math.PI * 2) * 0.6 * (cu.hop > 0 ? 1 : 0);
      cu.char.root.position.set(cu.pos.x, Math.max(0, hopY), cu.pos.z);
      cu.char.root.rotation.y = cu.yaw;
      cu.char.animate(dt, { speed, forward: speed / 6, side: 0, onGround: hopY <= 0.01, pitch: 0, dead: false, showTag: false });
    }
  }

  // A little emoji over a customer's head for a couple of seconds.
  react(cu, emoji) {
    if (cu.bubble) cu.char.root.remove(cu.bubble);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTexture(emoji), transparent: true, depthWrite: false }));
    s.scale.set(1.1, 1.1, 1);
    s.position.y = 3.3;
    s.renderOrder = 8;
    cu.char.root.add(s);
    cu.bubble = s;
    cu.bubbleT = 2.2;
  }

  // The staff you've hired: a bouncer on the door, a waitress working the floor.
  buildStaff() {
    for (const st of this.staff || []) this.raid.scene.remove(st.char.root);
    this.staff = [];
    const c = this.owner.me ? casinoData() : { up: this.layout.up || {} };
    if (upLevel(c, 'security')) {
      const char = createCharacter({ color: 0x2b2140, hat: 'none', eyes: 'angry', mouth: 'flat', glasses: 'shades', neck: 'bowtie' });
      char.showTag(false);
      char.root.scale.setScalar(1.35);
      char.root.position.set(5.5, 0, 42);
      char.root.rotation.y = Math.PI;
      this.raid.scene.add(char.root);
      this.staff.push({ char, still: true });
    }
    for (let i = 0; i < upLevel(c, 'staff'); i++) {
      const char = createCharacter({ color: 0xff7eb6, hat: 'none', eyes: 'happy', mouth: 'smile', glasses: 'none', neck: 'bowtie' });
      char.showTag(false);
      const tray = part(new THREE.CylinderGeometry(0.45, 0.45, 0.06, 14), 0xd4a63a);
      tray.position.set(0.55, 2.1, 0.2);
      char.root.add(tray);
      const pos = new THREE.Vector3((Math.random() - 0.5) * 6, 0, 20);
      this.raid.scene.add(char.root);
      this.staff.push({ char, pos, goal: null, wait: 0 });
    }
  }

  updateStaff(dt) {
    for (const st of this.staff || []) {
      if (st.still) { st.char.animate(dt, { speed: 0, forward: 0, side: 0, onGround: true, pitch: 0, dead: false, showTag: false }); continue; }
      let speed = 0;
      if (st.wait > 0) st.wait -= dt;
      else {
        if (!st.goal) {
          const [x, z] = slotXZ(Math.floor(Math.random() * this.layout.rows * CASINO_COLS.length));
          st.goal = new THREE.Vector3(x + (Math.random() - 0.5) * 6, 0, z + 5.6);
        }
        const dx = st.goal.x - st.pos.x;
        const dz = st.goal.z - st.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.4) { st.goal = null; st.wait = 2 + Math.random() * 3; } else {
          speed = 3.2;
          st.pos.x += (dx / d) * Math.min(d, speed * dt);
          st.pos.z += (dz / d) * Math.min(d, speed * dt);
          st.char.root.rotation.y = Math.atan2(dx, dz);
        }
      }
      st.char.root.position.copy(st.pos);
      st.char.animate(dt, { speed, forward: speed / 6, side: 0, onGround: true, pitch: 0, dead: false, showTag: false });
    }
  }

  // ---------- pranks ----------

  // Friends in here right now (as the owner sees them).
  guests() { return this.raid.combatants.filter((c) => c.human && c.alive && c.owner); }

  // Owner: pull one on a friend.
  prank(id, kind) {
    const raid = this.raid;
    if (!this.owner.me || !raid.isHost) return;
    if (this.prankCd > 0) { raid.hud.toast('😈 Give it a second...'); return; }
    const f = this.guests().find((c) => String(c.owner) === String(id));
    if (!f) return;
    this.prankCd = 2;
    raid.net.net.to(f.owner, { k: 'prank', p: kind, by: this.owner.name });
    // What everyone in the room sees happen to them.
    const at = f.pos.clone().setY(f.pos.y + 3);
    raid.fx.number(at, '😈', '#ff3fa4', 1.8);
    if (kind === 'jackpot') raid.fx.confetti(at, 30);
    if (kind === 'horn') sfx.siren();
    if (kind === 'shrink') { f.char.root.scale.setScalar(0.4); f.shrinkT = 20; }
    const label = (PRANKS.find(([k]) => k === kind) || [])[1] || 'Prank';
    raid.feed(`😈 You pulled ${label} on ${f.name}`);
  }

  // Friend: the owner just pranked us.
  pranked(kind, by) {
    const raid = this.raid;
    const p = raid.player;
    if (!p) return;
    const who = esc(by || 'The owner');
    if (kind === 'jackpot') {
      const el = this.banner();
      el.innerHTML = '<b>💎💎💎 JACKPOT! 💎💎💎</b><span>🪙 1,000,000</span>';
      el.className = 'prankbanner win';
      el.hidden = false;
      sfx.jackpot();
      raid.fx.confetti(p.pos.clone().setY(2.5), 60);
      clearTimeout(this.bannerT);
      this.bannerT = setTimeout(() => {
        el.innerHTML = `<b>😈 JUST KIDDING</b><span>Pranked by ${who}</span>`;
        el.className = 'prankbanner kid';
        sfx.deny();
        this.bannerT = setTimeout(() => { el.hidden = true; }, 2600);
      }, 2400);
    } else if (kind === 'boot') {
      if (raid.tables && raid.tables.seat) raid.setOverlay(null);
      p.pos.set((Math.random() - 0.5) * 4, 0, 44);
      p.vel.set(0, 0, 0);
      p.yaw = 0;
      raid.shake = Math.max(raid.shake, 0.5);
      sfx.bonk();
      raid.hud.toast(`🚪 ${who} had the bouncer throw you out!`, 'big');
    } else if (kind === 'horn') {
      sfx.siren();
      raid.shake = Math.max(raid.shake, 0.7);
      raid.hud.toast(`📯 HOOOOOONK! (courtesy of ${who})`, 'big');
    } else if (kind === 'spin') {
      this.spinT = 1.4;
      raid.hud.toast(`🌀 ${who} spun you around!`);
    } else if (kind === 'shrink') {
      p.char.root.scale.setScalar(0.4);
      this.shrinkT = 20;
      raid.hud.toast(`🐜 ${who} shrank you! Back to normal in 20 seconds.`, 'big');
    }
  }

  banner() {
    let el = $('prankBanner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'prankBanner';
      el.hidden = true;
      document.body.appendChild(el);
    }
    return el;
  }

  // ---------- each frame ----------

  interactables() { return [...this.spots, ...(this.T ? this.T.interactables() : [])]; }

  update(dt) {
    if (this.T) this.T.update(dt);
    this.prankCd = Math.max(0, this.prankCd - dt);
    const p = this.raid.player;
    if (p && this.spinT > 0) { this.spinT -= dt; p.yaw += dt * 11; }
    if (p && this.shrinkT > 0) { this.shrinkT -= dt; if (this.shrinkT <= 0) { p.char.root.scale.setScalar(1); this.raid.hud.toast('🐜 You\'re back to normal size.'); } }
    for (const c of this.raid.combatants) if (c.shrinkT > 0) { c.shrinkT -= dt; if (c.shrinkT <= 0) c.char.root.scale.setScalar(1); }
    this.updateCustomers(dt);
    this.updateStaff(dt);
    const now = performance.now() / 1000;
    for (const it of this.items.values()) {
      if (it.group.userData.spin) it.group.userData.spin.position.y = 3.1 + Math.sin(now * 3.3) * 0.15;
      if (it.group.userData.tick) it.group.userData.tick(now, dt);
    }
    this.signT -= dt;
    if (this.signT <= 0) { this.signT = 1; this.drawSigns(); }
  }

  dispose() {
    if (this.T) this.T.dispose();
    for (const it of this.items.values()) this.removeItem(it);
    for (const cu of this.customers) this.raid.scene.remove(cu.char.root);
    for (const st of this.staff || []) this.raid.scene.remove(st.char.root);
    this.customers = [];
    this.raid.scene.remove(this.markers, this.nameSign, this.vaultSign);
    if (this.owner.me && !this.raid.isClient) updateCasino((c) => { c.lastSeen = Date.now(); });
    const el = $('buildPanel');
    if (el) el.hidden = true;
    if ($('prankBanner')) $('prankBanner').hidden = true;
    clearTimeout(this.bannerT);
    if (this.raid.player) this.raid.player.char.root.scale.setScalar(1);
  }

  // ---------- the build panel ----------

  panelOpen() { const el = $('buildPanel'); return el && !el.hidden; }

  openPanel() {
    let el = $('buildPanel');
    if (!el) {
      el = document.createElement('div');
      el.id = 'buildPanel';
      el.className = 'buildpanel';
      document.body.appendChild(el);
      el.addEventListener('click', (e) => this.onClick(e));
      el.addEventListener('change', (e) => { if (e.target.id === 'casName') this.rename(e.target.value); });
    }
    this.raid.setOverlay('build');
    el.hidden = false;
    this.renderPanel();
  }

  renderPanel() {
    const el = $('buildPanel');
    if (!el) return;
    const c = casinoData();
    const chips = save.get().stash.chips;
    const open = c.rows * CASINO_COLS.length;
    const guests = this.raid.isHost ? this.guests() : [];
    const cell = (i) => {
      const s = c.slots[i];
      const locked = i >= open;
      const def = s && CASINO_ITEMS[s.id];
      return `<button class="bcell ${this.sel === i ? 'on' : ''} ${locked ? 'locked' : ''} ${s && s.rig ? 'rig' : ''}" data-act="cell" data-i="${i}" style="${def ? `--c:${def.color}` : ''}">${locked ? '🔒' : def ? `${def.icon}${s.rig ? '<i>😈</i>' : ''}` : '<span>+</span>'}</button>`;
    };
    // Rows from the back wall (top) to the door (bottom), the aisle down the middle.
    const rows = [...CASINO_ROWS.keys()].reverse().map((r) => {
      const ids = CASINO_COLS.map((_, k) => r * CASINO_COLS.length + k);
      return `<div class="brow">${ids.slice(0, 3).map(cell).join('')}<div class="baisle"></div>${ids.slice(3).map(cell).join('')}</div>`;
    }).join('');
    let detail = '<p class="bhint">Pick a spot on the floor plan to build there.</p>';
    if (this.sel !== null) {
      const s = c.slots[this.sel];
      if (this.sel >= open) {
        const next = c.rows;
        const nextCost = ROW_COST[next];
        const row = Math.floor(this.sel / CASINO_COLS.length);
        detail = row === next
          ? `<h4>🔒 Expand the floor</h4><p>Open up another row of six spots.</p><button class="btn" data-act="expand" ${chips < nextCost ? 'disabled' : ''}>Expand for 🪙 ${fmt(nextCost)}</button>`
          : '<h4>🔒 Not yet</h4><p>Open the rows nearer the door first.</p>';
      } else if (s) {
        const def = CASINO_ITEMS[s.id];
        detail = `<h4>${def.icon} ${def.name}</h4><p>${def.blurb}</p>
          ${def.game ? `<p class="brig">${s.rig ? '😈 <b>RIGGED.</b> Customers lose more (+80%), but some notice. Friends who sit here lose most of their wins, and find out who did it.' : '😇 Playing it straight.'}</p>
          <button class="btn ${s.rig ? 'ghost' : 'rigbtn'}" data-act="rig">${s.rig ? '😇 Un-rig it' : '😈 Rig this table'}</button>` : ''}
          <button class="btn ghost" data-act="sell">Sell for 🪙 ${fmt(Math.floor(def.cost / 2))}</button>`;
      } else {
        const shop = (ids) => ids.map((id) => {
          const def = CASINO_ITEMS[id];
          return `<button class="bitem" data-act="buy" data-id="${id}" ${chips < def.cost ? 'disabled' : ''} style="--c:${def.color}"><span>${def.icon}</span><b>${def.name}</b><small>${def.edge ? `~🪙${def.edge} a customer · ` : ''}+${def.appeal} appeal</small><em>🪙 ${fmt(def.cost)}</em></button>`;
        }).join('');
        detail = `<h4>Games</h4><div class="bshop">${shop(GAME_IDS)}</div><h4>Decor</h4><div class="bshop">${shop(DECOR_IDS)}</div>`;
      }
    }
    el.innerHTML = `<div class="bphead"><div><small>YOUR CASINO</small><input id="casName" maxlength="24" value="${esc(c.name)}"></div><button class="btn ghost" data-act="close">✕ Close</button></div>
      <div class="bpstats">
        <span>💰 Vault <b>🪙 ${fmt(c.vault)}</b> <button class="btn tiny" data-act="collect" ${c.vault > 0 ? '' : 'disabled'}>Collect</button></span>
        <span>⭐ Appeal <b>${appealOf(c)}</b></span>
        <span>🧑‍🤝‍🧑 Customers <b>${this.customers.length}</b></span>
        <span>📈 ~🪙 <b>${fmt(incomeRate(c))}</b>/hr</span>
        <span>🏦 Made <b>🪙 ${fmt(c.earned)}</b></span>
        <span>🏅 Rating <b class="stars">${starText(starsOf(c))}</b></span>
        <span>🪙 You have <b>${fmt(chips)}</b></span>
      </div>
      <div class="bpbody"><div class="bplan"><div class="bwall">🎰 BACK WALL</div>${rows}<div class="bdoor">🚪 DOOR</div></div><div class="bdetail">${detail}</div></div>
      <div class="bups"><b>🛠️ Upgrades</b><div>${Object.entries(UPGRADES).map(([k, u]) => {
        const lv = upLevel(c, k);
        const max = lv >= u.costs.length;
        const cost = u.costs[lv];
        return `<button class="bitem" data-act="upgrade" data-k="${k}" ${max || chips < cost ? 'disabled' : ''} style="--c:#2ee6d6"><span>${u.name.split(' ')[0]}</span><b>${u.name.split(' ').slice(1).join(' ')} ${u.costs.length > 1 ? `· Lv ${lv}/${u.costs.length}` : lv ? '· Hired' : ''}</b><small>${u.blurb}</small><em>${max ? '✅ Maxed' : `🪙 ${fmt(cost)}`}</em></button>`;
      }).join('')}</div></div>
      <div class="bpfoot">
        <div class="bcover"><b>🎟️ Cover charge</b><small>What friends pay to get in (into your vault).</small>
          <div>${COVER_CHARGES.map((v) => `<button class="subtab ${(c.cover || 0) === v ? 'on' : ''}" data-act="cover" data-v="${v}">${v ? `🪙 ${fmt(v)}` : 'Free'}</button>`).join('')}</div></div>
        <div class="bpranks"><b>😈 Pranks</b>${guests.length ? guests.map((g) => `<div class="bprow"><span>${esc(g.name)}</span>${PRANKS.map(([k, n, t]) => `<button class="subtab" data-act="prank" data-f="${esc(g.owner)}" data-p="${k}" title="${esc(t)}">${n}</button>`).join('')}</div>`).join('') : '<small>Make a party and bring friends in to prank them.</small>'}</div>
      </div>`;
  }

  onClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    const i = this.sel;
    if (act === 'close') { this.raid.setOverlay(null); return; }
    if (act === 'cell') this.sel = Number(b.dataset.i);
    else if (act === 'collect') { this.collect(); return; }
    else if (act === 'prank') { this.prank(b.dataset.f, b.dataset.p); return; }
    else if (act === 'upgrade') {
      const k = b.dataset.k;
      const lv = upLevel(casinoData(), k);
      const cost = UPGRADES[k] && UPGRADES[k].costs[lv];
      if (!cost || !this.raid.casino.spend(cost)) return;
      updateCasino((c) => { c.up = { ...(c.up || {}), [k]: lv + 1 }; });
      sfx.cashout();
      this.raid.hud.toast(`🛠️ ${UPGRADES[k].name} ${UPGRADES[k].costs.length > 1 ? `level ${lv + 1}` : 'hired'}!`);
      this.changed();
      return;
    }
    else if (act === 'cover') { updateCasino((c) => { c.cover = Number(b.dataset.v) || 0; }); this.changed(); return; }
    else if (act === 'expand') {
      const cost = ROW_COST[casinoData().rows];
      if (!this.raid.casino.spend(cost)) return;
      updateCasino((c) => { c.rows += 1; });
      sfx.cashout();
      this.raid.hud.toast('🏗️ The floor just got bigger!');
      this.changed();
    } else if (act === 'buy') {
      const def = CASINO_ITEMS[b.dataset.id];
      if (!def || i === null || !this.raid.casino.spend(def.cost)) return;
      updateCasino((c) => { c.slots[i] = { id: b.dataset.id }; });
      sfx.win();
      this.changed();
      const it = this.items.get(i);
      if (it) this.raid.fx.confetti(new THREE.Vector3(it.x, 2, it.z));
    } else if (act === 'sell') {
      const s = casinoData().slots[i];
      if (!s) return;
      const back = Math.floor(CASINO_ITEMS[s.id].cost / 2);
      updateCasino((c, x) => { delete c.slots[i]; x.stash.chips += back; });
      this.changed();
    } else if (act === 'rig') {
      updateCasino((c) => { if (c.slots[i]) c.slots[i].rig = !c.slots[i].rig; });
      const on = casinoData().slots[i] && casinoData().slots[i].rig;
      if (on) sfx.deny(); else sfx.win();
      this.changed();
    }
    this.renderPanel();
  }

  rename(v) {
    const name = String(v || '').trim().slice(0, 24);
    if (!name) return;
    updateCasino((c) => { c.name = name; });
    this.changed();
  }

  // The layout changed: rebuild here, and tell any friends visiting.
  changed() {
    this.layout = casinoLayout();
    this.rebuild();
    this.drawSigns();
    if (this.raid.isHost) this.raid.net.rel({ k: 'cas', layout: this.layout });
    this.renderPanel();
  }

  // A friend's game: the owner changed something.
  applyLayout(layout) {
    if (!layout) return;
    this.layout = layout;
    this.rebuild();
    this.drawSigns();
  }
}
