// Owns the current floor and everyone on it: the run, shooting, damage, rockets, rivals and loot.
import * as THREE from 'three';
import {
  WEAPONS, RARITIES, START_CHIPS, FLOORS, RIVAL_ARRIVAL, COLORS, HATS, BOT_NAMES,
} from './config.js';
import { buildWorld } from './world.js';
import { buildSlotRow, rollRarity } from './slots.js';
import { RouletteTable, BlackjackTable } from './tables.js';
import { CrashMachine } from './crash.js';
import { buildCashier, Elevator, GunPickup } from './services.js';
import { ChipSystem } from './chips.js';
import { Fx } from './fx.js';
import { Combatant } from './combatant.js';
import { BotBrain } from './bots.js';
import { part } from './toon.js';
import { save } from './save.js';
import { sfx } from './audio.js';

const raycaster = new THREE.Raycaster();
const tmp = new THREE.Vector3();
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Free GPU memory from a floor we're leaving.
function disposeScene(scene) {
  scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const m = o.material;
    if (m && m.map && m.map.userData && m.map.userData.canvas) m.map.dispose();
  });
}

export class Game {
  constructor(hud) {
    this.hud = hud;
    this.listener = new THREE.Vector3();
    this.shake = 0;
    // True while the elevator is moving between floors: everything holds still.
    this.intermission = 0;
    this.player = null;
    this.run = null;
    this.loadFloor(0);
  }

  // ---------- floors ----------

  loadFloor(index) {
    if (this.player) this.scene.remove(this.player.char.root);
    if (this.scene) disposeScene(this.scene);

    this.scene = new THREE.Scene();
    this.floorIndex = index;
    this.floor = FLOORS[index];
    this.world = buildWorld(this.scene, this.floor, index + 1);
    this.fx = new Fx(this.scene);
    this.chips = new ChipSystem(this);
    this.machines = buildSlotRow(this);
    const { sites } = this.world;
    this.tables = [
      ...sites.roulette.map((s) => new RouletteTable(this, s.x, s.z)),
      ...sites.blackjack.map((s) => new BlackjackTable(this, s.x, s.z)),
      ...sites.crash.map((s) => new CrashMachine(this, s.x, s.z)),
    ];
    this.cashier = buildCashier(this);
    this.elevator = new Elevator(this);
    this.world.bake();

    this.pickups = [];
    this.rockets = [];
    this.combatants = [];
    this.bots = [];
    this.timeLeft = this.floor.time;
    this.warned = {};
    this.arrivalIn = RIVAL_ARRIVAL;

    if (this.player) {
      const p = this.player;
      this.scene.add(p.char.root);
      this.combatants.push(p);
      p.pos.set(this.world.arrival.x, 0, this.world.arrival.z);
      p.vel.set(0, 0, 0);
      p.yaw = 0;
      p.pitch = 0;
      p.busy = null;
    }
    for (let i = 0; i < this.floor.rivals; i++) this.spawnRival(false);
  }

  get interactables() {
    return [
      ...this.machines,
      ...this.tables.flatMap((t) => t.seats),
      ...this.cashier,
      this.elevator,
      ...this.pickups,
    ];
  }

  // ---------- runs ----------

  startRun(name, color, hat) {
    save.update((d) => { d.runs++; });
    this.player = null;
    this.loadFloor(0);
    const p = new Combatant(this, { name, color, hat, isPlayer: true });
    this.player = p;
    this.combatants.push(p);
    p.pos.set(this.world.arrival.x, 0, this.world.arrival.z);
    p.chips = START_CHIPS;
    this.run = { over: false, kills: 0, earned: 0, started: performance.now() };
    this.hud.floorIntro(this.floorIndex, this.floor);
  }

  rideElevator(c, fee) {
    if (this.intermission || !this.run || this.run.over) return;
    c.chips -= fee;
    sfx.cashout();
    if (this.floorIndex === FLOORS.length - 1) {
      this.victory();
      return;
    }
    const next = this.floorIndex + 1;
    this.unlocked(save.update((d) => { d.bestFloor = Math.max(d.bestFloor, next + 1); }));
    this.intermission = 1;
    this.hud.elevatorRide(next, () => {
      this.loadFloor(next);
      this.intermission = 0;
      this.hud.floorIntro(next, this.floor);
    });
  }

  victory() {
    this.run.over = true;
    this.intermission = 1;
    const newHats = save.update((d) => { d.wins++; d.bestFloor = Math.max(d.bestFloor, FLOORS.length); });
    this.fx.confetti(this.player.pos.clone().setY(3), 150);
    this.hud.showRunOver({ won: true, floor: this.floorIndex + 1, chips: this.player.chips, kills: this.run.kills, newHats });
  }

  gameOver(reason, by) {
    if (!this.run || this.run.over) return;
    this.run.over = true;
    const newHats = save.update((d) => { d.busts++; });
    this.hud.showRunOver({ won: false, reason, by, floor: this.floorIndex + 1, kills: this.run.kills, newHats });
  }

  // Tell the player about any hats they just unlocked.
  unlocked(hats) {
    for (const hat of hats) {
      this.hud.toast(`🔓 UNLOCKED: the ${hat} hat!`, 'big');
      this.feed(`🔓 You unlocked the ${hat} hat`);
    }
  }

  // ---------- rivals ----------

  spawnRival(atElevator) {
    const taken = new Set(this.combatants.map((c) => c.name));
    const name = pick(BOT_NAMES.filter((n) => !taken.has(n))) || 'Some Guy';
    const c = new Combatant(this, { name, color: pick(COLORS), hat: pick(HATS) });
    const f = this.floor;
    c.chips = Math.round(f.rivalChips * (0.7 + Math.random() * 0.6));
    c.armor = f.rivalArmor;
    if (f.rivalGuns.length && Math.random() < 0.75) c.setWeapon(pick(f.rivalGuns), rollRarity(f.rarityBoost));

    let spot;
    if (atElevator) spot = { x: this.world.arrival.x + (Math.random() - 0.5) * 4, z: this.world.arrival.z };
    else {
      const far = this.world.spawnPoints.filter(([x, z]) => !this.player || Math.hypot(x - this.player.pos.x, z - this.player.pos.z) > 14);
      const [x, z] = pick(far.length ? far : this.world.spawnPoints);
      spot = { x, z };
    }
    c.pos.set(spot.x, 0, spot.z);
    c.yaw = Math.random() * Math.PI * 2;
    this.combatants.push(c);
    this.bots.push(new BotBrain(this, c));
    if (atElevator) this.feed(`🛗 ${name} walked in with 🪙${c.chips}`);
    return c;
  }

  removeCombatant(c) {
    this.scene.remove(c.char.root);
    this.combatants = this.combatants.filter((o) => o !== c);
    this.bots = this.bots.filter((b) => b.c !== c);
  }

  // ---------- interaction ----------

  nearbyInteractable(c) {
    let best = null;
    let bestD = Infinity;
    for (const it of this.interactables) {
      const d = Math.hypot(it.spot.x - c.pos.x, it.spot.z - c.pos.z);
      if (d < (it.range || 1.6) && d < bestD && it.prompt(c)) { bestD = d; best = it; }
    }
    return best;
  }

  interact(c) {
    if (!c.alive || this.intermission) return;
    if (c.busy) {
      if (c.busy.leave) c.busy.leave(c);
      return;
    }
    const it = this.nearbyInteractable(c);
    if (!it) return;
    const refusal = it.use(c);
    if (refusal && c.isPlayer) {
      this.hud.toast(refusal);
      sfx.deny();
    }
  }

  takeGun(c, pickup) {
    if (!this.pickups.includes(pickup)) return;
    this.dropGun(c);
    c.setWeapon(pickup.kind, pickup.rarity, pickup.ammo);
    pickup.remove();
    this.pickups = this.pickups.filter((p) => p !== pickup);
    if (c.isPlayer) {
      sfx.win();
      this.hud.toast(`Picked up the ${c.weaponName}`, pickup.rarity >= 2 ? 'big' : '');
    }
  }

  dropGun(c) {
    if (c.weapon === 'fists' || c.ammo <= 0) return;
    const at = c.pos.clone();
    at.x += (Math.random() - 0.5) * 1.5;
    at.z += (Math.random() - 0.5) * 1.5;
    this.pickups.push(new GunPickup(this, at, c.weapon, c.rarity, c.ammo));
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
    const damage = w.damage * RARITIES[c.rarity].damage;
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
        this.damage(o, damage, c, o.pos.clone().setY(o.pos.y + 1.4));
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
        this.fx.tracer(muzzle, hit.point, c.rarity ? new THREE.Color(RARITIES[c.rarity].css).getHex() : 0xffe066);
        if (hit.target) this.damage(hit.target, damage, c, hit.point);
        else if (hit.hit) this.fx.puff(hit.point, 0xfff6e0, 0.12);
      }
    }

    if (c.ammo <= 0) {
      c.setWeapon('fists');
      if (c.isPlayer) this.hud.toast('Out of ammo! Hit the slots or the cashier.');
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
    this.rockets.push({ mesh, dir: dir.clone(), owner, rarity: owner.rarity, life: 3, trail: 0 });
  }

  updateRockets(dt) {
    const speed = WEAPONS.rocket.speed;
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.life -= dt;
      const step = speed * dt;
      const hit = this.raycast(r.mesh.position, r.dir, step, r.owner);
      if (hit.hit || r.life <= 0) {
        this.explode(hit.hit ? hit.point.addScaledVector(r.dir, -0.2) : r.mesh.position.clone(), r.owner, r.rarity);
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

  explode(point, owner, rarity = 0) {
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
      const dmg = w.damage * RARITIES[rarity].damage * (1 - (d / w.splash) * 0.6) * (c === owner ? 0.4 : 1);
      this.damage(c, dmg, owner, c.pos.clone().setY(c.pos.y + 1.6));
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
    c.armor = 0;
    if (c.busy && c.busy.leave) c.busy.leave(c);
    c.busy = null;
    sfx.bust(c.pos, this.listener);
    this.fx.confetti(c.pos.clone().setY(c.pos.y + 1.4), 25);
    if (attacker && attacker !== c) {
      attacker.kills++;
      if (attacker.isPlayer && this.run) this.run.kills++;
      this.feed(`${attacker.name} busted ${c.name}`);
    } else {
      this.feed(`${c.name} went bust`);
    }
    if (c.isPlayer) {
      c.setWeapon('fists');
      this.gameOver('bust', attacker && attacker !== c ? attacker.name : null);
    } else {
      // Their gun stays on the floor for whoever wants it.
      this.dropGun(c);
      c.setWeapon('fists');
      c.respawnIn = 6;
    }
  }

  feed(text) {
    this.hud.feed(text);
  }

  // ---------- loop ----------

  update(dt) {
    if (this.player) this.player.head(this.listener);
    for (const b of this.bots) b.update(dt);
    for (const c of this.combatants.slice()) {
      c.update(dt);
      c.wantJump = false;
    }
    for (const m of this.machines) m.update(dt);
    for (const t of this.tables) t.update(dt);
    this.elevator.update(dt);
    for (const p of this.pickups) p.update(dt);
    this.pickups = this.pickups.filter((p) => {
      if (p.age < 90) return true;
      p.remove();
      return false;
    });
    this.updateRockets(dt);
    this.chips.update(dt);
    this.world.update(dt);
    this.fx.update(dt);
    this.shake = Math.max(0, this.shake - dt * 1.5);

    // Fresh rivals keep walking in.
    this.arrivalIn -= dt;
    if (this.arrivalIn <= 0) {
      this.arrivalIn = RIVAL_ARRIVAL;
      if (this.combatants.filter((c) => !c.isPlayer && c.alive).length < this.floor.rivals) this.spawnRival(true);
    }

    // Closing time.
    if (this.run && !this.run.over && !this.intermission) {
      this.timeLeft -= dt;
      for (const mark of [60, 30, 10]) {
        if (this.timeLeft <= mark && !this.warned[mark]) {
          this.warned[mark] = true;
          this.hud.toast(`⏰ Closing in ${mark} seconds! Pay the elevator or you're out.`, 'big');
          sfx.deny();
        }
      }
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.player.alive = false;
        this.gameOver('closing');
      }
    }
  }
}
