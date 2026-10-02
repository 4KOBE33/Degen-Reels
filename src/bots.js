// Raider bots: other "players" looting Lost Vegas. They fight machines, grab loot, and leave
// through an exit eventually. Most leave you alone unless you shoot them or get in their face.
import * as THREE from 'three';
import { WEAPONS, RAIDERS, PLAYER } from './config.js';

const RESCUE_LINES = ['Hang on, I got you!', "Don't bleed on my shoes.", 'Coming! Stay down!', 'You owe me one.', 'Nobody gets left in Lost Vegas.'];
const REVIVED_LINES = ['Up you get, high roller.', "The House isn't done with you yet.", 'Try not to do that again.', 'Back in the game!', 'That one was free.'];
const FINISH_LINES = ['Nothing personal.', 'House rules.', 'Should have stayed home.', 'Your loot looks better on me.'];
const say = (raid, c, lines) => raid.feed(`💬 ${c.name}: "${lines[Math.floor(Math.random() * lines.length)]}"`);

function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class RaiderBrain {
  constructor(raid, c) {
    this.raid = raid;
    this.c = c;
    c.brain = this;
    this.hostile = Math.random() < RAIDERS.hostileChance;
    this.target = null;
    this.goal = null;
    this.loot = null;
    this.los = false;
    this.strafe = 1;
    this.thinkIn = Math.random();
    this.reaction = 0;
    this.stuckFor = 0;
    this.leaveAt = 240 + Math.random() * 480;
    this.age = 0;
    this.atExit = 0;
  }

  // Down: crawl away from whoever did it, and maybe use a Second Chance Token.
  crawl(dt) {
    const { c, raid } = this;
    this.rescue = null;
    this.target = null;
    const from = c.lastAttacker && c.lastAttacker.pos ? c.lastAttacker.pos : null;
    if (from) {
      const dx = c.pos.x - from.x;
      const dz = c.pos.z - from.z;
      const d = Math.hypot(dx, dz) || 1;
      c.move.set(dx / d, dz / d);
      c.yaw += angleDiff(c.yaw, Math.atan2(-dx, -dz)) * Math.min(1, dt * 3);
    }
    if (c.count('token') && c.bleed < PLAYER.bleedTime - 3) {
      this.selfRez = (this.selfRez || 0) + dt;
      if (this.selfRez > PLAYER.selfReviveTime && c.takeOne('token')) { this.selfRez = 0; raid.revive(c, c); }
    }
  }

  canSee(a) {
    const from = this.c.head(new THREE.Vector3());
    const to = a.center(new THREE.Vector3());
    const d = from.distanceTo(to);
    return !this.raid.raycast(from, to.sub(from).normalize(), d, this.c, { solidsOnly: true }).hit;
  }

  think() {
    const { c, raid } = this;
    if (Math.random() < 0.3) this.strafe *= -1;

    // Patch up when hurt.
    if (c.hp < 45 && !c.using && c.count('bandage')) c.startUsing('bandage');

    // Who's worth shooting? Machines always; you only if they're hostile or you hit them.
    let best = null;
    let bestD = 24;
    for (const a of raid.actors) {
      if (!a.alive || a === c) continue;
      if (a === this.friend) continue;
      // Someone's down: friendly raiders don't shoot them, hostile ones finish the job.
      if (a.downed && !(a.isPlayer && this.hostile)) continue;
      const enemy = a.team === 'machine' || (a.isPlayer && (this.hostile || c.lastAttacker === a)) || a === c.lastAttacker;
      if (!enemy) continue;
      const d = a.pos.distanceTo(c.pos);
      if (d < bestD) { bestD = d; best = a; }
    }
    if (best && best !== this.target) {
      this.reaction = RAIDERS.reaction + Math.random() * 0.6;
      if (best.downed && best.isPlayer) say(raid, c, FINISH_LINES);
    }
    // Friendly raiders come pick up anyone who's down (you included), once the shooting stops.
    if (!this.rescue && !this.hostile) {
      for (const a of raid.combatants) {
        if (a === c || !a.alive || !a.downed) continue;
        if (a.isPlayer && c.lastAttacker === a) continue;
        const d = a.pos.distanceTo(c.pos);
        if (d < 45 && (d < 15 || this.canSee(a))) { this.rescue = a; this.reviveT = 0; say(raid, c, RESCUE_LINES); break; }
      }
    }
    if (this.rescue && (!this.rescue.alive || !this.rescue.downed)) this.rescue = null;
    this.target = best;
    this.los = best ? this.canSee(best) : false;

    // Loot lying around nearby.
    this.loot = null;
    if (!best || bestD > 14) {
      let lootD = 14;
      for (const p of raid.pickups) {
        const d = p.spot.distanceTo(c.pos);
        if (d < lootD && c.backpack.length < c.capacity) { lootD = d; this.loot = p; }
      }
    }

    // Someone called a ride nearby? Friendly raiders who are done looting hitch along.
    const called = raid.extracts.find((e) => e.call && Math.hypot(e.x - c.pos.x, e.z - c.pos.z) < 70);
    if (called && !this.hostile && this.age > this.leaveAt * 0.6) this.leaveAt = Math.min(this.leaveAt, this.age);
    // Time to go home?
    if (this.age > this.leaveAt) {
      let exitD = Infinity;
      for (const e of raid.extracts) {
        if (!e.active) continue;
        const d = Math.hypot(e.x - c.pos.x, e.z - c.pos.z);
        if (d < exitD) { exitD = d; this.goal = new THREE.Vector3(e.x, 0, e.z); }
      }
    } else if (!this.goal || this.goal.distanceTo(c.pos) < 3 || Math.random() < 0.02) {
      // Wander toward something interesting.
      const k = raid.containers[Math.floor(Math.random() * raid.containers.length)];
      this.goal = k.spot.clone();
    }
  }

  update(dt) {
    const { c, raid } = this;
    c.move.set(0, 0);
    c.sprint = false;
    if (!c.alive) return;
    if (c.stunned > 0) return;
    if (c.downed) { this.crawl(dt); return; }
    // Far from the player, raiders just drift toward their goal without thinking hard.
    this.age += dt;
    this.thinkIn -= dt;
    if (this.thinkIn <= 0) {
      this.thinkIn = 0.45 + Math.random() * 0.3;
      this.think();
    }

    let goal = null;
    const t = this.target;
    if (t && t.alive) {
      const w = WEAPONS[c.weapon];
      const dx = t.pos.x - c.pos.x;
      const dz = t.pos.z - c.pos.z;
      const d = Math.hypot(dx, dz) || 0.01;
      const wantYaw = Math.atan2(-dx, -dz);
      c.yaw += angleDiff(c.yaw, wantYaw) * Math.min(1, dt * 4);
      const ty = t.center(new THREE.Vector3()).y;
      c.pitch = Math.atan2(ty - (c.pos.y + 1.45), d);
      const ideal = w.melee ? 1.2 : c.weapon === 'shotgun' ? 6 : 12;
      let mx = 0;
      let mz = 0;
      if (d > ideal + 2 || !this.los) { mx += dx / d; mz += dz / d; } else if (d < ideal - 3 && !w.melee) { mx -= dx / d; mz -= dz / d; }
      if (this.los && !w.melee) { mx += (-dz / d) * this.strafe * 0.7; mz += (dx / d) * this.strafe * 0.7; }
      const len = Math.hypot(mx, mz);
      if (len > 0) c.move.set(mx / len, mz / len);

      this.reaction -= dt;
      const aimed = Math.abs(angleDiff(c.yaw, wantYaw)) < 0.25;
      const range = w.melee ? w.range + 0.5 : w.range || 60;
      if (this.los && aimed && d < range && this.reaction <= 0) {
        const origin = c.head(new THREE.Vector3());
        const aim = t.center(new THREE.Vector3());
        const err = RAIDERS.accuracy * (0.5 + d / 25);
        aim.x += (Math.random() - 0.5) * err * d;
        aim.y += (Math.random() - 0.5) * err * d * 0.6;
        aim.z += (Math.random() - 0.5) * err * d;
        raid.fire(c, origin, aim.sub(origin).normalize());
        // Bots pause between taps so they aren't laser beams.
        if (c.weapon !== 'smg') this.reaction = 0.25 + Math.random() * 0.5;
      }
      // Now and then, lob a Cherry Bomb at someone in the open.
      if (this.los && d > 8 && d < 24 && c.currentThrowable() && Math.random() < dt * 0.12) {
        const from = c.head(new THREE.Vector3());
        c.throwGrenade(from, raid.aimGrenade(from, t.pos));
      }
      if (Number.isFinite(c.ammo) && c.ammo <= 0) {
        if (c.reload()) c.switchTo(c.active ? 0 : 1);
      }
    } else if (this.rescue) {
      // Kneel by them and hold the use key.
      const r = this.rescue;
      const d = Math.hypot(r.pos.x - c.pos.x, r.pos.z - c.pos.z);
      if (d > 1.6) { goal = r.pos; this.reviveT = 0; } else {
        this.reviveT += dt;
        c.yaw += angleDiff(c.yaw, Math.atan2(-(r.pos.x - c.pos.x), -(r.pos.z - c.pos.z))) * Math.min(1, dt * 6);
        if (this.reviveT >= PLAYER.reviveTime) {
          raid.revive(r, c);
          say(raid, c, REVIVED_LINES);
          this.rescue = null;
        }
      }
    } else if (this.loot && raid.pickups.includes(this.loot)) {
      goal = this.loot.spot;
      if (goal.distanceTo(c.pos) < 1.4) {
        raid.takeItem(c, this.loot);
        this.loot = null;
      }
    } else if (this.goal) {
      goal = this.goal;
    }

    if (goal) {
      const dx = goal.x - c.pos.x;
      const dz = goal.z - c.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.5) c.move.set(dx / d, dz / d);
      c.yaw += angleDiff(c.yaw, Math.atan2(-dx, -dz)) * Math.min(1, dt * 6);
      c.pitch *= 0.9;
      c.sprint = d > 25;
    }

    // Leaving: wait in the circle (the raid handles calling the ride and taking off).
    if (this.age > this.leaveAt) {
      const at = raid.extracts.find((e) => e.active && Math.hypot(e.x - c.pos.x, e.z - c.pos.z) < 4.5);
      if (at && !this.target) c.move.set(0, 0);
    }

    // Hop over things if stuck.
    const trying = c.move.lengthSq() > 0.1;
    const moving = Math.hypot(c.vel.x, c.vel.z) > 1.2;
    this.stuckFor = trying && !moving ? this.stuckFor + dt : 0;
    if (this.stuckFor > 0.5) {
      c.wantJump = true;
      c.move.set(-c.move.y * this.strafe, c.move.x * this.strafe);
      if (this.stuckFor > 2) { this.stuckFor = 0; this.goal = null; }
    }
  }
}
