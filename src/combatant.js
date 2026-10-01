// Anyone in the casino who can fight: you or a bot.
import * as THREE from 'three';
import { PLAYER, START_CHIPS, WEAPONS, RARITIES } from './config.js';
import { createCharacter } from './character.js';
import { resolve } from './physics.js';
import { sfx } from './audio.js';

export class Combatant {
  constructor(game, { name, color, hat, isPlayer = false }) {
    this.game = game;
    this.name = name;
    this.isPlayer = isPlayer;
    this.char = createCharacter({ color, hat });
    this.char.body.userData.combatant = this;
    game.scene.add(this.char.root);

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.chips = START_CHIPS;
    this.armor = 0;
    this.alive = true;
    this.respawnIn = 0;
    this.onGround = true;
    this.cooldown = 0;
    this.busy = null; // the slot machine you're using, if any
    this.kills = 0;
    this.lastAttacker = null;

    // Intent, set by the player controller or a bot brain each frame.
    this.move = new THREE.Vector2();
    this.sprint = false;
    this.wantJump = false;

    this.setWeapon('fists');
  }

  setWeapon(kind, rarity = 0, ammo = null) {
    this.weapon = kind;
    this.rarity = kind === 'fists' ? 0 : rarity;
    const base = WEAPONS[kind].ammo;
    this.ammo = ammo !== null ? ammo : (Number.isFinite(base) ? Math.round(base * RARITIES[this.rarity].ammo) : base);
    this.char.setWeapon(kind, RARITIES[this.rarity].color);
  }

  // e.g. "Epic Boomstick"
  get weaponName() {
    const name = WEAPONS[this.weapon].name;
    return this.rarity ? `${RARITIES[this.rarity].name} ${name}` : name;
  }

  get forward() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  head(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + PLAYER.headHeight, this.pos.z);
  }

  update(dt) {
    const canMove = this.alive && !this.busy && !this.game.intermission;
    const speed = this.sprint ? PLAYER.sprint : PLAYER.walk;
    const tx = canMove ? this.move.x * speed : 0;
    const tz = canMove ? this.move.y * speed : 0;
    const accel = Math.min(1, dt * (this.onGround ? 14 : 3.5));
    this.vel.x += (tx - this.vel.x) * accel;
    this.vel.z += (tz - this.vel.z) * accel;

    if (this.wantJump && this.onGround && canMove) {
      this.vel.y = PLAYER.jump;
      this.onGround = false;
      this.char.jump();
      if (this.isPlayer) sfx.jump();
    }

    this.vel.y -= PLAYER.gravity * dt;
    this.pos.addScaledVector(this.vel, dt);
    const r = resolve(this.pos, this.vel, PLAYER.radius, this.game.world);
    this.onGround = r.onGround;
    if (r.landed > 5) this.char.land(r.landed);
    this.cooldown -= dt;

    // Busted rivals lie there a moment, then get dragged out by security.
    if (!this.alive && !this.isPlayer) {
      this.respawnIn -= dt;
      if (this.respawnIn <= 0) this.game.removeCombatant(this);
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
    if (!this.isPlayer) this.char.setTag(this.name, this.chips, this.armor);
  }
}
