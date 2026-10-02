// Multiplayer raids. The party leader ("host") runs the real raid: machines, raider bots, loot,
// containers, slots, the vault, extraction and the Pit Boss. Everyone else ("clients") runs their
// own character and aim locally, sends where they are and what they hit, and draws everything
// else from the host's snapshots. All messages go through the party server (server/index.js).
import * as THREE from 'three';
import { Combatant } from './combatant.js';
import { Machine } from './enemies.js';
import { ItemPickup } from './pickups.js';
import { PLAYER, RARITIES, WEAPONS } from './config.js';
import { addToList, itemInfo } from './items.js';
import { sfx } from './audio.js';
import { localTime, pushSample } from './netsmooth.js';

const SNAP_RATE = 1 / 12;
const STATE_RATE = 1 / 15;
const VIEW = 150; // how far around each player the host sends machines and effects

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const arr = (v) => [Math.round(v.x * 100) / 100, Math.round(v.y * 100) / 100, Math.round(v.z * 100) / 100];
const r2 = (n) => Math.round(n * 100) / 100;
const r1 = (n) => Math.round(n * 10) / 10;
// Fields that rarely change: only sent when they do (or when someone first sees that actor).
const STICKY = ['n', 'l', 'wn', 't', 'mh'];
const RESEND = 1000; // still-standing actors are re-sent this often so nobody thinks they vanished
const FORGET = 3000; // not sent for this long: introduce them again from scratch (clients forget after 4s)
const MAX_BACKLOG = 192 * 1024; // the leader's upload is this far behind: skip a snapshot

export class Session {
  constructor(raid, net, info) {
    this.raid = raid;
    this.net = net;
    this.me = net.id;
    this.host = info.host === net.id;
    this.client = !this.host;
    this.mode = info.mode || (info.ffa ? 'ffa' : 'coop');
    this.ffa = this.mode === 'ffa';
    this.teamOf = new Map(info.members.map((m) => [m.id, m.team || 0]));
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
    this.sent = new Map(); // host: per player, what we last told them about each actor
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
    if (!attacker || attacker === target || !this.human(attacker) || !this.human(target)) return false;
    if (this.mode === 'ffa') return false;
    if (this.mode === 'teams') return this.ally(attacker, target);
    return true;
  }

  // Which party member a person-actor belongs to.
  ownerOf(a) {
    if (!a) return null;
    if (a.isPlayer) return this.me;
    if (a.owner) return a.owner;
    return a.netId && a.netId[0] === 'p' ? a.netId.slice(1) : null;
  }

  // On the same side? (Everyone in co-op, nobody in free-for-all, your team in team games.)
  ally(a, b = this.raid.player) {
    if (this.mode === 'coop') return true;
    if (this.mode === 'ffa') return false;
    const x = this.ownerOf(a);
    const y = this.ownerOf(b);
    return x !== null && y !== null && this.teamOf.get(x) === this.teamOf.get(y);
  }

  // ---------- starting ----------

  // Host: a stand-in body for every friend, at the squad spawn.
  addFriends(spawn) {
    const raid = this.raid;
    this.register(raid.player, `p${this.me}`);
    this.members.forEach((m, i) => {
      if (m.id === this.me) return;
      this.makeFriend(m, new THREE.Vector3(spawn.x + (i % 3) * 2 - 2, 0, spawn.z + Math.floor(i / 3) * 2));
    });
  }

  makeFriend(m, pos) {
    const raid = this.raid;
    const c = new Combatant(raid, { name: m.name, look: m.look || undefined });
    c.puppet = true;
    c.human = true;
    c.owner = m.id;
    c.pos.copy(pos);
    c.netPos = c.pos.clone();
    this.register(c, `p${m.id}`);
    raid.combatants.push(c);
    return c;
  }

  // Host: someone wants into the raid: a friend back from a refresh, or a new party member.
  handleJoin(from, d) {
    const raid = this.raid;
    if (this.ended || !this.info) return;
    const no = (why) => this.net.to(from, { k: 'nojoin', why });
    let pup = this.puppetOf(from);
    if (pup && (!pup.alive || (this.gone.has(from) && !this.left.has(from)))) { no('You already left this raid. Wait for the next one.'); return; }
    if (!pup && this.gone.has(from) && !this.left.has(from)) { no('You already left this raid. Wait for the next one.'); return; }
    let pos;
    if (pup && pup.alive) pos = pup.pos.clone();
    else {
      // New to this raid: drop in next to a teammate who's still out there.
      const m = { id: from, name: String(d.name || 'Raider').slice(0, 16), look: d.look || null, team: d.team ? 1 : 0 };
      this.members = this.members.filter((x) => x.id !== from).concat(m);
      this.teamOf.set(from, m.team);
      const mates = raid.combatants.filter((c) => (c.isPlayer || c.human) && c.alive && (this.mode !== 'teams' || this.teamOf.get(this.ownerOf(c)) === m.team));
      const anchor = mates[Math.floor(Math.random() * mates.length)];
      const [sx, sz] = anchor ? [anchor.pos.x + 2, anchor.pos.z + 2] : raid.map.spawns[Math.floor(Math.random() * raid.map.spawns.length)];
      const [x, z] = raid.openSpot(sx, sz);
      pos = new THREE.Vector3(x, 0, z);
      if (pup) raid.removeCombatant(pup);
      pup = this.makeFriend(m, pos);
      raid.feed(`🪂 ${m.name} dropped into the raid`);
    }
    this.gone.delete(from);
    this.left.delete(from);
    this.watching.delete(from);
    this.sent.delete(from);
    this.net.to(from, {
      k: 'joinInfo',
      info: { ...this.info, host: this.me, mode: this.mode, members: this.members },
      pos: arr(pos),
      time: r1(raid.timeLeft),
      el: r2(raid.elapsed),
      opened: raid.containers.map((k, i) => (k.opened ? i : -1)).filter((i) => i >= 0),
      vault: raid.vaultOpen,
      pickups: raid.pickups.filter((pk) => pk.netId).map((pk) => ({ id: pk.netId, p: arr(pk.pos), item: pk.item })),
    });
  }

  // Client: catch up on the world when dropping in mid-raid.
  applyJoin(j) {
    const raid = this.raid;
    raid.timeLeft = j.time;
    raid.elapsed = j.el;
    for (const i of j.opened || []) if (raid.containers[i]) raid.containers[i].showOpened();
    if (j.vault) raid.openVault({ name: 'Someone' }, true);
    for (const p of j.pickups || []) this.applyEvent({ k: 'pn', id: p.id, p: p.p, item: p.item });
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
    const s = { i: this.id(a), x: r1(a.pos.x), y: r1(a.pos.y), z: r1(a.pos.z), yw: r2(a.yaw || 0), hp: Math.round(a.hp), mh: a.maxHp, a: a.alive ? 1 : 0 };
    if (a.team === 'machine') {
      s.k = 'm';
      s.t = a.type;
      if (a.stunned > 0) s.st = 1;
      if (a.isBoss) { s.bp = a.bossPhase; if (a.invuln > 0) s.iv = 1; }
    } else {
      s.k = 'c';
      s.n = a.name;
      s.l = a.look;
      s.lk = a.lookKey || (a.lookKey = JSON.stringify(a.look || null));
      s.p = r2(a.pitch || 0);
      s.ar = Math.round(a.armor || 0);
      s.d = a.downed ? 1 : 0;
      const roll = a.puppet ? a.netRoll || 0 : a.rolling ? a.rolling.t / PLAYER.rollTime : 0;
      if (roll) s.rl = r2(roll);
      s.w = a.puppet ? a.netWeapon || 'fists' : a.weapon;
      s.r = a.puppet ? a.netRarity || 0 : a.rarity || 0;
      s.wn = a.puppet ? a.netWeaponName : a.weaponName;
      if (a.human) s.h = 1;
      if (a.champion) s.ch = 1;
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

  // Only what changed since we last told this player: unchanged actors are skipped (but re-sent
  // every second), and names/outfits/weapon names only go out when they change.
  pack(memberId, full, now) {
    let mem = this.sent.get(memberId);
    if (!mem) { mem = new Map(); this.sent.set(memberId, mem); }
    const out = [];
    for (const s of full) {
      const lk = s.lk;
      delete s.lk;
      const prev = mem.get(s.i);
      const fresh = !prev || now - prev.at > FORGET;
      const sig = `${s.x},${s.y},${s.z},${s.yw},${s.hp},${s.a},${s.p},${s.ar},${s.d},${s.w},${s.r},${s.st}`;
      if (!fresh && prev.sig === sig && now - prev.at < RESEND) continue;
      const o = { ...s };
      const last = fresh ? {} : prev.v;
      const v = {};
      for (const k of STICKY) {
        const val = k === 'l' ? lk : s[k];
        v[k] = val;
        if (!fresh && last[k] === val) delete o[k];
      }
      mem.set(s.i, { at: now, sig, v });
      out.push(o);
    }
    return out;
  }

  sendSnapshots() {
    const raid = this.raid;
    // Our upload can't keep up: skip this one (events and reliable messages wait for the next).
    if (this.net.buffered > MAX_BACKLOG) {
      if (this.events.length > 300) this.events.splice(0, this.events.length - 300);
      return;
    }
    const now = performance.now();
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
        t: Math.round(now),
        time: r1(raid.timeLeft),
        el: r2(raid.elapsed),
        act: this.pack(m.id, actors, now),
        ev,
        rel: reliable,
        ex: raid.extracts.map((e) => (e.active ? [e.call ? r2(e.call.t) : -1, r2(e.cooldown || 0), e.call ? e.call.by.name : ''] : null)),
        storm: raid.hazards.storm > 0 ? 1 : 0,
        bl: raid.bossLock && raid.bossLock.on ? 1 : 0,
        dl: raid.duel ? raid.duel.view : null,
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
    return this.raid.combatants.filter((c) => c.human && !c.isPlayer && c.alive && !(this.host && this.gone.has(c.owner)) && (this.mode !== 'teams' || this.ally(c)));
  }

  // ---------- client → host ----------

  sendState() {
    const p = this.raid.player;
    this.net.to('host', {
      k: 'state',
      t: Math.round(performance.now()),
      x: r2(p.pos.x), y: r2(p.pos.y), z: r2(p.pos.z), yw: r2(p.yaw), p: r2(p.pitch),
      vx: r2(p.vel.x), vz: r2(p.vel.z), hp: Math.round(p.hp), mh: p.maxHp, ar: Math.round(p.armor),
      a: p.alive ? 1 : 0, d: p.downed ? 1 : 0, w: p.weapon, r: p.rarity || 0, wn: p.weaponName,
      rl: p.rolling ? r2(p.rolling.t / PLAYER.rollTime) : 0,
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
    if (d.k === 'rejoin') { this.handleJoin(from, d); return; }
    const duel = this.raid.duel;
    if (duel && d.k === 'duelAsk') { const a = this.puppetOf(from); const b = this.byId.get(d.to); if (a && b) duel.request(a, b, d.stakes || {}, d.gun || null); return; }
    if (duel && d.k === 'duelReply') { const p = duel.pending.get(d.id); if (p && p.b.owner === from) duel.reply(d.id, !!d.yes, d.gun || null); return; }
    if (duel && d.k === 'duelLost') { duel.lostBy(from); return; }
    if (duel && d.k === 'bet') { const b = this.puppetOf(from); if (b && !duel.placeBet(b, d.side, Math.max(0, Number(d.amount) || 0))) this.net.to(from, { k: 'toast', text: 'Bets are closed.' }); return; }
    if (d.k === 'watch') { if (d.i) this.watching.set(from, d.i); else this.watching.delete(from); return; }
    if (d.k === 'bye') { this.left.add(from); this.gone.add(from); return; }
    const pup = this.puppetOf(from);
    if (!pup) return;
    switch (d.k) {
      case 'state': {
        if (!pup.alive) return;
        pup.netPos = new THREE.Vector3(d.x, d.y, d.z);
        pushSample(pup, localTime(from, d.t), d.x, d.y, d.z, d.yw);
        pup.netSpeed = Math.hypot(d.vx, d.vz);
        if (!pup.netBuf) pup.yaw = d.yw;
        pup.pitch = d.p;
        pup.hp = d.hp;
        pup.maxHp = d.mh;
        pup.armor = d.ar;
        if (d.w !== pup.netWeapon) (pup.recentGuns ||= new Map()).set(pup.netWeapon, performance.now());
        pup.netWeapon = d.w;
        pup.netRarity = d.r;
        pup.netWeaponName = d.wn;
        pup.netRoll = d.rl || 0;
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
        if (!this.validHit(pup, target, d)) return;
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
      case 'gw': {
        // A friend bet a gun on a Gun Wheel: we spin it.
        const w = raid.gunWheels[d.i];
        if (w && !w.spin && d.gun && d.gun.id === 'gun') w.roll(pup, d.gun);
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

  // Sanity-check a friend's hit before it counts: could that gun do that much, from there, that
  // often, without a wall in the way? (Generous, since everyone sees the world a moment late.)
  validHit(pup, target, d) {
    const now = performance.now();
    const guns = [pup.netWeapon || 'fists'];
    for (const [g, at] of pup.recentGuns || []) if (now - at < 2500) guns.push(g);
    const rar = RARITIES[pup.netRarity || 0] || RARITIES[0];
    let maxDmg = 0;
    let range = 0;
    let perSec = 0;
    for (const g of guns) {
      const w = WEAPONS[g] || WEAPONS.fists;
      maxDmg = Math.max(maxDmg, w.damage * Math.max(rar.damage, ...RARITIES.map((r) => r.damage)) * 3 + 1);
      range = Math.max(range, w.range || 2);
      perSec = Math.max(perSec, (w.pellets || 1) / Math.max(0.05, w.rate));
    }
    if (!(d.dmg > 0) || d.dmg > maxDmg) return this.reject(pup, 'damage');
    const from = pup.netPos || pup.pos;
    const to = target.center(new THREE.Vector3());
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    if (dist > range + (target.radius || 1) + 12) return this.reject(pup, 'range');
    // Fire rate: a leaky bucket of hits.
    const b = pup.hitBucket || (pup.hitBucket = { n: 0, at: now });
    b.n = Math.max(0, b.n - ((now - b.at) / 1000) * perSec * 1.6);
    b.at = now;
    b.n++;
    if (b.n > perSec * 1.6 + 12) return this.reject(pup, 'rate');
    // A wall between them (well short of the target) means no.
    const eye = new THREE.Vector3(from.x, from.y + 1.5, from.z);
    const dir = to.clone().sub(eye);
    const len = dir.length();
    if (len > 3) {
      const h = this.raid.raycast(eye, dir.normalize(), len, pup, { solidsOnly: true });
      if (h.hit && len - h.distance > 3) return this.reject(pup, 'wall');
    }
    return true;
  }

  reject(pup, why) {
    pup.rejected = (pup.rejected || 0) + 1;
    if (pup.rejected % 25 === 1) console.warn(`Ignored a hit from ${pup.name}: ${why}`);
    return false;
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
      case 'hostgone': this.hostLeft(); break;
      case 'duelInvite': if (raid.duel) raid.duel.showInvite(d); break;
      case 'duelResult': if (raid.duel) raid.duel.applyResult(d); break;
      case 'betResult': if (raid.duel) raid.duel.applyBet(d); break;
      case 'showdown': if (raid.duel) raid.duel.showReveal(d); break;
      case 'tp':
        // Mid kill cam: wait for it to finish before moving.
        if (raid.killcam && !raid.killcam.over) raid.pendingTp = d;
        else raid.applyTp(d);
        break;
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
    const at = localTime('host', s.t);
    for (const a of s.act) {
      seen.add(a.i);
      let actor = this.byId.get(a.i);
      if (!actor) actor = this.makePuppet(a);
      if (!actor) continue;
      actor.lastSeen = performance.now();
      actor.netPos = new THREE.Vector3(a.x, a.y, a.z);
      actor.netYaw = a.yw;
      pushSample(actor, at, a.x, a.y, a.z, a.yw);
      if (a.mh !== undefined) actor.maxHp = a.mh;
      if (actor.team === 'machine') {
        const dropped = a.hp < actor.hp;
        actor.hp = a.hp;
        if (dropped) actor.hurt(null);
        actor.stunned = a.st ? 1 : 0;
        if (actor.isBoss && a.bp) { actor.setBossPhase(a.bp); actor.invuln = a.iv ? 1 : 0; }
        if (actor.alive && !a.a) this.machineDied(actor);
      } else {
        actor.hp = a.hp;
        actor.armor = a.ar;
        actor.netPitch = a.p;
        actor.netRoll = a.rl || 0;
        actor.netWeapon = a.w;
        actor.netRarity = a.r;
        if (a.wn !== undefined) actor.netWeaponName = a.wn;
        if (a.n !== undefined) actor.name = a.n;
        if (a.d && !actor.downed) raid.down(actor, null, true);
        if (!a.d && actor.downed) { actor.downed = false; actor.reviveSpot = null; }
        if (actor.alive && !a.a) { actor.alive = false; actor.downed = false; actor.removeIn = 8; }
      }
    }
    // Out of range or gone for a while: tidy up.
    const now = performance.now();
    for (const [id, actor] of this.byId) {
      if (seen.has(id) || actor === raid.player) continue;
      if (now - (actor.lastSeen || 0) > 4000) {
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
    raid.setBossLock(!!s.bl);
    if (raid.duel) raid.duel.apply(s.dl);
    if (raid.hazards.dust) raid.hazards.storm = s.storm ? Math.max(raid.hazards.storm, 1) : 0;
  }

  makePuppet(a) {
    const raid = this.raid;
    if (a.k === 'm') {
      if (!a.a || !a.t) return null;
      const m = new Machine(raid, a.t, a.x, a.z, a.y || 0);
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
    c.champion = !!a.ch;
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
      case 'gws': {
        const w = raid.gunWheels[e.i];
        if (w) w.start(e.slice, e.gun);
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
