// Owns the world and everyone in it: shooting, damage, rockets, respawns and rounds.
import * as THREE from 'three';
import {
  WEAPONS, START_CHIPS, LOAN_CHIPS, WIN_CHIPS, RESPAWN_TIME, BOT_COUNT, COLORS, HATS, BOT_NAMES,
} from './config.js';
import { buildWorld } from './world.js';
import { buildSlotRow } from './slots.js';
import { ChipSystem } from './chips.js';
import { Fx } from './fx.js';
import { Combatant } from './combatant.js';
import { BotBrain } from './bots.js';
import { part } from './toon.js';
import { sfx } from './audio.js';

const raycaster = new THREE.Raycaster();
const tmp = new THREE.Vector3();

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class Game {
  constructor(scene, hud) {
    this.scene = scene;
    this.hud = hud;
    this.world = buildWorld(scene);
    this.fx = new Fx(scene);
    this.chips = new ChipSystem(this);
    this.machines = buildSlotRow(this);
    this.world.bake();
    this.combatants = [];
    this.bots = [];
    this.rockets = [];
    this.shake = 0;
    this.intermission = 0;
    this.listener = new THREE.Vector3();
  }

  addPlayer(name, color, hat) {
    const c = new Combatant(this, { name, color, hat, isPlayer: true });
    c.colorHex = color;
    this.combatants.push(c);
    this.player = c;
    this.respawn(c, START_CHIPS);
    return c;
  }

  addBots() {
    const colors = shuffle(COLORS);
    const names = shuffle(BOT_NAMES);
    for (let i = 0; i < BOT_COUNT; i++) {
      const c = new Combatant(this, { name: names[i], color: colors[i % colors.length], hat: HATS[Math.floor(Math.random() * HATS.length)] });
      this.combatants.push(c);
      this.bots.push(new BotBrain(this, c));
      this.respawn(c, START_CHIPS);
    }
  }

  // ---------- spawning ----------

  respawn(c, chips) {
    const others = this.combatants.filter((o) => o !== c && o.alive);
    const spots = this.world.spawnPoints
      .map(([x, z]) => ({ x, z, d: Math.min(...others.map((o) => Math.hypot(o.pos.x - x, o.pos.z - z)), 99) }))
      .sort((a, b) => b.d - a.d);
    const spot = spots[Math.floor(Math.random() * Math.min(3, spots.length))];
    c.pos.set(spot.x, 0, spot.z);
    c.vel.set(0, 0, 0);
    c.yaw = Math.atan2(spot.x, spot.z);
    c.pitch = 0;
    const loan = chips === undefined && c.chips < LOAN_CHIPS;
    c.chips = chips !== undefined ? chips : Math.max(c.chips, LOAN_CHIPS);
    c.armor = 0;
    c.alive = true;
    c.busy = null;
    c.setWeapon('fists');
    if (c.isPlayer && loan) this.hud.toast(`The house spotted you ${LOAN_CHIPS} chips. Don't make it weird.`);
  }

  // ---------- combat ----------

  // Casts a ray against walls, props and other fighters.
  raycast(origin, dir, range, ignore, { solidsOnly = false } = {}) {
    const targets = solidsOnly
      ? this.world.solids
      : this.world.solids.concat(this.combatants.filter((c) => c.alive && c !== ignore).map((c) => c.char.body));
    raycaster.set(origin, dir);
    raycaster.far = range;
    const hit = raycaster.intersectObjects(targets, false)[0];
    if (hit) return { hit: true, point: hit.point.clone(), target: hit.object.userData.combatant || null, distance: hit.distance };
    return { hit: false, point: origin.clone().addScaledVector(dir, range), target: null, distance: range };
  }

  // `origin` and `dir` describe the aim ray (the camera's for you, the head's for bots).
  fire(c, origin, dir) {
    const w = WEAPONS[c.weapon];
    if (!c.alive || c.busy || c.cooldown > 0 || this.intermission) return false;
    c.cooldown = w.rate;
    const muzzle = c.char.muzzle.getWorldPosition(new THREE.Vector3());

    if (w.melee) {
      c.char.swing();
      sfx.swing(c.pos, this.listener);
      const fwd = c.forward;
      for (const o of this.combatants) {
        if (o === c || !o.alive) continue;
        const to = tmp.copy(o.pos).sub(c.pos);
        if (Math.abs(to.y) > 1.5) continue;
        to.y = 0;
        const d = to.length();
        if (d > w.range + 0.5 || to.normalize().dot(fwd) < 0.35) continue;
        o.vel.addScaledVector(fwd, 7);
        o.vel.y += 3;
        sfx.bonk(o.pos, this.listener);
        this.damage(o, w.damage, c, o.pos.clone().setY(o.pos.y + 1.4));
      }
      return true;
    }

    c.ammo--;
    c.char.recoil(w.projectile ? 1.6 : 1);
    this.fx.muzzleFlash(muzzle);
    sfx.shoot(c.weapon, c.pos, this.listener);

    if (w.projectile) {
      const aim = this.raycast(origin, dir, 200, c).point;
      this.spawnRocket(muzzle, aim.sub(muzzle).normalize(), c);
    } else {
      for (let i = 0; i < w.pellets; i++) {
        const d = dir.clone();
        d.x += (Math.random() - 0.5) * 2 * w.spread;
        d.y += (Math.random() - 0.5) * 2 * w.spread;
        d.z += (Math.random() - 0.5) * 2 * w.spread;
        d.normalize();
        const hit = this.raycast(origin, d, w.range, c);
        this.fx.tracer(muzzle, hit.point);
        if (hit.target) this.damage(hit.target, w.damage, c, hit.point);
        else if (hit.hit) this.fx.puff(hit.point, 0xfff6e0, 0.12);
      }
    }

    if (c.ammo <= 0) {
      c.setWeapon('fists');
      if (c.isPlayer) this.hud.toast('Out of ammo! Hit the slots for a new gun.');
    }
    return true;
  }

  spawnRocket(pos, dir, owner) {
    const mesh = new THREE.Group();
    const body = part(new THREE.CylinderGeometry(0.12, 0.12, 0.6, 10), 0x5ee27a, { ink: 0.025, shadow: false });
    body.rotation.x = Math.PI / 2;
    const tip = part(new THREE.ConeGeometry(0.12, 0.25, 10), 0xe63946, { ink: 0.025, shadow: false });
    tip.rotation.x = -Math.PI / 2;
    tip.position.z = -0.42;
    mesh.add(body, tip);
    mesh.position.copy(pos);
    mesh.lookAt(pos.clone().sub(dir));
    this.scene.add(mesh);
    this.rockets.push({ mesh, dir: dir.clone(), owner, life: 3, trail: 0 });
  }

  updateRockets(dt) {
    const speed = WEAPONS.rocket.speed;
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.life -= dt;
      const step = speed * dt;
      const hit = this.raycast(r.mesh.position, r.dir, step, r.owner);
      if (hit.hit || r.life <= 0) {
        this.explode(hit.hit ? hit.point.addScaledVector(r.dir, -0.2) : r.mesh.position.clone(), r.owner);
        this.scene.remove(r.mesh);
        this.rockets.splice(i, 1);
        continue;
      }
      r.mesh.position.addScaledVector(r.dir, step);
      r.trail -= dt;
      if (r.trail <= 0) {
        r.trail = 0.03;
        this.fx.puff(r.mesh.position.clone().addScaledVector(r.dir, -0.5), 0xd1d5db, 0.2);
      }
    }
  }

  explode(point, owner) {
    const w = WEAPONS.rocket;
    this.fx.explosion(point, w.splash);
    sfx.boom(point, this.listener);
    const pd = this.player ? this.player.pos.distanceTo(point) : 99;
    this.shake = Math.max(this.shake, Math.max(0, 0.6 - pd / 30));
    for (const c of this.combatants) {
      if (!c.alive) continue;
      const center = c.pos.clone().setY(c.pos.y + 0.9);
      const d = center.distanceTo(point);
      if (d > w.splash) continue;
      const k = 1 - d / w.splash;
      const push = center.sub(point).normalize().multiplyScalar(14 * k);
      c.vel.add(push);
      c.vel.y += 7 * k;
      c.onGround = false;
      this.damage(c, w.damage * (1 - (d / w.splash) * 0.6) * (c === owner ? 0.4 : 1), owner, c.pos.clone().setY(c.pos.y + 1.6));
    }
  }

  damage(target, amount, attacker, at) {
    if (!target.alive || this.intermission) return;
    amount = Math.round(amount);
    if (amount <= 0) return;
    const absorbed = Math.min(target.armor, amount);
    target.armor -= absorbed;
    const lost = Math.min(target.chips, amount - absorbed);
    target.chips -= lost;
    if (lost > 0) this.chips.spawnBurst(target.pos.clone().setY(target.pos.y + 1.2), lost, target);
    this.fx.number(at, `-${amount}`, absorbed && !lost ? '#7dd3fc' : '#ff5d5d', attacker && attacker.isPlayer ? 1.2 : 0.9);
    target.char.hurt();
    if (attacker && attacker !== target) target.lastAttacker = attacker;
    if (attacker && attacker.isPlayer && target !== attacker) {
      this.hud.hitmarker();
      sfx.hit();
    }
    if (target.isPlayer) {
      this.hud.hurt();
      this.shake = Math.max(this.shake, 0.25);
      sfx.hurt();
    }
    if (target.chips <= 0) this.bust(target, attacker);
  }

  bust(c, attacker) {
    c.alive = false;
    c.respawnIn = RESPAWN_TIME;
    c.armor = 0;
    c.setWeapon('fists');
    sfx.bust(c.pos, this.listener);
    this.fx.confetti(c.pos.clone().setY(c.pos.y + 1.4), 25);
    if (attacker && attacker !== c) {
      attacker.kills++;
      this.feed(`${attacker.name} busted ${c.name}`);
    } else {
      this.feed(`${c.name} went bust`);
    }
    if (c.isPlayer) this.hud.showBust(attacker && attacker !== c ? attacker.name : null);
  }

  // ---------- slots ----------

  nearbyMachine(c) {
    let best = null;
    let bestD = 1.8;
    for (const m of this.machines) {
      const d = Math.hypot(m.useSpot.x - c.pos.x, m.useSpot.z - c.pos.z);
      if (d < bestD) { bestD = d; best = m; }
    }
    return best;
  }

  interact(c) {
    const m = this.nearbyMachine(c);
    if (!m || !c.alive || c.busy || this.intermission) return;
    const refusal = m.pull(c);
    if (refusal && c.isPlayer) {
      this.hud.toast(refusal);
      sfx.deny();
    }
  }

  // ---------- rounds ----------

  feed(text) {
    this.hud.feed(text);
  }

  checkWinner() {
    if (this.intermission) return;
    const winner = this.combatants.find((c) => c.alive && c.chips >= WIN_CHIPS);
    if (!winner) return;
    this.intermission = 6;
    this.hud.showCashout(winner, this.combatants);
    this.fx.confetti(winner.pos.clone().setY(winner.pos.y + 2), 120);
    sfx.cashout();
    this.feed(`🏆 ${winner.name} cashed out with ${winner.chips} chips!`);
  }

  resetRound() {
    this.chips.clear();
    for (const r of this.rockets) this.scene.remove(r.mesh);
    this.rockets = [];
    for (const c of this.combatants) {
      c.kills = 0;
      this.respawn(c, START_CHIPS);
    }
    this.hud.hideCenter();
  }

  // ---------- loop ----------

  update(dt) {
    if (this.player) this.player.head(this.listener);
    for (const b of this.bots) b.update(dt);
    for (const c of this.combatants) {
      c.update(dt);
      c.wantJump = false;
    }
    for (const m of this.machines) m.update(dt);
    this.updateRockets(dt);
    this.chips.update(dt);
    this.world.update(dt);
    this.fx.update(dt);
    this.shake = Math.max(0, this.shake - dt * 1.5);

    if (this.intermission) {
      this.intermission = Math.max(0, this.intermission - dt);
      if (!this.intermission) this.resetRound();
    } else {
      this.checkWinner();
    }
  }
}
