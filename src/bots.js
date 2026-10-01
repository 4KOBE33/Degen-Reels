// Bot brains: gamble when they're unarmed, grab loose chips, and pick fights.
import * as THREE from 'three';
import { WEAPONS, MACHINES } from './config.js';

const tmp = new THREE.Vector3();

function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class BotBrain {
  constructor(game, c) {
    this.game = game;
    this.c = c;
    this.skill = 0.55 + Math.random() * 0.4;
    this.mode = 'wander';
    this.target = null;
    this.machine = null;
    this.loot = null;
    this.wanderTo = null;
    this.los = false;
    this.strafe = 1;
    this.thinkIn = 0;
    this.stuckFor = 0;
    this.reaction = 0;
  }

  think() {
    const { c, game } = this;
    if (Math.random() < 0.3) this.strafe *= -1;

    // Unarmed (or stuck with a spoon) and can afford it: go gamble.
    const wantsGun = c.weapon === 'fists' || (c.weapon === 'spoon' && Math.random() < 0.15);
    if (wantsGun && c.chips > MACHINES[0].cost + 15) {
      const budget = c.chips > 130 ? 2 : c.chips > 70 ? 1 : 0;
      let best = null;
      let bestScore = Infinity;
      for (const m of game.machines) {
        if (m.busy || MACHINES.indexOf(m.tier) > budget) continue;
        const score = Math.hypot(m.useSpot.x - c.pos.x, m.useSpot.z - c.pos.z) - MACHINES.indexOf(m.tier) * 6;
        if (score < bestScore) { bestScore = score; best = m; }
      }
      if (best) {
        this.mode = 'slots';
        this.machine = best;
        return;
      }
    }

    // Pick a target: whoever hit us last if they're close, otherwise the nearest.
    let target = null;
    let bestD = 32;
    for (const o of game.combatants) {
      if (o === c || !o.alive) continue;
      let d = Math.hypot(o.pos.x - c.pos.x, o.pos.z - c.pos.z);
      if (o === c.lastAttacker) d *= 0.6;
      if (d < bestD) { bestD = d; target = o; }
    }

    // Loose chips nearby are worth a detour if nobody's breathing down our neck.
    let loot = null;
    let lootD = 8;
    for (const chip of game.chips.list) {
      if (chip.owner === c && chip.age < chip.lockUntil) continue;
      const d = Math.hypot(chip.mesh.position.x - c.pos.x, chip.mesh.position.z - c.pos.z);
      if (d < lootD) { lootD = d; loot = chip; }
    }
    if (loot && (!target || bestD > 7)) {
      this.mode = 'loot';
      this.loot = loot;
      return;
    }

    if (target) {
      if (target !== this.target) this.reaction = 0.35 + (1 - this.skill) * 0.4;
      this.mode = 'fight';
      this.target = target;
      const from = c.head(new THREE.Vector3());
      const to = target.pos.clone().setY(target.pos.y + 0.9);
      const dist = from.distanceTo(to);
      this.los = !game.raycast(from, to.sub(from).normalize(), dist, c, { solidsOnly: true }).hit;
      return;
    }

    this.mode = 'wander';
    if (!this.wanderTo || Math.random() < 0.3) {
      const [x, z] = game.world.spawnPoints[Math.floor(Math.random() * game.world.spawnPoints.length)];
      this.wanderTo = new THREE.Vector3(x, 0, z);
    }
  }

  update(dt) {
    const { c, game } = this;
    c.move.set(0, 0);
    c.sprint = false;
    if (!c.alive || c.busy || game.intermission) return;

    this.thinkIn -= dt;
    if (this.thinkIn <= 0) {
      this.thinkIn = 0.35 + Math.random() * 0.35;
      this.think();
    }

    let goal = null;
    let faceMove = true;

    if (this.mode === 'slots' && this.machine) {
      goal = this.machine.useSpot;
      if (Math.hypot(goal.x - c.pos.x, goal.z - c.pos.z) < 0.7) {
        if (!this.machine.busy) this.machine.pull(c);
        this.mode = 'wander';
        this.machine = null;
        return;
      }
      c.sprint = true;
    } else if (this.mode === 'loot' && this.loot && game.chips.list.includes(this.loot)) {
      goal = this.loot.mesh.position;
    } else if (this.mode === 'fight' && this.target && this.target.alive) {
      const t = this.target;
      const w = WEAPONS[c.weapon];
      const dx = t.pos.x - c.pos.x;
      const dz = t.pos.z - c.pos.z;
      const d = Math.hypot(dx, dz) || 0.001;
      const ideal = w.melee ? 1.0 : c.weapon === 'shotgun' ? 5 : w.projectile ? 12 : 9;

      // Turn toward the target, with skill-based lag.
      const wantYaw = Math.atan2(-dx, -dz);
      c.yaw += angleDiff(c.yaw, wantYaw) * Math.min(1, dt * (3 + this.skill * 6));
      c.pitch = Math.atan2(t.pos.y + 0.9 - (c.pos.y + 1.45), d);
      faceMove = false;

      let mx = 0;
      let mz = 0;
      if (d > ideal + 1.5 || !this.los) { mx += dx / d; mz += dz / d; }
      else if (d < ideal - 2 && !w.melee) { mx -= dx / d; mz -= dz / d; }
      if (!w.melee && this.los) { mx += (-dz / d) * this.strafe * 0.8; mz += (dx / d) * this.strafe * 0.8; }
      const len = Math.hypot(mx, mz);
      if (len > 0) c.move.set(mx / len, mz / len);
      c.sprint = d > 14;
      if (Math.random() < dt * 0.4) c.wantJump = true;

      this.reaction -= dt;
      const range = w.melee ? w.range + 0.4 : w.range || 60;
      const aimed = Math.abs(angleDiff(c.yaw, wantYaw)) < 0.2;
      if (this.los && aimed && d < range && this.reaction <= 0) {
        const origin = c.head(new THREE.Vector3());
        const aimAt = t.pos.clone().setY(t.pos.y + 0.9);
        const err = (1 - this.skill) * 0.12 + 0.02;
        aimAt.x += (Math.random() - 0.5) * err * d;
        aimAt.y += (Math.random() - 0.5) * err * d;
        aimAt.z += (Math.random() - 0.5) * err * d;
        game.fire(c, origin, aimAt.sub(origin).normalize());
      }
    } else if (this.wanderTo) {
      goal = this.wanderTo;
      if (Math.hypot(goal.x - c.pos.x, goal.z - c.pos.z) < 1.5) this.wanderTo = null;
    }

    if (goal) {
      const dx = goal.x - c.pos.x;
      const dz = goal.z - c.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.2) c.move.set(dx / d, dz / d);
    }
    if (faceMove && c.move.lengthSq() > 0) {
      c.yaw += angleDiff(c.yaw, Math.atan2(-c.move.x, -c.move.y)) * Math.min(1, dt * 8);
      c.pitch *= 0.9;
    }

    // Hop over things if we're trying to move but not getting anywhere.
    const trying = c.move.lengthSq() > 0.1;
    const moving = Math.hypot(c.vel.x, c.vel.z) > 1.5;
    this.stuckFor = trying && !moving ? this.stuckFor + dt : 0;
    if (this.stuckFor > 0.4) {
      c.wantJump = true;
      this.strafe *= -1;
      tmp.set(-c.move.y, 0, c.move.x).multiplyScalar(this.strafe);
      c.move.set(tmp.x, tmp.z);
      if (this.stuckFor > 1.5) { this.stuckFor = 0; this.wanderTo = null; this.mode = 'wander'; this.thinkIn = 0.8; }
    }
  }
}
