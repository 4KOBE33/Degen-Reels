// 1v1 duels in the High Roller Lounge. Walk up to someone (a friend, or the House Champion),
// hold E, pick the stakes (chips, and maybe "pink slips": both bet the gun in their hands), and
// if they accept you're both dropped into The Pit. Nobody dies: the losing blow ends it and the
// loser pays up. In a party, the leader's game referees; everyone else sees the result.
import * as THREE from 'three';
import { save } from './save.js';
import { itemInfo, makeGun, addToStash, rollRarity } from './items.js';
import { Combatant } from './combatant.js';
import { RaiderBrain } from './bots.js';
import { randomLook } from './looks.js';
import { keyName } from './keys.js';
import { sfx } from './audio.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const COUNTDOWN = 3;
const TIME_LIMIT = 120;
const STAKES = [0, 500, 1000, 5000, 10000, 25000, 50000, 100000];
const gunName = (g) => (g ? itemInfo({ id: 'gun', kind: g.kind, rarity: g.rarity }).name : 'nothing');

export class Duel {
  constructor(raid) {
    this.raid = raid;
    this.cur = null; // referee: { id, a, b, chips, guns, gunA, gunB, phase, t, winner }
    this.view = null; // what everyone sees: { a, b, aId, bId, chips, guns, ph, t, w }
    this.pending = new Map(); // referee: invites waiting on an answer
    this.invite = null; // an invite to us
    this.nextId = 1;
    this.lostSent = false;
    const L = raid.map.lounge;
    this.arena = new THREE.Vector3(L.arena.x, 0, L.arena.z);
    this.r = L.arena.r;
    this.exitSpot = { spot: new THREE.Vector3(L.exit.x, 0, L.exit.z), range: 4, searchTime: 0.6, searchLabel: 'Cashing out…', prompt: () => `<b>Hold ${keyName('use')}</b> Cash out (leave with everything)`, open: (by) => { if (by.isPlayer) raid.extract('Cash Out'); } };
    this.challengeSpots = new Map();
    this.onKey = (e) => this.key(e);
    window.addEventListener('keydown', this.onKey);
    $('duelSend').onclick = () => this.sendChallenge();
    $('duelCancel').onclick = () => this.closePanel();
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey);
    $('duelInvite').hidden = true;
    $('duelStatus').hidden = true;
    $('duelPanel').hidden = true;
  }

  get referee() { return !this.raid.isClient; }
  get net() { return this.raid.net; }
  get fighting() { return !!this.view && this.view.ph === 'fight'; }

  // ---------- the House Champion (always up for it) ----------

  spawnChampion() {
    const raid = this.raid;
    const L = raid.map.lounge;
    const c = new Combatant(raid, { name: '👑 House Champion', look: { ...randomLook(), hat: 'crown' } });
    c.pos.set(L.champion.x, 0, L.champion.z);
    c.yaw = Math.PI;
    const kind = ['revolver', 'ar', 'shotgun', 'smg', 'dbarrel'][Math.floor(Math.random() * 5)];
    c.equip(makeGun(kind, Math.max(2, rollRarity(3))));
    c.backpack.push({ id: 'ammo', qty: 6 });
    c.champion = true;
    c.home = c.pos.clone();
    raid.combatants.push(c);
    const brain = new RaiderBrain(raid, c);
    brain.duelist = true;
    brain.skill = 0.62;
    raid.bots.push(brain);
    this.champ = c;
    return c;
  }

  // ---------- what E does near people ----------

  interactables() {
    const raid = this.raid;
    const out = [this.exitSpot];
    if (this.view) return out; // one duel at a time
    for (const c of raid.combatants) {
      if (c.isPlayer || !c.alive || !(c.human || c.champion)) continue;
      let it = this.challengeSpots.get(c);
      if (!it) {
        it = { spot: c.pos, range: 3, searchTime: 0.3, searchLabel: 'Sizing them up…', prompt: () => `<b>Hold ${keyName('use')}</b> Challenge ${c.name} to a 1v1`, open: (by) => { if (by.isPlayer) this.openPanel(c); } };
        this.challengeSpots.set(c, it);
      }
      out.push(it);
    }
    return out;
  }

  // The gun you'd put up for pink slips: the one in your hands, unless it's free-loadout gear.
  betGun() {
    const g = this.raid.player && this.raid.player.gun;
    return g && !g.free ? g : null;
  }

  // ---------- the challenge panel ----------

  openPanel(target) {
    this.target = target;
    this.stake = 0;
    $('duelWho').textContent = target.name;
    this.renderPanel();
    this.raid.setOverlay('duel');
  }

  renderPanel() {
    const chips = save.get().stash.chips;
    const champ = this.target && this.target.champion;
    $('duelChips').innerHTML = STAKES.map((v) => `<button class="cchip ${v === this.stake ? 'on' : ''}" data-v="${v}" ${v > chips ? 'disabled' : ''}>${v ? (v >= 1000 ? `${v / 1000}K` : v) : 'Just for fun'}</button>`).join('');
    $('duelChips').onclick = (e) => { const b = e.target.closest('[data-v]'); if (b && !b.disabled) { this.stake = Number(b.dataset.v); this.renderPanel(); } };
    const mine = this.betGun();
    const theirs = champ ? this.target.gun : null;
    $('duelGunsLabel').innerHTML = `🔫 <b>Pink slips:</b> you both bet the gun in your hands (yours: ${mine ? itemInfo(mine).name : this.raid.player.gun ? 'free loadout guns can\'t be bet' : 'none'}${champ && theirs ? `, his: ${itemInfo(theirs).name}` : ''})`;
    $('duelGuns').disabled = !mine;
    if (!mine) $('duelGuns').checked = false;
    $('duelNote').textContent = `Your bank: 🪙 ${fmt(chips)}. Chips come out of your stash; the winner takes the pot. Nobody dies in The Pit.`;
  }

  closePanel() {
    this.target = null;
    this.raid.setOverlay(null);
  }

  sendChallenge() {
    const t = this.target;
    const p = this.raid.player;
    if (!t || !t.alive) { this.closePanel(); return; }
    const bet = this.betGun();
    const stakes = { chips: this.stake, guns: $('duelGuns').checked && !!bet };
    const gun = bet ? { kind: bet.kind, rarity: bet.rarity } : null;
    this.closePanel();
    if (this.referee) this.request(p, t, stakes, gun);
    else this.net.send({ k: 'duelAsk', to: t.netId, stakes, gun });
    this.raid.hud.toast(t.champion ? '🥊 The House Champion cracks his knuckles…' : `🥊 Challenge sent to ${t.name}. Waiting for an answer…`);
  }

  // ---------- an invite to us ----------

  showInvite(inv) {
    this.invite = { ...inv, until: performance.now() + 20000 };
    const s = inv.stakes;
    $('duelInvite').innerHTML = `🥊 <b>${inv.from}</b> challenges you to a 1v1!<br>Stakes: ${s.chips ? `🪙 ${fmt(s.chips)} each` : 'just for fun'}${s.guns ? ` · 🔫 pink slips (their ${gunName(inv.gun)} vs your gun in hand)` : ''}
      <small><b>Y</b> accept · <b>N</b> decline</small>`;
    $('duelInvite').hidden = false;
    sfx.alert(this.raid.focus, this.raid.listener);
  }

  answer(yes) {
    const inv = this.invite;
    if (!inv) return;
    this.invite = null;
    $('duelInvite').hidden = true;
    if (yes) {
      if (save.get().stash.chips < inv.stakes.chips) { this.raid.hud.toast(`You don't have 🪙 ${fmt(inv.stakes.chips)} in the bank.`); yes = false; }
      else if (inv.stakes.guns && !this.betGun()) { this.raid.hud.toast('Pink slips need a gun in your hands (not a free loadout one).'); yes = false; }
    }
    const bet = this.betGun();
    const gun = bet ? { kind: bet.kind, rarity: bet.rarity } : null;
    if (this.referee) this.reply(inv.id, yes, gun);
    else this.net.send({ k: 'duelReply', id: inv.id, yes, gun });
  }

  key(e) {
    if (!this.invite || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.code === 'KeyY') this.answer(true);
    if (e.code === 'KeyN') this.answer(false);
  }

  // ---------- referee ----------

  tell(c, text, big = false) {
    if (!c) return;
    if (c.isPlayer) this.raid.hud.toast(text, big ? 'big' : '');
    else if (c.human && this.net) this.net.net.to(c.owner, { k: 'toast', text, big });
  }

  request(a, b, stakes, gunA) {
    if (this.cur) { this.tell(a, 'Someone\'s already in The Pit. Wait your turn.'); return; }
    if (!b || !b.alive) return;
    if (b.champion) {
      this.start(a, b, stakes, gunA, b.gun ? { kind: b.gun.kind, rarity: b.gun.rarity } : null);
      return;
    }
    const id = this.nextId++;
    this.pending.set(id, { a, b, stakes, gunA, at: performance.now() });
    const inv = { id, from: a.name, stakes, gun: gunA };
    if (b.isPlayer) this.showInvite(inv);
    else if (b.human && this.net) this.net.net.to(b.owner, { k: 'duelInvite', ...inv });
  }

  reply(id, yes, gunB) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    if (!yes) { this.tell(p.a, `${p.b.name} chickened out. No duel.`); return; }
    if (this.cur) { this.tell(p.a, 'Someone else got to The Pit first.'); this.tell(p.b, 'Someone else got to The Pit first.'); return; }
    this.start(p.a, p.b, p.stakes, p.gunA, gunB);
  }

  // Put someone somewhere (and patch them up). Friends' games move their own character.
  place(c, pos, yaw) {
    if (c.puppet) {
      if (c.human && this.net) this.net.net.to(c.owner, { k: 'tp', p: [pos.x, 0, pos.z], yaw });
      c.pos.copy(pos);
      c.netPos = pos.clone();
      return;
    }
    c.pos.copy(pos);
    c.vel.set(0, 0, 0);
    c.yaw = yaw;
    c.hp = c.maxHp;
    c.downed = false;
    c.rolling = null;
  }

  start(a, b, stakes, gunA, gunB) {
    const guns = !!(stakes.guns && gunA && gunB);
    this.cur = { a, b, chips: stakes.chips || 0, guns, gunA, gunB, phase: 'count', t: 0 };
    const ar = this.arena;
    this.place(a, new THREE.Vector3(ar.x - this.r + 4, 0, ar.z), -Math.PI / 2);
    this.place(b, new THREE.Vector3(ar.x + this.r - 4, 0, ar.z), Math.PI / 2);
    if (b.brain) b.brain.duelTarget = a;
    if (a.brain) a.brain.duelTarget = b;
    this.raid.feed(`🥊 ${a.name} vs ${b.name} in The Pit${this.cur.chips ? ` for 🪙 ${fmt(this.cur.chips * 2)}` : ''}${guns ? ' and their guns' : ''}!`);
    this.sync();
  }

  // The losing blow landed (or a friend's game says it did to them).
  lethal(target, attacker) {
    if (!this.referee) {
      if (target.isPlayer && !this.lostSent && this.fighting) { this.lostSent = true; this.net.send({ k: 'duelLost' }); }
      return;
    }
    const c = this.cur;
    if (!c || c.phase !== 'fight') return;
    if (target === c.a) this.finish(c.b, c.a);
    else if (target === c.b) this.finish(c.a, c.b);
  }

  lostBy(owner) {
    const c = this.cur;
    if (!c || c.phase !== 'fight') return;
    if (c.a.owner === owner) this.finish(c.b, c.a);
    else if (c.b.owner === owner) this.finish(c.a, c.b);
  }

  finish(winner, loser, draw = false) {
    const c = this.cur;
    c.phase = 'over';
    c.t = 0;
    c.winner = draw ? null : winner;
    if (draw) {
      this.raid.feed(`🥊 ${c.a.name} vs ${c.b.name}: time! It's a draw, nobody pays.`);
    } else {
      const pot = c.chips * 2;
      this.raid.feed(`🏆 ${winner.name} beat ${loser.name}${pot ? ` and takes 🪙 ${fmt(pot)}` : ''}${c.guns ? ` plus their ${gunName(loser === c.a ? c.gunA : c.gunB)}` : ''}!`);
      const loserGun = loser === c.a ? c.gunA : c.gunB;
      this.settle(winner, { won: true, chips: c.chips, gainGun: c.guns ? loserGun : null, loseGun: null, vs: loser.name });
      this.settle(loser, { won: false, chips: c.chips, gainGun: null, loseGun: c.guns ? loserGun : null, vs: winner.name });
      // The champion's gun goes to you if you beat him; if he wins, yours is the House's now.
      if (loser.champion && c.guns) this.champGunLost = true;
    }
    this.sync();
  }

  settle(c, res) {
    if (c.champion) return;
    if (c.isPlayer) this.applyResult(res);
    else if (c.human && this.net) this.net.net.to(c.owner, { k: 'duelResult', ...res });
  }

  // Our side of the bet.
  applyResult(res) {
    const raid = this.raid;
    const p = raid.player;
    save.update((d) => {
      d.stash.chips = Math.max(0, d.stash.chips + (res.won ? res.chips : -res.chips));
      if (res.gainGun) addToStash(d.stash.items, makeGun(res.gainGun.kind, res.gainGun.rarity));
      d.stats.duels = (d.stats.duels || 0) + 1;
      if (res.won) d.stats.duelWins = (d.stats.duelWins || 0) + 1;
    });
    if (res.loseGun) {
      // The gun you bet leaves your hands.
      const i = p.weapons.findIndex((g) => g && g.kind === res.loseGun.kind && g.rarity === res.loseGun.rarity);
      if (i >= 0) { p.weapons[i] = null; p.refreshWeapon(); }
      else {
        const j = p.backpack.findIndex((g) => g.id === 'gun' && g.kind === res.loseGun.kind && g.rarity === res.loseGun.rarity);
        if (j >= 0) p.backpack.splice(j, 1);
      }
    }
    if (res.won) {
      sfx.jackpot();
      raid.hud.toast(`🏆 YOU WIN!${res.chips ? ` +🪙 ${fmt(res.chips)}` : ''}${res.gainGun ? ` and their ${gunName(res.gainGun)} (in your stash)` : ''}`, 'big');
    } else {
      sfx.deny();
      raid.hud.toast(`💸 ${res.vs} got you.${res.chips ? ` −🪙 ${fmt(res.chips)}` : ''}${res.loseGun ? ` Your ${gunName(res.loseGun)} is theirs now.` : ''}`, 'big');
    }
  }

  update(dt) {
    // Invites time out.
    if (this.invite && performance.now() > this.invite.until) this.answer(false);
    if (!this.referee) { this.render(); return; }
    for (const [id, p] of this.pending) if (performance.now() - p.at > 22000) { this.pending.delete(id); this.tell(p.a, `${p.b.name} didn't answer.`); }
    const c = this.cur;
    if (c) {
      c.t += dt;
      const gone = (x) => !x.alive || !this.raid.combatants.includes(x);
      if (c.phase === 'count' && c.t >= COUNTDOWN) { c.phase = 'fight'; c.t = 0; this.sync(); }
      else if (c.phase === 'fight') {
        if (gone(c.a)) this.finish(c.b, c.a);
        else if (gone(c.b)) this.finish(c.a, c.b);
        else if (c.t >= TIME_LIMIT) this.finish(null, null, true);
      } else if (c.phase === 'over' && c.t >= 3.5) {
        // Back out to the floor, patched up.
        const ar = this.arena;
        for (const [x, i] of [[c.a, -1], [c.b, 1]]) {
          if (!gone(x)) this.place(x, new THREE.Vector3(ar.x + i * 4, 0, ar.z + this.r + 4), 0);
          if (x.brain) x.brain.duelTarget = null;
        }
        if (this.champ && this.champ.alive) {
          this.place(this.champ, this.champ.home.clone(), Math.PI);
          if (this.champGunLost) {
            // The House always has another one.
            const kind = ['revolver', 'ar', 'shotgun', 'smg', 'dbarrel'][Math.floor(Math.random() * 5)];
            this.champ.weapons = [makeGun(kind, Math.max(2, rollRarity(3))), null];
            this.champ.active = 0;
            this.champ.refreshWeapon();
            this.champGunLost = false;
          }
        }
        this.cur = null;
        this.sync();
      }
      if (this.cur) this.sync(true);
    }
    this.render();
  }

  // What everyone should see (the host sends it out in snapshots).
  sync(quiet = false) {
    const c = this.cur;
    const before = this.view && this.view.ph;
    this.view = c ? {
      a: c.a.name, b: c.b.name, aId: this.net ? this.net.id(c.a) : null, bId: this.net ? this.net.id(c.b) : null,
      chips: c.chips, guns: c.guns, ph: c.phase, t: Math.round(c.t * 10) / 10, w: c.winner ? c.winner.name : '',
    } : null;
    if (!quiet || before !== (this.view && this.view.ph)) this.announce(before);
  }

  // A client got the duel state from the host.
  apply(v) {
    const before = this.view && this.view.ph;
    this.view = v || null;
    if (before !== (v && v.ph)) {
      if (v && v.ph === 'count') this.lostSent = false;
      this.announce(before);
    }
  }

  // The bell.
  announce(before) {
    const v = this.view;
    if (v && v.ph === 'fight' && before !== 'fight') sfx.alert(this.raid.focus, this.raid.listener);
  }

  // Duel status bar + countdown for everyone in the Lounge.
  render() {
    const v = this.view;
    const el = $('duelStatus');
    if (!v || !this.raid.active) { el.hidden = true; return; }
    el.hidden = false;
    const pot = v.chips ? `🪙 ${fmt(v.chips * 2)}` : 'bragging rights';
    let big = '';
    if (v.ph === 'count') big = `<div class="dbig">${Math.max(1, Math.ceil(COUNTDOWN - v.t))}</div>`;
    else if (v.ph === 'fight' && v.t < 1) big = '<div class="dbig">FIGHT!</div>';
    else if (v.ph === 'over') big = `<div class="dbig small">${v.w ? `🏆 ${v.w} WINS` : 'DRAW'}</div>`;
    const left = v.ph === 'fight' ? ` · ${Math.max(0, Math.ceil(TIME_LIMIT - v.t))}s` : '';
    el.innerHTML = `<div class="dline">🥊 <b>${v.a}</b> vs <b>${v.b}</b> · ${pot}${v.guns ? ' + 🔫 pink slips' : ''}${left}</div>${big}`;
  }

  // Can `attacker` hurt `target` right now? Only the two duelists, only once the bell rings.
  canHurt(attacker, target) {
    if (!attacker || !target || attacker === target) return false;
    if (this.referee) {
      const c = this.cur;
      return !!c && c.phase === 'fight' && ((attacker === c.a && target === c.b) || (attacker === c.b && target === c.a));
    }
    const v = this.view;
    if (!v || v.ph !== 'fight') return false;
    const ids = [v.aId, v.bId];
    return ids.includes(attacker.netId) && ids.includes(target.netId);
  }
}
