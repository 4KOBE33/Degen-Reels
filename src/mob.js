// Borrowing from the Mob. Broke? Ask in the Back Room and they spot you anywhere from 25 to 5,000
// chips. Pay them back, with interest, before your next raid. If you go in still owing them,
// a black van shows up a few seconds into the raid and you're not coming back from that one.
import * as THREE from 'three';
import { part } from './toon.js';
import { save } from './save.js';
import { Combatant } from './combatant.js';
import { randomLook } from './looks.js';
import { sfx } from './audio.js';

// How much they hand over is up to them: anywhere from 25 to 5,000 chips, small loans more often
// than big ones. The bigger the loan, the worse the interest.
export const MOB_MIN = 25;
export const MOB_MAX = 5000;
export function loanAmount() {
  const raw = MOB_MIN * (MOB_MAX / MOB_MIN) ** Math.random();
  const step = raw >= 1000 ? 100 : raw >= 200 ? 25 : 5;
  return Math.min(MOB_MAX, Math.max(MOB_MIN, Math.round(raw / step) * step));
}
// Interest: 50% on the smallest loan, climbing to 150% on the biggest (5,000 back as 12,500).
export const interestFor = (lent) => 0.5 + ((lent - MOB_MIN) / (MOB_MAX - MOB_MIN));
export const oweFor = (lent) => Math.ceil((lent * (1 + interestFor(lent))) / 5) * 5;

export const mobDebt = () => (save.get().mobDebt ? save.get().mobDebt.owe : 0);

export function borrow() {
  const lent = loanAmount();
  const owe = oweFor(lent);
  save.update((d) => { d.stash.chips += lent; d.mobDebt = { lent, owe, at: Date.now() }; });
  return { lent, owe };
}

// Pay them back. Returns false if you can't cover it.
export function repay() {
  const owe = mobDebt();
  if (!owe || save.get().stash.chips < owe) return false;
  save.update((d) => { d.stash.chips -= owe; delete d.mobDebt; });
  return true;
}

const VAN_AT = 6; // seconds into the raid before the van comes
const DRIVE = 2.4;
const GRAB = 3.2; // after the van stops

// In a raid while you owe them: the van, the goons, and the end of your raid.
export class Kidnap {
  constructor(raid) {
    this.raid = raid;
    this.t = 0;
    this.phase = 'wait';
  }

  // A black van, built where it can drive straight at you.
  buildVan() {
    const g = new THREE.Group();
    const body = part(new THREE.BoxGeometry(2.2, 2.0, 4.6), 0x16121c);
    body.position.y = 1.35;
    const cab = part(new THREE.BoxGeometry(2.1, 1.1, 1.2), 0x16121c);
    cab.position.set(0, 0.95, -2.75);
    const glass = part(new THREE.BoxGeometry(1.9, 0.6, 0.06), 0x1d2a3a, { ink: 0.01 });
    glass.position.set(0, 1.6, -2.32);
    glass.rotation.x = 0.35;
    const stripe = part(new THREE.BoxGeometry(2.24, 0.12, 4.62), 0xd4a63a, { ink: 0 });
    stripe.position.y = 1.0;
    g.add(body, cab, glass, stripe);
    for (const [x, z] of [[-1.05, -2.6], [1.05, -2.6], [-1.05, 1.5], [1.05, 1.5]]) {
      const w = part(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 14), 0x0a0a0a, { ink: 0.01 });
      w.rotation.z = Math.PI / 2;
      w.position.set(x, 0.42, z);
      g.add(w);
    }
    const lights = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.18, 0.05), new THREE.MeshBasicMaterial({ color: 0xfff1b8 }));
    lights.position.set(0, 0.95, -3.36);
    g.add(lights);
    return g;
  }

  start() {
    const raid = this.raid;
    const p = raid.player;
    // Pick a direction with a clear run-up.
    let dir = null;
    for (let i = 0; i < 16 && !dir; i++) {
      const a = (i / 16) * Math.PI * 2;
      const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      let ok = true;
      for (let s = 4; s <= 26 && ok; s += 2) ok = raid.map.isFree(p.pos.x + d.x * s, p.pos.z + d.z * s, 1.6);
      if (ok) dir = d;
    }
    this.dir = dir || new THREE.Vector3(1, 0, 0);
    this.van = this.buildVan();
    raid.scene.add(this.van);
    this.drive = { t: 0, far: dir ? 26 : 4 };
    this.phase = 'drive';
    raid.hud.toast('🤌 You still owe the Mob. A black van is pulling up…', 'big');
    raid.feed('🚐 A black van screeches into the raid');
    sfx.siren(0.6);
  }

  update(dt) {
    const raid = this.raid;
    const p = raid.player;
    if (!raid.active || !p || !p.alive) return;
    this.t += dt;
    if (this.phase === 'wait') { if (this.t >= VAN_AT) this.start(); return; }
    if (this.phase === 'drive') {
      this.drive.t += dt;
      const k = Math.min(1, this.drive.t / DRIVE);
      const ease = 1 - (1 - k) ** 3;
      const dist = 4 + (this.drive.far - 4) * (1 - ease);
      this.van.position.set(p.pos.x + this.dir.x * dist, p.pos.y || 0, p.pos.z + this.dir.z * dist);
      // Nose toward you.
      this.van.rotation.y = Math.atan2(this.dir.x, this.dir.z);
      if (k >= 1) this.grab();
      return;
    }
    if (this.phase === 'grab') {
      this.grabT += dt;
      // The goons close in.
      for (const g of this.goons) {
        const to = p.pos.clone().sub(g.pos);
        to.y = 0;
        if (to.length() > 1.3) g.pos.addScaledVector(to.normalize(), dt * 3.2);
        g.yaw = Math.atan2(-(p.pos.x - g.pos.x), -(p.pos.z - g.pos.z));
      }
      p.move.set(0, 0);
      if (this.grabT >= GRAB) this.done();
    }
  }

  grab() {
    const raid = this.raid;
    const p = raid.player;
    this.phase = 'grab';
    this.grabT = 0;
    this.goons = [0, 1, 2].map((i) => {
      const c = new Combatant(raid, { name: '🤌 Mob Goon', look: { ...randomLook(), color: 0x1b1b24, hat: i ? 'top' : 'cowboy' } });
      const a = Math.atan2(this.dir.z, this.dir.x) + (i - 1) * 0.6;
      c.pos.set(p.pos.x + Math.cos(a) * 3.2, p.pos.y || 0, p.pos.z + Math.sin(a) * 3.2);
      c.goon = true;
      c.hp = 9999;
      c.maxHp = 9999;
      raid.combatants.push(c);
      return c;
    });
    raid.hud.toast('🤌 "The boss wants a word." Nowhere to run.', 'big');
    sfx.alert();
    document.body.classList.add('kidnapfade');
  }

  done() {
    const raid = this.raid;
    // You're square with them now: they took everything you had on you.
    save.update((d) => { delete d.mobDebt; d.stats.kidnapped = (d.stats.kidnapped || 0) + 1; });
    raid.fail('kidnapped');
    this.cleanup();
  }

  cleanup() {
    const raid = this.raid;
    document.body.classList.remove('kidnapfade');
    if (this.van) raid.scene.remove(this.van);
    for (const g of this.goons || []) { g.alive = false; g.char.root.visible = false; raid.combatants = raid.combatants.filter((c) => c !== g); raid.scene.remove(g.char.root); }
    this.goons = [];
  }
}
