// A raid: drop into a map with a loadout, loot, fight machines (and maybe other raiders),
// then reach an extraction point before time runs out. Die and you lose everything you carried.
import * as THREE from 'three';
import {
  WEAPONS, RARITIES, RAID_TIME, EXTRACT_TIME, BOSS_TIME, RAIDERS, RAIDER_NAMES, COLORS, HATS, ENEMIES,
} from './config.js';
import { buildMap, drawMinimap, neonSign } from './map.js';
import { SlotMachine } from './slots.js';
import { Container } from './containers.js';
import { ChipSystem } from './chips.js';
import { Fx } from './fx.js';
import { Combatant } from './combatant.js';
import { Machine } from './enemies.js';
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
    this.map.bake();
    this.minimap = drawMinimap(this.map, 512);

    this.combatants = [];
    this.bots = [];
    this.machines = [];
    this.pickups = [];
    this.rockets = [];
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
    for (let i = 0; i < RAIDERS.count; i++) this.spawnRaider();
  }

  spawnMachine(type, x, z) {
    const m = new Machine(this, type, x, z);
    this.machines.push(m);
    return m;
  }

  spawnRaider() {
    const taken = new Set(this.combatants.map((c) => c.name));
    const name = pick(RAIDER_NAMES.filter((n) => !taken.has(n))) || 'Some Raider';
    const c = new Combatant(this, { name, color: pick(COLORS), hat: pick(HATS) });
    const [x, z] = pick(this.map.spawns);
    c.pos.set(x + (Math.random() - 0.5) * 10, 0, z + (Math.random() - 0.5) * 10);
    c.equip(makeGun(pick(['pistol', 'pistol', 'smg', 'shotgun']), rollRarity(1)));
    c.backpack.push(makeItem('bandage', 2));
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
    const [x, z] = pick(this.map.spawns);
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

  nearbyInteractable(c) {
    let best = null;
    let bestD = Infinity;
    for (const it of this.interactables) {
      const dx = it.spot.x - c.pos.x;
      const dz = it.spot.z - c.pos.z;
      if (Math.abs(dx) > 3 || Math.abs(dz) > 3) continue;
      const d = Math.hypot(dx, dz);
      if (d < (it.range || 1.6) && d < bestD && Math.abs((it.spot.y || 0) - c.pos.y) < 2.5 && it.prompt(c)) { bestD = d; best = it; }
    }
    return best;
  }

  takeItem(c, pickup) {
    if (!this.pickups.includes(pickup)) return null;
    const item = pickup.item;
    let ok;
    if (isGun(item)) ok = c.equip(item) || addToList(c.backpack, item, c.capacity);
    else ok = addToList(c.backpack, item, c.capacity);
    if (!ok) return c.isPlayer ? 'Backpack full. Press Tab to drop something.' : 'full';
    pickup.remove();
    this.pickups = this.pickups.filter((p) => p !== pickup);
    if (c.isPlayer) {
      const info = itemInfo(item);
      sfx.pickup();
      if (info.rarity >= 2) sfx.win();
      this.hud.toast(`+ ${info.icon} ${info.name}`, info.rarity >= 2 ? 'big' : '');
    }
    return null;
  }

  dropItem(pos, item) {
    const p = new ItemPickup(this, pos, item);
    this.pickups.push(p);
    return p;
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
    this.dropItem(c.pos.clone().addScaledVector(c.forward, 1.5), item);
  }

  // ---------- combat ----------

  raycast(origin, dir, range, ignore, { solidsOnly = false } = {}) {
    const targets = this.map.rayTargets(origin, dir, range);
    if (!solidsOnly) {
      for (const a of this.actors) {
        if (!a.alive || a === ignore) continue;
        if (a.pos.distanceTo(origin) > range + 8) continue;
        targets.push(a.hitMesh);
      }
    }
    raycaster.set(origin, dir);
    raycaster.far = range;
    const hit = raycaster.intersectObjects(targets, false)[0];
    if (hit) return { hit: true, point: hit.point.clone(), target: hit.object.userData.actor || null, distance: hit.distance };
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
        if (hit.target) this.damage(hit.target, damage, c, hit.point);
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

  explode(point, rocket) {
    const w = WEAPONS.rocket;
    const owner = rocket.owner;
    this.fx.explosion(point, w.splash);
    sfx.boom(point, this.listener);
    const pd = this.player && this.player.alive ? this.player.pos.distanceTo(point) : 99;
    this.shake = Math.max(this.shake, Math.max(0, 0.6 - pd / 30));
    const base = rocket.damage || w.damage * RARITIES[rocket.rarity].damage;
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

  damage(target, amount, attacker, at) {
    if (!target.alive || this.frozen) return;
    if (attacker && attacker !== target && attacker.team === 'machine' && target.team === 'machine') return;
    amount = Math.round(amount);
    if (amount <= 0) return;
    // Armor soaks up most of a hit until it breaks.
    const absorbed = Math.min(target.armor || 0, Math.round(amount * 0.7));
    target.armor = (target.armor || 0) - absorbed;
    target.hp -= amount - absorbed;
    this.fx.number(at, `${amount}`, absorbed ? '#7dd3fc' : '#ff5d5d', attacker && attacker.isPlayer ? 1.1 : 0.8);
    target.hurt(attacker);
    if (attacker && attacker.isPlayer && target !== attacker) {
      this.hud.hitmarker(target.hp <= 0);
      sfx.hit();
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
      this.feed(`${attacker ? attacker.name : 'Lost Vegas'} busted you`);
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
    this.dropItem(at.clone().add(new THREE.Vector3((Math.random() - 0.5) * spread * 2, 0, (Math.random() - 0.5) * spread * 2)), item);
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
        this.hud.toast(`⏰ ${mark >= 60 ? `${mark / 60} minute${mark > 60 ? 's' : ''}` : `${mark} seconds`} until The House locks down Lost Vegas. Get to an exit!`, 'big');
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
