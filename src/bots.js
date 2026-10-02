// Raider bots: other "players" in the raid. They path around walls, search containers, grab loot,
// fight machines and leave on an extraction. Most leave you alone unless you shoot them, but every
// one of them can actually play: they strafe, jump, track you, go for headshots, switch guns for
// the range, back off to heal, and throw things.
import * as THREE from 'three';
import { WEAPONS, RAIDERS, PLAYER } from './config.js';

const RESCUE_LINES = ['Hang on, I got you!', "Don't bleed on my shoes.", 'Coming! Stay down!', 'You owe me one.', 'Nobody gets left in Lost Vegas.'];
const REVIVED_LINES = ['Up you get, high roller.', "The House isn't done with you yet.", 'Try not to do that again.', 'Back in the game!', 'That one was free.'];
const FINISH_LINES = ['Nothing personal.', 'House rules.', 'Should have stayed home.', 'Your loot looks better on me.'];
const say = (raid, c, lines) => raid.feed(`💬 ${c.name}: "${lines[Math.floor(Math.random() * lines.length)]}"`);

// Where each gun wants to fight from.
const IDEAL_RANGE = { fists: 1.2, spoon: 1.4, shotgun: 6, smg: 10, pistol: 15, rocket: 22, rifle: 30 };

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
    // How good this one is: aim, reactions, movement. Some are cracked.
    this.skill = 0.55 + Math.random() * 0.45;
    this.target = null;
    this.goal = null;
    this.goalKind = null;
    this.loot = null;
    this.los = false;
    this.lastSeen = null;
    this.strafe = 1;
    this.strafeIn = 0;
    this.thinkIn = Math.random();
    this.reaction = 0;
    this.stuckFor = 0;
    this.leaveAt = 240 + Math.random() * 480;
    this.age = 0;
    this.path = null;
    this.pathTo = null;
    this.pathAge = 0;
    this.searchT = 0;
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

  // ---------- getting around ----------

  // Walk toward `to` along a path around walls. Returns the distance left.
  steer(to, dt, sprint = null) {
    const { c, raid } = this;
    const d = Math.hypot(to.x - c.pos.x, to.z - c.pos.z);
    this.pathAge += dt;
    const stale = !this.path || !this.pathTo || this.pathTo.distanceTo(to) > 3 || this.pathAge > 4;
    if (stale && raid.nav) {
      this.path = raid.nav.find(c.pos, to) || [to.clone()];
      this.pathTo = to.clone();
      this.pathAge = 0;
    }
    let wp = this.path && this.path[0];
    while (wp && this.path.length > 1 && Math.hypot(wp.x - c.pos.x, wp.z - c.pos.z) < 1.3) {
      this.path.shift();
      wp = this.path[0];
    }
    wp = wp || to;
    const dx = wp.x - c.pos.x;
    const dz = wp.z - c.pos.z;
    const wd = Math.hypot(dx, dz);
    if (wd > 0.4) c.move.set(dx / wd, dz / wd);
    c.sprint = sprint === null ? d > 12 : sprint;
    return d;
  }

  faceMove(dt) {
    const { c } = this;
    if (c.move.lengthSq() < 0.01) return;
    c.yaw += angleDiff(c.yaw, Math.atan2(-c.move.x, -c.move.y)) * Math.min(1, dt * 7);
    c.pitch *= 0.9;
  }

  // The nearest unsearched container, so they don't walk across the whole map for one crate.
  pickContainer() {
    const { c, raid } = this;
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < 14; i++) {
      const k = raid.containers[Math.floor(Math.random() * raid.containers.length)];
      if (!k || k.opened || k.claimedBy) continue;
      const d = k.spot.distanceTo(c.pos);
      if (d < bestD) { bestD = d; best = k; }
    }
    return best;
  }

  // ---------- deciding what to do ----------

  think() {
    const { c, raid } = this;

    // Who's worth shooting? Machines always; you only if they're hostile or you hit them.
    let best = null;
    let bestScore = Infinity;
    for (const a of raid.actors) {
      if (!a.alive || a === c || a === this.friend) continue;
      // Someone's down: friendly raiders don't shoot them, hostile ones finish the job.
      if (a.downed && !(a.isPlayer && this.hostile)) continue;
      // Give you a few seconds after dropping in before anyone comes for you.
      if (a.isPlayer && raid.elapsed < 12 && c.lastAttacker !== a) continue;
      const enemy = a.team === 'machine' || (a.isPlayer && (this.hostile || c.lastAttacker === a)) || a === c.lastAttacker;
      if (!enemy) continue;
      const d = a.pos.distanceTo(c.pos);
      if (d > (a === c.lastAttacker ? 60 : 36)) continue;
      // Whoever's shooting at me first, then the closest.
      const score = d - (a === c.lastAttacker ? 25 : 0) - (a.isPlayer && this.hostile ? 8 : 0);
      if (score < bestScore) { bestScore = score; best = a; }
    }
    if (best && best !== this.target) {
      this.reaction = (0.55 - this.skill * 0.35) + Math.random() * 0.25;
      if (best.downed && best.isPlayer) say(raid, c, FINISH_LINES);
    }
    this.target = best;
    this.los = best ? this.canSee(best) : false;
    if (best && this.los) this.lastSeen = best.pos.clone();

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

    // Loot lying around nearby.
    this.loot = null;
    if (!best || (!this.los && c.pos.distanceTo(best.pos) > 18)) {
      let lootD = 18;
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
        if (d < exitD) { exitD = d; this.goal = new THREE.Vector3(e.x, 0, e.z); this.goalKind = 'exit'; }
      }
    } else if (!this.goal || (this.goalKind === 'container' && (!this.goalContainer || this.goalContainer.opened))) {
      // Go search the nearest crate nobody else is on.
      if (this.goalContainer) this.goalContainer.claimedBy = null;
      const k = this.pickContainer();
      if (k) {
        k.claimedBy = c;
        this.goalContainer = k;
        this.goal = k.spot.clone();
        this.goalKind = 'container';
      } else {
        this.goal = c.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 60, 0, (Math.random() - 0.5) * 60));
        this.goalKind = 'wander';
      }
    }
  }

  update(dt) {
    const { c, raid } = this;
    c.move.set(0, 0);
    c.sprint = false;
    if (!c.alive) return;
    if (c.stunned > 0) return;
    if (c.downed) { this.crawl(dt); return; }
    this.age += dt;
    this.thinkIn -= dt;
    if (this.thinkIn <= 0) {
      this.thinkIn = 0.3 + Math.random() * 0.25;
      this.think();
    }

    const t = this.target;
    if (t && t.alive) this.fight(t, dt);
    else if (this.rescue) this.doRescue(dt);
    else if (this.loot && raid.pickups.includes(this.loot)) {
      if (this.steer(this.loot.spot, dt) < 1.4) {
        raid.takeItem(c, this.loot);
        this.loot = null;
      }
      this.faceMove(dt);
    } else if (this.goal) {
      // Patch up between fights.
      if (c.hp < c.maxHp * 0.7 && !c.using && (c.count('bandage') || c.count('soda'))) c.startUsing(c.count('bandage') ? 'bandage' : 'soda');
      if (c.armor < 40 && !c.using && c.count('plate')) c.startUsing('plate');
      const d = this.steer(this.goal, dt);
      this.faceMove(dt);
      if (this.goalKind === 'container' && d < 1.8) {
        // Search it like a player would.
        c.move.set(0, 0);
        this.searchT += dt;
        const k = this.goalContainer;
        if (k && !k.opened && this.searchT >= (k.searchTime || 2)) { k.open(c); this.searchT = 0; }
        if (!k || k.opened) { this.goal = null; this.searchT = 0; }
      } else if (this.goalKind === 'exit' && d < 4) c.move.set(0, 0);
      else if (this.goalKind === 'wander' && d < 2) this.goal = null;
      else this.searchT = 0;
    }

    this.unstick(dt);
  }

  // ---------- fighting ----------

  fight(t, dt) {
    const { c, raid } = this;
    const dx = t.pos.x - c.pos.x;
    const dz = t.pos.z - c.pos.z;
    const d = Math.hypot(dx, dz) || 0.01;

    // Pick the right gun for the range (if it has ammo).
    this.swapIn = (this.swapIn || 0) - dt;
    if (this.swapIn <= 0 && !c.using) {
      this.swapIn = 1;
      const score = (g) => {
        if (!g || (Number.isFinite(g.ammo) && g.ammo <= 0)) return -99;
        const ideal = IDEAL_RANGE[g.kind] || 12;
        return -Math.abs(Math.log((d + 2) / (ideal + 2))) + g.rarity * 0.15;
      };
      const want = score(c.weapons[0]) >= score(c.weapons[1]) ? 0 : 1;
      if (want !== c.active && c.weapons[want]) c.switchTo(want);
    }
    const w = WEAPONS[c.weapon];
    const ideal = IDEAL_RANGE[c.weapon] || 12;

    // Hurt? Back off and heal when there's a moment.
    const hurting = c.hp < 40 && (c.count('bandage') || c.count('soda'));
    if (hurting && !c.using && (!this.los || d > 22)) c.startUsing(c.count('bandage') ? 'bandage' : 'soda');

    // Aim: track the target, lead it a little, good shots go for the head.
    const aim = t.center(new THREE.Vector3());
    if (t.team !== 'machine') {
      if (this.headshot === undefined || Math.random() < dt) this.headshot = Math.random() < this.skill * 0.45;
      if (this.headshot && t.head) aim.y = t.head(new THREE.Vector3()).y - 0.1;
    }
    if (t.vel) aim.addScaledVector(t.vel, w.projectile ? d / (w.speed || 30) : 0.05);
    const origin = c.head(new THREE.Vector3());
    const ax = aim.x - c.pos.x;
    const az = aim.z - c.pos.z;
    const wantYaw = Math.atan2(-ax, -az);
    c.yaw += angleDiff(c.yaw, wantYaw) * Math.min(1, dt * (5 + this.skill * 7));
    c.pitch = Math.atan2(aim.y - origin.y, Math.hypot(ax, az));

    // Move: no line of sight → path to where we last saw them. Otherwise hold the right range and strafe.
    if (!this.los && this.lastSeen) {
      this.steer(this.lastSeen, dt, d > 15);
      if (c.pos.distanceTo(this.lastSeen) < 2) this.lastSeen = null;
    } else {
      let mx = 0;
      let mz = 0;
      const back = hurting && this.los;
      if (w.melee) { if (d > 1.3) { mx += dx / d; mz += dz / d; } } else if (back || d < ideal - 3) { mx -= dx / d; mz -= dz / d; } else if (d > ideal + 3) { mx += dx / d; mz += dz / d; }
      if (!w.melee) {
        // A-D strafing on a jittery rhythm, harder to hit the better they are.
        this.strafeIn -= dt;
        if (this.strafeIn <= 0) {
          this.strafeIn = 0.25 + Math.random() * (1.1 - this.skill * 0.6);
          if (Math.random() < 0.7) this.strafe *= -1;
        }
        const s = 0.6 + this.skill * 0.6;
        mx += (-dz / d) * this.strafe * s;
        mz += (dx / d) * this.strafe * s;
        // Jump peeks.
        if (this.los && this.skill > 0.7 && c.onGround && Math.random() < dt * 0.6 * this.skill) c.wantJump = true;
      }
      const len = Math.hypot(mx, mz);
      if (len > 0) c.move.set(mx / len, mz / len);
      // Don't strafe into walls.
      if (len > 0 && !raid.map.isFree(c.pos.x + c.move.x * 1.6, c.pos.z + c.move.y * 1.6, 0.6)) {
        this.strafe *= -1;
        this.strafeIn = 0.4;
        c.move.set(dx / d, dz / d);
      }
      c.sprint = d > ideal + 10 || (hurting && this.los);
    }

    // Shoot.
    this.reaction -= dt;
    const aimed = Math.abs(angleDiff(c.yaw, wantYaw)) < 0.12 + (1 - this.skill) * 0.15;
    const range = w.melee ? w.range + 0.5 : w.range || 60;
    if (this.los && aimed && d < range && this.reaction <= 0 && !c.using) {
      const err = RAIDERS.accuracy * (1.5 - this.skill) * (0.35 + d / 30) * (c.isSprinting ? 1.6 : 1);
      aim.x += (Math.random() - 0.5) * err * d;
      aim.y += (Math.random() - 0.5) * err * d * 0.6;
      aim.z += (Math.random() - 0.5) * err * d;
      raid.fire(c, origin, aim.sub(origin).normalize());
      // A beat between taps on single-shot guns, so they aren't aimbots.
      if (c.weapon !== 'smg') this.reaction = 0.08 + Math.random() * (0.35 - this.skill * 0.2);
    }
    // Throwables: flush people out of cover.
    if (d > 8 && d < 26 && c.currentThrowable() && Math.random() < dt * (this.los ? 0.1 : 0.25)) {
      const from = c.head(new THREE.Vector3());
      c.throwGrenade(from, raid.aimGrenade(from, this.lastSeen || t.pos));
    }
    if (Number.isFinite(c.ammo) && c.ammo <= 0) {
      if (c.reload()) c.switchTo(c.active ? 0 : 1);
    }
  }

  doRescue(dt) {
    const { c, raid } = this;
    // Kneel by them and hold the use key.
    const r = this.rescue;
    const d = Math.hypot(r.pos.x - c.pos.x, r.pos.z - c.pos.z);
    if (d > 1.6) { this.steer(r.pos, dt); this.faceMove(dt); this.reviveT = 0; return; }
    this.reviveT += dt;
    c.yaw += angleDiff(c.yaw, Math.atan2(-(r.pos.x - c.pos.x), -(r.pos.z - c.pos.z))) * Math.min(1, dt * 6);
    if (this.reviveT >= PLAYER.reviveTime) {
      raid.revive(r, c);
      say(raid, c, REVIVED_LINES);
      this.rescue = null;
    }
  }

  // Still stuck despite the path? Hop, sidestep, and re-path.
  unstick(dt) {
    const { c } = this;
    const trying = c.move.lengthSq() > 0.1;
    const moving = Math.hypot(c.vel.x, c.vel.z) > 1.2;
    this.stuckFor = trying && !moving ? this.stuckFor + dt : 0;
    if (this.stuckFor > 0.6) {
      c.wantJump = true;
      c.move.set(-c.move.y * this.strafe, c.move.x * this.strafe);
      this.path = null;
      if (this.stuckFor > 2.5) {
        this.stuckFor = 0;
        if (this.goalContainer) this.goalContainer.claimedBy = null;
        this.goal = null;
      }
    }
  }
}
