// Royale: everyone drops in with a pea shooter, the House Edge closes in, last one standing wins.
// About two dozen fighters (you, your party, and bots to fill), ten minutes at most.
//
// The circle is worked out from the raid's seed and the raid clock alone, so every player in a
// party sees the same circle without anything extra on the wire.
import * as THREE from 'three';
import { buildPartyBus } from './lobby.js';
import { keyName } from './keys.js';

export const ROYALE_SIZE = 40;
// How long the party bus takes to cross the island, and how high it flies.
export const BUS_TIME = 45;
const BUS_Y = 110;
const BUS_SCALE = 1.6;
// [wait, shrink] seconds, the radius it closes to (fraction of the map's half-width), and the damage
// a second you take outside it.
const PHASES = [
  { wait: 75, shrink: 45, r: 0.55, dmg: 2 },
  { wait: 55, shrink: 40, r: 0.32, dmg: 4 },
  { wait: 45, shrink: 35, r: 0.17, dmg: 7 },
  { wait: 35, shrink: 30, r: 0.08, dmg: 11 },
  { wait: 25, shrink: 30, r: 0.03, dmg: 16 },
];
// After the last circle: a minute's grace, then a minute where it closes all the way (and a
// little spare so the clock never runs out first).
const FINAL_HOLD = 30;
const FINAL_CLOSE = 60;
export const ROYALE_TIME = PHASES.reduce((n, p) => n + p.wait + p.shrink, 0) + FINAL_HOLD + FINAL_CLOSE + 60;

// Bets on yourself before the drop: finish in the top N and it pays.
export const PLACE_BETS = [[10, 'Top 10', 2], [3, 'Top 3', 4], [1, 'Win it', 10]];
export const PLACE_STAKES = [0, 100, 500, 2500, 10000];

// Chips (and XP) by where you finish.
// A pink golf cart: parked out on the island, or carrying whoever's driving it.
export function buildCart(roofless = false) {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.7, 3), mat(0xff3fa4));
  body.position.y = 0.75;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.18, 3.04), mat(0xffd23f));
  stripe.position.y = 0.95;
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.35, 0.3), mat(0xfff4e0));
  seat.position.set(0, 1.25, 1.2);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.12, 2.4), mat(0xfff4e0));
  roof.position.set(0, 3.4, 0.2);
  g.add(body, stripe, seat);
  // (The one you're driving has no roof, so it doesn't block your view.)
  if (!roofless) g.add(roof);
  for (const [x, z] of roofless ? [] : [[-0.9, -1.0], [0.9, -1.0], [-0.9, 1.3], [0.9, 1.3]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.3), mat(0xd4a63a));
    pole.position.set(x, 2.25, z * 0.85 + 0.15);
    g.add(pole);
  }
  for (const [x, z] of [[-1.05, -1], [1.05, -1], [-1.05, 1], [1.05, 1]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.28, 14), mat(0x1b0f2b));
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.42, z);
    g.add(w);
  }
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff4b0 }));
  light.position.set(0, 0.85, -1.52);
  g.add(light);
  return g;
}
export const CART_SPEED = 21;

export function placementPrize(place, kills) {
  const base = place === 1 ? 3000 : place <= 3 ? 1400 : place <= 5 ? 800 : place <= 10 ? 400 : 150;
  return { chips: base + kills * 75, xp: Math.round((place === 1 ? 400 : place <= 3 ? 220 : place <= 10 ? 120 : 60) + kills * 15) };
}

function seeded(seed) {
  let a = (seed ^ 0x2545f491) >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Royale {
  constructor(raid, seed) {
    this.raid = raid;
    const half = raid.map.half;
    const rnd = seeded(seed || 1);
    // Circle centers, each one inside the last.
    // The first circle takes in the whole island, so you can see the wall from the bus.
    const circles = [{ x: 0, z: 0, r: half * 0.93 }];
    for (const ph of PHASES) {
      const prev = circles[circles.length - 1];
      const r = half * ph.r;
      const room = Math.max(0, Math.min(prev.r - r, half * 0.9 - r));
      const a = rnd() * Math.PI * 2;
      const d = rnd() * room * 0.85;
      let x = prev.x + Math.cos(a) * d;
      let z = prev.z + Math.sin(a) * d;
      // Keep the final circles on dry land, away from the very edge.
      x = Math.max(-half * 0.8 + r, Math.min(half * 0.8 - r, x));
      z = Math.max(-half * 0.8 + r, Math.min(half * 0.8 - r, z));
      circles.push({ x, z, r });
    }
    this.circles = circles;
    this.dropLine = (() => {
      const a = rnd() * Math.PI * 2;
      return { a, from: new THREE.Vector3(Math.cos(a) * half * 0.9, 0, Math.sin(a) * half * 0.9), to: new THREE.Vector3(-Math.cos(a) * half * 0.9, 0, -Math.sin(a) * half * 0.9) };
    })();
    this.hurtT = 0;
    this.over = false;
    this.buildVisuals();
    this.buildCarts(rnd);
  }

  // Where the circle is right now (and where it's heading), from the raid clock.
  state(t = this.raid.raidTime - this.raid.timeLeft) {
    let at = 0;
    for (let i = 0; i < PHASES.length; i++) {
      const ph = PHASES[i];
      const a = this.circles[i];
      const b = this.circles[i + 1];
      if (t < at + ph.wait) return { ...a, next: b, phase: i, closing: false, left: at + ph.wait - t, dmg: i ? PHASES[i - 1].dmg : 1 };
      at += ph.wait;
      if (t < at + ph.shrink) {
        const k = (t - at) / ph.shrink;
        return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, r: a.r + (b.r - a.r) * k, next: b, phase: i, closing: true, left: at + ph.shrink - t, dmg: ph.dmg };
      }
      at += ph.shrink;
    }
    const last = this.circles[this.circles.length - 1];
    const dmg = PHASES[PHASES.length - 1].dmg + 6;
    const end = { ...last, r: 0 };
    if (t < at + FINAL_HOLD) return { ...last, next: end, phase: PHASES.length, closing: false, left: at + FINAL_HOLD - t, dmg };
    const k = Math.min(1, (t - at - FINAL_HOLD) / FINAL_CLOSE);
    return { ...last, r: last.r * (1 - k), next: end, phase: PHASES.length, closing: k < 1, left: Math.max(0, at + FINAL_HOLD + FINAL_CLOSE - t), dmg: dmg + Math.round(k * 20) };
  }

  outside(pos, s = this.state()) { return Math.hypot(pos.x - s.x, pos.z - s.z) > s.r; }

  buildVisuals() {
    const scene = this.raid.scene;
    // The wall of the circle: a tall glowing curtain with stripes running up it, strongest at the
    // ground, scaled to the radius every frame.
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 128;
    const ctx = c.getContext('2d');
    for (let y = 0; y < 128; y++) {
      const a = 0.08 + Math.pow(y / 127, 1.6) * 0.8;
      for (let x = 0; x < 64; x++) {
        const stripe = ((x + y) % 32) < 12 ? 1 : 0.55;
        ctx.fillStyle = `rgba(255, ${stripe === 1 ? 63 : 120}, ${stripe === 1 ? 164 : 200}, ${a * stripe})`;
        ctx.fillRect(x, 127 - y, 1, 1);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.set(90, 1);
    this.wallTex = tex;
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 90, 128, 1, true), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false }));
    wall.position.y = 44;
    wall.renderOrder = 3;
    // The edge of the circle right now, painted on the ground.
    const edge = new THREE.Mesh(new THREE.RingGeometry(0.992, 1, 160), new THREE.MeshBasicMaterial({ color: 0xff3fa4, side: THREE.DoubleSide, depthWrite: false }));
    edge.rotation.x = -Math.PI / 2;
    edge.position.y = 0.35;
    scene.add(edge);
    this.edge = edge;
    // Where it's closing to: a white ring on the ground.
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 128), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.3;
    scene.add(wall, ring);
    this.wall = wall;
    this.ring = ring;
    // The High Roller party bus everyone rides in on.
    const bus = buildPartyBus();
    bus.scale.setScalar(BUS_SCALE);
    bus.rotation.y = -this.dropLine.a;
    scene.add(bus);
    this.bus = bus;
    this.busAt(0);
  }

  // Where along the drop line the bus is (0 to 1) at raid time t.
  busK(t = this.raid.raidTime - this.raid.timeLeft) { return t / BUS_TIME; }

  busAt(k) {
    const L = this.dropLine;
    this.bus.position.set(L.from.x + (L.to.x - L.from.x) * k, BUS_Y, L.from.z + (L.to.z - L.from.z) * k);
    this.bus.visible = k < 1.25;
  }

  // Everyone starts on the bus. You and your friends ride on the roof and jump when you like;
  // bots each pick a spot along the way to bail out.
  dropIn(c, i, n) {
    c.vel.set(0, 0, 0);
    c.gliding = false;
    c.onGround = false;
    c.riding = true;
    c.leaveBus = false;
    c.seat = c.isPlayer || c.human ? (i % 5) - 2 : 0;
    if (!c.isPlayer && !c.human) c.jumpAt = 0.06 + Math.pow(Math.random(), 0.9) * 0.86;
    if (!c.chute) {
      const chute = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: [0xff3fa4, 0xffd23f, 0x2ee6d6, 0xc77dff][i % 4], side: THREE.DoubleSide }));
      chute.position.y = 4.2;
      chute.scale.set(1.3, 0.8, 1.3);
      c.char.root.add(chute);
      c.chute = chute;
    }
    c.chute.visible = false;
    this.seatOn(c);
  }

  // Players stand on the roof (so you can see the island go by); bots ride inside.
  seatOn(c) {
    const b = this.bus.position;
    const L = this.dropLine;
    const dx = (L.to.x - L.from.x) / (L.from.distanceTo(L.to) || 1);
    const dz = (L.to.z - L.from.z) / (L.from.distanceTo(L.to) || 1);
    const roof = c.isPlayer || c.human;
    c.pos.set(b.x + dx * c.seat * 2.6, b.y + (roof ? 2.1 * BUS_SCALE : -1), b.z + dz * c.seat * 2.6);
    c.vel.set(0, 0, 0);
  }

  // Out the door: chute open, and bots head for a spot near where they jumped.
  jumpOut(c) {
    c.riding = false;
    c.leaveBus = false;
    c.gliding = true;
    c.onGround = false;
    const b = this.bus.position;
    c.pos.set(c.pos.x, b.y - 4, c.pos.z);
    c.vel.set(0, 0, 0);
    if (c.chute) c.chute.visible = true;
    if (!c.isPlayer && !c.human) {
      const half = this.raid.map.half * 0.78;
      const a = Math.random() * Math.PI * 2;
      const d = 30 + Math.random() * 190;
      c.glideTo = new THREE.Vector3(Math.max(-half, Math.min(half, c.pos.x + Math.cos(a) * d)), 0, Math.max(-half, Math.min(half, c.pos.z + Math.sin(a) * d)));
    }
    if (c.isPlayer && this.raid.hud) this.raid.hud.toast('🪂 Chute open! Steer with WASD.');
  }

  // Golf carts parked round the island: along the roads, and a few out in each part of it.
  buildCarts(rnd) {
    const raid = this.raid;
    const half = raid.map.half;
    this.carts = [];
    const spots = [];
    for (let i = 0; i < 8; i++) {
      const t = (rnd() * 2 - 1) * half * 0.7;
      spots.push(i % 2 ? [12, t] : [t, 12]);
    }
    for (let i = 0; i < 10; i++) {
      const a = rnd() * Math.PI * 2;
      const d = half * (0.3 + rnd() * 0.45);
      spots.push([Math.cos(a) * d, Math.sin(a) * d]);
    }
    for (const [x0, z0] of spots) {
      let x = x0;
      let z = z0;
      for (let k = 0; k < 12 && !raid.map.isFree(x, z, 2); k++) { x = x0 + (rnd() - 0.5) * 20; z = z0 + (rnd() - 0.5) * 20; }
      if (!raid.map.isFree(x, z, 2)) continue;
      const group = buildCart();
      group.position.set(x, 0, z);
      group.rotation.y = rnd() * Math.PI * 2;
      raid.scene.add(group);
      const cart = { group, driver: null };
      cart.spot = {
        spot: group.position, range: 3.4, searchTime: 0.3, searchLabel: 'Hopping in…',
        prompt: () => `<b>Hold ${keyName('use')}</b> 🛺 Drive the golf cart`,
        open: (by) => { if (by.isPlayer && !cart.driver && !by.cart) this.enterCart(by, cart); },
      };
      this.carts.push(cart);
    }
  }

  interactables() { return this.carts.filter((c) => !c.driver).map((c) => c.spot); }

  enterCart(c, cart) {
    cart.driver = c;
    c.cart = cart;
    cart.group.visible = false;
    c.pos.set(cart.group.position.x, c.pos.y, cart.group.position.z);
    c.yaw = cart.group.rotation.y;
    if (c.isPlayer) this.raid.hud.toast(`🛺 Vroom! ${keyName('use')} to hop out.`);
  }

  exitCart(c) {
    const cart = c.cart;
    if (!cart) return;
    c.cart = null;
    cart.driver = null;
    cart.group.position.set(c.pos.x, 0, c.pos.z);
    cart.group.rotation.y = c.yaw;
    cart.group.visible = true;
    // Step out to the side.
    const sx = Math.cos(c.yaw) * 2;
    const sz = -Math.sin(c.yaw) * 2;
    if (this.raid.map.isFree(c.pos.x + sx, c.pos.z + sz, 0.6)) { c.pos.x += sx; c.pos.z += sz; }
  }

  // Fighters still in it (you, friends, bots); downed counts as still in it.
  left() {
    if (this.raid.isClient && this.raid.royaleLeft) return this.raid.royaleLeft;
    return this.raid.combatants.filter((c) => c.alive && (c.isPlayer || c.human || c.brain)).length;
  }

  update(dt) {
    const raid = this.raid;
    const s = this.state();
    this.wall.scale.set(Math.max(0.5, s.r), 1, Math.max(0.5, s.r));
    // (Bigger than the map at the start: nothing to see yet.)
    this.wall.visible = s.r > 0.5;
    this.wall.position.x = s.x;
    this.wall.position.z = s.z;
    this.wallTex.offset.x = (this.wallTex.offset.x + dt * (s.closing ? 0.6 : 0.15)) % 1;
    this.edge.scale.set(Math.max(0.5, s.r), Math.max(0.5, s.r), 1);
    this.edge.position.x = s.x;
    this.edge.position.z = s.z;
    // Tell everyone when the circle's about to move, and when it starts closing.
    const key = `${s.phase}${s.closing ? 'c' : 'w'}${!s.closing && s.left < 20 ? 's' : ''}`;
    if (key !== this.lastKey && raid.player && raid.player.alive && s.phase <= 5) {
      if (this.lastKey !== undefined) {
        if (s.closing) raid.hud.toast(`🔴 The House Edge is closing in! Get inside the white ring (${Math.round(s.left)}s).`, 'big');
        else if (s.left < 20) raid.hud.toast(`⭕ The circle starts closing in ${Math.round(s.left)}s. Head for the white ring.`);
        else raid.hud.toast('⭕ The circle stopped. Next one marked in white on your map.');
      }
      this.lastKey = key;
    }
    this.ring.scale.set(Math.max(0.5, s.next.r), Math.max(0.5, s.next.r), 1);
    this.ring.position.x = s.next.x;
    this.ring.position.z = s.next.z;
    this.ring.visible = s.next.r < s.r - 1;
    // The bus crosses the island; riders go with it until they jump (or get thrown off at the end).
    const t = raid.raidTime - raid.timeLeft;
    const bk = this.busK(t);
    this.busAt(Math.min(1.3, bk));
    for (const c of raid.combatants) {
      if (!c.riding) continue;
      if (!c.alive) { c.riding = false; continue; }
      const go = bk >= 0.97 || (c.isPlayer ? c.leaveBus && bk > 0.02 : bk >= c.jumpAt);
      if (go) this.jumpOut(c);
      else this.seatOn(c);
    }
    // Whoever's driving rides in a cart (friends' too, from what they tell us).
    for (const c of raid.combatants) {
      if (c.cart && (!c.alive || c.downed)) this.exitCart(c);
      const on = !!(c.cart || c.netCart);
      if (on && !c.cartMesh) { c.cartMesh = buildCart(c.isPlayer); c.cartMesh.position.y = 0; c.char.root.add(c.cartMesh); }
      if (c.cartMesh) c.cartMesh.visible = on;
    }
    // Chutes away once people land.
    for (const c of raid.combatants) if (c.chute && !c.gliding) c.chute.visible = false;
    // The House Edge hurts: you in every game, bots (and anything else) only where they're run.
    this.hurtT -= dt;
    if (this.hurtT <= 0) {
      this.hurtT = 1;
      for (const c of raid.combatants) {
        if (!c.alive || c.gliding || c.riding) continue;
        if (!c.isPlayer && (raid.isClient || c.human)) continue;
        if (!this.outside(c.pos, s)) continue;
        raid.damage(c, s.dmg, null, c.center(new THREE.Vector3()), false, true);
        if (c.isPlayer) raid.hud.hurtFlash && raid.hud.hurtFlash();
      }
    }
    if (this.over || raid.isClient) return;
    // Last one (or one team) standing.
    const alive = raid.combatants.filter((c) => c.alive && (c.isPlayer || c.human || c.brain));
    const people = alive.filter((c) => c.isPlayer || c.human);
    if (alive.length && alive.length === people.length && raid.player && raid.player.alive && t > 5) {
      this.over = true;
      raid.royaleWin();
    }
  }

  dispose() {
    for (const o of [this.wall, this.ring, this.edge, this.bus]) if (o) this.raid.scene.remove(o);
    for (const cart of this.carts || []) this.raid.scene.remove(cart.group);
    for (const c of this.raid.combatants) { if (c.cartMesh) { c.char.root.remove(c.cartMesh); c.cartMesh = null; } c.cart = null; }
  }
}
