// Multiplayer raids. The party leader ("host") runs the real raid: machines, raider bots, loot,
// containers, slots, the vault, extraction and the Pit Boss. Everyone else ("clients") runs their
// own character and aim locally, sends where they are and what they hit, and draws everything
// else from the host's snapshots. All messages go through the party server (server/index.js).
import * as THREE from 'three';
import { Combatant } from './combatant.js';
import { Machine } from './enemies.js';
import { ItemPickup } from './pickups.js';
import { RARITIES, WEAPONS } from './config.js';
import { addToList, itemInfo } from './items.js';
import { sfx } from './audio.js';

const SNAP_RATE = 1 / 12;
const STATE_RATE = 1 / 15;
const VIEW = 150; // how far around each player the host sends machines and effects

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const arr = (v) => [Math.round(v.x * 100) / 100, Math.round(v.y * 100) / 100, Math.round(v.z * 100) / 100];
const r2 = (n) => Math.round(n * 100) / 100;

export class Session {
  constructor(raid, net, info) {
    this.raid = raid;
    this.net = net;
    this.me = net.id;
    this.host = info.host === net.id;
    this.client = !this.host;
    this.ffa = !!info.ffa;
    this.members = info.members;
    this.byId = new Map();
    this.idOf = new WeakMap();
    this.nextId = 1;
    this.snapT = 0;
    this.stateT = 0;
    this.events = []; // host: positional effects for this tick
    this.reliable = []; // host: things everyone must hear about
    this.gone = new Set(); // host: players who extracted, died or left
    this.left = new Set(); // host: players who went back to the hub or disconnected (stop sending to them)
    this.watching = new Map(); // host: dead/extracted player -> net id of the squadmate they spectate
    this.ended = false;
    this.lastSnap = 0;
    this.pickupsById = new Map();
    this.onMsg = ({ from, d }) => this.receive(from, d);
    net.on('msg', this.onMsg);
    this.onLeft = ({ id }) => this.playerLeft(id);
    net.on('left', this.onLeft);
    this.onHostLeft = () => this.hostLeft();
    net.on('hostLeft', this.onHostLeft);
    raid.net = this;
  }

  dispose() {
    this.ended = true;
    const h = this.net.handlers;
    for (const [k, fn] of [['msg', this.onMsg], ['left', this.onLeft], ['hostLeft', this.onHostLeft]]) {
      if (h[k]) h[k] = h[k].filter((f) => f !== fn);
    }
    if (this.raid.net === this) this.raid.net = null;
  }

  // ---------- ids ----------

  id(actor) {
    if (!actor) return null;
    if (actor.netId) return actor.netId;
    actor.netId = `${actor.team === 'machine' ? 'm' : 'b'}${this.nextId++}`;
    this.byId.set(actor.netId, actor);
    return actor.netId;
  }

  register(actor, id) {
    actor.netId = id;
    this.byId.set(id, actor);
  }

  // Is this a person (you or a friend), not a bot?
  human(a) { return a && (a.isPlayer || a.human); }

  // Friendly fire between people is off unless the leader turned on free-for-all.
  blocked(attacker, target) {
    return !this.ffa && attacker !== target && this.human(attacker) && this.human(target);
  }

  // ---------- starting ----------

  // Host: a stand-in body for every friend, at the squad spawn.
  addFriends(spawn) {
    const raid = this.raid;
    this.register(raid.player, `p${this.me}`);
    this.members.forEach((m, i) => {
      if (m.id === this.me) return;
      const c = new Combatant(raid, { name: m.name, look: m.look || undefined });
      c.puppet = true;
      c.human = true;
      c.owner = m.id;
      c.pos.set(spawn.x + (i % 3) * 2 - 2, 0, spawn.z + Math.floor(i / 3) * 2);
      c.netPos = c.pos.clone();
      this.register(c, `p${m.id}`);
      raid.combatants.push(c);
    });
  }

  // ---------- every frame ----------

  update(dt) {
    if (this.ended) return;
    if (this.host) {
      this.snapT -= dt;
      if (this.snapT <= 0) { this.snapT = SNAP_RATE; this.sendSnapshots(); }
    } else {
      this.stateT -= dt;
      const p = this.raid.player;
      if (this.stateT <= 0 && p) { this.stateT = STATE_RATE; this.sendState(); }
    }
  }

  // Host: the raid is over for everyone.
  endWorld() {
    if (this.ended) return;
    if (this.host) this.net.to('all', { k: 'over' });
    this.ended = true;
    if (this.host) this.net.end();
  }

  // Host: is anyone still out there (so the world keeps running after the host is done)?
  worldAlive() {
    if (this.ended) return false;
    return this.raid.combatants.some((c) => c.human && c.alive && !this.gone.has(c.owner));
  }

  // ---------- host → clients ----------

  ev(e, at = null) {
    if (!this.host || this.ended) return;
    e.at = at ? arr(at) : null;
    this.events.push(e);
  }

  rel(e) {
    if (!this.host || this.ended) return;
    this.reliable.push(e);
  }

  actorState(a) {
    const s = { i: this.id(a), x: r2(a.pos.x), y: r2(a.pos.y), z: r2(a.pos.z), yw: r2(a.yaw || 0), hp: Math.round(a.hp), mh: a.maxHp, a: a.alive ? 1 : 0 };
    if (a.team === 'machine') {
      s.k = 'm';
      s.t = a.type;
      if (a.stunned > 0) s.st = 1;
    } else {
      s.k = 'c';
      s.n = a.name;
      s.l = a.look;
      s.p = r2(a.pitch || 0);
      s.ar = Math.round(a.armor || 0);
      s.d = a.downed ? 1 : 0;
      s.w = a.puppet ? a.netWeapon || 'fists' : a.weapon;
      s.r = a.puppet ? a.netRarity || 0 : a.rarity || 0;
      s.wn = a.puppet ? a.netWeaponName : a.weaponName;
      if (a.human) s.h = 1;
      if (a.isPlayer) s.h = 1;
    }
    return s;
  }

  // Who a player's snapshot is centered on: themselves while they're alive, otherwise the
  // squadmate they're spectating (or anyone still out there, so their world doesn't empty out).
  viewOf(id) {
    const pup = this.puppetOf(id);
    if (pup && pup.alive && !this.gone.has(id)) return pup;
    const w = this.byId.get(this.watching.get(id));
    if (w && w.alive) return w;
    return this.raid.combatants.find((c) => this.human(c) && c.alive) || null;
  }

  sendSnapshots() {
    const raid = this.raid;
    const reliable = this.reliable;
    this.reliable = [];
    for (const m of this.members) {
      if (m.id === this.me || this.left.has(m.id)) continue;
      const c = this.viewOf(m.id);
      if (!c) continue;
      const own = this.puppetOf(m.id);
      const near = (v) => Math.abs(v.x - c.pos.x) < VIEW && Math.abs(v.z - c.pos.z) < VIEW;
      const actors = [];
      for (const a of raid.combatants) if (a !== own && (a.alive || a.removeIn > 6) && (near(a.pos) || this.human(a))) actors.push(this.actorState(a));
      for (const mm of raid.machines) if (near(mm.pos) && (mm.alive || mm.dead < 1)) actors.push(this.actorState(mm));
      const ev = this.events.filter((e) => !e.at || (Math.abs(e.at[0] - c.pos.x) < VIEW && Math.abs(e.at[2] - c.pos.z) < VIEW));
      this.net.to(m.id, {
        k: 'snap',
        time: r2(raid.timeLeft),
        el: r2(raid.elapsed),
        act: actors,
        ev,
        rel: reliable,
        ex: raid.extracts.map((e) => (e.active ? [e.call ? r2(e.call.t) : -1, r2(e.cooldown || 0), e.call ? e.call.by.name : ''] : null)),
        storm: raid.hazards.storm > 0 ? 1 : 0,
      });
    }
    this.events = [];
  }

  // Client: tell the host who we're spectating (null to stop), so our snapshots follow them.
  watch(target) {
    if (this.client && !this.ended) this.send({ k: 'watch', i: target ? target.netId : null });
  }

  // Client: we're back at the hub, stop sending us the world.
  bye() {
    if (this.client && !this.ended) this.send({ k: 'bye' });
  }

  // Squadmates still out in the raid (for spectating).
  squad() {
    if (this.ended) return [];
    // No word from the leader for a while: their world is gone.
    if (this.client && performance.now() - this.lastSnap > 5000) return [];
    return this.raid.combatants.filter((c) => c.human && !c.isPlayer && c.alive && !(this.host && this.gone.has(c.owner)));
  }

  // ---------- client → host ----------

  sendState() {
    const p = this.raid.player;
    this.net.to('host', {
      k: 'state',
      x: r2(p.pos.x), y: r2(p.pos.y), z: r2(p.pos.z), yw: r2(p.yaw), p: r2(p.pitch),
      vx: r2(p.vel.x), vz: r2(p.vel.z), hp: Math.round(p.hp), mh: p.maxHp, ar: Math.round(p.armor),
      a: p.alive ? 1 : 0, d: p.downed ? 1 : 0, w: p.weapon, r: p.rarity || 0, wn: p.weaponName,
    });
  }

  send(d) { this.net.to('host', d); }

  // ---------- receiving ----------

  receive(from, d) {
    if (this.ended || !d) return;
    if (this.host) this.hostReceive(from, d);
    else if (from === this.hostId || d.k === 'snap' || true) this.clientReceive(d);
  }

  puppetOf(from) { return this.byId.get(`p${from}`); }

  // Host handling a message from a friend.
  hostReceive(from, d) {
    const raid = this.raid;
    if (d.k === 'watch') { if (d.i) this.watching.set(from, d.i); else this.watching.delete(from); return; }
    if (d.k === 'bye') { this.left.add(from); this.gone.add(from); return; }
    const pup = this.puppetOf(from);
    if (!pup) return;
    switch (d.k) {
      case 'state': {
        if (!pup.alive) return;
        pup.netPos = new THREE.Vector3(d.x, d.y, d.z);
        pup.netSpeed = Math.hypot(d.vx, d.vz);
        pup.yaw = d.yw;
        pup.pitch = d.p;
        pup.hp = d.hp;
        pup.maxHp = d.mh;
        pup.armor = d.ar;
        pup.netWeapon = d.w;
        pup.netRarity = d.r;
        pup.netWeaponName = d.wn;
        if (d.d && !pup.downed) raid.down(pup, null, true);
        if (!d.d && pup.downed) { pup.downed = false; pup.reviveSpot = null; }
        break;
      }
      case 'shot':
        this.ev({ k: 'tr', f: d.f, to: d.to, c: d.c, w: d.w, own: from }, v3(d.f));
        break;
      case 'hit': {
        const target = this.byId.get(d.i);
        if (!target || !target.alive) return;
        raid.damage(target, d.dmg, pup, v3(d.at), !!d.crit);
        break;
      }
      case 'throw':
        raid.throws.spawn(pup, v3(d.o), v3(d.d), d.id, d.roll);
        this.ev({ k: 'th', o: d.o, d: d.d, id: d.id, roll: d.roll, own: from }, v3(d.o));
        break;
      case 'rocket':
        raid.spawnRocket(v3(d.o), v3(d.d), pup, d.r || 0);
        this.ev({ k: 'rk', o: d.o, d: d.d, r: d.r, own: from }, v3(d.o));
        break;
      case 'take': {
        const pk = this.pickupsById.get(d.id);
        if (!pk || !raid.pickups.includes(pk)) return;
        pk.remove();
        raid.pickups = raid.pickups.filter((x) => x !== pk);
        this.pickupsById.delete(d.id);
        this.rel({ k: 'pg', id: d.id });
        this.net.to(from, { k: 'give', item: pk.item });
        break;
      }
      case 'drop':
        raid.dropItem(v3(d.at), d.item, d.from ? v3(d.from) : null);
        break;
      case 'open': {
        const k = raid.containers[d.i];
        if (k && !k.opened) k.open(pup);
        break;
      }
      case 'slot': {
        const s = raid.slots[d.i];
        if (s && !s.user) s.use(pup, true);
        break;
      }
      case 'vault':
        if (!raid.vaultOpen) raid.openVault(pup);
        break;
      case 'revive': {
        const t = this.byId.get(d.i);
        if (t && t.downed) raid.revive(t, pup);
        break;
      }
      case 'dead': {
        // A friend died: their stuff drops where they fell, for anyone to grab.
        pup.downed = false;
        pup.alive = false;
        pup.hp = 0;
        pup.removeIn = 8;
        this.gone.add(from);
        raid.feed(`💀 ${pup.name} ${d.by ? `was busted by ${d.by}` : 'went down for good'}`);
        for (const it of d.items || []) raid.dropAround(pup.pos.clone(), it, 1.5);
        if (d.chips) raid.chips.spawnBurst(pup.pos.clone().setY(1.2), d.chips, null);
        break;
      }
      case 'gone':
        this.gone.add(from);
        break;
      default:
    }
  }

  // A friend's connection dropped mid-raid.
  playerLeft(id) {
    if (!this.host) return;
    const pup = this.puppetOf(id);
    this.gone.add(id);
    this.left.add(id);
    this.watching.delete(id);
    if (pup) {
      this.raid.feed(`🔌 ${pup.name} disconnected`);
      this.raid.removeCombatant(pup);
    }
  }

  hostLeft() {
    if (this.host) return;
    const raid = this.raid;
    this.ended = true;
    if (raid.active && raid.player && raid.player.alive) {
      raid.hud.toast('🔌 The party leader left. You got out with what you had.', 'big');
      raid.extract('Emergency Exit');
    }
  }

  // Client handling a message from the host.
  clientReceive(d) {
    const raid = this.raid;
    const p = raid.player;
    switch (d.k) {
      case 'snap': this.applySnapshot(d); break;
      case 'hurt': {
        if (!p || !p.alive) return;
        const by = d.by ? this.byId.get(d.by) : null;
        const attacker = by || (d.byName ? { name: d.byName, team: 'env' } : null);
        raid.damage(p, d.amount, attacker, d.at ? v3(d.at) : p.center(new THREE.Vector3()), !!d.crit, true);
        break;
      }
      case 'give': {
        if (!p) return;
        if (!addToList(p.backpack, d.item, p.capacity)) {
          raid.hud.toast('Backpack full');
          this.send({ k: 'drop', item: d.item, at: arr(p.pos), from: arr(p.pos) });
          return;
        }
        const info = itemInfo(d.item);
        sfx.pickup();
        raid.hud.toast(`+ ${info.icon} ${info.name}`, info.rarity >= 2 ? 'big' : '');
        break;
      }
      case 'revived': {
        if (p && p.downed) raid.revive(p, (d.by && this.byId.get(d.by)) || { name: d.byName || 'Someone' }, true);
        break;
      }
      case 'extracted':
        if (p && p.alive && raid.active) raid.extract(d.where, d.riders || []);
        this.send({ k: 'gone' });
        break;
      case 'credit':
        if (d.what === 'machine') { raid.run.kills++; raid.run.machines++; }
        if (d.what === 'gator') { raid.run.kills++; raid.run.machines++; raid.run.gators++; }
        if (d.what === 'raider') { raid.run.kills++; raid.run.raiders++; }
        if (d.what === 'boss') { raid.run.boss = true; raid.run.kills++; raid.run.machines++; }
        break;
      case 'toast':
        raid.hud.toast(d.text, d.big ? 'big' : '');
        break;
      case 'over': this.ended = true; break;
      default:
    }
  }

  applySnapshot(s) {
    const raid = this.raid;
    this.lastSnap = performance.now();
    if (raid.active) {
      raid.timeLeft = s.time;
      raid.elapsed = s.el;
    }
    const seen = new Set();
    for (const a of s.act) {
      seen.add(a.i);
      let actor = this.byId.get(a.i);
      if (!actor) actor = this.makePuppet(a);
      if (!actor) continue;
      actor.lastSeen = performance.now();
      actor.netPos = new THREE.Vector3(a.x, a.y, a.z);
      actor.netYaw = a.yw;
      actor.maxHp = a.mh;
      if (actor.team === 'machine') {
        const dropped = a.hp < actor.hp;
        actor.hp = a.hp;
        if (dropped) actor.hurt(null);
        actor.stunned = a.st ? 1 : 0;
        if (actor.alive && !a.a) this.machineDied(actor);
      } else {
        actor.hp = a.hp;
        actor.armor = a.ar;
        actor.netPitch = a.p;
        actor.netWeapon = a.w;
        actor.netRarity = a.r;
        actor.netWeaponName = a.wn;
        actor.name = a.n;
        if (a.d && !actor.downed) raid.down(actor, null, true);
        if (!a.d && actor.downed) { actor.downed = false; actor.reviveSpot = null; }
        if (actor.alive && !a.a) { actor.alive = false; actor.downed = false; actor.removeIn = 8; }
      }
    }
    // Out of range or gone for a while: tidy up.
    const now = performance.now();
    for (const [id, actor] of this.byId) {
      if (seen.has(id) || actor === raid.player) continue;
      if (now - (actor.lastSeen || 0) > 2500) {
        if (actor.team === 'machine') { raid.scene.remove(actor.group); raid.machines = raid.machines.filter((m) => m !== actor); } else raid.removeCombatant(actor);
        this.byId.delete(id);
      }
    }
    for (const e of s.ev) this.applyEvent(e);
    for (const e of s.rel) this.applyEvent(e);
    // Extraction state.
    s.ex.forEach((x, i) => {
      const e = raid.extracts[i];
      if (!e || !x) return;
      const [t, cd, by] = x;
      const was = !!e.call;
      e.call = t >= 0 ? { t, by: { name: by } } : null;
      e.cooldown = cd;
      if (e.call && !was && raid.active && raid.player && raid.player.alive) {
        raid.hud.toast(`📣 ${by} called the ${e.name} extraction! Get in the circle.`, 'big');
      }
      e.beam.material.color.setHex(e.call ? 0xffd23f : 0x5ee27a);
      e.ring.material.color.setHex(e.call ? 0xffd23f : 0x5ee27a);
    });
    if (raid.hazards.dust) raid.hazards.storm = s.storm ? Math.max(raid.hazards.storm, 1) : 0;
  }

  makePuppet(a) {
    const raid = this.raid;
    if (a.k === 'm') {
      if (!a.a) return null;
      const m = new Machine(raid, a.t, a.x, a.z);
      m.puppet = true;
      m.yaw = a.yw;
      this.register(m, a.i);
      raid.machines.push(m);
      return m;
    }
    if (!a.a) return null;
    const c = new Combatant(raid, { name: a.n, look: a.l || undefined });
    c.puppet = true;
    c.human = !!a.h;
    c.pos.set(a.x, a.y, a.z);
    c.yaw = a.yw;
    this.register(c, a.i);
    raid.combatants.push(c);
    return c;
  }

  machineDied(m) {
    const raid = this.raid;
    m.alive = false;
    m.hp = 0;
    raid.fx.explosion(m.center(new THREE.Vector3()), m.isBoss ? 8 : 1.8);
    sfx.bust(m.pos, raid.listener);
  }

  applyEvent(e) {
    const raid = this.raid;
    if (e.own === this.me) return;
    switch (e.k) {
      case 'tr': {
        const f = v3(e.f);
        raid.fx.tracer(f, v3(e.to), e.c);
        raid.fx.muzzleFlash(f);
        if (e.w && WEAPONS[e.w]) sfx.shoot(e.w, f, raid.listener);
        else sfx.zap(f, raid.listener);
        break;
      }
      case 'bm':
        raid.fx.explosion(v3(e.at), e.s);
        sfx.boom(v3(e.at), raid.listener);
        raid.shake = Math.max(raid.shake, Math.max(0, 0.6 - raid.player.pos.distanceTo(v3(e.at)) / 30));
        break;
      case 'fd': raid.hud.feed(e.text); break;
      case 'pn': {
        const pk = new ItemPickup(raid, v3(e.p), e.item, e.from ? v3(e.from) : null);
        pk.netId = e.id;
        raid.pickups.push(pk);
        this.pickupsById.set(e.id, pk);
        break;
      }
      case 'pg': {
        const pk = this.pickupsById.get(e.id);
        if (pk) { pk.remove(); raid.pickups = raid.pickups.filter((x) => x !== pk); this.pickupsById.delete(e.id); }
        break;
      }
      case 'ko': {
        const k = raid.containers[e.i];
        if (k) k.showOpened();
        break;
      }
      case 'ss': {
        const s = raid.slots[e.i];
        if (s) s.startSpin(null, e.finals, e.jackpot);
        break;
      }
      case 'vo': raid.openVault({ name: e.by || 'Someone' }, true); break;
      case 'th': {
        const owner = this.byId.get(e.ow) || { name: '?', alive: true, team: 'raider' };
        raid.throws.spawn(owner, v3(e.o), v3(e.d), e.id, e.roll);
        break;
      }
      case 'rk': raid.spawnRocket(v3(e.o), v3(e.d), { team: 'raider', name: '?' }, e.r || 0); break;
      case 'ch': raid.chips.spawnBurst(v3(e.at), e.n, null, { speed: e.sp || 3 }); break;
      default:
    }
  }
}
