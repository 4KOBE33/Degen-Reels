// A bean with a backpack: you, or a rival raider bot.
import * as THREE from 'three';
import { PLAYER, WEAPONS, RARITIES, ITEMS, BACKPACK_SLOTS } from './config.js';
import { createCharacter } from './character.js';
import { resolve } from './physics.js';
import { fullAmmo, itemInfo } from './items.js';
import { sfx } from './audio.js';

export class Combatant {
  constructor(raid, { name, color, hat, isPlayer = false, team = 'raider' }) {
    this.raid = raid;
    this.name = name;
    this.isPlayer = isPlayer;
    this.team = isPlayer ? 'player' : team;
    this.char = createCharacter({ color, hat });
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
  get weaponName() { return this.gun ? itemInfo(this.gun).name : 'Fists'; }
  get capacity() { return BACKPACK_SLOTS; }

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
    const def = ITEMS[id];
    if (!this.count(id)) return `No ${def.name}`;
    if (def.kind === 'heal' && this.hp >= this.maxHp) return 'Already at full health';
    if (def.kind === 'armor' && this.armor >= PLAYER.maxArmor) return 'Armor is full';
    if (def.kind === 'warm' && this.warmth >= PLAYER.maxWarmth && this.hp >= this.maxHp) return 'You\'re already toasty';
    this.using = { id, t: 0, total: def.useTime };
    return null;
  }

  // Ammo boxes refill half a gun's ammo.
  reload() {
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

  // Lob a Cherry Bomb along `dir` from `origin`.
  throwGrenade(origin, dir) {
    if (!this.alive || this.using) return 'Busy';
    if (this.throwCooldown > 0) return 'Still winding up';
    if (!this.takeOne('grenade')) return 'No Cherry Bombs';
    this.throwCooldown = 0.9;
    this.raid.spawnGrenade(this, origin, dir);
    this.char.recoil(1.5);
    return null;
  }

  get forward() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  head(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + PLAYER.headHeight, this.pos.z);
  }

  center(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + 1.0, this.pos.z);
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

  update(dt) {
    const canMove = this.alive && !this.raid.frozen;
    // Stamina: sprinting drains it, standing still or walking refills it after a short pause.
    const moving = this.move.lengthSq() > 0.01;
    this.isSprinting = this.sprint && moving && !this.aiming && !this.using && !this.winded && this.stamina > 0;
    if (this.isSprinting) {
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
    const tx = canMove ? this.move.x * speed : 0;
    const tz = canMove ? this.move.y * speed : 0;
    const accel = Math.min(1, dt * (this.onGround ? 14 : 3.5));
    this.vel.x += (tx - this.vel.x) * accel;
    this.vel.z += (tz - this.vel.z) * accel;

    if (this.wantJump && this.onGround && canMove && this.stamina >= PLAYER.jumpCost * 0.5) {
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
      showTag: !this.isPlayer,
    });
    if (!this.isPlayer) this.char.setTag(this.name, `${Math.ceil(this.hp)}`, Math.ceil(this.armor));
  }
}

export { WEAPONS };
