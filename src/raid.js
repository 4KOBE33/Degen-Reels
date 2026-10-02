// A raid: drop into a map with a loadout, loot, fight machines (and maybe other raiders),
// then reach an extraction point before time runs out. Die and you lose everything you carried.
import * as THREE from 'three';
import {
  WEAPONS, RARITIES, RAID_TIME, EXTRACT_TIME, BOSS_TIME, RAIDERS, RAIDER_NAMES, COLORS, HATS, ENEMIES, ITEMS,
} from './config.js';
import { buildMap, drawMinimap, neonSign } from './map.js';
import { SlotMachine } from './slots.js';
import { Container } from './containers.js';
import { ChipSystem } from './chips.js';
import { Fx } from './fx.js';
import { Combatant } from './combatant.js';
import { Machine } from './enemies.js';
import { Hazards } from './hazards.js';
import { RaiderBrain } from './bots.js';
import { ItemPickup } from './pickups.js';
import {
  makeGun, makeItem, rollLoot, randInt, pick, addToList, itemInfo, isGun, rollRarity, fullAmmo,
} from './items.js';
import { part } from './toon.js';
import { save } from './save.js';
import { sfx } from './audio.js';

const raycaster = new THREE.Raycaster();
const tmp = new THREE.Vector3();
// Cherry Bomb throws.
const GRENADE_SPEED = 17;
const GRENADE_LIFT = 4.5;
const GRENADE_GRAVITY = 22;

export class Raid {
  constructor(hud, mapId = 'vegas') {
    this.mapId = mapId;
    this.hud = hud;
    this.scene = new THREE.Scene();
    this.map = buildMap(this.scene, mapId);
    this.fx = new Fx(this.scene);
    this.chips = new ChipSystem(this);
    this.listener = new THREE.Vector3();
    this.focus = new THREE.Vector3(0, 0, 40);
    this.shake = 0;
    this.frozen = false;

    this.slots = this.map.slotSpots.map((s) => new SlotMachine(this, s));
    this.containers = this.map.containers.map((c) => new Container(this, c));
    this.buildVaultDoor();
    this.buildExtracts();
    this.hazards = new Hazards(this);
    this.map.bake();
    this.minimap = drawMinimap(this.map, 512, false);
    this.bigmap = drawMinimap(this.map, 1024, true);

    this.combatants = [];
    this.bots = [];
    this.machines = [];
    this.pickups = [];
    this.rockets = [];
    this.grenades = [];
    this.player = null;
    this.active = false;
    this.populate();
  }

  get actors() {
    return this.combatants.concat(this.machines);
  }

  // ---------- setup ----------

  buildVaultDoor() {
    const { vault } = this.map;
    this.vaultDoor = part(new THREE.BoxGeometry(5, 9.5, 0.6), 0x9ca3af, { ink: 0.05 });
    this.vaultDoor.position.set(vault.x, 4.75, vault.doorZ);
    const wheel = part(new THREE.TorusGeometry(1.1, 0.15, 8, 20), 0xd4a63a, { ink: 0.02 });
    wheel.position.set(0, -0.5, 0.4);
    this.vaultDoor.add(wheel);
    this.scene.add(this.vaultDoor);
    this.vaultCollider = this.map.addCollider({ type: 'box', minX: vault.x - 2.5, maxX: vault.x + 2.5, minZ: vault.doorZ - 0.4, maxZ: vault.doorZ + 0.4, top: 10 });
    this.vaultOpen = false;
    this.vaultLock = {
      spot: new THREE.Vector3(vault.x, 0, vault.doorZ + 1.6),
      range: 2.2,
      prompt: (c) => {
        if (this.vaultOpen) return null;
        return c.count('keycard') ? '<b>E</b> Swipe your 💳 Vault Keycard' : '🔒 The Vault needs a 💳 Vault Keycard';
      },
      use: (c) => {
        if (this.vaultOpen) return null;
        if (!c.takeOne('keycard')) return 'You need a Vault Keycard. They turn up in the casino.';
        this.openVault(c);
        return null;
      },
    };
  }

  openVault(c) {
    this.vaultOpen = true;
    this.vaultCollider.disabled = true;
    this.map.removeCollider(this.vaultCollider);
    sfx.jackpot(this.vaultDoor.position, this.listener);
    this.feed(`💳 ${c.name} opened the Vault!`);
    if (c.isPlayer) this.hud.toast('🔓 THE VAULT IS OPEN', 'big');
  }

  closeVault() {
    if (this.vaultOpen) this.map.addCollider(this.vaultCollider);
    this.vaultCollider.disabled = false;
    this.vaultOpen = false;
    this.vaultDoor.position.y = 4.75;
  }

  buildExtracts() {
    this.extracts = this.map.extracts.map((e) => {
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(4.5, 4.5, 40, 24, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x5ee27a, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
      );
      beam.position.set(e.x, 20, e.z);
      const ring = new THREE.Mesh(new THREE.RingGeometry(4.3, 5, 32), new THREE.MeshBasicMaterial({ color: 0x5ee27a, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(e.x, 0.08, e.z);
      const sign = neonSign(`EXIT: ${e.name.toUpperCase()}`, '#5ee27a', 10);
      sign.position.set(e.x, 7, e.z);
      this.scene.add(beam, ring, sign);
      return { ...e, beam, ring, sign, active: false };
    });
  }

  // Free GPU memory when switching to a different map.
  dispose() {
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const m = o.material;
      if (m && !Array.isArray(m) && m.map && m.map.userData && m.map.userData.canvas) m.map.dispose();
    });
  }

  // Fresh machines and raiders. Used for the menu backdrop and at the start of each raid.
  populate() {
    for (const m of this.machines) this.scene.remove(m.group);
    for (const c of this.combatants) if (!c.isPlayer) this.scene.remove(c.char.root);
    this.machines = [];
    this.bots = [];
    this.combatants = this.combatants.filter((c) => c.isPlayer);
    for (const s of this.map.enemySpots) this.spawnMachine(s.type, s.x, s.z);
    // Bayou ponds hide gators.
    if (this.mapId === 'bayou') for (const pd of this.map.hazards.ponds) this.spawnMachine('gator', pd.x, pd.z);
    for (let i = 0; i < RAIDERS.count; i++) this.spawnRaider();
  }

  spawnMachine(type, x, z) {
    if (type !== 'gator' && type !== 'boss') [x, z] = this.openSpot(x, z, 0.9);
    const m = new Machine(this, type, x, z);
    this.machines.push(m);
    return m;
  }

  spawnRaider() {
    const taken = new Set(this.combatants.map((c) => c.name));
    const name = pick(RAIDER_NAMES.filter((n) => !taken.has(n))) || 'Some Raider';
    const c = new Combatant(this, { name, color: pick(COLORS), hat: pick(HATS) });
    const [sx, sz] = pick(this.map.spawns);
    const [x, z] = this.openSpot(sx + (Math.random() - 0.5) * 10, sz + (Math.random() - 0.5) * 10);
    c.pos.set(x, 0, z);
    c.equip(makeGun(pick(['pistol', 'pistol', 'smg', 'shotgun']), rollRarity(1)));
    c.backpack.push(makeItem('bandage', 2));
    if (Math.random() < 0.35) c.backpack.push(makeItem('grenade', randInt(1, 2)));
    if (Math.random() < 0.5) c.backpack.push(rollLoot(2).chips ? makeItem('dice') : rollLoot(2));
    c.chips = randInt(20, 120);
    this.combatants.push(c);
    this.bots.push(new RaiderBrain(this, c));
    return c;
  }

  // ---------- raid lifecycle ----------

  deploy({ name, color, hat, loadout }) {
    // Reset the map.
    for (const p of this.pickups) p.remove();
    this.pickups = [];
    this.chips.clear();
    for (const r of this.rockets) this.scene.remove(r.mesh);
    this.rockets = [];
    for (const g of this.grenades) this.scene.remove(g.mesh);
    this.grenades = [];
    for (const k of this.containers) k.reset();
    for (const s of this.slots) s.user = null;
    this.closeVault();
    if (this.player) {
      this.scene.remove(this.player.char.root);
      this.combatants = this.combatants.filter((c) => c !== this.player);
    }
    this.populate();

    // Two of the four exits are open each raid.
    const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    this.extracts.forEach((e, i) => {
      e.active = order.indexOf(i) < 2;
      e.beam.material.color.setHex(e.active ? 0x5ee27a : 0xff5d5d);
      e.ring.material.color.setHex(e.active ? 0x5ee27a : 0xff5d5d);
      e.beam.visible = e.active;
      e.sign.visible = e.active;
    });

    const p = new Combatant(this, { name, color, hat, isPlayer: true });
    const [sx, sz] = pick(this.map.spawns);
    const [x, z] = this.openSpot(sx, sz);
    p.pos.set(x, 0, z);
    p.yaw = Math.atan2(x, z);
    for (const gun of loadout.weapons) {
      if (!gun) continue;
      const g = { ...gun };
      if (!Number.isFinite(g.ammo)) g.ammo = fullAmmo(g.kind, g.rarity);
      p.equip(g);
    }
    for (const it of loadout.items) addToList(p.backpack, { ...it }, p.capacity);
    this.player = p;
    this.combatants.push(p);

    this.timeLeft = RAID_TIME;
    this.elapsed = 0;
    this.extractT = 0;
    this.bossSpawned = false;
    this.boss = null;
    this.warned = {};
    this.run = { kills: 0, machines: 0, raiders: 0, boss: false, started: performance.now() };
    this.active = true;
    this.frozen = false;
    this.result = null;
    save.update((d) => { d.stats.raids++; });
    this.hud.raidIntro(this);
  }

  // Successful extraction: everything you're carrying goes to the stash.
  extract(where) {
    if (!this.active) return;
    const p = this.player;
    const items = [...p.weapons.filter(Boolean), ...p.backpack];
    const value = items.reduce((n, it) => n + itemInfo(it).value, 0) + p.chips;
    sfx.extract();
    const newHats = save.update((d) => {
      d.stats.extracts++;
      d.stats.bestHaul = Math.max(d.stats.bestHaul, value);
      d.stash.chips += p.chips;
      for (const it of items) {
        if (!isGun(it)) {
          const same = d.stash.items.find((o) => o.id === it.id);
          if (same) { same.qty += it.qty; continue; }
        }
        d.stash.items.push({ ...it });
      }
    });
    this.finish({ success: true, where, items, chips: p.chips, value, newHats });
    // The player escapes: pull them out of the world.
    p.alive = false;
    p.char.root.visible = false;
  }

  fail(reason, by) {
    if (!this.active) return;
    const p = this.player;
    const items = [...p.weapons.filter(Boolean), ...p.backpack];
    const value = items.reduce((n, it) => n + itemInfo(it).value, 0) + p.chips;
    const newHats = save.update((d) => { d.stats.deaths++; });
    this.finish({ success: false, reason, by, items, chips: p.chips, value, newHats });
  }

  finish(result) {
    this.active = false;
    this.result = { ...result, run: this.run, time: RAID_TIME - this.timeLeft };
    this.hud.raidOver(this.result);
  }

  // ---------- interaction ----------

  get interactables() {
    const list = [...this.slots, ...this.pickups, this.vaultLock];
    for (const k of this.containers) if (!k.opened) list.push(k);
    return list;
  }

  // What E does right now. Loot on the floor always beats the machine or crate next to it,
  // so you can never get stuck re-pulling a lever when you meant to grab the prize.
  nearbyInteractable(c) {
    let best = null;
    let bestScore = Infinity;
    for (const it of this.interactables) {
      const dx = it.spot.x - c.pos.x;
      const dz = it.spot.z - c.pos.z;
      if (Math.abs(dx) > 3 || Math.abs(dz) > 3) continue;
      const d = Math.hypot(dx, dz);
      if (d >= (it.range || 1.6) || Math.abs((it.spot.y || 0) - c.pos.y) >= 2.5 || !it.prompt(c)) continue;
      const score = d - (it instanceof ItemPickup ? 10 : 0);
      if (score < bestScore) { bestScore = score; best = it; }
    }
    return best;
  }

  takeItem(c, pickup) {
    if (!this.pickups.includes(pickup)) return null;
    const item = pickup.item;
    let ok;
    if (isGun(item)) ok = c.equip(item) || addToList(c.backpack, item, c.capacity);
    else ok = addToList(c.backpack, item, c.capacity);
    if (!ok) return c.isPlayer ? 'Backpack full. Press Q and drop something.' : 'full';
    pickup.remove();
    this.pickups = this.pickups.filter((p) => p !== pickup);
    if (c.isPlayer) {
      const info = itemInfo(item);
      sfx.pickup();
      if (info.rarity >= 2) sfx.win();
      const hint = { ammo: ' · press R to reload', grenade: ' · hold T to throw', bandage: ' · press H to heal', soda: ' · press H to heal', plate: ' · press F to use', cocoa: ' · press G to drink' }[item.id] || '';
      this.hud.toast(`+ ${info.icon} ${info.name}${hint}`, info.rarity >= 2 ? 'big' : '');
    }
    return null;
  }

  // Drop an item near `pos`. `from` is where it came out of (a crate, a machine, a body):
  // the item always lands somewhere open and reachable from there, never inside furniture
  // or on the far side of a wall.
  dropItem(pos, item, from = null) {
    const spot = this.findDropSpot(from || pos, pos);
    const p = new ItemPickup(this, spot, item, from);
    this.pickups.push(p);
    return p;
  }

  // The nearest open ground to (x, z), so nobody spawns inside a rock or a wall.
  openSpot(x, z, pad = 0.7) {
    if (this.map.isFree(x, z, pad)) return [x, z];
    for (let r = 1.5; r <= 12; r += 1.5) {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const nx = x + Math.cos(a) * r;
        const nz = z + Math.sin(a) * r;
        if (this.map.isFree(nx, nz, pad)) return [nx, nz];
      }
    }
    return [x, z];
  }

  findDropSpot(from, want) {
    const origin = new THREE.Vector3(from.x, 1.0, from.z);
    const reachable = (x, z) => {
      if (!this.map.isFree(x, z, 0.6)) return false;
      if (this.pickups.some((pk) => Math.hypot(pk.spot.x - x, pk.spot.z - z) < 0.6)) return false;
      const to = new THREE.Vector3(x, 1.0, z);
      const d = origin.distanceTo(to);
      if (d < 0.05) return true;
      return !this.raycast(origin, to.sub(origin).normalize(), d, null, { solidsOnly: true }).hit;
    };
    if (reachable(want.x, want.z)) return new THREE.Vector3(want.x, 0, want.z);
    // Spiral outward from the source, starting in the direction we wanted.
    const base = Math.atan2(want.z - from.z, want.x - from.x) || 0;
    for (const r of [1.2, 1.7, 2.3, 3, 3.8, 4.8]) {
      for (let k = 0; k < 12; k++) {
        const a = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 6);
        const x = from.x + Math.cos(a) * r;
        const z = from.z + Math.sin(a) * r;
        if (reachable(x, z)) return new THREE.Vector3(x, 0, z);
      }
    }
    return new THREE.Vector3(want.x, 0, want.z);
  }

  // Move a gun from the backpack into a weapon slot (swapping if both are full).
  equipFromPack(c, i) {
    const gun = c.backpack[i];
    if (!isGun(gun)) return 'That isn\'t a gun';
    const slot = c.weapons[c.active] ? (c.weapons.indexOf(null) >= 0 ? c.weapons.indexOf(null) : c.active) : c.active;
    const old = c.weapons[slot];
    c.weapons[slot] = gun;
    c.backpack.splice(i, 1);
    if (old) c.backpack.splice(i, 0, old);
    c.active = slot;
    c.refreshWeapon();
    return null;
  }

  // Stash a weapon in the backpack.
  unequipToPack(c, slot) {
    const gun = c.weapons[slot];
    if (!gun) return null;
    if (c.backpack.length >= c.capacity) return 'Backpack is full';
    c.backpack.push(gun);
    c.weapons[slot] = null;
    c.refreshWeapon();
    return null;
  }

  // Drop something from your inventory onto the floor in front of you.
  dropFromInventory(c, where, index) {
    let item;
    if (where === 'weapon') {
      item = c.weapons[index];
      if (!item) return;
      c.weapons[index] = null;
      c.refreshWeapon();
    } else {
      item = c.backpack.splice(index, 1)[0];
      if (!item) return;
    }
    this.dropItem(c.pos.clone().addScaledVector(c.forward, 1.5), item, c.pos);
  }

  // ---------- combat ----------

  raycast(origin, dir, range, ignore, { solidsOnly = false } = {}) {
    const targets = this.map.rayTargets(origin, dir, range);
    if (!solidsOnly) {
      for (const a of this.actors) {
        if (!a.alive || a === ignore) continue;
        if (a.pos.distanceTo(origin) > range + 8) continue;
        targets.push(a.hitMesh);
        if (a.critMesh) targets.push(a.critMesh);
      }
    }
    raycaster.set(origin, dir);
    raycaster.far = range;
    const hit = raycaster.intersectObjects(targets, false)[0];
    if (hit) {
      const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : null;
      return { hit: true, point: hit.point.clone(), target: hit.object.userData.actor || null, crit: hit.object.userData.crit || 1, distance: hit.distance, normal };
    }
    return { hit: false, point: origin.clone().addScaledVector(dir, range), target: null, distance: range };
  }

  // Fire whatever `c` is holding. `origin`/`dir` is the aim ray (camera for you, head for bots).
  fire(c, origin, dir) {
    const w = WEAPONS[c.weapon];
    if (!c.alive || c.cooldown > 0 || c.using || this.frozen) return false;
    if (Number.isFinite(c.ammo) && c.ammo <= 0) {
      const refusal = c.reload();
      if (c.isPlayer) {
        if (refusal) { this.hud.toast('Out of ammo! Find an 📦 Ammo Box or switch guns.'); sfx.deny(); } else this.hud.toast('Reloading…');
      }
      c.cooldown = Math.max(c.cooldown, 0.5);
      return true;
    }
    c.cooldown = w.rate;
    const damage = w.damage * RARITIES[c.rarity].damage;
    const muzzle = c.char.muzzle.getWorldPosition(new THREE.Vector3());

    if (w.melee) {
      c.char.swing();
      sfx.swing(c.pos, this.listener);
      const fwd = c.forward;
      for (const o of this.actors) {
        if (o === c || !o.alive) continue;
        const to = tmp.copy(o.pos).sub(c.pos);
        if (Math.abs(to.y) > 2) continue;
        to.y = 0;
        const d = to.length();
        if (d > w.range + (o.radius || 0.5) + 0.3 || to.normalize().dot(fwd) < 0.35) continue;
        if (o.vel) { o.vel.addScaledVector(fwd, 6); o.vel.y += 2; }
        sfx.bonk(o.pos, this.listener);
        this.damage(o, damage, c, o.center(new THREE.Vector3()));
      }
      return true;
    }

    c.gun.ammo--;
    c.char.recoil(w.projectile ? 1.6 : 1);
    this.fx.muzzleFlash(muzzle);
    sfx.shoot(c.weapon, c.pos, this.listener);

    if (w.projectile) {
      const aim = this.raycast(origin, dir, 200, c).point;
      this.spawnRocket(muzzle, aim.sub(muzzle).normalize(), c, c.rarity);
    } else {
      // Bad footing means bad aim: even a laser-accurate rifle sprays when you're sprinting or mid-air.
      const pen = c.aimPenalty();
      const spread = w.spread * pen + Math.max(0, pen - 1) * 0.012;
      for (let i = 0; i < w.pellets; i++) {
        const d = dir.clone();
        d.x += (Math.random() - 0.5) * 2 * spread;
        d.y += (Math.random() - 0.5) * 2 * spread;
        d.z += (Math.random() - 0.5) * 2 * spread;
        d.normalize();
        const hit = this.raycast(origin, d, w.range, c);
        this.fx.tracer(muzzle, hit.point, c.rarity ? new THREE.Color(RARITIES[c.rarity].css).getHex() : 0xffe066);
        if (hit.target) this.damage(hit.target, damage * hit.crit, c, hit.point, hit.crit > 1);
        else if (hit.hit) this.fx.puff(hit.point, 0xfff6e0, 0.12);
      }
    }
    return true;
  }

  machineShot(m, origin, dir, damage) {
    const hit = this.raycast(origin, dir, m.def.range + 10, m);
    this.fx.tracer(origin, hit.point, 0xff3fa4);
    this.fx.muzzleFlash(origin);
    sfx.zap(origin, this.listener);
    if (hit.target && hit.target.team !== 'machine') this.damage(hit.target, damage * this.map.toughness, m, hit.point);
    else if (hit.hit) this.fx.puff(hit.point, 0xff7eb6, 0.12);
  }

  meleeHit(m, target, damage) {
    if (!target.alive || target.pos.distanceTo(m.pos) > m.def.range + 0.8) return;
    sfx.swing(m.pos, this.listener);
    if (target.vel) target.vel.addScaledVector(target.pos.clone().sub(m.pos).setY(0).normalize(), 6);
    this.damage(target, damage, m, target.center(new THREE.Vector3()));
  }

  // The Pit Boss's ground pound.
  slam(boss, radius, damage) {
    this.fx.explosion(boss.pos.clone().setY(0.5), radius);
    sfx.boom(boss.pos, this.listener);
    this.shake = Math.max(this.shake, 0.6);
    for (const a of this.combatants) {
      if (!a.alive) continue;
      const d = a.pos.distanceTo(boss.pos);
      if (d > radius) continue;
      a.vel.add(a.pos.clone().sub(boss.pos).setY(0).normalize().multiplyScalar(14));
      a.vel.y += 8;
      a.onGround = false;
      this.damage(a, damage * (1 - d / radius * 0.5), boss, a.center(new THREE.Vector3()));
    }
  }

  spawnRocket(pos, dir, owner, rarity = 0, damage = null) {
    const mesh = new THREE.Group();
    const body = part(new THREE.CylinderGeometry(0.12, 0.12, 0.6, 10), owner.team === 'machine' ? 0xff3fa4 : 0x5ee27a, { ink: 0.025, shadow: false });
    body.rotation.x = Math.PI / 2;
    const tip = part(new THREE.ConeGeometry(0.12, 0.25, 10), 0xe63946, { ink: 0.025, shadow: false });
    tip.rotation.x = -Math.PI / 2;
    tip.position.z = -0.42;
    mesh.add(body, tip);
    mesh.position.copy(pos);
    mesh.lookAt(pos.clone().sub(dir));
    this.scene.add(mesh);
    this.rockets.push({ mesh, dir: dir.clone(), owner, rarity, damage, life: 3, trail: 0, speed: owner.team === 'machine' ? 20 : WEAPONS.rocket.speed });
  }

  updateRockets(dt) {
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.life -= dt;
      const step = r.speed * dt;
      const hit = this.raycast(r.mesh.position, r.dir, step, r.owner);
      if (hit.hit || r.life <= 0) {
        this.explode(hit.hit ? hit.point.addScaledVector(r.dir, -0.2) : r.mesh.position.clone(), r);
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

  // ---------- grenades ----------

  // Where a throw starts and how fast it goes. Shared by real throws and the aiming arc.
  grenadeLaunch(origin, dir) {
    const pos = origin.clone().addScaledVector(dir, 0.6);
    const vel = dir.clone().multiplyScalar(GRENADE_SPEED);
    vel.y += GRENADE_LIFT;
    return { pos, vel };
  }

  // Move a grenade one step: gravity, bounces off walls and floors. Returns true if it bounced.
  stepGrenade(g, dt) {
    let bounced = false;
    g.vel.y -= GRENADE_GRAVITY * dt;
    const speed = g.vel.length();
    if (speed > 0.01) {
      const dir = g.vel.clone().divideScalar(speed);
      const hit = this.raycast(g.pos, dir, speed * dt + 0.15, g.owner, { solidsOnly: true });
      if (hit.hit && hit.normal) {
        const n = hit.normal;
        g.pos.copy(hit.point).addScaledVector(n, 0.16);
        g.vel.addScaledVector(n, -2 * g.vel.dot(n)).multiplyScalar(0.45);
        bounced = speed > 3;
      } else g.pos.addScaledVector(g.vel, dt);
    }
    const floor = this.map.groundAt(g.pos.x, g.pos.z, g.pos.y) + 0.15;
    if (g.pos.y < floor) {
      g.pos.y = floor;
      if (g.vel.y < 0) {
        bounced = g.vel.y < -3;
        g.vel.y = Math.abs(g.vel.y) < 2 ? 0 : -g.vel.y * 0.35;
        g.vel.x *= 0.6;
        g.vel.z *= 0.6;
      }
    }
    return bounced;
  }

  spawnGrenade(owner, origin, dir) {
    const def = ITEMS.grenade;
    const { pos, vel } = this.grenadeLaunch(origin, dir);
    const mesh = new THREE.Group();
    const ball = part(new THREE.SphereGeometry(0.2, 12, 10), 0xe63946, { ink: 0.03, shadow: false });
    const stem = part(new THREE.CylinderGeometry(0.025, 0.025, 0.25, 6), 0x2d6a4f, { ink: 0.015, shadow: false });
    stem.position.set(0.05, 0.25, 0);
    stem.rotation.z = -0.4;
    const spark = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
    spark.position.set(0.1, 0.36, 0);
    mesh.add(ball, stem, spark);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.grenades.push({ mesh, spark, pos, vel, owner, fuse: def.fuse, blink: 0 });
    sfx.lever(pos, this.listener);
  }

  updateGrenades(dt) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.fuse -= dt;
      if (this.stepGrenade(g, dt)) sfx.tick(g.pos, this.listener);
      g.mesh.position.copy(g.pos);
      g.mesh.rotation.x += g.vel.length() * dt * 2;
      // The fuse blinks faster as it burns down.
      g.blink += dt * (g.fuse < 0.7 ? 18 : 7);
      g.spark.visible = Math.floor(g.blink) % 2 === 0;
      if (g.fuse <= 0) {
        const def = ITEMS.grenade;
        this.explode(g.pos.clone().setY(g.pos.y + 0.3), { owner: g.owner, damage: def.damage, splash: def.splash });
        this.scene.remove(g.mesh);
        this.grenades.splice(i, 1);
      }
    }
  }

  // Points along the path a throw would take, for the aiming arc.
  grenadeArc(owner, origin, dir) {
    const g = { ...this.grenadeLaunch(origin, dir), owner };
    const pts = [g.pos.clone()];
    const dt = 1 / 30;
    let bounces = 0;
    for (let t = 0; t < ITEMS.grenade.fuse && bounces < 2; t += dt) {
      if (this.stepGrenade(g, dt)) bounces++;
      pts.push(g.pos.clone());
    }
    return pts;
  }

  // Draw the aiming arc as a trail of dots plus a ring showing the blast.
  showArc(pts) {
    if (!this.arc) {
      if (!pts) return;
      const dotGeo = new THREE.SphereGeometry(0.07, 6, 5);
      const dotMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9 });
      const dots = Array.from({ length: 32 }, () => new THREE.Mesh(dotGeo, dotMat));
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40), new THREE.MeshBasicMaterial({ color: 0xff5d5d, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.scale.setScalar(ITEMS.grenade.splash);
      this.arc = new THREE.Group();
      this.arc.add(ring, ...dots);
      this.arc.userData = { dots, ring };
      this.scene.add(this.arc);
    }
    this.arc.visible = !!pts;
    if (!pts) return;
    const { dots, ring } = this.arc.userData;
    dots.forEach((d, i) => {
      const p = pts[i * 2 + 1];
      d.visible = !!p;
      if (p) d.position.copy(p);
    });
    const end = pts[pts.length - 1];
    ring.position.set(end.x, this.map.groundAt(end.x, end.z, end.y) + 0.06, end.z);
  }

  // A bot picks a throw angle that lands near `to`.
  aimGrenade(from, to) {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const d = Math.hypot(dx, dz) || 1;
    let best = null;
    for (let pitch = -0.3; pitch <= 0.9; pitch += 0.05) {
      const dir = new THREE.Vector3((dx / d) * Math.cos(pitch), Math.sin(pitch), (dz / d) * Math.cos(pitch));
      const vh = GRENADE_SPEED * Math.cos(pitch);
      const vy = GRENADE_SPEED * Math.sin(pitch) + GRENADE_LIFT;
      const h0 = from.y - to.y;
      const tLand = (vy + Math.sqrt(Math.max(0, vy * vy + 2 * GRENADE_GRAVITY * h0))) / GRENADE_GRAVITY;
      const err = Math.abs(vh * tLand - d);
      if (!best || err < best.err) best = { dir, err };
    }
    return best.dir;
  }

  explode(point, rocket) {
    const w = { splash: rocket.splash || WEAPONS.rocket.splash, damage: WEAPONS.rocket.damage };
    const owner = rocket.owner;
    this.fx.explosion(point, w.splash);
    sfx.boom(point, this.listener);
    const pd = this.player && this.player.alive ? this.player.pos.distanceTo(point) : 99;
    this.shake = Math.max(this.shake, Math.max(0, 0.6 - pd / 30));
    const base = rocket.damage || w.damage * RARITIES[rocket.rarity || 0].damage;
    for (const a of this.actors) {
      if (!a.alive) continue;
      const center = a.center(new THREE.Vector3());
      const d = center.distanceTo(point);
      if (d > w.splash + (a.radius || 0.5)) continue;
      const k = Math.max(0, 1 - d / w.splash);
      if (a.vel && a.team !== 'machine') {
        a.vel.add(center.clone().sub(point).normalize().multiplyScalar(14 * k));
        a.vel.y += 7 * k;
        a.onGround = false;
      }
      this.damage(a, base * (0.4 + 0.6 * k) * (a === owner ? 0.4 : 1), owner, center);
    }
  }

  damage(target, amount, attacker, at, crit = false) {
    if (!target.alive || this.frozen) return;
    if (attacker && attacker !== target && attacker.team === 'machine' && target.team === 'machine') return;
    amount = Math.round(amount);
    if (amount <= 0) return;
    // Armor soaks up most of a hit until it breaks.
    const absorbed = Math.min(target.armor || 0, Math.round(amount * 0.7));
    target.armor = (target.armor || 0) - absorbed;
    target.hp -= amount - absorbed;
    if (crit) this.fx.number(at, `${amount}!`, '#ffd23f', attacker && attacker.isPlayer ? 1.6 : 1);
    else this.fx.number(at, `${amount}`, absorbed ? '#7dd3fc' : '#ff5d5d', attacker && attacker.isPlayer ? 1.1 : 0.8);
    target.hurt(attacker);
    if (attacker && attacker.isPlayer && target !== attacker) {
      this.hud.hitmarker(target.hp <= 0, crit);
      if (crit) sfx.crit(); else sfx.hit();
    }
    if (target.isPlayer) {
      this.hud.hurt();
      this.shake = Math.max(this.shake, 0.2);
      sfx.hurt();
    }
    // Shooting a raider makes them (and their friends' tempers) hostile to you.
    if (target.brain && attacker && attacker.isPlayer) target.brain.hostile = true;
    if (target.hp <= 0) this.kill(target, attacker);
  }

  kill(target, attacker) {
    target.alive = false;
    target.hp = 0;
    const at = target.pos.clone();
    if (target.team === 'machine') {
      const def = target.def;
      this.fx.explosion(target.center(new THREE.Vector3()), target.isBoss ? 8 : 1.8);
      sfx.bust(at, this.listener);
      this.chips.spawnBurst(target.center(new THREE.Vector3()), randInt(def.chips[0], def.chips[1]), null, { speed: target.isBoss ? 7 : 3 });
      const tier = this.map.tierAt(at.x, at.z);
      if (target.isBoss) {
        for (let i = 0; i < 5; i++) this.dropAround(at, rollLoot(4), 4);
        this.dropAround(at, makeGun(pick(['rifle', 'rocket', 'shotgun']), Math.random() < 0.25 ? 3 : 2), 4);
        this.dropAround(at, makeItem('keycard'), 4);
        if (Math.random() < 0.2) this.dropAround(at, makeItem('clover'), 4);
        if (Math.random() < 0.01) this.dropAround(at, makeItem('crown'), 4);
        this.feed('👑 The Pit Boss is DOWN!');
        if (attacker && attacker.isPlayer) {
          this.run.boss = true;
          const hats = save.update((d) => { d.stats.bossKills++; });
          for (const h of hats) this.hud.toast(`🔓 UNLOCKED: the ${h} hat!`, 'big');
        }
      } else if (target.type === 'gator') {
        if (Math.random() < def.loot) this.dropAround(at, makeItem('tooth'), 1.5);
      } else if (Math.random() < def.loot) {
        this.dropAround(at, rollLoot(tier), 1.5);
      }
      if (attacker && attacker.isPlayer) { this.run.kills++; this.run.machines++; }
      return;
    }
    // A bean went down: everything they carried spills out.
    sfx.bust(at, this.listener);
    this.fx.confetti(at.clone().setY(1.4), 25);
    if (target.using) target.using = null;
    if (target.isPlayer) {
      this.feed(`${attacker ? attacker.name : 'Something'} got you`);
      this.fail('dead', attacker ? attacker.name : null);
      return;
    }
    for (const g of target.weapons) if (g) this.dropAround(at, g, 1.5);
    for (const it of target.backpack) this.dropAround(at, it, 1.5);
    if (target.chips) this.chips.spawnBurst(at.clone().setY(1.2), target.chips, null);
    target.weapons = [null, null];
    target.backpack = [];
    target.chips = 0;
    target.removeIn = 8;
    this.feed(`${attacker ? attacker.name : 'Something'} busted ${target.name}`);
    if (attacker && attacker.isPlayer) { this.run.kills++; this.run.raiders++; }
  }

  dropAround(at, item, spread) {
    if (item.chips) {
      this.chips.spawnBurst(at.clone().setY(1), item.chips, null);
      return;
    }
    this.dropItem(at.clone().add(new THREE.Vector3((Math.random() - 0.5) * spread * 2, 0, (Math.random() - 0.5) * spread * 2)), item, at);
  }

  removeCombatant(c) {
    this.scene.remove(c.char.root);
    this.combatants = this.combatants.filter((o) => o !== c);
    this.bots = this.bots.filter((b) => b.c !== c);
  }

  feed(text) {
    this.hud.feed(text);
  }

  // ---------- loop ----------

  spawnBoss() {
    this.bossSpawned = true;
    const { casino } = this.map;
    this.boss = this.spawnMachine('boss', casino.x, casino.z + 10);
    this.feed('🚨 THE PIT BOSS HAS HIT THE CASINO FLOOR');
    this.hud.toast('🚨 The Pit Boss is on the casino floor. Big risk, bigger loot.', 'big');
    sfx.alert(this.focus, this.listener);
  }

  update(dt) {
    const p = this.player;
    if (p && p.alive) this.focus.copy(p.pos);
    this.listener.copy(this.focus).setY(1.5);

    for (const b of this.bots) b.update(dt);
    for (const c of this.combatants.slice()) {
      c.update(dt);
      c.wantJump = false;
      if (!c.alive && !c.isPlayer) {
        c.removeIn -= dt;
        if (c.removeIn <= 0) this.removeCombatant(c);
      }
    }
    this.machines = this.machines.filter((m) => {
      const keep = m.update(dt);
      if (!keep) this.scene.remove(m.group);
      // Don't draw machines lost in the haze.
      m.group.visible = m.pos.distanceToSquared(this.focus) < 115 * 115;
      return keep;
    });
    for (const c of this.combatants) if (!c.isPlayer) c.char.root.visible = c.pos.distanceToSquared(this.focus) < 115 * 115;
    for (const s of this.slots) s.update(dt);
    for (const k of this.containers) k.cull(this.focus);
    for (const pk of this.pickups) pk.update(dt);
    if (this.vaultOpen && this.vaultDoor.position.y < 14) this.vaultDoor.position.y += dt * 4;
    this.updateRockets(dt);
    this.updateGrenades(dt);
    this.hazards.update(dt);
    this.chips.update(dt);
    this.map.update(dt);
    this.map.followShadow(this.focus);
    this.fx.update(dt);
    this.shake = Math.max(0, this.shake - dt * 1.5);
    for (const e of this.extracts) e.beam.rotation.y += dt * 0.5;

    if (!this.active) return;
    this.timeLeft -= dt;
    this.elapsed += dt;
    if (!this.bossSpawned && this.elapsed >= BOSS_TIME) this.spawnBoss();
    for (const mark of [300, 120, 60, 30]) {
      if (this.timeLeft <= mark && !this.warned[mark]) {
        this.warned[mark] = true;
        this.hud.toast(`⏰ ${mark >= 60 ? `${mark / 60} minute${mark > 60 ? 's' : ''}` : `${mark} seconds`} until The House locks down ${this.map.name}. Get to an exit!`, 'big');
      }
    }
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      p.alive = false;
      this.fail('time');
      return;
    }

    // Extraction: stand in an open exit's circle until the countdown finishes.
    this.extractAt = null;
    if (p.alive) {
      for (const e of this.extracts) {
        if (e.active && Math.hypot(p.pos.x - e.x, p.pos.z - e.z) < 5) this.extractAt = e;
      }
    }
    if (this.extractAt) {
      this.extractT += dt;
      // The noise draws in nearby machines.
      if (Math.floor(this.extractT * 2) !== Math.floor((this.extractT - dt) * 2)) {
        for (const m of this.machines) if (m.alive && !m.target && m.pos.distanceTo(p.pos) < 45) m.target = p;
      }
      if (this.extractT >= EXTRACT_TIME) this.extract(this.extractAt.name);
    } else this.extractT = 0;
  }
}

export { ENEMIES };
