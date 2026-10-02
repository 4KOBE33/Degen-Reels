// A bean with a backpack: you, or a rival raider bot.
import * as THREE from 'three';
import { PLAYER, WEAPONS, RARITIES, ITEMS, BACKPACK_SLOTS } from './config.js';
import { createCharacter } from './character.js';
import { resolve } from './physics.js';
import { fullAmmo, itemInfo } from './items.js';
import { sfx } from './audio.js';

export class Combatant {
  constructor(raid, { name, look, isPlayer = false, team = 'raider' }) {
    this.raid = raid;
    this.name = name;
    this.isPlayer = isPlayer;
    this.team = isPlayer ? 'player' : team;
    this.char = createCharacter(look);
    this.char.body.userData.actor = this;
    this.hitMesh = this.char.body;
    this.critMesh = this.char.headHit;
    this.critMesh.userData.actor = this;
    this.critMesh.userData.crit = 1.75;
    raid.scene.add(this.char.root);

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.maxHp = PLAYER.maxHp;
    this.hp = PLAYER.maxHp;
    this.armor = 0;
    this.alive = true;
    this.onGround = true;
    this.cooldown = 0;
    this.lastAttacker = null;

    // Loadout and loot.
    this.weapons = [null, null];
    this.active = 0;
    this.backpack = [];
    this.chips = 0;
    this.using = null; // a consumable being used: { item, t, total }

    // Intent, set by the player controller or a bot brain each frame.
    this.move = new THREE.Vector2();
    this.sprint = false;
    this.wantJump = false;
    this.aiming = false;
    this.stamina = PLAYER.maxStamina;
    this.warmth = PLAYER.maxWarmth;
    this.warmSource = null;
    this.staminaWait = 0;
    this.winded = false;
    this.isSprinting = false;
    this.refreshWeapon();
  }

  get gun() { return this.weapons[this.active]; }
  get weapon() { return this.gun ? this.gun.kind : 'fists'; }
  get rarity() { return this.gun ? this.gun.rarity : 0; }
  get ammo() { return this.gun ? this.gun.ammo : Infinity; }
  get capacity() { return BACKPACK_SLOTS + (this.bagBonus || 0); }

  refreshWeapon() {
    this.char.setWeapon(this.weapon, RARITIES[this.rarity].color);
  }

  switchTo(i) {
    if (i === this.active || this.using) return;
    this.active = i;
    this.cooldown = Math.max(this.cooldown, 0.35);
    this.refreshWeapon();
  }

  // Puts a gun in an empty weapon slot. Returns false if both slots are full.
  equip(gun) {
    const slot = this.weapons[this.active] ? this.weapons.indexOf(null) : this.active;
    if (slot < 0) return false;
    this.weapons[slot] = gun;
    if (slot === this.active) this.refreshWeapon();
    return true;
  }

  count(id) {
    return this.backpack.filter((it) => it.id === id).reduce((n, it) => n + it.qty, 0);
  }

  // Removes one of an item from the backpack.
  takeOne(id) {
    const it = this.backpack.find((x) => x.id === id);
    if (!it) return false;
    it.qty--;
    if (it.qty <= 0) this.backpack.splice(this.backpack.indexOf(it), 1);
    return true;
  }

  // Start using a heal or armor plate. Slows you down while it works.
  startUsing(id) {
    if (this.using || !this.alive) return 'Busy';
    if (this.downed) return 'You\'re down. Hold the use key for a Second Chance Token, or wait for help';
    const def = ITEMS[id];
    if (!this.count(id)) return `No ${def.name}`;
    if (def.kind === 'heal' && this.hp >= this.maxHp) return 'Already at full health';
    if (def.kind === 'armor' && this.armor >= PLAYER.maxArmor) return 'Armor is full';
    if (def.kind === 'warm' && this.warmth >= PLAYER.maxWarmth && this.hp >= this.maxHp) return 'You\'re already toasty';
    if (def.kind === 'throw') return `Hold the throw key to toss your ${def.name}`;
    this.using = { id, t: 0, total: def.useTime };
    return null;
  }

  // Ammo boxes refill half a gun's ammo.
  reload() {
    if (this.downed) return 'You\'re down';
    const g = this.gun;
    if (!g || !Number.isFinite(g.ammo)) return null;
    const full = fullAmmo(g.kind, g.rarity);
    if (g.ammo >= full) return 'Already full';
    if (!this.takeOne('ammo')) return 'Out of ammo, and no Ammo Boxes';
    g.ammo = Math.min(full, g.ammo + Math.ceil(full * 0.5));
    this.cooldown = Math.max(this.cooldown, 1.2);
    this.char.recoil(2);
    return null;
  }

  // Every kind of throwable in the backpack, in backpack order.
  throwables() {
    const ids = [];
    for (const it of this.backpack) if (ITEMS[it.id] && ITEMS[it.id].kind === 'throw' && !ids.includes(it.id)) ids.push(it.id);
    return ids;
  }

  // The throwable the throw key uses: the one you picked, or the first one you have.
  currentThrowable() {
    if (this.throwable && this.count(this.throwable)) return this.throwable;
    return this.throwables()[0] || null;
  }

  cycleThrowable() {
    const ids = this.throwables();
    if (!ids.length) return null;
    const i = ids.indexOf(this.currentThrowable());
    this.throwable = ids[(i + 1) % ids.length];
    return this.throwable;
  }

  // Lob a throwable along `dir` from `origin`.
  throwGrenade(origin, dir, id = this.currentThrowable()) {
    if (!this.alive || this.using) return 'Busy';
    if (this.stunned > 0) return 'Seeing stars…';
    if (this.downed) return 'You\'re down';
    if (this.throwCooldown > 0) return 'Still winding up';
    if (!id || !this.takeOne(id)) return 'Nothing to throw';
    this.throwCooldown = 0.9;
    this.raid.spawnGrenade(this, origin, dir, id);
    if (this.isPlayer) this.raid.run.throws++;
    this.char.recoil(1.5);
    return null;
  }

  get forward() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  head(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + (this.downed ? 0.55 : PLAYER.headHeight), this.pos.z);
  }

  center(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + (this.downed ? 0.4 : 1.0), this.pos.z);
  }

  // How much worse your aim is right now: running, jumping and moving all throw it off.
  aimPenalty() {
    let m = 1;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed > 2) m = 1.6;
    if (this.isSprinting) m = 3;
    if (!this.onGround) m = Math.max(m, 3.5);
    if (this.aiming) m *= 0.4;
    return m;
  }

  hurt(attacker) {
    this.char.hurt();
    if (attacker && attacker !== this) this.lastAttacker = attacker;
  }

  // Someone driven over the network (a friend, or a bot on someone else's game): glide to where
  // they really are and animate.
  puppetUpdate(dt) {
    const k = Math.min(1, dt * 12);
    if (this.netPos) {
      const before = this.pos.clone();
      this.pos.lerp(this.netPos, k);
      const moved = Math.hypot(this.pos.x - before.x, this.pos.z - before.z) / Math.max(dt, 0.001);
      this.netSpeed = this.netSpeed === undefined ? moved : this.netSpeed + (moved - this.netSpeed) * Math.min(1, dt * 6);
    }
    if (this.netYaw !== undefined) this.yaw += Math.atan2(Math.sin(this.netYaw - this.yaw), Math.cos(this.netYaw - this.yaw)) * k;
    if (this.netPitch !== undefined) this.pitch += (this.netPitch - this.pitch) * k;
    const w = this.netWeapon || 'fists';
    if (this.char.setWeapon) this.char.setWeapon(w, RARITIES[this.netRarity || 0] ? RARITIES[this.netRarity || 0].color : null);
    const speed = this.netSpeed || 0;
    this.char.root.position.copy(this.pos);
    this.char.root.rotation.y = this.yaw;
    this.char.animate(dt, {
      speed, forward: Math.min(1, speed / PLAYER.walk), side: 0, onGround: true, pitch: this.pitch,
      dead: !this.alive, downed: this.downed, showTag: true, roll: this.netRoll || 0,
    });
    this.char.setTag(this.name, `${Math.max(0, Math.ceil(this.hp))}`, Math.ceil(this.armor || 0));
  }

  get weaponName() { return this.puppet ? this.netWeaponName || 'a gun' : this.gun ? itemInfo(this.gun).name : 'Fists'; }

  // Dodge roll: a quick tumble the way you're moving (or forward), with a split second where
  // nothing can hit you. Costs stamina and has a short cooldown.
  tryRoll() {
    if (!this.alive || this.downed || this.using || this.rolling || (this.rollCd || 0) > 0 || !this.onGround || this.raid.frozen) return 'Can\'t roll right now';
    if (this.stamina < PLAYER.rollCost) return 'Too tired to roll';
    if (this.pin) return 'Wait for the bell';
    const dir = new THREE.Vector3(this.move.x, 0, this.move.y);
    if (dir.lengthSq() < 0.01) dir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    dir.normalize();
    this.stamina -= PLAYER.rollCost;
    this.staminaWait = PLAYER.staminaDelay;
    this.rolling = { t: 0, dir };
    this.rollCd = PLAYER.rollCooldown;
    if (this.isPlayer) sfx.jump();
    return null;
  }

  // Inside the dodge window of a roll?
  get dodging() { return !!this.rolling && this.rolling.t < PLAYER.rollDodge; }

  update(dt) {
    if (this.puppet) { this.puppetUpdate(dt); return; }
    this.rollCd = Math.max(0, (this.rollCd || 0) - dt);
    const canMove = this.alive && !this.raid.frozen;
    // Stamina: sprinting drains it, standing still or walking refills it after a short pause.
    const moving = this.move.lengthSq() > 0.01;
    this.isSprinting = this.sprint && moving && !this.aiming && !this.using && !this.winded && this.stamina > 0;
    this.boost = Math.max(0, (this.boost || 0) - dt);
    this.stunned = Math.max(0, (this.stunned || 0) - dt);
    if (this.isSprinting && this.boost > 0) {
      // Rocket Fuel: sprint for free.
      this.staminaWait = PLAYER.staminaDelay;
    } else if (this.isSprinting) {
      this.stamina = Math.max(0, this.stamina - PLAYER.sprintDrain * dt);
      this.staminaWait = PLAYER.staminaDelay;
      if (this.stamina <= 0) this.winded = true;
    } else {
      this.staminaWait -= dt;
      if (this.staminaWait <= 0) this.stamina = Math.min(PLAYER.maxStamina, this.stamina + PLAYER.staminaRegen * dt);
      if (this.winded && this.stamina >= PLAYER.windedUntil) this.winded = false;
    }
    let speed = this.isSprinting ? PLAYER.sprint : PLAYER.walk;
    if (this.winded) speed *= 0.85;
    if (this.aiming) speed *= 0.6;
    if (this.using) speed *= 0.45;
    if (this.boost > 0) speed *= 1.25;
    // Heavy guns slow you down.
    speed *= (WEAPONS[this.weapon] && WEAPONS[this.weapon].moveMul) || 1;
    if (this.stunned > 0) speed *= 0.3;
    // Downed: a slow crawl, no sprinting.
    if (this.downed) { speed = 1.4; this.isSprinting = false; }
    const tx = canMove ? this.move.x * speed : 0;
    const tz = canMove ? this.move.y * speed : 0;
    const accel = Math.min(1, dt * (this.onGround ? 14 : 3.5));
    this.vel.x += (tx - this.vel.x) * accel;
    this.vel.z += (tz - this.vel.z) * accel;
    if (this.rolling) {
      const r = this.rolling;
      r.t += dt;
      if (r.t >= PLAYER.rollTime || !this.alive || this.downed) this.rolling = null;
      else {
        const k = 1 - (r.t / PLAYER.rollTime) * 0.5;
        this.vel.x = r.dir.x * PLAYER.rollSpeed * k;
        this.vel.z = r.dir.z * PLAYER.rollSpeed * k;
        this.isSprinting = false;
      }
    }

    if (this.downed) {
      this.bleed -= dt;
      if (this.bleed <= 0 && this.alive) this.raid.kill(this, this.lastAttacker && this.lastAttacker.alive !== undefined ? this.lastAttacker : null);
    }
    if (this.wantJump && !this.downed && this.onGround && canMove && this.stamina >= PLAYER.jumpCost * 0.5) {
      this.stamina = Math.max(0, this.stamina - PLAYER.jumpCost);
      this.staminaWait = PLAYER.staminaDelay;
      this.vel.y = PLAYER.jump;
      this.onGround = false;
      this.char.jump();
      if (this.isPlayer) sfx.jump();
    }

    this.vel.y -= PLAYER.gravity * dt;
    this.pos.addScaledVector(this.vel, dt);
    const r = resolve(this.pos, this.vel, PLAYER.radius, this.raid.map);
    this.onGround = r.onGround;
    // Waiting for the bell in The Pit: stay on your mark (you can still look around).
    if (this.pin) {
      this.pos.x = this.pin.x;
      this.pos.z = this.pin.z;
      this.vel.x = 0;
      this.vel.z = 0;
    }
    if (r.landed > 5) this.char.land(r.landed);
    this.cooldown -= dt;
    this.throwCooldown = Math.max(0, (this.throwCooldown || 0) - dt);

    // Finish using a consumable.
    if (this.using && this.alive) {
      this.using.t += dt;
      if (this.using.t >= this.using.total) {
        const def = ITEMS[this.using.id];
        if (this.takeOne(this.using.id)) {
          if (def.kind === 'heal') this.hp = Math.min(this.maxHp, this.hp + def.heal);
          if (def.kind === 'armor') this.armor = Math.min(PLAYER.maxArmor, this.armor + def.armor);
          if (def.kind === 'warm') {
            this.warmth = Math.min(PLAYER.maxWarmth, this.warmth + def.warmth);
            this.hp = Math.min(this.maxHp, this.hp + def.heal);
          }
          if (def.kind === 'boost') this.boost = def.duration;
          if (this.isPlayer) sfx.heal();
        }
        this.using = null;
      }
    }

    // Feed the animation with movement relative to where you're facing.
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const forward = (this.vel.x * fx + this.vel.z * fz) / PLAYER.walk;
    const side = (this.vel.x * -fz + this.vel.z * fx) / PLAYER.walk;
    this.char.root.position.copy(this.pos);
    this.char.root.rotation.y = this.yaw;
    this.char.animate(dt, {
      speed: Math.hypot(this.vel.x, this.vel.z),
      forward,
      side,
      onGround: this.onGround,
      pitch: this.pitch,
      dead: !this.alive,
      downed: this.downed,
      showTag: !this.isPlayer,
      roll: this.rolling ? this.rolling.t / PLAYER.rollTime : 0,
    });
    if (!this.isPlayer) this.char.setTag(this.name, `${Math.ceil(this.hp)}`, Math.ceil(this.armor));
  }
}

export { WEAPONS };
