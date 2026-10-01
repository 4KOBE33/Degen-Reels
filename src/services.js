// The cashier (armor and ammo), the elevator up to the next floor, and guns lying on the floor.
import * as THREE from 'three';
import { SHOP, WEAPONS, RARITIES, FLOORS } from './config.js';
import { part, canvasTexture } from './toon.js';
import { buildGun } from './character.js';
import { neonSign } from './world.js';
import { sfx } from './audio.js';

function label(text, color = '#ffd23f') {
  const tex = canvasTexture(512, 128, (c, w, h) => {
    c.fillStyle = '#1b0f2b';
    c.fillRect(0, 0, w, h);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = "70px 'Luckiest Guy', 'Arial Black', sans-serif";
    c.fillStyle = color;
    c.fillText(text, w / 2, h / 2 + 4);
  });
  return new THREE.MeshBasicMaterial({ map: tex });
}

// ---------- Cashier ----------

class Window {
  constructor(spot, promptFn, useFn) {
    this.spot = spot;
    this.prompt = promptFn;
    this.use = useFn;
  }
}

export function buildCashier(game) {
  const { world, floor } = game;
  const { x, z } = world.cashier;
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const counter = part(new THREE.BoxGeometry(2, 1.3, 9), 0x24103d);
  counter.position.y = 0.65;
  const top = part(new THREE.BoxGeometry(2.3, 0.12, 9.3), floor.theme.trim, { ink: 0.02 });
  top.position.y = 1.36;
  g.add(counter, top);
  for (let i = 0; i < 10; i++) {
    const bar = part(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6), floor.theme.trim, { ink: 0.012, shadow: false });
    bar.position.set(0.9, 2.5, -4.2 + i * 0.93);
    g.add(bar);
  }
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), label('CASHIER'));
  sign.position.set(1.0, 4.1, 0);
  sign.rotation.y = Math.PI / 2;
  g.add(sign);
  world.statics.add(g);
  world.addCollider({ type: 'box', minX: x - 1, maxX: x + 1.15, minZ: z - 4.6, maxZ: z + 4.6, top: 1.4 });

  const armorCost = floor.bets[0] * SHOP.armor.costMult;
  const ammoCost = floor.bets[0] * SHOP.ammo.costMult;

  const armor = new Window(
    new THREE.Vector3(x + 2.0, 0, z - 2),
    (c) => (c.armor >= 100 ? 'Armor is maxed out' : `<b>E</b> Buy armor 🛡️ +${SHOP.armor.amount} · 🪙 ${armorCost}`),
    (c) => {
      if (c.armor >= 100) return 'Armor is already maxed out';
      if (c.chips <= armorCost) return `Need more than ${armorCost} chips`;
      c.chips -= armorCost;
      c.armor = Math.min(100, c.armor + SHOP.armor.amount);
      sfx.win();
      return null;
    },
  );

  const fullAmmo = (c) => Math.round(WEAPONS[c.weapon].ammo * RARITIES[c.rarity].ammo);
  const ammo = new Window(
    new THREE.Vector3(x + 2.0, 0, z + 2),
    (c) => {
      if (!Number.isFinite(WEAPONS[c.weapon].ammo)) return 'Ammo window · get a gun first';
      if (c.ammo >= fullAmmo(c)) return 'Your gun is fully loaded';
      return `<b>E</b> Refill ammo · 🪙 ${ammoCost}`;
    },
    (c) => {
      if (!Number.isFinite(WEAPONS[c.weapon].ammo)) return 'Nothing to reload. Hit the slots for a gun.';
      if (c.ammo >= fullAmmo(c)) return 'Already full';
      if (c.chips <= ammoCost) return `Need more than ${ammoCost} chips`;
      c.chips -= ammoCost;
      c.ammo = fullAmmo(c);
      sfx.win();
      return null;
    },
  );
  return [armor, ammo];
}

// ---------- Elevator ----------

export class Elevator {
  constructor(game) {
    this.game = game;
    const { world, floor, floorIndex } = game;
    const { x, z } = world.elevator;
    this.last = floorIndex === FLOORS.length - 1;
    this.spot = new THREE.Vector3(x, 0, z - 1.6);
    this.range = 2.2;
    this.fee = floor.fee;

    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const frame = part(new THREE.BoxGeometry(5, 5, 0.6), floor.theme.trim);
    frame.position.y = 2.5;
    g.add(frame);
    world.statics.add(g);

    this.doors = [];
    for (const side of [-1, 1]) {
      const door = part(new THREE.BoxGeometry(1.9, 4.2, 0.2), 0x9ca3af, { ink: 0.03 });
      door.position.set(x + side * 0.95, 2.1, z - 0.4);
      game.scene.add(door);
      this.doors.push({ mesh: door, side, baseX: x + side * 0.95 });
    }
    const sign = neonSign(this.last ? '$ CASH OUT $' : `▲ FLOOR ${floorIndex + 2}`, '#5ee27a', 7);
    sign.position.set(x, 6, z - 0.45);
    sign.rotation.y = Math.PI;
    game.scene.add(sign);
    const fee = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), label(`FEE 🪙 ${this.fee}`, '#5ee27a'));
    fee.position.set(x, 4.65, z - 0.32);
    fee.rotation.y = Math.PI;
    game.scene.add(fee);
    world.addCollider({ type: 'box', minX: x - 2.5, maxX: x + 2.5, minZ: z - 0.5, maxZ: z + 1, top: 5 });
    this.open = 0;
  }

  prompt(c) {
    const where = this.last ? 'cash out and WIN' : `ride up to Floor ${this.game.floorIndex + 2}`;
    if (c.chips > this.fee) return `<b>E</b> Pay 🪙 ${this.fee} and ${where}`;
    return `Elevator fee is 🪙 ${this.fee}. You have 🪙 ${c.chips}.`;
  }

  use(c) {
    if (c.chips <= this.fee) return `You need more than ${this.fee} chips to ride.`;
    this.game.rideElevator(c, this.fee);
    return null;
  }

  update(dt) {
    const p = this.game.player;
    const near = p && p.alive && Math.hypot(p.pos.x - this.spot.x, p.pos.z - this.spot.z) < 5 && p.chips > this.fee;
    this.open += ((near ? 1 : 0) - this.open) * Math.min(1, dt * 4);
    for (const d of this.doors) d.mesh.position.x = d.baseX + d.side * this.open * 1.6;
  }
}

// ---------- Guns on the floor ----------

export class GunPickup {
  constructor(game, pos, kind, rarity, ammo) {
    this.game = game;
    this.kind = kind;
    this.rarity = rarity;
    this.ammo = ammo;
    this.spot = new THREE.Vector3(pos.x, 0, pos.z);
    this.range = 1.8;
    this.age = 0;
    this.group = new THREE.Group();
    this.group.position.copy(this.spot);
    this.gun = buildGun(kind, RARITIES[rarity].color);
    this.gun.scale.setScalar(1.6);
    this.gun.position.y = 0.9;
    this.group.add(this.gun);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.75, 24),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(RARITIES[rarity].css), transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    this.group.add(ring);
    game.scene.add(this.group);
  }

  get name() {
    const n = WEAPONS[this.kind].name;
    return this.rarity ? `${RARITIES[this.rarity].name} ${n}` : n;
  }

  prompt() {
    const ammo = Number.isFinite(this.ammo) ? ` (${this.ammo} ammo)` : '';
    return `<b>E</b> Take the <span style="color:${RARITIES[this.rarity].css}">${this.name}</span>${ammo}`;
  }

  use(c) {
    this.game.takeGun(c, this);
    return null;
  }

  update(dt) {
    this.age += dt;
    this.gun.rotation.y += dt * 1.5;
    this.gun.position.y = 0.9 + Math.sin(this.age * 3) * 0.12;
  }

  remove() {
    this.game.scene.remove(this.group);
  }
}
