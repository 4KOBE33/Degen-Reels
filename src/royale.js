// Royale: everyone drops in with a pea shooter, the House Edge closes in, last one standing wins.
// About two dozen fighters (you, your party, and bots to fill), ten minutes at most.
//
// The circle is worked out from the raid's seed and the raid clock alone, so every player in a
// party sees the same circle without anything extra on the wire.
import * as THREE from 'three';
import { buildPartyBus } from './lobby.js';

export const ROYALE_SIZE = 24;
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
  { wait: 25, shrink: 30, r: 0.0, dmg: 16 },
];
export const ROYALE_TIME = PHASES.reduce((n, p) => n + p.wait + p.shrink, 0) + 60;

// Chips (and XP) by where you finish.
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
    const circles = [{ x: 0, z: 0, r: half * 1.3 }];
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
    return { ...last, next: last, phase: PHASES.length, closing: false, left: 0, dmg: PHASES[PHASES.length - 1].dmg + 6 };
  }

  outside(pos, s = this.state()) { return Math.hypot(pos.x - s.x, pos.z - s.z) > s.r; }

  buildVisuals() {
    const scene = this.raid.scene;
    // The wall of the circle: a tall see-through cylinder, scaled to the radius every frame.
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 120, 96, 1, true), new THREE.MeshBasicMaterial({ color: 0xff3fa4, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
    wall.position.y = 55;
    wall.renderOrder = 3;
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
    this.wall.visible = s.r < raid.map.half * 1.05;
    this.wall.position.x = s.x;
    this.wall.position.z = s.z;
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
    for (const o of [this.wall, this.ring, this.bus]) if (o) this.raid.scene.remove(o);
  }
}
