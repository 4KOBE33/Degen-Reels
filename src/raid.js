// A raid: drop into a map with a loadout, loot, fight machines (and maybe other raiders),
// then reach an extraction point before time runs out. Die and you lose everything you carried.
import * as THREE from 'three';
import {
  PLAYER, WEAPONS, bagBonus, RARITIES, RAID_TIME, EXTRACT_TIME, EXTRACT_RADIUS, EXTRACT_COOLDOWN, BOSS_TIME, RAIDERS, RAIDER_NAMES, COLORS, HATS, ENEMIES, ITEMS,
} from './config.js';
import { buildMap, drawMinimap, neonSign } from './map.js';
import { SlotMachine } from './slots.js';
import { GunWheel } from './gunwheel.js';
import { Container } from './containers.js';
import { ChipSystem } from './chips.js';
import { Fx } from './fx.js';
import { Combatant } from './combatant.js';
import { Machine } from './enemies.js';
import { Hazards } from './hazards.js';
import { Throwables } from './throwables.js';
import { NavGrid } from './nav.js';
import { Recorder, Replay } from './replay.js';
import { RaiderBrain } from './bots.js';
import { ItemPickup } from './pickups.js';
import {
  makeGun, makeItem, rollLoot, randInt, pick, addToList, itemInfo, isGun, rollRarity, fullAmmo,
  addToStash, isBelt,
} from './items.js';
import { part } from './toon.js';
import { save } from './save.js';
import { sfx } from './audio.js';
import { keyName } from './keys.js';
import { recordRaid } from './progress.js';
import { randomLook } from './looks.js';
import { Duel } from './duel.js';

const raycaster = new THREE.Raycaster();
const tmp = new THREE.Vector3();

const escapeHtmlLite = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// A seedable random so every player in a party builds the exact same map.
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Raid {
  constructor(hud, mapId = 'vegas', seed = null) {
    this.mapId = mapId;
    this.seed = seed;
    this.hud = hud;
    this.net = null;
    this.scene = new THREE.Scene();
    const realRandom = Math.random;
    if (seed !== null) Math.random = seededRandom(seed);
    try {
      this.build(mapId);
    } finally {
      Math.random = realRandom;
    }
    this.combatants = [];
    this.bots = [];
    this.machines = [];
    this.pickups = [];
    this.rockets = [];
    this.throws = new Throwables(this);
    this.recorder = new Recorder(this);
    this.player = null;
    this.active = false;
    this.populate();
  }

  build(mapId) {
    this.map = buildMap(this.scene, mapId);
    this.nav = new NavGrid(this.map);
    this.fx = new Fx(this.scene);
    this.chips = new ChipSystem(this);
    this.listener = new THREE.Vector3();
    this.focus = new THREE.Vector3(0, 0, 40);
    this.shake = 0;
    this.frozen = false;

    this.slots = this.map.slotSpots.map((s) => new SlotMachine(this, s));
    this.containers = this.map.containers.map((c) => new Container(this, c));
    this.gunWheels = this.map.safe ? [] : this.wheelSpots().map((s) => new GunWheel(this, s));
    this.drawDist = 115;
    this.buildVaultDoor();
    this.buildBossLock();
    this.buildExtracts();
    this.hazards = new Hazards(this);
    this.map.bake();
    this.minimap = drawMinimap(this.map, 512, false);
    this.bigmap = drawMinimap(this.map, 1024, true);
  }

  get isClient() { return !!(this.net && this.net.client); }
  get isHost() { return !!(this.net && this.net.host); }

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
        return c.count('keycard') ? `<b>${keyName('use')}</b> Swipe your 💳 Vault Keycard` : '🔒 The Vault needs a 💳 Vault Keycard';
      },
      use: (c) => {
        if (this.vaultOpen) return null;
        if (!c.takeOne('keycard')) return 'You need a Vault Keycard. They turn up in the casino.';
        this.openVault(c);
        return null;
      },
    };
  }

  // ---------- Pit Boss lockdown ----------
  // Once the Pit Boss is out, walking into the casino seals every door behind you: nobody gets in
  // or out (and no shots go through) until he's busted. Everyone inside dies: the doors open and
  // he patches himself back up. He can only be hurt from inside, so no sniping him through a door.

  buildBossLock() {
    const cas = this.map.casino;
    const barMat = new THREE.MeshBasicMaterial({ color: 0xff2d55 });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xff2d55, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
    this.bossLock = { on: false, doors: [], glowMat };
    for (const d of cas.doors || []) {
      const g = new THREE.Group();
      g.position.set(d.x, 0, d.z);
      if (!d.horiz) g.rotation.y = Math.PI / 2;
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(d.width, 3.4), glowMat);
      glow.position.y = 1.7;
      g.add(glow);
      for (let i = 0; i < 6; i++) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(d.width, 0.08, 0.08), barMat);
        bar.position.y = 0.35 + i * 0.55;
        g.add(bar);
      }
      g.visible = false;
      this.scene.add(g);
      const half = d.width / 2;
      const collider = d.horiz
        ? { type: 'box', minX: d.x - half, maxX: d.x + half, minZ: d.z - 0.45, maxZ: d.z + 0.45, top: 10 }
        : { type: 'box', minX: d.x - 0.45, maxX: d.x + 0.45, minZ: d.z - half, maxZ: d.z + half, top: 10 };
      this.bossLock.doors.push({ group: g, collider, added: false });
    }
  }

  // Is this spot inside the casino hall? margin > 0 means well inside.
  inCasino(pos, margin = 0) {
    const c = this.map.casino;
    return Math.abs(pos.x - c.x) < c.w / 2 - margin && Math.abs(pos.z - c.z) < c.d / 2 - margin;
  }

  setBossLock(on) {
    const lock = this.bossLock;
    if (!lock || lock.on === on) return;
    lock.on = on;
    for (const d of lock.doors) {
      d.group.visible = on;
      if (on && !d.added) { this.map.addCollider(d.collider); d.added = true; }
      if (!on && d.added) { this.map.removeCollider(d.collider); d.added = false; }
    }
    this.nav.cache.clear();
    const p = this.player;
    const inside = p && p.alive && this.inCasino(p.pos);
    if (on) {
      sfx.alert(this.focus, this.listener);
      this.feed('🔒 The casino doors slammed shut. Nobody leaves until the Pit Boss is busted.');
      if (inside) this.hud.toast('🔒 LOCKED IN WITH THE PIT BOSS. Bust him to get out!', 'big');
      else if (p && p.alive && Math.hypot(p.pos.x - this.map.casino.x, p.pos.z - this.map.casino.z) < 120) this.hud.toast('🔒 The casino just locked down. Someone\'s fighting the Pit Boss in there.');
    } else {
      this.feed('🔓 The casino doors are open again.');
      if (inside) this.hud.toast('🔓 The doors are open. Get out of here!', 'big');
    }
  }

  // Host/solo: seal or open the doors, keep the boss on his floor.
  updateBossLock(dt) {
    const lock = this.bossLock;
    if (!lock) return;
    lock.glowMat.opacity = 0.18 + Math.sin(this.elapsed * 6) * 0.08;
    const boss = this.boss && this.boss.alive ? this.boss : null;
    if (!boss) { if (lock.on) this.setBossLock(false); return; }
    // Keep him inside his casino.
    const c = this.map.casino;
    boss.pos.x = Math.max(c.x - c.w / 2 + 4, Math.min(c.x + c.w / 2 - 4, boss.pos.x));
    boss.pos.z = Math.max(c.z - c.d / 2 + 4, Math.min(c.z + c.d / 2 - 4, boss.pos.z));
    const inside = this.combatants.some((a) => (a.isPlayer || a.human) && a.alive && this.inCasino(a.pos, 2.5));
    if (!lock.on && inside) this.setBossLock(true);
    else if (lock.on && !this.combatants.some((a) => (a.isPlayer || a.human) && a.alive && this.inCasino(a.pos))) {
      // Everyone who went in is dead: he resets.
      boss.hp = boss.maxHp;
      boss.setBossPhase(1);
      this.setBossLock(false);
      this.feed('💼 The Pit Boss straightens his tie. Fully healed.');
    }
  }

  openVault(c, fromNet = false) {
    if (this.vaultOpen) return;
    if (this.isClient && !fromNet) { this.net.send({ k: 'vault' }); return; }
    if (this.isHost) this.net.rel({ k: 'vo', by: c.name });
    this.vaultOpen = true;
    this.vaultCollider.disabled = true;
    this.map.removeCollider(this.vaultCollider);
    this.nav.cache.clear();
    sfx.jackpot(this.vaultDoor.position, this.listener);
    this.feed(`💳 ${c.name} opened the Vault!`);
    if (c.isPlayer) this.hud.toast('🔓 THE VAULT IS OPEN… something\'s moving in there!', 'big');
    // The vault's guards come pouring out at whoever opened it.
    if (!this.isClient) {
      const { vault } = this.map;
      const opener = c && c.alive !== undefined && c.team !== 'machine' ? c : null;
      setTimeout(() => {
        if (!this.active && !(this.net && this.net.worldAlive && this.net.worldAlive())) return;
        this.fx.explosion(new THREE.Vector3(vault.x, 1.5, vault.z), 3);
        sfx.alert(this.vaultDoor.position, this.listener);
        this.feed('🚨 VAULT GUARDS!');
        for (const [type, dx, dz] of [['bouncer', 0, -1], ['shark', -5, 1], ['shark', 5, 1], ['dicer', -3, -3], ['dicer', 3, -3]]) {
          const m = this.spawnMachine(type, vault.x + dx, vault.z + dz);
          m.summoned = true;
          if (opener && opener.alive) { m.target = opener; m.windup = 0.4; }
        }
      }, 700);
    }
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
    if (this.duel) { this.duel.dispose(); this.duel = null; }
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
    for (const s of this.map.enemySpots) this.spawnMachine(s.type, s.x, s.z, s.y || 0);
    // Bayou ponds hide gators.
    if (this.mapId === 'bayou') for (const pd of this.map.hazards.ponds) this.spawnMachine('gator', pd.x, pd.z);
    for (let i = 0; i < (this.map.raiders ?? RAIDERS.count); i++) this.spawnRaider();
  }

  spawnMachine(type, x, z, y = 0) {
    if (type !== 'gator' && type !== 'boss' && !y) [x, z] = this.openSpot(x, z, 0.9);
    const m = new Machine(this, type, x, z, y);
    this.machines.push(m);
    return m;
  }

  spawnRaider() {
    const taken = new Set(this.combatants.map((c) => c.name));
    const name = pick(RAIDER_NAMES.filter((n) => !taken.has(n))) || 'Some Raider';
    const c = new Combatant(this, { name, look: randomLook() });
    const [sx, sz] = pick(this.map.spawns);
    const [x, z] = this.openSpot(sx + (Math.random() - 0.5) * 10, sz + (Math.random() - 0.5) * 10);
    c.pos.set(x, 0, z);
    c.equip(makeGun(pick(['pistol', 'pistol', 'smg', 'shotgun', 'revolver', 'ar']), rollRarity(1)));
    if (Math.random() < 0.4) c.equip(makeGun(pick(['smg', 'shotgun', 'revolver', 'dbarrel', 'rifle', 'bat']), rollRarity(1)));
    c.backpack.push(makeItem('bandage', 2), makeItem('ammo', randInt(1, 3)));
    if (Math.random() < 0.5) c.backpack.push(makeItem('plate', 1));
    if (Math.random() < 0.4) c.backpack.push(makeItem(pick(['grenade', 'grenade', 'dice', 'flash', 'sauce']), randInt(1, 2)));
    if (Math.random() < 0.15) c.backpack.push(makeItem('token', 1));
    if (Math.random() < 0.5) c.backpack.push(rollLoot(2).chips ? makeItem('cards') : rollLoot(2));
    c.chips = randInt(20, 120);
    this.combatants.push(c);
    const brain = new RaiderBrain(this, c);
    if (this.map.hostile !== null) brain.hostile = Math.random() < this.map.hostile;
    this.bots.push(brain);
    return c;
  }

  // ---------- raid lifecycle ----------

  // opts (multiplayer): { client, exits: [i, i], spawn: [x, z], slot } — host and clients agree on these.
  deploy({ name, look, loadout, opts = {} }) {
    // Reset the map.
    for (const p of this.pickups) p.remove();
    this.pickups = [];
    this.chips.clear();
    for (const r of this.rockets) this.scene.remove(r.mesh);
    this.rockets = [];
    this.throws.clear();
    for (const k of this.containers) k.reset();
    for (const s of this.slots) s.user = null;
    for (const w of this.gunWheels) { w.spin = null; w.pending = null; }
    this.closeVault();
    if (this.player) {
      this.scene.remove(this.player.char.root);
      this.combatants = this.combatants.filter((c) => c !== this.player);
    }
    if (opts.client) {
      // Clients don't run machines or bots; they arrive in the host's snapshots.
      for (const m of this.machines) this.scene.remove(m.group);
      for (const c of this.combatants) if (!c.isPlayer) this.scene.remove(c.char.root);
      this.machines = [];
      this.bots = [];
      this.combatants = [];
    } else {
      this.populate();
      // Fewer bots when real people are along.
      const extra = (opts.party || 1) - 1;
      for (let i = 0; i < extra && this.bots.length > 2; i++) {
        const b = this.bots.pop();
        this.removeCombatant(b.c);
      }
    }
    if (this.recorder) this.recorder.reset();
    if (this.duel) this.duel.dispose();
    this.duel = null;

    // Two of the four exits are open each raid.
    const order = opts.exits ? [0, 1, 2, 3].sort((a, b) => (opts.exits.includes(b) ? 1 : 0) - (opts.exits.includes(a) ? 1 : 0)) : [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    this.extracts.forEach((e, i) => {
      e.active = order.indexOf(i) < 2;
      e.beam.material.color.setHex(e.active ? 0x5ee27a : 0xff5d5d);
      e.ring.material.color.setHex(e.active ? 0x5ee27a : 0xff5d5d);
      e.beam.visible = e.active;
      e.sign.visible = e.active;
    });

    const p = new Combatant(this, { name, look, isPlayer: true });
    p.bagBonus = bagBonus(save.get().bag || 0);
    const [sx, sz] = opts.spawn || pick(this.map.spawns);
    const slot = opts.slot || 0;
    // Dropping back into a raid in progress: right where the leader says.
    // Room to breathe: start a couple of meters off any wall so the camera isn't inside it.
    const [x, z] = opts.at ? this.openSpot(opts.at[0], opts.at[2]) : this.openSpot(sx + (slot % 3) * 2 - 2, sz + Math.floor(slot / 3) * 2, 2.2);
    p.pos.set(x, 0, z);
    p.yaw = Math.atan2(x, z);
    for (const gun of loadout.weapons) {
      if (!gun) continue;
      const g = { ...gun };
      if (!Number.isFinite(g.ammo)) g.ammo = fullAmmo(g.kind, g.rarity);
      p.equip(g);
    }
    for (const it of loadout.items) addToList(p.backpack, { ...it }, p.room);
    // The Safe Pocket (comes with a bought backpack): whatever's in it survives your death.
    p.pocket = Array(loadout.pocket || 0).fill(null);
    // Back from a refresh or crash: what you were carrying.
    const back = opts.restore;
    if (back) {
      back.weapons.forEach((g, i) => { p.weapons[i] = g ? { ...g } : null; });
      p.refreshWeapon();
      p.backpack = back.backpack.map((it) => ({ ...it }));
      if (back.pocket) back.pocket.forEach((it, i) => { if (i < p.pocket.length) p.pocket[i] = it ? { ...it } : null; });
      p.chips = back.chips || 0;
      if (back.hp > 0) p.hp = Math.min(p.maxHp, back.hp);
      p.armor = back.armor || 0;
    }
    this.player = p;
    this.combatants.push(p);
    // The Lounge: duels in The Pit, refereed by the host (or you, solo), with a House Champion.
    if (this.map.lounge) {
      this.duel = new Duel(this);
      if (!opts.client) this.duel.spawnChampion();
    }

    this.raidTime = this.map.raidTime || RAID_TIME;
    this.timeLeft = this.raidTime;
    this.elapsed = 0;
    for (const e of this.extracts) { e.call = null; e.cooldown = 0; }
    this.bossSpawned = false;
    this.boss = null;
    this.setBossLock(false);
    this.warned = {};
    this.hurtBy = {};
    this.killcam = null;
    this.run = {
      kills: 0, machines: 0, raiders: 0, gators: 0, boss: false, crits: 0, throws: 0, containers: 0, slotPulls: 0, diceSixes: 0, bestStun: 0, started: performance.now(),
    };
    this.active = true;
    this.frozen = false;
    this.result = null;
    save.update((d) => { d.stats.raids++; });
    this.hud.raidIntro(this);
  }

  // ---------- extraction ----------
  // Step into an open exit to call the ride. It takes EXTRACT_TIME to arrive, a siren tells the
  // whole map, and every machine nearby comes running. Whoever is in the circle when it lands
  // gets out: you, and any raiders riding with you.

  inCircle(e, c) {
    return c.alive && !c.downed && Math.hypot(c.pos.x - e.x, c.pos.z - e.z) < EXTRACT_RADIUS;
  }

  callExtract(e, by) {
    if (!e.active || e.call || e.cooldown > 0) return;
    e.call = { t: 0, by, siren: 0, wave: 0 };
    e.beam.material.color.setHex(0xffd23f);
    e.ring.material.color.setHex(0xffd23f);
    this.feed(`📣 ${by.name} called the ${e.name} extraction!`);
    if (by.isPlayer) this.hud.toast(`📣 Extraction called! The ride lands in ${EXTRACT_TIME}s. Everything nearby heard that…`, 'big');
    else if (this.player && this.player.alive) this.hud.toast(`📣 ${by.name} called the ${e.name} extraction. Get there in ${EXTRACT_TIME}s to ride out too!`, 'big');
  }

  updateExtracts(dt) {
    const p = this.player;
    this.extractAt = null;
    for (const e of this.extracts) {
      if (!e.active) continue;
      e.cooldown = Math.max(0, (e.cooldown || 0) - dt);
      // You, plus raiders who are done for the day (others just passing through don't count).
      const inside = this.combatants.filter((c) => this.inCircle(e, c) && (c.isPlayer || c.human || (c.brain && c.brain.age > c.brain.leaveAt)));
      if (p && p.alive && inside.includes(p)) this.extractAt = e;
      if (!e.call) {
        if (inside.length && !e.cooldown) this.callExtract(e, inside.includes(p) ? p : inside[0]);
        continue;
      }
      const call = e.call;
      call.t += dt;
      e.beam.material.opacity = 0.18 + Math.abs(Math.sin(call.t * 4)) * 0.25;
      // The siren, every couple of seconds, louder the closer you are.
      call.siren -= dt;
      if (call.siren <= 0) {
        call.siren = 2.2;
        const d = p ? Math.hypot(p.pos.x - e.x, p.pos.z - e.z) : 999;
        sfx.siren(Math.max(0, 1 - d / 150));
      }
      // Everything within earshot comes for whoever's waiting.
      const bait = inside[0] || call.by;
      for (const m of this.machines) {
        if (!m.alive || m.isBoss || m.type === 'gator' || m.target) continue;
        if (Math.hypot(m.pos.x - e.x, m.pos.z - e.z) < 140 && bait && bait.alive && !bait.downed) m.target = bait;
      }
      // Hostile raiders smell an easy ambush.
      for (const b of this.bots) {
        if (b.hostile && b.c.alive && Math.hypot(b.c.pos.x - e.x, b.c.pos.z - e.z) < 120) b.goal = new THREE.Vector3(e.x, 0, e.z);
      }
      // Reinforcements: three waves of machines pour in from the edges.
      const waves = [0.15, 0.45, 0.75];
      if (call.wave < waves.length && call.t >= EXTRACT_TIME * waves[call.wave]) {
        call.wave++;
        const n = 2 + Math.floor(Math.random() * 2) + (call.wave === 3 ? 1 : 0);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = 38 + Math.random() * 14;
          const type = pick(['dicer', 'dicer', 'shark', 'slotbot']);
          const m = this.spawnMachine(type, e.x + Math.cos(a) * r, e.z + Math.sin(a) * r);
          if (bait && bait.alive && !bait.downed) m.target = bait;
        }
        if (p && p.alive && Math.hypot(p.pos.x - e.x, p.pos.z - e.z) < 80) this.hud.toast(`⚠️ More machines incoming! (${call.wave}/${waves.length})`);
      }
      if (call.t >= EXTRACT_TIME) {
        // The ride is here. Everyone in the circle goes.
        e.call = null;
        e.cooldown = EXTRACT_COOLDOWN;
        e.beam.material.color.setHex(0x5ee27a);
        e.ring.material.color.setHex(0x5ee27a);
        e.beam.material.opacity = 0.18;
        const riders = inside.filter((c) => !c.isPlayer);
        for (const c of riders) {
          this.feed(`🚁 ${c.name} extracted${inside.includes(p) ? ' with you' : ''}`);
          // A friend riding out: tell their game they made it.
          if (c.human && this.net) {
            this.net.net.to(c.owner, { k: 'extracted', where: e.name, riders: inside.filter((x) => x !== c).map((x) => x.name) });
            this.net.gone.add(c.owner);
          }
          this.removeCombatant(c);
        }
        if (inside.includes(p)) this.extract(e.name, riders.map((c) => c.name));
        else {
          this.feed(`🚁 The ${e.name} ride left${riders.length ? ` with ${riders.length} raider${riders.length > 1 ? 's' : ''}` : ' empty'}`);
          if (p && p.alive && Math.hypot(p.pos.x - e.x, p.pos.z - e.z) < 60) this.hud.toast(`🚁 You missed the ride! ${e.name} can be called again in ${EXTRACT_COOLDOWN}s.`, 'big');
        }
      }
    }
  }

  // Successful extraction: everything you're carrying goes to the stash.
  extract(where, riders = []) {
    if (!this.active) return;
    const p = this.player;
    const items = [...p.weapons.filter(Boolean), ...p.backpack, ...(p.pocket || []).filter(Boolean)];
    const value = items.reduce((n, it) => n + itemInfo(it).value, 0) + p.chips;
    sfx.extract();
    save.update((d) => {
      d.stash.chips += p.chips;
      for (const raw of items) {
        // Free-loadout gear you got out with is yours now.
        const it = { ...raw };
        delete it.free;
        if (!isGun(it)) {
          const same = d.stash.items.find((o) => o.id === it.id);
          if (same) { same.qty += it.qty; continue; }
        }
        d.stash.items.push({ ...it });
      }
    });
    this.finish({ success: true, where, items, chips: p.chips, value, riders });
    // The player escapes: pull them out of the world.
    p.alive = false;
    p.char.root.visible = false;
  }

  fail(reason, by) {
    if (!this.active) return;
    if (this.isClient && reason !== 'dead') {
      const p = this.player;
      this.net.send({ k: 'dead', items: [...p.weapons.filter(Boolean), ...p.backpack], chips: p.chips, by: null });
    }
    const p = this.player;
    const items = [...p.weapons.filter(Boolean), ...p.backpack];
    const value = items.reduce((n, it) => n + itemInfo(it).value, 0) + p.chips;
    // The Safe Pocket: what's in it makes it home no matter what.
    const kept = (p.pocket || []).filter(Boolean).map((it) => { const x = { ...it }; delete x.free; return x; });
    if (kept.length) save.update((d) => { for (const it of kept) addToStash(d.stash.items, it); });
    p.pocket = (p.pocket || []).map(() => null);
    this.finish({ success: false, reason, by, items, chips: p.chips, value, kept: kept.map((it) => itemInfo(it).name) });
  }

  // ---------- kill cam ----------

  // You died: swing the camera over to whoever did it before the results come up.
  // replay: play back the tape (and hold the world still while it plays). Solo, or a friend's
  // game in the Lounge; the party leader can't pause the world for everyone.
  startKillcam(victim, killer, { replay = !this.net } = {}) {
    const real = killer && killer !== victim && killer.pos && killer.alive !== undefined ? killer : null;
    const weapon = !killer ? 'something'
      : killer.team === 'machine' ? ({ shark: 'its blade', gator: 'its jaws', boss: 'the jackpot cannon', dicer: 'dice bullets', bouncer: 'its fists', roller: 'a running start', turret: 'a jackpot shell', dealer: 'a fan of razor cards' }[killer.type] || 'a burst of bullets')
        : killer.team === 'env' ? '' : killer.weaponName || 'their fists';
    this.killcam = {
      t: 0, dur: 4, over: false, killer: real, victimPos: victim.pos.clone(), name: killer ? killer.name : 'Something',
      weapon, dealt: Math.round(killer ? this.hurtBy[killer.name] || 0 : 0), angle: Math.atan2(victim.pos.x - (real ? real.pos.x : victim.pos.x), victim.pos.z - (real ? real.pos.z : victim.pos.z + 1)),
    };
    // Solo: play back the last few seconds from over the killer's shoulder.
    if (replay && this.recorder && this.recorder.frames.length > 10) {
      const replay = new Replay(this, this.recorder, victim, real);
      if (!replay.done) {
        this.killcam.replay = replay;
        this.killcam.dur = replay.length + 1.8;
        this.killcam.freeze = true;
      }
    }
  }

  // Lost a duel in the Lounge: watch how it happened, then you're back on the floor.
  loungeKillcam(victim, killer) {
    this.startKillcam(victim, killer, { replay: !this.isHost });
    this.hud.killcam(this.killcam);
  }

  // The referee moved us (into or out of The Pit), patched up.
  applyTp(d) {
    const p = this.player;
    if (!p || !p.alive) return;
    p.pos.set(d.p[0], d.p[1], d.p[2]);
    p.vel.set(0, 0, 0);
    p.yaw = d.yaw || 0;
    p.hp = p.maxHp;
    p.downed = false;
    p.rolling = null;
    p.pin = d.pin ? p.pos.clone() : null;
  }

  skipKillcam() {
    const kc = this.killcam;
    if (kc && !kc.over && kc.t > 0.3) kc.t = kc.dur;
  }

  // Where the kill cam's camera sits and what it looks at.
  killcamView(dt, camera) {
    const k = this.killcam;
    if (k.replay && !k.replay.done && k.replay.camera(camera, dt)) return;
    const target = k.killer ? k.killer.pos : k.victimPos;
    const big = k.killer && k.killer.isBoss;
    k.angle += dt * 0.35;
    const dist = big ? 14 : 5.5;
    const ease = Math.min(1, k.t / 0.8);
    const want = new THREE.Vector3(target.x + Math.sin(k.angle) * dist, target.y + (big ? 7 : 2.4), target.z + Math.cos(k.angle) * dist);
    camera.position.lerp(want, ease < 1 ? 0.12 : 0.25);
    camera.lookAt(target.x, target.y + (big ? 4 : 1.2), target.z);
    if (Math.abs(camera.fov - 55) > 0.1) { camera.fov = 55; camera.updateProjectionMatrix(); }
  }

  finish(result) {
    this.active = false;
    this.result = { ...result, run: this.run, time: this.raidTime - this.timeLeft, newFinds: [] };
    // Stats, collection log, XP and achievements.
    // The Lounge is for hanging out and dueling: no raid XP or stats for walking in and out.
    this.result.progress = this.map.safe ? null : recordRaid(this.result, this.mapId);
    if (this.killcam) this.hud.killcam(this.killcam);
    else this.hud.raidOver(this.result);
  }

  // ---------- interaction ----------

  get interactables() {
    const list = [...this.slots, ...this.gunWheels, ...this.pickups, this.vaultLock];
    if (this.duel) list.push(...this.duel.interactables());
    for (const k of this.containers) if (!k.opened) list.push(k);
    for (const c of this.combatants) if (c.downed && c.alive && c.reviveSpot) list.push(c.reviveSpot);
    return list;
  }

  // ---------- downed and revives ----------

  // Lethal damage on a raider or you: go down instead of dying.
  down(target, attacker, fromNet = false) {
    target.downed = true;
    target.hp = 0;
    target.downHp = PLAYER.downHp;
    target.bleed = PLAYER.bleedTime;
    target.using = null;
    target.lastAttacker = attacker && attacker !== target ? attacker : target.lastAttacker;
    // Anyone nearby can hold the use key on you to get you back up.
    const raid = this;
    target.reviveSpot = {
      spot: target.pos,
      range: 2.2,
      searchTime: PLAYER.reviveTime,
      searchLabel: 'Reviving…',
      prompt: () => (target.downed ? `<b>Hold ${keyName('use')}</b> Revive ${escapeHtmlLite(target.name)}` : null),
      open: (by) => raid.revive(target, by),
    };
    // Machines lose interest in someone who's down.
    for (const m of this.machines) if (m.target === target) m.target = null;
    if (!fromNet) this.feed(`${attacker ? attacker.name : 'Something'} downed ${target.name}`);
    if (target.isPlayer) sfx.hurt();
  }

  revive(target, by, fromNet = false) {
    if (!target.downed || !target.alive) return null;
    // Multiplayer: someone else's body is theirs to get up.
    if (this.net && !fromNet && target.puppet) {
      if (this.isClient) { this.net.send({ k: 'revive', i: target.netId }); return null; }
      if (target.human) {
        this.net.net.to(target.owner, { k: 'revived', by: this.net.id(by), byName: by ? by.name : 'Someone' });
        this.feed(`🤝 ${by ? by.name : 'Someone'} revived ${target.name}`);
        if (by && by.isPlayer) this.run.revives = (this.run.revives || 0) + 1;
        return null;
      }
    }
    target.downed = false;
    target.reviveSpot = null;
    target.hp = PLAYER.reviveHp;
    target.downHp = 0;
    target.lastAttacker = null;
    this.fx.number(target.center(new THREE.Vector3()).setY(target.pos.y + 2), '❤️ UP!', '#5ee27a', 1.4);
    sfx.heal();
    if (by === target && target.isPlayer) this.run.selfRevives = (this.run.selfRevives || 0) + 1;
    if (by === target) this.feed(`🎟️ ${target.name} used a Second Chance Token`);
    else this.feed(`🤝 ${by ? by.name : 'Someone'} revived ${target.name}`);
    if (by && by.isPlayer && by !== target) {
      this.run.revives = (this.run.revives || 0) + 1;
      // A raider you pick up won't forget it.
      if (target.brain) { target.brain.hostile = false; target.brain.friend = by; }
      if (target.lastAttacker === by) target.lastAttacker = null;
    }
    if (target.isPlayer) this.hud.toast(by === target ? '🎟️ Second chance! Back on your feet.' : `🤝 ${by ? by.name : 'Someone'} picked you up!`, 'big');
    return null;
  }

  // While you're down, the use key is your Second Chance Token.
  // Close enough to an open exit that getting up would put you on the ride.
  nearExit(c) {
    return this.extracts.some((e) => e.active && Math.hypot(c.pos.x - e.x, c.pos.z - e.z) < EXTRACT_RADIUS + 4);
  }

  selfReviveFor(c) {
    if (!c.count('token')) return null;
    // No popping a token on the helipad: being downed there means a teammate has to get you up.
    if (this.nearExit(c)) {
      return c.selfReviveBlocked || (c.selfReviveBlocked = { spot: c.pos, range: 99, searchTime: 0, prompt: () => '🚫 Crawl out of the exit to use your 🎟️ Second Chance Token', open: () => {} });
    }
    if (!c.selfRevive) {
      c.selfRevive = {
        spot: c.pos, range: 99, searchTime: PLAYER.selfReviveTime, searchLabel: 'Second chance…',
        prompt: () => `<b>Hold ${keyName('use')}</b> Use 🎟️ Second Chance Token (${c.count('token')})`,
        open: (by) => {
          if (this.nearExit(by)) { if (by.isPlayer) this.hud.toast('🚫 Crawl out of the exit to use your token'); return; }
          if (by.takeOne('token')) this.revive(by, by);
        },
      };
    }
    return c.selfRevive;
  }

  // What E does right now. Loot on the floor always beats the machine or crate next to it,
  // so you can never get stuck re-pulling a lever when you meant to grab the prize.
  nearbyInteractable(c) {
    if (c.downed) return this.selfReviveFor(c);
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
    // Multiplayer client: ask the host for it (first come, first served).
    if (this.isClient && c.isPlayer) {
      if (!isGun(item) && !c.hasRoom(item)) return isBelt(item) ? `Belt full. Press ${keyName('bag')} and drop something.` : `Backpack full. Press ${keyName('bag')} and drop something.`;
      if (pickup.requested && performance.now() - pickup.requested < 800) return null;
      pickup.requested = performance.now();
      this.net.send({ k: 'take', id: pickup.netId });
      return null;
    }
    let ok;
    if (isGun(item)) ok = c.equip(item) || addToList(c.backpack, item, c.room);
    else ok = addToList(c.backpack, item, c.room);
    if (!ok) return c.isPlayer ? `Backpack full. Press ${keyName('bag')} and drop something.` : 'full';
    pickup.remove();
    this.pickups = this.pickups.filter((p) => p !== pickup);
    if (this.isHost && pickup.netId) { this.net.rel({ k: 'pg', id: pickup.netId }); this.net.pickupsById.delete(pickup.netId); }
    if (c.isPlayer) {
      const info = itemInfo(item);
      sfx.pickup();
      if (info.rarity >= 2) sfx.win();
      const kind = ITEMS[item.id] && ITEMS[item.id].kind;
      const hint = kind === 'throw' ? ` · hold ${keyName('throw')} to throw (${keyName('cycleThrow')} switches)`
        : { ammo: ` · press ${keyName('reload')} to reload`, bandage: ` · press ${keyName('heal')} to heal`, soda: ` · press ${keyName('heal')} to heal`, plate: ` · press ${keyName('armor')} to use`, cocoa: ` · press ${keyName('cocoa')} to drink`, fuel: ` · press ${keyName('boost')} to drink` }[item.id] || '';
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
    if (this.isHost) {
      p.netId = `k${this.net.nextId++}`;
      this.net.pickupsById.set(p.netId, p);
      this.net.rel({ k: 'pn', id: p.netId, item, p: [spot.x, spot.y || 0, spot.z], from: from ? [from.x, 1, from.z] : null });
    }
    return p;
  }

  // The nearest open ground to (x, z), so nobody spawns inside a rock or a wall.
  // Gun Wheels stand beside a few of the slot machines (the same spots for everyone in a party).
  wheelSpots() {
    const spots = this.map.slotSpots;
    const out = [];
    const n = Math.min(spots.length, spots.length >= 6 ? 3 : 2);
    // Try slots spread across the list first, then the rest, until we've placed enough.
    const order = [];
    for (let k = 0; k < n; k++) order.push(Math.floor(((k + 0.5) * spots.length) / n));
    for (let k = 0; k < spots.length; k++) if (!order.includes(k)) order.push(k);
    for (const idx of order) {
      if (out.length >= n) break;
      const s = spots[idx];
      const rot = s.rot || 0;
      const fx = Math.sin(rot);
      const fz = Math.cos(rot);
      // Either side of the slot, never in front of anything you need to stand at.
      for (const side of [1, -1]) {
        const x = s.x + side * fz * 3.2 + fx * 0.6;
        const z = s.z - side * fx * 3.2 + fz * 0.6;
        if (!this.map.isFree(x, z, 1.9) || !this.map.isFree(x + fx * 1.6, z + fz * 1.6, 0.6)) continue;
        if (this.slots.some((sl) => Math.hypot(sl.spot.x - x, sl.spot.z - z) < 2.6)) continue;
        if (this.containers.some((k) => k.spot.y < 0.5 && Math.hypot(k.spot.x - x, k.spot.z - z) < 3.4)) continue;
        if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 8)) continue;
        out.push({ x, z, rot });
        break;
      }
    }
    return out;
  }

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
    // Works upstairs too: loot lands on whatever floor it came from.
    const baseY = from.y > 0.5 ? from.y : 0;
    const floorAt = (x, z) => (baseY ? this.map.groundAt(x, z, baseY + 0.5) : 0);
    const origin = new THREE.Vector3(from.x, baseY + 1.0, from.z);
    const reachable = (x, z) => {
      if (!this.map.isFree(x, z, 0.6)) return false;
      if (this.pickups.some((pk) => Math.hypot(pk.spot.x - x, pk.spot.z - z) < 0.6)) return false;
      if (baseY && Math.abs(floorAt(x, z) - baseY) > 0.6) return false;
      const to = new THREE.Vector3(x, baseY + 1.0, z);
      const d = origin.distanceTo(to);
      if (d < 0.05) return true;
      return !this.raycast(origin, to.sub(origin).normalize(), d, null, { solidsOnly: true }).hit;
    };
    if (reachable(want.x, want.z)) return new THREE.Vector3(want.x, floorAt(want.x, want.z), want.z);
    // Spiral outward from the source, starting in the direction we wanted.
    const base = Math.atan2(want.z - from.z, want.x - from.x) || 0;
    for (const r of [1.2, 1.7, 2.3, 3, 3.8, 4.8]) {
      for (let k = 0; k < 12; k++) {
        const a = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 6);
        const x = from.x + Math.cos(a) * r;
        const z = from.z + Math.sin(a) * r;
        if (reachable(x, z)) return new THREE.Vector3(x, floorAt(x, z), z);
      }
    }
    return new THREE.Vector3(want.x, floorAt(want.x, want.z), want.z);
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
    if (c.packUsed >= c.capacity) return 'Backpack is full';
    c.backpack.push(gun);
    c.weapons[slot] = null;
    c.refreshWeapon();
    return null;
  }

  // Drag and drop in the backpack screen. `from`/`to` are { where: 'weapon' | 'pack', i }.
  // Guns swap into weapon slots, anything swaps places in the backpack.
  moveItem(c, from, to) {
    if (from.where === to.where && from.i === to.i) return null;
    const list = (w) => (w === 'weapon' ? c.weapons : w === 'pocket' ? c.pocket || [] : c.backpack);
    const a = list(from.where)[from.i];
    const b = list(to.where)[to.i];
    if (!a) return null;
    if (to.where === 'weapon' && !isGun(a)) return 'Only guns go in weapon slots';
    if (from.where === 'weapon' && b && !isGun(b)) return 'Only guns go in weapon slots';
    if (to.where === 'pocket' && to.i >= (c.pocket || []).length) return 'No Safe Pocket this raid';
    if (b) {
      // Swap places.
      list(from.where)[from.i] = b;
      list(to.where)[to.i] = a;
    } else {
      if (to.where === 'pack' && from.where !== 'pack' && !c.hasRoom(a)) return isBelt(a) ? 'Belt is full' : 'Backpack is full';
      if (from.where === 'pack') c.backpack.splice(from.i, 1); else list(from.where)[from.i] = null;
      if (to.where === 'pack') c.backpack.push(a); else list(to.where)[to.i] = a;
    }
    if (to.where === 'weapon' && from.where !== 'weapon') c.active = to.i;
    c.refreshWeapon();
    return null;
  }

  // Drop something from your inventory onto the floor in front of you.
  dropFromInventory(c, where, index) {
    if (this.isClient && c.isPlayer) {
      const item = where === 'weapon' ? c.weapons[index] : where === 'pocket' ? c.pocket[index] : c.backpack[index];
      if (!item) return;
      if (where === 'weapon') { c.weapons[index] = null; c.refreshWeapon(); } else if (where === 'pocket') c.pocket[index] = null; else c.backpack.splice(index, 1);
      const at = c.pos.clone().addScaledVector(c.forward, 1.5);
      this.net.send({ k: 'drop', item, at: [at.x, 0, at.z], from: [c.pos.x, 1, c.pos.z] });
      return;
    }
    let item;
    if (where === 'weapon') {
      item = c.weapons[index];
      if (!item) return;
      c.weapons[index] = null;
      c.refreshWeapon();
    } else if (where === 'pocket') {
      item = c.pocket && c.pocket[index];
      if (!item) return;
      c.pocket[index] = null;
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
    if (!c.alive || c.downed || c.cooldown > 0 || c.using || this.frozen) return false;
    if (!w.melee && Number.isFinite(c.ammo) && c.ammo <= 0) {
      const refusal = c.reload();
      if (c.isPlayer) {
        if (refusal) { this.hud.toast('Out of ammo! Find an 📦 Ammo Box or switch guns.'); sfx.deny(); } else this.hud.toast('Reloading…');
      }
      c.cooldown = Math.max(c.cooldown, 0.5);
      return true;
    }
    c.cooldown = w.rate;
    if (c.isPlayer) c.firedAt = performance.now();
    // Bots swing a bit softer than people do, so the melee buff doesn't turn every raider into a blender.
    const damage = w.damage * RARITIES[c.rarity].damage * (w.melee && c.brain ? 0.6 : 1);
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
        // A generous swing: anything roughly in front of you and in reach gets hit.
        if (d > w.range + (o.radius || 0.5) + 0.5 || to.normalize().dot(fwd) < 0.1) continue;
        if (o.vel) { o.vel.addScaledVector(fwd, 7); o.vel.y += 2.5; }
        sfx.bonk(o.pos, this.listener);
        // Melee punches through armor: plates only soak half as much of it.
        this.piercing = true;
        this.damage(o, damage, c, o.center(new THREE.Vector3()));
        this.piercing = false;
      }
      return true;
    }

    c.gun.ammo--;
    c.char.recoil(w.projectile ? 1.6 : 1);
    this.fx.muzzleFlash(muzzle);
    sfx.shoot(c.weapon, c.pos, this.listener);

    if (w.projectile) {
      const aim = this.raycast(origin, dir, 200, c).point;
      const rdir = aim.sub(muzzle).normalize();
      this.spawnRocket(muzzle, rdir, c, c.rarity);
      if (this.isClient && c.isPlayer) this.net.send({ k: 'rocket', o: [muzzle.x, muzzle.y, muzzle.z], d: [rdir.x, rdir.y, rdir.z], r: c.rarity });
      else if (this.isHost) this.net.ev({ k: 'rk', o: [muzzle.x, muzzle.y, muzzle.z], d: [rdir.x, rdir.y, rdir.z], r: c.rarity }, muzzle);
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
        const color = c.rarity ? new THREE.Color(RARITIES[c.rarity].css).getHex() : 0xffe066;
        this.fx.tracer(muzzle, hit.point, color);
        if (this.recorder) this.recorder.shot(muzzle, hit.point, color, c, hit.crit > 1);
        if (this.net && i < 3) {
          const shot = { f: [muzzle.x, muzzle.y, muzzle.z], to: [hit.point.x, hit.point.y, hit.point.z], c: color, w: i === 0 ? c.weapon : null };
          if (this.isClient && c.isPlayer) this.net.send({ k: 'shot', ...shot });
          else if (this.isHost) this.net.ev({ k: 'tr', ...shot }, muzzle);
        }
        if (hit.target) this.damage(hit.target, damage * hit.crit, c, hit.point, hit.crit > 1);
        else if (hit.hit) this.fx.puff(hit.point, 0xfff6e0, 0.12);
      }
    }
    return true;
  }

  machineShot(m, origin, dir, damage) {
    const hit = this.raycast(origin, dir, m.def.range + 10, m);
    this.fx.tracer(origin, hit.point, 0xff3fa4);
    if (this.recorder) this.recorder.shot(origin, hit.point, 0xff3fa4, m);
    if (this.isHost) this.net.ev({ k: 'tr', f: [origin.x, origin.y, origin.z], to: [hit.point.x, hit.point.y, hit.point.z], c: 0xff3fa4 }, origin);
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

  // ---------- throwables (see throwables.js) ----------

  get grenades() { return this.throws.list; }
  spawnGrenade(owner, origin, dir, id = 'grenade') { this.throws.spawn(owner, origin, dir, id); }
  grenadeArc(owner, origin, dir, id) { return this.throws.path(owner, origin, dir, id); }
  showArc(pts, id) { this.throws.showArc(pts, id); }
  aimGrenade(from, to) { return this.throws.aim(from, to); }

  explode(point, rocket) {
    const w = { splash: rocket.splash || WEAPONS.rocket.splash, damage: WEAPONS.rocket.damage };
    const owner = rocket.owner;
    this.fx.explosion(point, w.splash);
    sfx.boom(point, this.listener);
    if (this.recorder) this.recorder.boom(point, w.splash);
    const pd = this.player && this.player.alive ? this.player.pos.distanceTo(point) : 99;
    this.shake = Math.max(this.shake, Math.max(0, 0.6 - pd / 30));
    // In a party, the host works out who got hurt; everyone else just sees the boom.
    if (this.isClient) return;
    if (this.isHost) this.net.ev({ k: 'bm', s: w.splash }, point);
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

  damage(target, amount, attacker, at, crit = false, fromNet = false) {
    if (!target.alive || this.frozen) return;
    if (attacker && attacker !== target && attacker.team === 'machine' && target.team === 'machine') return;
    amount = Math.round(amount);
    if (amount <= 0) return;
    // Mid-roll: it whiffs.
    if (target.dodging && !target.puppet) {
      if (target.isPlayer || (attacker && attacker.isPlayer)) this.fx.number(target.center(new THREE.Vector3()).setY(target.pos.y + 2), 'DODGE!', '#2ee6d6', 1.1);
      return;
    }
    // Safe maps (the Lounge): nobody gets hurt, except the two people dueling in The Pit.
    if (this.map.safe && !(this.duel && this.duel.canHurt(attacker, target))) return;
    // The Pit Boss only takes hits from people in the casino with him.
    if (target.isBoss && attacker && attacker.pos && !this.inCasino(attacker.pos)) {
      if (attacker.isPlayer) {
        this.fx.number(at || target.center(new THREE.Vector3()), 'IMMUNE', '#9ca3af', 1.1);
        if (!this.bossHint || this.elapsed - this.bossHint > 6) { this.bossHint = this.elapsed; this.hud.toast('🛡️ The Pit Boss can\'t be hurt from outside. Go in and fight him!'); }
      }
      return;
    }
    // The Pit Boss: shielded while he changes phase; armored everywhere but his weak spot later on.
    if (target.isBoss) {
      if (target.invuln > 0) {
        if (attacker && attacker.isPlayer) this.fx.number(at || target.center(new THREE.Vector3()), 'SHIELDED', '#9ca3af', 1.1);
        return;
      }
      if (target.bossPhase >= 2 && !crit) amount = Math.max(1, Math.round(amount * 0.6));
    }
    if (this.net && !fromNet) {
      if (!this.map.safe && this.net.blocked(attacker, target)) return;
      // Client: we only decide our own hits. Send them to the host, show them right away.
      if (this.isClient && target.puppet) {
        if (!(attacker && attacker.isPlayer)) return;
        this.net.send({ k: 'hit', i: target.netId, dmg: amount, crit, at: at ? [at.x, at.y, at.z] : null });
        this.fx.number(at || target.center(new THREE.Vector3()), crit ? `${amount}!` : `${amount}`, crit ? '#ffd23f' : '#ff5d5d', crit ? 1.6 : 1.1);
        this.hud.hitmarker(false, crit);
        if (crit) sfx.crit(); else sfx.hit();
        return;
      }
      // Host: a friend got hit. Their game applies it (armor, downed, death).
      if (this.isHost && target.human) {
        this.net.net.to(target.owner, { k: 'hurt', amount, crit, by: this.net.id(attacker), byName: attacker ? attacker.name : null, at: at ? [at.x, at.y, at.z] : null });
        this.fx.number(at || target.center(new THREE.Vector3()), `${amount}`, '#ff5d5d', attacker && attacker.isPlayer ? 1.1 : 0.8);
        target.hurt(attacker);
        if (attacker && attacker.isPlayer) { this.hud.hitmarker(false, crit); sfx.hit(); }
        return;
      }
    }
    if (target.isPlayer && this.recorder) this.recorder.hurt(amount, crit, at);
    // Already down: hits chew through what's left, armor or not.
    if (target.downed) {
      target.downHp -= amount;
      this.fx.number(at, `${amount}`, '#ff5d5d', attacker && attacker.isPlayer ? 1.1 : 0.8);
      target.hurt(attacker);
      if (attacker && attacker.isPlayer && target !== attacker) { this.hud.hitmarker(target.downHp <= 0, false); sfx.hit(); }
      if (target.isPlayer) this.hud.hurt();
      if (target.downHp <= 0) this.kill(target, attacker);
      return;
    }
    // Armor soaks up most of a hit until it breaks.
    const absorbed = Math.min(target.armor || 0, Math.round(amount * (this.piercing ? 0.35 : 0.7)));
    target.armor = (target.armor || 0) - absorbed;
    target.hp -= amount - absorbed;
    if (crit) this.fx.number(at, `${amount}!`, '#ffd23f', attacker && attacker.isPlayer ? 1.6 : 1);
    else this.fx.number(at, `${amount}`, absorbed ? '#7dd3fc' : '#ff5d5d', attacker && attacker.isPlayer ? 1.1 : 0.8);
    target.hurt(attacker);
    if (attacker && attacker.isPlayer && target !== attacker) {
      if (crit) this.run.crits++;
      this.hud.hitmarker(target.hp <= 0, crit);
      if (crit) sfx.crit(); else sfx.hit();
    }
    if (target.isPlayer) {
      target.hurtAt = performance.now();
      // Remember who's been hurting you, for the kill cam.
      if (attacker && attacker !== target) {
        const k = attacker.name;
        this.hurtBy[k] = (this.hurtBy[k] || 0) + amount;
      }
      this.hud.hurt();
      this.shake = Math.max(this.shake, 0.2);
      sfx.hurt();
    }
    // Shooting a raider makes them (and their friends' tempers) hostile to you.
    if (target.brain && attacker && attacker.isPlayer) target.brain.hostile = true;
    // A duel never kills anyone: the losing blow just ends it.
    if (this.map.safe && target.hp <= 0) {
      target.hp = 1;
      if (this.duel) this.duel.lethal(target, attacker);
      return;
    }
    if (target.hp <= 0) {
      // Raiders and you go down first; machines just blow up.
      if (target.team !== 'machine' && !target.isBoss) this.down(target, attacker);
      else this.kill(target, attacker);
    }
  }

  kill(target, attacker) {
    if (!target.alive) return;
    // Party: tell the host we're out, so our stuff drops for the others.
    if (target.isPlayer && this.isClient) {
      this.net.send({ k: 'dead', items: [...target.weapons.filter(Boolean), ...target.backpack], chips: target.chips, by: attacker ? attacker.name : null });
    }
    // Host: a friend landed the kill, give them the credit.
    if (this.isHost && attacker && attacker.human && target !== attacker) {
      const what = target.isBoss ? 'boss' : target.type === 'gator' ? 'gator' : target.team === 'machine' ? 'machine' : 'raider';
      this.net.net.to(attacker.owner, { k: 'credit', what });
    }
    target.downed = false;
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
        this.dropAround(at, makeGun(pick(['rifle', 'rocket', 'sniper', 'minigun', 'ar', 'dbarrel']), Math.random() < 0.25 ? 3 : 2), 4);
        this.dropAround(at, makeItem('keycard'), 4);
        if (Math.random() < 0.2) this.dropAround(at, makeItem('clover'), 4);
        if (Math.random() < 0.01) this.dropAround(at, makeItem('crown'), 4);
        this.feed('👑 The Pit Boss is DOWN!');
        if (attacker && attacker.isPlayer) {
          this.run.boss = true;
          save.update((d) => { d.stats.bossKills++; });
        }
      } else if (target.type === 'gator') {
        if (Math.random() < def.loot) this.dropAround(at, makeItem('tooth'), 1.5);
      } else if (Math.random() < def.loot) {
        this.dropAround(at, rollLoot(tier), 1.5);
      }
      if (attacker && attacker.isPlayer) {
        this.run.kills++;
        this.run.machines++;
        if (target.type === 'gator') this.run.gators++;
      }
      return;
    }
    // A bean went down: everything they carried spills out.
    sfx.bust(at, this.listener);
    this.fx.confetti(at.clone().setY(1.4), 25);
    if (target.using) target.using = null;
    if (target.isPlayer) {
      this.feed(`${attacker ? attacker.name : 'Something'} got you`);
      this.startKillcam(target, attacker);
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
    const kc = this.killcam;
    const solo = !this.net;
    if (kc && !kc.over) {
      kc.t += dt;
      if (kc.replay && !kc.replay.done) kc.replay.update(dt);
      if (kc.t >= kc.dur) {
        kc.over = true;
        this.hud.killcam(null);
        // Lounge: back on your feet (where the referee put you) once the replay's done.
        if (this.pendingTp) { this.applyTp(this.pendingTp); this.pendingTp = null; }
        if (this.result) this.hud.raidOver(this.result);
      } else if (kc.freeze) {
        // The world holds still while the replay plays.
        this.focus.copy(kc.killer && kc.killer.pos ? kc.killer.pos : kc.victimPos);
        this.listener.copy(this.focus).setY(1.5);
        this.fx.update(dt);
        this.map.update(dt);
        this.map.followShadow(this.focus);
        return;
      }
    }
    if (p && p.alive) this.focus.copy(p.pos);
    else if (this.spectating && this.spectating.alive) this.focus.copy(this.spectating.pos);
    this.listener.copy(this.focus).setY(1.5);

    if (!this.isClient) for (const b of this.bots) b.update(dt);
    for (const c of this.combatants.slice()) {
      c.update(dt);
      c.wantJump = false;
      if (!c.alive && !c.isPlayer) {
        c.removeIn -= dt;
        if (c.removeIn <= 0) this.removeCombatant(c);
      }
    }
    // (Anything spawned mid-update, like boss summons, lands after the first n and is kept.)
    const all = this.machines;
    const n = all.length;
    const kept = [];
    for (let i = 0; i < n; i++) {
      const m = all[i];
      const keep = m.update(dt);
      if (!keep) this.scene.remove(m.group);
      // Don't draw machines lost in the haze.
      m.group.visible = m.pos.distanceToSquared(this.focus) < this.drawDist * this.drawDist;
      if (keep) kept.push(m);
    }
    this.machines = kept.concat(all.slice(n));
    for (const c of this.combatants) if (!c.isPlayer) c.char.root.visible = c.pos.distanceToSquared(this.focus) < this.drawDist * this.drawDist;
    for (const s of this.slots) s.update(dt);
    for (const w of this.gunWheels) w.update(dt);
    for (const k of this.containers) k.cull(this.focus);
    for (const pk of this.pickups) pk.update(dt);
    if (this.vaultOpen && this.vaultDoor.position.y < 14) this.vaultDoor.position.y += dt * 4;
    this.updateRockets(dt);
    this.throws.update(dt);
    this.hazards.update(dt);
    this.chips.update(dt);
    this.map.update(dt);
    this.map.followShadow(this.focus);
    this.fx.update(dt);
    this.shake = Math.max(0, this.shake - dt * 1.5);
    for (const e of this.extracts) e.beam.rotation.y += dt * 0.5;
    if (this.active && this.recorder) this.recorder.record(dt);
    if (this.net) this.net.update(dt);
    if (this.duel) this.duel.update(dt);

    // The host keeps the world running for friends even after they're done themselves.
    const world = this.active || (this.isHost && this.net.worldAlive());
    if (!world) {
      if (this.isHost && !this.net.ended) this.net.endWorld();
      return;
    }
    if (!this.isClient) {
      this.timeLeft -= dt;
      this.elapsed += dt;
    } else {
      this.timeLeft -= dt;
    }
    if (!this.isClient && !this.bossSpawned && !this.map.noBoss && this.elapsed >= BOSS_TIME) this.spawnBoss();
    // The Lounge never locks down.
    if (this.map.safe) this.timeLeft = Math.max(this.timeLeft, 600);
    if (this.active && !this.map.safe) {
      for (const mark of [300, 120, 60, 30]) {
        if (this.timeLeft <= mark && !this.warned[mark]) {
          this.warned[mark] = true;
          this.hud.toast(`⏰ ${mark >= 60 ? `${mark / 60} minute${mark > 60 ? 's' : ''}` : `${mark} seconds`} until The House locks down ${this.map.name}. Get to an exit!`, 'big');
        }
      }
    }
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      if (this.active) {
        p.alive = false;
        this.fail('time');
      }
      if (this.isHost) this.net.endWorld();
      return;
    }

    if (this.isClient) {
      // The host runs the rides; we just need to know if we're standing in one.
      this.extractAt = p && p.alive ? this.extracts.find((e) => e.active && this.inCircle(e, p)) || null : null;
    } else {
      this.updateExtracts(dt);
      this.updateBossLock(dt);
    }
  }
}

export { ENEMIES };
