// Physical poker chips. Getting hit sprays your chips on the floor; anyone can grab them.
import * as THREE from 'three';
import { CHIP_VALUE } from './config.js';
import { toon, outline } from './toon.js';
import { sfx } from './audio.js';

const chipGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.07, 16);
const MATS = [0xe63946, 0x1d4ed8, 0x2a9d8f, 0xffd23f].map((c) => toon(c));
const MAX_CHIPS = 400;

export class ChipSystem {
  constructor(game) {
    this.game = game;
    this.list = [];
  }

  // Throws `amount` worth of chips out from `origin`. Owner can't re-grab them for a moment.
  spawnBurst(origin, amount, owner, { toward = null, speed = 4 } = {}) {
    if (amount <= 0) return;
    const count = Math.min(24, Math.ceil(amount / CHIP_VALUE));
    const base = Math.floor(amount / count);
    let left = amount;
    for (let i = 0; i < count; i++) {
      const value = i === count - 1 ? left : base;
      left -= value;
      const mesh = new THREE.Mesh(chipGeo, MATS[Math.floor(Math.random() * MATS.length)]);
      mesh.castShadow = true;
      outline(mesh, 0.02);
      mesh.position.copy(origin);
      this.game.scene.add(mesh);
      const a = Math.random() * Math.PI * 2;
      const vel = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(speed * (0.5 + Math.random()));
      if (toward) {
        const dir = toward.clone().sub(origin).setY(0).normalize();
        vel.addScaledVector(dir, speed * 1.2);
      }
      vel.y = 4 + Math.random() * 4;
      this.list.push({
        mesh,
        vel,
        value,
        owner,
        lockUntil: 1.0,
        age: 0,
        spin: new THREE.Vector3(Math.random() * 12, Math.random() * 12, 0),
        resting: false,
      });
    }
    while (this.list.length > MAX_CHIPS) this.remove(0);
  }

  remove(i) {
    this.game.scene.remove(this.list[i].mesh);
    this.list.splice(i, 1);
  }

  clear() {
    while (this.list.length) this.remove(0);
  }

  update(dt) {
    const world = this.game.world;
    const people = this.game.combatants;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const chip = this.list[i];
      const p = chip.mesh.position;
      chip.age += dt;

      // Magnet toward nearby players once it's been on the ground a moment.
      let collector = null;
      for (const c of people) {
        if (!c.alive) continue;
        if (c === chip.owner && chip.age < chip.lockUntil) continue;
        const dx = c.pos.x - p.x;
        const dy = c.pos.y + 0.6 - p.y;
        const dz = c.pos.z - p.z;
        const d = Math.hypot(dx, dy, dz);
        if (d < 0.9) { collector = c; break; }
        if (d < 3 && chip.age > 0.5) {
          chip.vel.x += (dx / d) * 40 * dt;
          chip.vel.z += (dz / d) * 40 * dt;
          chip.vel.y += (dy / d) * 40 * dt;
          chip.resting = false;
        }
      }
      if (collector) {
        collector.chips += chip.value;
        if (collector.isPlayer) sfx.pickup();
        this.remove(i);
        continue;
      }

      if (chip.age > 45) {
        this.remove(i);
        continue;
      }
      if (chip.resting) continue;

      chip.vel.y -= 20 * dt;
      p.addScaledVector(chip.vel, dt);
      chip.mesh.rotation.x += chip.spin.x * dt;
      chip.mesh.rotation.z += chip.spin.y * dt;

      const ground = world.groundAt(p.x, p.z, p.y) + 0.035;
      if (p.y <= ground) {
        p.y = ground;
        if (chip.vel.y < -2) {
          chip.vel.y *= -0.35;
          chip.vel.x *= 0.6;
          chip.vel.z *= 0.6;
          chip.spin.multiplyScalar(0.5);
        } else {
          chip.vel.set(0, 0, 0);
          chip.mesh.rotation.set(0, chip.mesh.rotation.y, 0);
          chip.resting = true;
        }
      }
      // Keep chips inside the room.
      p.x = Math.max(-world.halfW + 1, Math.min(world.halfW - 1, p.x));
      p.z = Math.max(-world.halfD + 1, Math.min(world.halfD - 1, p.z));
    }
  }
}
