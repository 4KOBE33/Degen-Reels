// 1v1 duels in the High Roller Lounge. Walk up to someone (a friend, or the House Champion),
// hold E, pick the stakes (chips, and maybe "pink slips": both bet the gun in their hands), and
// if they accept you're both dropped into The Pit. Nobody dies: the losing blow ends it and the
// loser pays up. In a party, the leader's game referees; everyone else sees the result.
import * as THREE from 'three';
import { save } from './save.js';
import { itemInfo, makeGun, addToStash, rollRarity } from './items.js';
import { netTeleport } from './netsmooth.js';
import { Combatant } from './combatant.js';
import { RaiderBrain } from './bots.js';
import { randomLook } from './looks.js';
import { keyName } from './keys.js';
import { sfx } from './audio.js';
import { LoungeTables } from './tables.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const COUNTDOWN = 3;
const TIME_LIMIT = 120;
const BET_TIME = 10; // seconds to get bets in before the bell
const EXHIBITION_IDLE = 25; // the House stages a fight when The Pit's been empty this long
const BETS = [100, 500, 1000, 5000, 10000, 25000];
const CHALLENGERS = ['Slick Vinnie', 'Lady Luck', 'Two-Bit Tony', 'The Dealer\'s Cousin', 'Big Sal', 'Lucky Lou', 'Mama Blackjack', 'Snake Eyes Sam'];

// ---------- Poker Showdown: five cards each, best hand takes the pot ----------
const RANKS = '23456789TJQKA';
const SUITS = ['♠', '♥', '♦', '♣'];
const HAND_NAMES = ['High Card', 'One Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];
function dealHands(n) {
  const deck = [];
  for (let r = 0; r < 13; r++) for (let s = 0; s < 4; s++) deck.push(r * 4 + s);
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return Array.from({ length: n }, (_, k) => deck.slice(k * 5, k * 5 + 5));
}
// [category, ...tiebreakers], compared left to right.
function scoreHand(cards) {
  const ranks = cards.map((c) => Math.floor(c / 4)).sort((a, b) => b - a);
  const flush = new Set(cards.map((c) => c % 4)).size === 1;
  const counts = {};
  for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
  const groups = Object.entries(counts).map(([r, n]) => [n, Number(r)]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const uniq = [...new Set(ranks)];
  let straightHigh = -1;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq.join() === '12,3,2,1,0') straightHigh = 3; // A-2-3-4-5
  }
  const kick = groups.map((g) => g[1]);
  if (straightHigh >= 0 && flush) return [8, straightHigh];
  if (groups[0][0] === 4) return [7, ...kick];
  if (groups[0][0] === 3 && groups[1][0] === 2) return [6, ...kick];
  if (flush) return [5, ...ranks];
  if (straightHigh >= 0) return [4, straightHigh];
  if (groups[0][0] === 3) return [3, ...kick];
  if (groups[0][0] === 2 && groups[1][0] === 2) return [2, ...kick];
  if (groups[0][0] === 2) return [1, ...kick];
  return [0, ...ranks];
}
function compareHands(a, b) {
  const x = scoreHand(a);
  const y = scoreHand(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
}
// Same card face as the blackjack table: rank in the corners, big suit in the middle.
const cardHtml = (c) => {
  const s = SUITS[c % 4];
  const r = RANKS[Math.floor(c / 4)].replace('T', '10');
  return `<span class="pcard ${s === '♥' || s === '♦' ? 'red' : ''}"><i>${r}</i><em>${s}</em><i class="flip">${r}</i></span>`;
};
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
    // Betting windows on two sides of The Pit.
    this.betSpots = [[0, this.r + 3.5], [0, -this.r - 3.5]].map(([dx, dz]) => ({
      spot: new THREE.Vector3(this.arena.x + dx, 0, this.arena.z + dz), range: 3.5, searchTime: 0.2, searchLabel: 'Grabbing a ticket…',
      prompt: () => `<b>Hold ${keyName('use')}</b> 🎟️ Bet on the fight`, open: (by) => { if (by.isPlayer) this.openBet(); },
    }));
    // The casino tables: real games on the floor that everyone can watch (tables.js). Poker is
    // still a Showdown against the House Champion.
    this.tables = new LoungeTables(raid, L.tables || [], L.armory);
    this.tableSpots = (L.tables || []).filter((t) => t.game === 'poker').map((t) => ({
      spot: new THREE.Vector3(t.x, 0, t.z), range: 3.6, searchTime: 0.2, searchLabel: 'Taking a seat…',
      prompt: () => `<b>Hold ${keyName('use')}</b> 🂡 Poker Showdown vs the House`,
      open: (by) => { if (by.isPlayer && this.champ && this.champ.alive) this.openPanel(this.champ, 'poker'); },
    }));
    this.onKey = (e) => this.key(e);
    window.addEventListener('keydown', this.onKey);
    $('duelSend').onclick = () => this.sendChallenge();
    $('duelCancel').onclick = () => this.closePanel();
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey);
    this.tables.dispose();
    $('duelInvite').hidden = true;
    $('duelStatus').hidden = true;
    document.body.classList.remove('duelbar', 'showdownup');
    $('duelPanel').hidden = true;
    $('betPanel').hidden = true;
    $('showdown').hidden = true;
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
    const out = [this.exitSpot, ...this.tableSpots, ...this.tables.interactables()];
    const v = this.view;
    const me = raid.player && raid.player.name;
    if (v && v.ph === 'bets' && v.a !== me && v.b !== me) out.push(...this.betSpots);
    if (v) {
      // The Pit's busy, but you can still challenge someone to cards.
      for (const c of raid.combatants) {
        if (c.isPlayer || !c.alive || !c.human || c.name === v.a || c.name === v.b) continue;
        out.push(this.spotFor(c, 'poker'));
      }
      return out;
    }
    for (const c of raid.combatants) {
      if (c.isPlayer || !c.alive || !(c.human || c.champion)) continue;
      out.push(this.spotFor(c, 'pit'));
    }
    return out;
  }

  spotFor(c, game) {
    const key = `${game}`;
    let m = this.challengeSpots.get(c);
    if (!m) { m = {}; this.challengeSpots.set(c, m); }
    if (!m[key]) {
      m[key] = { spot: c.pos, range: 3, searchTime: 0.3, searchLabel: 'Sizing them up…', prompt: () => `<b>Hold ${keyName('use')}</b> Challenge ${c.name}${game === 'poker' ? ' to a Poker Showdown' : ' (1v1 or cards)'}`, open: (by) => { if (by.isPlayer) this.openPanel(c, game); } };
    }
    return m[key];
  }

  // The gun you'd put up for pink slips: the one in your hands, unless it's free-loadout gear.
  betGun() {
    const g = this.raid.player && this.raid.player.gun;
    return g && !g.free ? g : null;
  }

  // ---------- the challenge panel ----------

  openPanel(target, game = 'pit') {
    this.target = target;
    this.stake = 0;
    this.game = game;
    $('duelWho').textContent = target.name;
    this.renderPanel();
    this.raid.setOverlay('duel');
  }

  renderPanel() {
    const chips = save.get().stash.chips;
    $('duelGame').innerHTML = [['pit', '🥊 Fight in The Pit'], ['poker', '🃏 Poker Showdown']].map(([g, l]) => `<button class="subtab ${this.game === g ? 'on' : ''}" data-g="${g}">${l}</button>`).join('');
    $('duelGame').onclick = (e) => { const b = e.target.closest('[data-g]'); if (b) { this.game = b.dataset.g; this.renderPanel(); } };
    const champ = this.target && this.target.champion;
    $('duelChips').innerHTML = STAKES.map((v) => `<button class="cchip c${v} ${v === this.stake ? 'on' : ''}" data-v="${v}" ${v > chips ? 'disabled' : ''}>${v ? (v >= 1000 ? `${v / 1000}K` : v) : 'Just for fun'}</button>`).join('');
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
    const stakes = { chips: this.stake, guns: $('duelGuns').checked && !!bet, game: this.game || 'pit' };
    const gun = bet ? { kind: bet.kind, rarity: bet.rarity } : null;
    this.closePanel();
    if (this.referee) this.request(p, t, stakes, gun);
    else this.net.send({ k: 'duelAsk', to: t.netId, stakes, gun });
    this.raid.hud.toast(t.champion ? (stakes.game === 'poker' ? '🃏 The House shuffles the deck…' : '🥊 The House Champion cracks his knuckles…') : `${stakes.game === 'poker' ? '🃏' : '🥊'} Challenge sent to ${t.name}. Waiting for an answer…`);
  }

  // ---------- an invite to us ----------

  showInvite(inv) {
    this.invite = { ...inv, until: performance.now() + 20000 };
    const s = inv.stakes;
    $('duelInvite').innerHTML = `${s.game === 'poker' ? '🃏' : '🥊'} <b>${inv.from}</b> challenges you to ${s.game === 'poker' ? 'a Poker Showdown' : 'a 1v1 in The Pit'}!<br>Stakes: ${s.chips ? `🪙 ${fmt(s.chips)} each` : 'just for fun'}${s.guns ? ` · 🔫 pink slips (their ${gunName(inv.gun)} vs your gun in hand)` : ''}
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
    // At a table: get up first (if the round lets you), then answer.
    if (this.tables.seat && (e.code === 'KeyY' || e.code === 'KeyN')) {
      if (e.code === 'KeyY' && !this.tables.canLeave()) return;
      if (e.code === 'KeyY') this.raid.setOverlay(null);
    }
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
    const pit = stakes.game !== 'poker';
    if (pit && this.busy) { this.tell(a, 'Someone\'s already in The Pit. Wait your turn.'); return; }
    if (!b || !b.alive) return;
    if (b.champion) {
      const gunB = b.gun ? { kind: b.gun.kind, rarity: b.gun.rarity } : null;
      if (pit) this.start(a, b, stakes, gunA, gunB);
      else this.showdown(a, b, stakes, gunA, gunB);
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
    if (p.stakes.game === 'poker') { this.showdown(p.a, p.b, p.stakes, p.gunA, gunB); return; }
    if (this.busy) { this.tell(p.a, 'Someone else got to The Pit first.'); this.tell(p.b, 'Someone else got to The Pit first.'); return; }
    this.start(p.a, p.b, p.stakes, p.gunA, gunB);
  }

  // Put someone somewhere (and patch them up). Friends' games move their own character.
  place(c, pos, yaw, pin = false) {
    if (c.puppet) {
      if (c.human && this.net) this.net.net.to(c.owner, { k: 'tp', p: [pos.x, 0, pos.z], yaw, pin: pin ? 1 : 0 });
      c.pos.copy(pos);
      c.netPos = pos.clone();
      netTeleport(c, pos, yaw);
      return;
    }
    c.pin = pin ? pos.clone() : null;
    c.pos.copy(pos);
    c.vel.set(0, 0, 0);
    c.yaw = yaw;
    c.hp = c.maxHp;
    c.downed = false;
    c.rolling = null;
  }

  // Is The Pit taken (a real duel, or the House's exhibition)?
  get busy() { return !!this.cur; }

  start(a, b, stakes, gunA, gunB, exhibition = false) {
    const guns = !!(stakes.guns && gunA && gunB);
    this.cur = { a, b, chips: stakes.chips || 0, guns, gunA, gunB, phase: 'bets', t: 0, exhibition, bets: [] };
    const ar = this.arena;
    // Both on their marks until the bell: no sneaking around during the bets and the countdown.
    this.place(a, new THREE.Vector3(ar.x - this.r + 4, 0, ar.z), -Math.PI / 2, true);
    this.place(b, new THREE.Vector3(ar.x + this.r - 4, 0, ar.z), Math.PI / 2, true);
    if (b.brain) b.brain.duelTarget = a;
    if (a.brain) a.brain.duelTarget = b;
    this.raid.feed(`🥊 ${a.name} vs ${b.name} in The Pit${this.cur.chips ? ` for 🪙 ${fmt(this.cur.chips * 2)}` : ''}${guns ? ' and their guns' : ''}! Bets are open at the 🎟️ Betting Window.`);
    this.idle = 0;
    this.sync();
  }

  // ---------- poker showdown ----------

  showdown(a, b, stakes, gunA, gunB) {
    const guns = !!(stakes.guns && gunA && gunB);
    const [ha, hb] = dealHands(2);
    const cmp = compareHands(ha, hb);
    const ra = HAND_NAMES[scoreHand(ha)[0]];
    const rb = HAND_NAMES[scoreHand(hb)[0]];
    const winner = cmp > 0 ? a : cmp < 0 ? b : null;
    const reveal = { k: 'showdown', a: a.name, b: b.name, ha, hb, ra, rb, w: winner ? winner.name : '', chips: stakes.chips || 0, guns };
    for (const c of [a, b]) {
      if (c.isPlayer) this.showReveal(reveal);
      else if (c.human && this.net) this.net.net.to(c.owner, reveal);
    }
    const pot = (stakes.chips || 0) * 2;
    if (!winner) { this.raid.feed(`🃏 ${a.name} vs ${b.name}: ${ra} vs ${rb}. Split pot, nobody pays.`); return; }
    const loser = winner === a ? b : a;
    const loserGun = loser === a ? gunA : gunB;
    this.raid.feed(`🃏 ${winner.name}'s ${winner === a ? ra : rb} beats ${loser.name}'s ${winner === a ? rb : ra}${pot ? ` for 🪙 ${fmt(pot)}` : ''}!`);
    // Let the cards land before the money moves.
    setTimeout(() => {
      this.settle(winner, { won: true, chips: stakes.chips || 0, gainGun: guns ? loserGun : null, loseGun: null, vs: loser.name, poker: true });
      this.settle(loser, { won: false, chips: stakes.chips || 0, gainGun: null, loseGun: guns ? loserGun : null, vs: winner.name, poker: true });
    }, 2600);
  }

  // Flip both hands face up.
  showReveal(r) {
    const el = $('showdown');
    const me = this.raid.player && this.raid.player.name;
    el.innerHTML = `<div class="sdhead">🃏 POKER SHOWDOWN${r.chips ? ` · 🪙 ${fmt(r.chips * 2)} pot` : ''}${r.guns ? ' + 🔫 pink slips' : ''}</div>
      ${[[r.a, r.ha, r.ra], [r.b, r.hb, r.rb]].map(([n, h, rank]) => `<div class="sdrow ${r.w === n ? 'win' : r.w ? 'lose' : ''}"><div class="sdwho"><b>${r.w === n ? '🏆 ' : ''}${n}${n === me ? ' (you)' : ''}</b><i>${rank}</i></div><span class="cards">${h.map(cardHtml).join('')}</span></div>`).join('')}
      <div class="sdfoot">${r.w ? `🏆 ${r.w} wins` : 'Split pot!'}</div>`;
    el.hidden = false;
    document.body.classList.add('showdownup');
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    sfx.lever();
    clearTimeout(this.revealTimer);
    this.revealTimer = setTimeout(() => { el.hidden = true; document.body.classList.remove('showdownup'); }, 7000);
  }

  // ---------- betting on The Pit ----------

  // A spectator puts chips on one side (one bet each; a new one replaces the old).
  placeBet(c, side, amount) {
    const cur = this.cur;
    if (!cur || cur.phase !== 'bets' || c === cur.a || c === cur.b || !(side === 'a' || side === 'b') || !(amount > 0)) return false;
    cur.bets = cur.bets.filter((x) => x.c !== c);
    cur.bets.push({ c, side, amount });
    this.raid.feed(`🎟️ ${c.name} bet 🪙 ${fmt(amount)} on ${side === 'a' ? cur.a.name : cur.b.name}`);
    this.sync(true);
    return true;
  }

  openBet() {
    const v = this.view;
    if (!v || v.ph !== 'bets') return;
    this.betSide = this.betSide || 'a';
    this.betAmt = this.betAmt || 0;
    this.renderBet();
    this.raid.setOverlay('bet');
  }

  renderBet() {
    const v = this.view;
    if (!v) { this.raid.setOverlay(null); return; }
    const chips = save.get().stash.chips;
    $('betWho').innerHTML = [['a', v.a], ['b', v.b]].map(([k, n]) => `<button class="betside ${this.betSide === k ? 'on' : ''}" data-s="${k}"><b>${n}</b><small>🪙 ${fmt(k === 'a' ? v.pa || 0 : v.pb || 0)} bet so far</small></button>`).join('');
    $('betWho').onclick = (e) => { const b = e.target.closest('[data-s]'); if (b) { this.betSide = b.dataset.s; this.renderBet(); } };
    $('betChips').innerHTML = BETS.map((x) => `<button class="cchip c${x} ${x === this.betAmt ? 'on' : ''}" data-v="${x}" ${x > chips ? 'disabled' : ''}>${x >= 1000 ? `${x / 1000}K` : x}</button>`).join('');
    $('betChips').onclick = (e) => { const b = e.target.closest('[data-v]'); if (b && !b.disabled) { this.betAmt = Number(b.dataset.v); this.renderBet(); } };
    $('betNote').textContent = `Pays 2x if you're right. Draws are refunded. Your bank: 🪙 ${fmt(chips)}. Bets close in ${Math.max(0, Math.ceil(BET_TIME - v.t))}s.`;
    $('betSend').onclick = () => this.sendBet();
    $('betCancel').onclick = () => this.raid.setOverlay(null);
  }

  sendBet() {
    const amt = this.betAmt;
    this.raid.setOverlay(null);
    if (!amt || save.get().stash.chips < amt) return;
    const side = this.betSide;
    if (this.referee) {
      if (!this.placeBet(this.raid.player, side, amt)) { this.raid.hud.toast('Bets are closed.'); return; }
    } else this.net.send({ k: 'bet', side, amount: amt });
    this.myBet = { side, amount: amt };
    this.raid.hud.toast(`🎟️ 🪙 ${fmt(amt)} on ${side === 'a' ? this.view.a : this.view.b}. Good luck!`);
  }

  // Pay out (or collect) a spectator's bet.
  applyBet(r) {
    if (r.draw) { this.raid.hud.toast('🎟️ Draw: your bet is refunded.'); return; }
    save.update((d) => { d.stash.chips = Math.max(0, d.stash.chips + (r.won ? r.amount : -r.amount)); });
    if (r.won) { sfx.jackpot(); this.raid.hud.toast(`🎟️ Your bet on ${r.on} paid off: +🪙 ${fmt(r.amount)}!`, 'big'); } else { sfx.deny(); this.raid.hud.toast(`🎟️ ${r.on} lost. −🪙 ${fmt(r.amount)}`); }
  }

  settleBets(winner, draw) {
    const c = this.cur;
    for (const b of c.bets) {
      const backed = b.side === 'a' ? c.a : c.b;
      const res = { k: 'betResult', draw, won: !draw && backed === winner, amount: b.amount, on: backed.name };
      if (b.c.isPlayer) this.applyBet(res);
      else if (b.c.human && this.net) this.net.net.to(b.c.owner, res);
    }
  }

  // ---------- the House's exhibition matches ----------

  spawnChallenger() {
    const raid = this.raid;
    const name = CHALLENGERS[Math.floor(Math.random() * CHALLENGERS.length)];
    const c = new Combatant(raid, { name: `🥊 ${name}`, look: randomLook() });
    const kind = ['pistol', 'smg', 'shotgun', 'revolver', 'ar'][Math.floor(Math.random() * 5)];
    c.equip(makeGun(kind, rollRarity(2)));
    c.backpack.push({ id: 'ammo', qty: 6 });
    c.exhibition = true;
    c.pos.set(this.arena.x + this.r + 6, 0, this.arena.z);
    raid.combatants.push(c);
    const brain = new RaiderBrain(raid, c);
    brain.duelist = true;
    brain.skill = 0.45 + Math.random() * 0.35;
    raid.bots.push(brain);
    return c;
  }

  exhibition() {
    if (!this.champ || !this.champ.alive || this.busy) return;
    const c = this.spawnChallenger();
    this.start(this.champ, c, { chips: 0 }, null, null, true);
    this.raid.feed('📣 EXHIBITION MATCH: the House Champion takes on a challenger. Place your bets!');
    const p = this.raid.player;
    if (p && p.alive) this.raid.hud.toast('📣 Exhibition match in The Pit! Bet at the 🎟️ Betting Window.', 'big');
  }

  // The losing blow landed (or a friend's game says it did to them).
  lethal(target, attacker) {
    if (!this.referee) {
      if (target.isPlayer && !this.lostSent && this.fighting) {
        this.lostSent = true;
        this.net.send({ k: 'duelLost' });
        this.raid.loungeKillcam(target, attacker);
      }
      return;
    }
    if (target.isPlayer && this.cur && this.cur.phase === 'fight') this.raid.loungeKillcam(target, attacker);
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
    this.settleBets(winner, draw);
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
      raid.hud.toast(`🏆 ${res.poker ? 'YOUR HAND WINS' : 'YOU WIN'}!${res.chips ? ` +🪙 ${fmt(res.chips)}` : ''}${res.gainGun ? ` and their ${gunName(res.gainGun)} (in your stash)` : ''}`, 'big');
    } else {
      sfx.deny();
      raid.hud.toast(`💸 ${res.vs} ${res.poker ? 'won the hand' : 'got you'}.${res.chips ? ` −🪙 ${fmt(res.chips)}` : ''}${res.loseGun ? ` Your ${gunName(res.loseGun)} is theirs now.` : ''}`, 'big');
    }
  }

  update(dt) {
    this.tables.update(dt);
    // Invites time out.
    if (this.invite && performance.now() > this.invite.until) this.answer(false);
    if (!this.referee) { this.render(); return; }
    for (const [id, p] of this.pending) if (performance.now() - p.at > 22000) { this.pending.delete(id); this.tell(p.a, `${p.b.name} didn't answer.`); }
    const c = this.cur;
    if (c) {
      c.t += dt;
      const gone = (x) => !x.alive || !this.raid.combatants.includes(x);
      if (c.phase === 'bets' && c.t >= BET_TIME) { c.phase = 'count'; c.t = 0; this.sync(); }
      else if (c.phase === 'count' && c.t >= COUNTDOWN) {
        c.phase = 'fight';
        c.t = 0;
        c.a.pin = null;
        c.b.pin = null;
        this.sync();
      }
      else if (c.phase === 'fight') {
        if (gone(c.a)) this.finish(c.b, c.a);
        else if (gone(c.b)) this.finish(c.a, c.b);
        else if (c.t >= TIME_LIMIT) this.finish(null, null, true);
      } else if (c.phase === 'over' && c.t >= (this.localLoserDone() ? 0.2 : 3.5)) {
        // Back out to the floor, patched up: the winner by The Pit, the loser respawns somewhere
        // in the Lounge.
        const ar = this.arena;
        const spawns = this.raid.map.spawns;
        for (const [x, i] of [[c.a, -1], [c.b, 1]]) {
          if (x.exhibition) {
            // The challenger heads home either way.
            this.raid.removeCombatant(x);
            continue;
          }
          const lost = c.winner && x !== c.winner;
          const sp = spawns[Math.floor(Math.random() * spawns.length)];
          if (!gone(x)) this.place(x, lost ? new THREE.Vector3(sp[0], 0, sp[1]) : new THREE.Vector3(ar.x + i * 4, 0, ar.z + this.r + 4), lost ? Math.atan2(sp[0], sp[1]) : 0);
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
    } else if (this.champ && this.champ.alive && this.pending.size === 0) {
      // Nobody's using The Pit: the House puts on a show.
      this.idle = (this.idle || 0) + dt;
      if (this.idle >= EXHIBITION_IDLE) { this.idle = 0; this.exhibition(); }
    }
    this.render();
  }

  // We lost, and our kill cam just finished: no need to stand around.
  localLoserDone() {
    const c = this.cur;
    const kc = this.raid.killcam;
    return !!(c && c.winner && c.winner !== this.raid.player && (c.a === this.raid.player || c.b === this.raid.player) && kc && kc.over);
  }

  // What everyone should see (the host sends it out in snapshots).
  sync(quiet = false) {
    const c = this.cur;
    const before = this.view && this.view.ph;
    this.view = c ? {
      a: c.a.name, b: c.b.name, aId: this.net ? this.net.id(c.a) : null, bId: this.net ? this.net.id(c.b) : null,
      chips: c.chips, guns: c.guns, ph: c.phase, t: Math.round(c.t * 10) / 10, w: c.winner ? c.winner.name : '',
      ex: c.exhibition ? 1 : 0,
      pa: c.bets.filter((x) => x.side === 'a').reduce((n, x) => n + x.amount, 0),
      pb: c.bets.filter((x) => x.side === 'b').reduce((n, x) => n + x.amount, 0),
    } : null;
    if (!quiet || before !== (this.view && this.view.ph)) this.announce(before);
  }

  // A client got the duel state from the host.
  apply(v) {
    const before = this.view && this.view.ph;
    this.view = v || null;
    const p = this.raid.player;
    if (p && p.pin && (!v || v.ph === 'fight' || v.ph === 'over')) p.pin = null;
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
    if (!v || !this.raid.active) { el.hidden = true; document.body.classList.remove('duelbar'); return; }
    el.hidden = false;
    document.body.classList.add('duelbar');
    const pot = v.chips ? `🪙 ${fmt(v.chips * 2)}` : 'bragging rights';
    let big = '';
    if (v.ph === 'bets') big = `<div class="dbets">🎟️ PLACE YOUR BETS · ${Math.max(0, Math.ceil(BET_TIME - v.t))}s<small>🪙 ${fmt(v.pa || 0)} on ${v.a} · 🪙 ${fmt(v.pb || 0)} on ${v.b}</small></div>`;
    else if (v.ph === 'count') big = `<div class="dbig">${Math.max(1, Math.ceil(COUNTDOWN - v.t))}</div>`;
    else if (v.ph === 'fight' && v.t < 1) big = '<div class="dbig">FIGHT!</div>';
    else if (v.ph === 'over') big = `<div class="dbig small">${v.w ? `🏆 ${v.w} WINS` : 'DRAW'}</div>`;
    const left = v.ph === 'fight' ? ` · ${Math.max(0, Math.ceil(TIME_LIMIT - v.t))}s` : '';
    el.innerHTML = `<div class="dline">${v.ex ? '📣 EXHIBITION · ' : '🥊 '}<b>${v.a}</b> vs <b>${v.b}</b> · ${v.ex ? 'bets only' : pot}${v.guns ? ' + 🔫 pink slips' : ''}${left}</div>${big}`;
    if (!$('betPanel').hidden) this.renderBet();
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
