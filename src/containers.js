// Things you can search for loot: hold E next to one. Safes take longer but pay better.
import * as THREE from 'three';
import { part, toon } from './toon.js';
import { rollLoot, randInt } from './items.js';
import { sfx } from './audio.js';
import { keyName } from './keys.js';

const KINDS = {
  register: { name: 'Cash Register', time: 1.0, rolls: [1, 2], tierBonus: 0, color: 0x4b5563, lid: 0xffd23f },
  crate: { name: 'Chip Crate', time: 1.2, rolls: [1, 2], tierBonus: 0, color: 0xb7791f, lid: 0x6b3a1e },
  locker: { name: 'Locker', time: 1.6, rolls: [2, 2], tierBonus: 0, color: 0x64748b, lid: 0x94a3b8 },
  safe: { name: 'Safe', time: 2.6, rolls: [2, 3], tierBonus: 1, color: 0x1f2937, lid: 0xd4a63a },
  vault: { name: 'Vault Box', time: 3.0, rolls: [3, 3], tierBonus: 0, color: 0xd4a63a, lid: 0xffc83d },
};

export class Container {
  constructor(raid, { kind, x, z, tier, rot = 0 }) {
    this.raid = raid;
    this.kind = kind;
    this.def = KINDS[kind];
    this.tier = Math.min(4, tier + this.def.tierBonus);
    this.spot = new THREE.Vector3(x, 0, z);
    this.range = 1.9;
    this.opened = false;

    // The body is static scenery; the lid is the only moving part.
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    let h;
    if (kind === 'register') {
      const stand = part(new THREE.BoxGeometry(0.8, 1.0, 0.6), 0x2b2140);
      stand.position.y = 0.5;
      const reg = part(new THREE.BoxGeometry(0.7, 0.35, 0.55), this.def.color);
      reg.position.y = 1.18;
      g.add(stand, reg);
      h = 1.35;
    } else if (kind === 'locker') {
      const body = part(new THREE.BoxGeometry(0.9, 2.1, 0.7), this.def.color);
      body.position.y = 1.05;
      g.add(body);
      h = 2.1;
    } else {
      const s = kind === 'crate' ? 1.1 : kind === 'safe' ? 1.0 : 1.2;
      const body = part(new THREE.BoxGeometry(s, s, s), this.def.color);
      body.position.y = s / 2;
      g.add(body);
      if (kind === 'safe' || kind === 'vault') {
        const dial = part(new THREE.CylinderGeometry(0.15, 0.15, 0.06, 12), 0xd1d5db, { ink: 0.015 });
        dial.rotation.x = Math.PI / 2;
        dial.position.set(0, s * 0.55, s / 2 + 0.03);
        g.add(dial);
      }
      h = s;
    }
    raid.map.statics.add(g);
    raid.map.addCollider({ type: 'box', minX: x - 0.5, maxX: x + 0.5, minZ: z - 0.45, maxZ: z + 0.45, top: h });

    this.lid = new THREE.Mesh(new THREE.BoxGeometry(kind === 'locker' ? 0.8 : 0.9, 0.12, kind === 'locker' ? 0.6 : 0.8), toon(this.def.lid));
    this.lid.position.set(x, h + 0.06, z);
    this.lid.rotation.y = rot;
    raid.scene.add(this.lid);
    this.h = h;
  }

  get name() { return this.def.name; }

  prompt() {
    if (this.opened) return null;
    return `<b>Hold ${keyName('use')}</b> Search the ${this.def.name}`;
  }

  // Containers are searched by holding E; the controller calls open() when it's done.
  get searchTime() { return this.def.time; }

  open(c) {
    if (this.opened) return;
    this.opened = true;
    this.lid.position.y = this.h + 0.5;
    this.lid.rotation.x = -0.9;
    sfx.open(this.spot, this.raid.listener);
    const [a, b] = this.def.rolls;
    const n = randInt(a, b);
    for (let i = 0; i < n; i++) {
      const loot = rollLoot(this.tier);
      const at = this.spot.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2));
      if (loot.chips) this.raid.chips.spawnBurst(at.setY(this.h + 0.3), loot.chips, null, { speed: 1.5 });
      else {
        // Spill out toward the person who opened it, fanned out a little.
        const dir = c ? new THREE.Vector3(c.pos.x - this.spot.x, 0, c.pos.z - this.spot.z) : new THREE.Vector3(0, 0, 1);
        if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
        dir.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), (i - (n - 1) / 2) * 0.6);
        this.raid.dropItem(this.spot.clone().addScaledVector(dir, 1.4), loot, this.spot);
      }
    }
  }

  reset() {
    this.opened = false;
    this.lid.position.y = this.h + 0.06;
    this.lid.rotation.x = 0;
  }

  // Only draw lids near the camera.
  cull(focus) {
    this.lid.visible = Math.abs(focus.x - this.spot.x) < 70 && Math.abs(focus.z - this.spot.z) < 70;
  }
}
