// Map hazards: traffic on the Vegas strip, cold in Frostbite Peaks, gators in the bayou.
import * as THREE from 'three';
import { PLAYER } from './config.js';
import { part } from './toon.js';
import { sfx } from './audio.js';

const CAR_SPEED = 17;
const CAR = { name: 'A speeding car', team: 'env' };
const COLD = { name: 'The cold', team: 'env' };
const CAR_COLORS = [0xe63946, 0x4dabff, 0xffd23f, 0x5ee27a, 0xc77dff, 0xff9f43, 0xf1f5f9];

function carModel(color) {
  const g = new THREE.Group();
  const body = part(new THREE.BoxGeometry(2.0, 1.0, 4.2), color);
  body.position.y = 0.75;
  const cabin = part(new THREE.BoxGeometry(1.8, 0.8, 2.2), 0x9fd8ff);
  cabin.position.set(0, 1.6, 0.2);
  g.add(body, cabin);
  for (const [x, z] of [[1, 1.3], [-1, 1.3], [1, -1.3], [-1, -1.3]]) {
    const wheel = part(new THREE.CylinderGeometry(0.4, 0.4, 0.3, 10), 0x1b0f2b, { ink: 0.02 });
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.4, z);
    g.add(wheel);
  }
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff6c0 });
  for (const x of [-0.6, 0.6]) {
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.1), lightMat);
    light.position.set(x, 0.85, -2.12);
    g.add(light);
  }
  return g;
}

export class Hazards {
  constructor(raid) {
    this.raid = raid;
    const h = raid.map.hazards || {};
    this.cold = !!h.cold;
    // Temakilla: dust storms roll in now and then and swallow the view.
    this.dust = !!h.dust;
    this.dustIn = 70 + Math.random() * 60;
    this.storm = 0;
    this.stormMix = 0;
    if (this.dust) {
      const f = raid.scene.fog;
      this.baseFog = { near: f.near, far: f.far, color: f.color.clone() };
    }
    this.fires = h.fires || [];
    this.cars = [];
    for (const lane of h.lanes || []) {
      const len = lane.to - lane.from;
      const n = Math.max(1, Math.round(len / 90));
      for (let i = 0; i < n; i++) {
        const mesh = carModel(CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)]);
        raid.scene.add(mesh);
        this.cars.push({ lane, t: (i + Math.random() * 0.5) / n, mesh, hitCooldown: new Map(), honkIn: 0 });
      }
    }
  }

  carPos(car) {
    const { lane } = car;
    const along = lane.dir > 0 ? lane.from + (lane.to - lane.from) * car.t : lane.to - (lane.to - lane.from) * car.t;
    return lane.axis === 'z' ? { x: lane.at, z: along } : { x: along, z: lane.at };
  }

  update(dt) {
    const raid = this.raid;
    // ---- Dust storms ----
    if (this.dust) {
      if (this.storm > 0) this.storm -= dt;
      else if (raid.active) {
        this.dustIn -= dt;
        if (this.dustIn <= 0) {
          this.storm = 30 + Math.random() * 15;
          this.dustIn = 110 + Math.random() * 90;
          raid.hud.toast('🌪️ DUST STORM! You can barely see your own hands.', 'big');
          raid.feed('🌪️ A dust storm is rolling through Temakilla');
        }
      }
      const want = this.storm > 0 ? 1 : 0;
      this.stormMix += (want - this.stormMix) * Math.min(1, dt / 2.5);
      const f = raid.scene.fog;
      const b = this.baseFog;
      f.near = b.near + (6 - b.near) * this.stormMix;
      f.far = b.far + (48 - b.far) * this.stormMix;
      f.color.copy(b.color).lerp(new THREE.Color(0xc9925e), this.stormMix);
      if (raid.scene.background && raid.scene.background.isColor) raid.scene.background.copy(f.color);
    }
    // ---- Traffic ----
    for (const car of this.cars) {
      const { lane } = car;
      car.t += (CAR_SPEED * dt) / (lane.to - lane.from);
      if (car.t > 1) car.t -= 1;
      const p = this.carPos(car);
      car.mesh.position.set(p.x, 0, p.z);
      // Models face -Z; point them down their lane.
      car.mesh.rotation.y = lane.axis === 'z' ? (lane.dir > 0 ? Math.PI : 0) : (lane.dir > 0 ? -Math.PI / 2 : Math.PI / 2);
      car.mesh.visible = Math.abs(p.x - raid.focus.x) < 120 && Math.abs(p.z - raid.focus.z) < 120;
      car.honkIn -= dt;

      for (const a of raid.actors) {
        if (!a.alive || a.isBoss || (a.type === 'dicer')) continue;
        const along = lane.axis === 'z' ? a.pos.z - p.z : a.pos.x - p.x;
        const across = lane.axis === 'z' ? a.pos.x - p.x : a.pos.z - p.z;
        // Honk at the player if they're standing in the lane ahead.
        if (a.isPlayer && car.honkIn <= 0 && Math.abs(across) < 2.5 && along * lane.dir > 3 && along * lane.dir < 22) {
          sfx.honk(a.pos, raid.listener);
          car.honkIn = 2.5;
        }
        if (Math.abs(along) > 2.4 || Math.abs(across) > 1.4 || a.pos.y > 1.6) continue;
        const last = car.hitCooldown.get(a) || 0;
        if (performance.now() - last < 1500) continue;
        car.hitCooldown.set(a, performance.now());
        // Splat.
        const fling = new THREE.Vector3(lane.axis === 'x' ? lane.dir : Math.sign(across || 1) * 0.4, 0, lane.axis === 'z' ? lane.dir : Math.sign(across || 1) * 0.4).normalize();
        if (a.vel) {
          a.vel.addScaledVector(fling, 16);
          a.vel.y += 9;
          a.onGround = false;
        }
        sfx.boom(a.pos, raid.listener);
        raid.shake = Math.max(raid.shake, a.isPlayer ? 0.7 : raid.shake);
        raid.damage(a, a.team === 'machine' ? 80 : 45, CAR, a.pos.clone().setY(a.pos.y + 1.6));
        if (a.isPlayer && !a.alive) raid.feed('🚗 You got hit by a car. Look both ways!');
        else if (a.isPlayer) raid.hud.toast('🚗 HIT BY A CAR! Stay off the road.', 'big');
      }
    }

    // ---- Cold ----
    const p = raid.player;
    if (this.cold && p && p.alive && raid.active) {
      const inside = raid.map.zones.some((z) => z.indoor && Math.abs(p.pos.x - z.x) < z.w / 2 && Math.abs(p.pos.z - z.z) < z.d / 2);
      const byFire = this.fires.some((f) => Math.hypot(p.pos.x - f.x, p.pos.z - f.z) < PLAYER.fireRadius);
      p.warmSource = byFire ? 'fire' : inside ? 'inside' : null;
      if (p.warmSource) p.warmth = Math.min(PLAYER.maxWarmth, p.warmth + PLAYER.warmGain * dt);
      else p.warmth = Math.max(0, p.warmth - PLAYER.coldDrain * dt);
      if (p.warmth <= 0) {
        this.freezeTick = (this.freezeTick || 0) + dt;
        if (this.freezeTick >= 1) {
          this.freezeTick = 0;
          // Frostbite goes straight through armor.
          const armor = p.armor;
          p.armor = 0;
          raid.damage(p, PLAYER.freezeDamage, COLD, p.pos.clone().setY(p.pos.y + 1.8));
          p.armor = armor;
          if (!p.alive) raid.feed('🥶 You froze solid');
        }
      }
      if (p.warmth < 30 && !this.warned) {
        this.warned = true;
        raid.hud.toast('🥶 You\'re freezing! Find a fire 🔥 or get indoors.', 'big');
      }
      if (p.warmth > 50) this.warned = false;
    }
  }
}
