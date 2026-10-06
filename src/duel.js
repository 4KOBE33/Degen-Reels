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
const chipLabel = (v) => (v >= 1000000 ? `${v / 1000000}M` : v >= 1000 ? `${v / 1000}K` : String(v));
const BETS = [100, 500, 1000, 5000, 10000, 25000, 100000, 250000, 1000000];
const CHALLENGERS = ['Slick Vinnie', 'Lady Luck', 'Two-Bit Tony', 'The Dealer\'s Cousin', 'Big Sal', 'Lucky Lou', 'Mama Blackjack', 'Snake Eyes Sam'];

// ---------- Poker Showdown: five cards each, best hand takes the pot ----------
const RANKS = '23456789TJQKA';
const SUITS = ['♠', '♥', '♦', '♣'];
const HAND_NAMES = ['High Card', 'One Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];
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
// Which cards make the hand (lit up at the reveal).
function madeCards(cards) {
  const cat = scoreHand(cards)[0];
  if ([4, 5, 6, 8].includes(cat)) return [0, 1, 2, 3, 4];
  const rank = (c) => Math.floor(c / 4);
  if (cat >= 1) return cards.map((c, i) => [c, i]).filter(([c]) => cards.filter((x) => rank(x) === rank(c)).length >= 2).map(([, i]) => i);
  let top = 0;
  cards.forEach((c, i) => { if (rank(c) > rank(cards[top])) top = i; });
  return [top];
}
// The House's draw: keep anything made, chase four to a flush or a straight, else keep the two best.
function houseDiscard(cards) {
  const cat = scoreHand(cards)[0];
  if (cat >= 4) return [];
  const made = madeCards(cards);
  if (cat >= 1) return [0, 1, 2, 3, 4].filter((i) => !made.includes(i)).slice(0, 3);
  for (let s = 0; s < 4; s++) {
    const off = cards.map((c, i) => [c, i]).filter(([c]) => c % 4 !== s);
    if (off.length === 1) return [off[0][1]];
  }
  for (let i = 0; i < 5; i++) {
    const rest = [...new Set(cards.filter((_, j) => j !== i).map((c) => Math.floor(c / 4)))];
    if (rest.length === 4 && Math.max(...rest) - Math.min(...rest) <= 4) return [i];
  }
  return cards.map((c, i) => [c, i]).sort((x, y) => x[0] - y[0]).slice(0, 3).map(([, i]) => i);
}
const MAX_DISCARD = 3;
const DRAW_TIME = 25; // seconds to pick your discards
// Same card face as the blackjack table: rank in the corners, big suit in the middle.
const cardHtml = (c, cls = '', style = '') => {
  const s = SUITS[c % 4];
  const r = RANKS[Math.floor(c / 4)].replace('T', '10');
  return `<span class="pcard ${s === '♥' || s === '♦' ? 'red' : ''} ${cls}" ${style ? `style="${style}"` : ''}><i>${r}</i><em>${s}</em><i class="flip">${r}</i></span>`;
};
const STAKES = [0, 500, 1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000];
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
    this.hands = new Map(); // referee: poker hands waiting on the draw
    this.myHand = null; // our cards while we pick what to throw back
    const L = raid.map.lounge;
    this.arena = new THREE.Vector3(L.arena.x, 0, L.arena.z);
    this.r = L.arena.r;
    this.exitSpot = { spot: new THREE.Vector3(L.exit.x, 0, L.exit.z), range: 4, searchTime: 0.6, searchLabel: 'Cashing out…', prompt: () => `<b>Hold ${keyName('use')}</b> Cash out (leave with everything)`, open: (by) => { if (by.isPlayer) raid.extract('Cash Out'); } };
    this.challengeSpots = new Map();
    // Betting windows on two sides of The Pit.
    this.betSpots = [[7, this.r + 8], [-7, -this.r - 8]].map(([dx, dz]) => ({
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
    $('pokerPanel').hidden = true;
    $('showdown').hidden = true;
    clearTimeout(this.revealTimer);
    clearTimeout(this.footTimer);
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
    $('duelChips').innerHTML = STAKES.map((v) => `<button class="cchip c${v} ${v === this.stake ? 'on' : ''}" data-v="${v}" ${v > chips ? 'disabled' : ''}>${v ? chipLabel(v) : 'Just for fun'}</button>`).join('');
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
  // Got into The Pit without a fight of your own (fell, glitched in, stayed after one)? Back up to
  // the floor by the north ramp.
  liftOut() {
    const p = this.raid.player;
    if (!p || !p.alive || p.pin) return;
    if (Math.hypot(p.pos.x - this.arena.x, p.pos.z - this.arena.z) > this.r - 0.6 || p.pos.y > 1.5) return;
    const v = this.view;
    if (v && (v.a === p.name || v.b === p.name)) return;
    if (this.cur && (this.cur.a === p || this.cur.b === p)) return;
    p.pos.set(this.arena.x, 0, this.arena.z + this.r + 13.5);
    p.vel.set(0, 0, 0);
    p.yaw = 0;
    this.raid.hud.toast('🪜 Lifted you out of The Pit. Watch from the gallery up top!');
  }

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

  // Five-card draw. The referee deals from one deck and holds the hands; each player sees only
  // their own five, throws back up to three, and when both have drawn the hands go face up.
  showdown(a, b, stakes, gunA, gunB) {
    const deck = [];
    for (let r = 0; r < 13; r++) for (let s = 0; s < 4; s++) deck.push(r * 4 + s);
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    const id = this.nextId++;
    const g = { id, a, b, stakes, gunA, gunB, deck, ha: deck.splice(0, 5), hb: deck.splice(0, 5), da: null, db: null, at: performance.now() };
    this.hands.set(id, g);
    this.raid.feed(`🃏 ${a.name} and ${b.name} sit down to five-card draw${stakes.chips ? ` for 🪙 ${fmt(stakes.chips * 2)}` : ''}`);
    for (const side of ['a', 'b']) {
      const c = g[side];
      const other = side === 'a' ? b : a;
      const deal = { k: 'pokerDeal', id, hand: g[`h${side}`], vs: other.name, chips: stakes.chips || 0, guns: !!(stakes.guns && gunA && gunB) };
      if (c.champion || !(c.isPlayer || c.human)) g[`d${side}`] = houseDiscard(g[`h${side}`]);
      else if (c.isPlayer) this.showDeal(deal);
      else if (this.net) this.net.net.to(c.owner, deal);
    }
    this.pokerCheck(g);
  }

  // A player's discards reach the referee.
  pokerDraw(id, c, discard) {
    const g = this.hands.get(id);
    if (!g) return;
    const side = c === g.a ? 'a' : c === g.b ? 'b' : null;
    if (!side || g[`d${side}`]) return;
    g[`d${side}`] = [...new Set((Array.isArray(discard) ? discard : []).map(Number))].filter((i) => Number.isInteger(i) && i >= 0 && i < 5).slice(0, MAX_DISCARD);
    if (!g[`d${side === 'a' ? 'b' : 'a'}`]) this.tell(c, `🃏 Waiting on ${g[side === 'a' ? 'b' : 'a'].name} to draw…`);
    this.pokerCheck(g);
  }

  pokerCheck(g) {
    if (g.da && g.db) this.pokerFinish(g);
  }

  pokerFinish(g) {
    this.hands.delete(g.id);
    const { a, b, stakes, gunA, gunB } = g;
    const draw = (hand, dis) => hand.map((c, i) => (dis.includes(i) ? g.deck.shift() : c));
    const ha = draw(g.ha, g.da);
    const hb = draw(g.hb, g.db);
    const guns = !!(stakes.guns && gunA && gunB);
    const cmp = compareHands(ha, hb);
    const ra = HAND_NAMES[scoreHand(ha)[0]];
    const rb = HAND_NAMES[scoreHand(hb)[0]];
    const winner = cmp > 0 ? a : cmp < 0 ? b : null;
    const reveal = {
      k: 'showdown', a: a.name, b: b.name, ia: this.whoId(a), ib: this.whoId(b), ws: winner ? (winner === a ? 'a' : 'b') : '', ha, hb, ra, rb, na: g.da, nb: g.db, ma: madeCards(ha), mb: madeCards(hb), w: winner ? winner.name : '', chips: stakes.chips || 0, guns,
    };
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
    }, 4200);
  }

  // Who a seat belongs to, by id (two players can share a name).
  whoId(c) {
    if (c.isPlayer) return this.net ? this.net.me : 'me';
    return c.human ? c.owner : null;
  }

  // ---------- our side of a poker hand ----------

  showDeal(d) {
    this.myHand = { ...d, out: new Set(), until: performance.now() + DRAW_TIME * 1000, sent: false };
    $('showdown').hidden = true;
    document.body.classList.remove('showdownup');
    d.hand.forEach((_, i) => setTimeout(() => sfx.card(), i * 90));
    this.renderDeal(true);
    this.raid.setOverlay('poker');
  }

  renderDeal(fresh = false) {
    const h = this.myHand;
    if (!h) return;
    const el = $('pokerCard');
    const n = h.out.size;
    const name = HAND_NAMES[scoreHand(h.hand)[0]];
    const made = madeCards(h.hand);
    el.innerHTML = `<h2>🃏 Five-Card Draw</h2>
      <p class="hint">vs <b>${h.vs}</b> · ${h.chips ? `🪙 ${fmt(h.chips * 2)} pot` : 'Just for fun'}${h.guns ? ' + 🔫 pink slips' : ''}. Click up to ${MAX_DISCARD} cards to throw back, then draw. Best hand takes it.</p>
      <div class="pkhand ${fresh ? 'fresh' : ''}">${h.hand.map((c, i) => `<button class="pkslot ${h.out.has(i) ? 'out' : ''}" data-i="${i}" style="--i:${i}">${cardHtml(c, made.includes(i) && name !== 'High Card' ? 'hot' : '')}<span class="pktag">${h.out.has(i) ? 'TOSS' : 'HOLD'}</span></button>`).join('')}</div>
      <p class="pknow">You're holding: <b>${name}</b></p>
      <div class="resbtns"><button id="pokerGo" class="btn big">${n ? `DRAW ${n} CARD${n > 1 ? 'S' : ''}` : 'STAND PAT'}</button></div>
      <p class="hint" id="pokerTime"></p>`;
    el.querySelector('.pkhand').onclick = (e) => {
      const b = e.target.closest('[data-i]');
      if (!b || h.sent) return;
      const i = Number(b.dataset.i);
      if (h.out.has(i)) h.out.delete(i);
      else if (h.out.size < MAX_DISCARD) h.out.add(i);
      else { this.raid.hud.toast(`You can only throw back ${MAX_DISCARD}.`); return; }
      sfx.tick();
      this.renderDeal();
    };
    $('pokerGo').onclick = () => this.sendDraw();
    this.tickDeal();
  }

  tickDeal() {
    const h = this.myHand;
    if (!h || h.sent) return;
    const left = Math.max(0, Math.ceil((h.until - performance.now()) / 1000));
    const t = $('pokerTime');
    if (t) { const txt = `${left}s to draw, then you stand pat.`; if (t.textContent !== txt) t.textContent = txt; }
    if (left <= 0) this.sendDraw();
  }

  sendDraw() {
    const h = this.myHand;
    if (!h || h.sent) return;
    h.sent = true;
    const discard = [...h.out];
    if (!$('pokerPanel').hidden) this.raid.setOverlay(null);
    if (this.referee) this.pokerDraw(h.id, this.raid.player, discard);
    else this.net.send({ k: 'pokerDraw', id: h.id, discard });
    if (discard.length) discard.forEach((_, i) => setTimeout(() => sfx.card(), i * 110));
  }

  // The panel closed (Esc, a click away): play the hand as it stands.
  pokerClosed() {
    if (this.myHand && !this.myHand.sent) this.sendDraw();
  }

  // Both hands face up: theirs card by card, the hand names, then the cards that won it light up.
  showReveal(r) {
    this.myHand = null;
    const el = $('showdown');
    const myId = this.net ? this.net.me : 'me';
    const mine = r.ia === myId ? 'a' : r.ib === myId ? 'b' : '';
    const STEP = 0.22;
    const ROW = 5 * STEP + 0.5;
    const rows = [['a', r.a, r.ha, r.ra, r.na || [], r.ma || []], ['b', r.b, r.hb, r.rb, r.nb || [], r.mb || []]];
    // Your hand first, theirs flips after.
    if (mine === 'b') rows.reverse();
    const done = 2 * ROW + 0.2;
    const ws = r.ws || '';
    const iWon = !!ws && ws === mine;
    const winName = ws === 'a' ? r.a : r.b;
    const money = r.chips ? (iWon ? ` +🪙 ${fmt(r.chips)}` : ws && mine ? ` · you lose 🪙 ${fmt(r.chips)}` : '') : '';
    el.innerHTML = `<div class="sdhead">🃏 SHOWDOWN${r.chips ? ` · 🪙 ${fmt(r.chips * 2)} pot` : ''}${r.guns ? ' + 🔫 pink slips' : ''}</div>
      ${rows.map(([side, n, h, rank, drew, made], k) => `<div class="sdrow ${ws === side ? 'win' : ws ? 'lose' : ''}" style="--done:${done}s">
        <div class="sdwho"><b>${ws === side ? '🏆 ' : ''}${n}${side === mine ? ' (you)' : ''}</b><small>${drew.length ? `drew ${drew.length}` : 'stood pat'}</small><i style="animation-delay:${k * ROW + 5 * STEP}s">${rank}</i></div>
        <span class="cards">${h.map((c, i) => cardHtml(c, `${made.includes(i) && ws === side ? 'hot' : ''} ${drew.includes(i) ? 'new' : ''}`, `animation-delay:${k * ROW + i * STEP}s, ${done}s`)).join('')}</span></div>`).join('')}
      <div class="sdfoot" style="animation-delay:${done}s">${ws ? `${iWon ? '🏆 YOU WIN' : `🏆 ${winName} wins`}${money}` : 'Split pot! Chips back.'}</div>`;
    el.hidden = false;
    document.body.classList.add('showdownup');
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    for (let k = 0; k < 2; k++) for (let i = 0; i < 5; i++) setTimeout(() => sfx.card(), (k * ROW + i * STEP) * 1000);
    clearTimeout(this.footTimer);
    this.footTimer = setTimeout(() => { if (iWon) sfx.win(); else if (ws && mine) sfx.deny(); else sfx.lever(); }, done * 1000);
    clearTimeout(this.revealTimer);
    this.revealTimer = setTimeout(() => { el.hidden = true; document.body.classList.remove('showdownup'); }, (done + 5) * 1000);
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
    if (this.myBet && this.myBetFight !== v.a + v.b) this.myBet = null; // last fight's bet
    this.betSide = this.myBet ? this.myBet.side : this.betSide || 'a';
    this.betAmt = this.myBet ? this.myBet.amount : this.betAmt || 0;
    this.betWhoKey = this.betChipKey = null;
    this.renderBet();
    this.raid.setOverlay('bet');
  }

  // The bet window. render() calls this every frame, so the buttons are only rebuilt when something
  // on them actually changes; rebuilding them under the mouse swallowed clicks (you couldn't switch sides).
  renderBet() {
    const v = this.view;
    if (!v) { this.raid.setOverlay(null); return; }
    const chips = save.get().stash.chips;
    const mine = this.myBet;
    const whoKey = `${this.betSide}|${v.a}|${v.b}|${v.pa || 0}|${v.pb || 0}|${mine ? mine.side + mine.amount : ''}`;
    if (whoKey !== this.betWhoKey) {
      this.betWhoKey = whoKey;
      $('betWho').innerHTML = [['a', v.a], ['b', v.b]].map(([k, n]) => `<button class="betside ${this.betSide === k ? 'on' : ''}" data-s="${k}"><b>${n}</b><small>🪙 ${fmt(k === 'a' ? v.pa || 0 : v.pb || 0)} bet so far${mine && mine.side === k ? ` · yours: 🪙 ${fmt(mine.amount)}` : ''}</small></button>`).join('');
    }
    const chipKey = `${this.betAmt}|${BETS.map((x) => x > chips).join('')}`;
    if (chipKey !== this.betChipKey) {
      this.betChipKey = chipKey;
      $('betChips').innerHTML = BETS.map((x) => `<button class="cchip c${x} ${x === this.betAmt ? 'on' : ''}" data-v="${x}" ${x > chips ? 'disabled' : ''}>${chipLabel(x)}</button>`).join('');
    }
    $('betWho').onclick = (e) => { const b = e.target.closest('[data-s]'); if (b) { this.betSide = b.dataset.s; this.renderBet(); } };
    $('betChips').onclick = (e) => { const b = e.target.closest('[data-v]'); if (b && !b.disabled) { this.betAmt = Number(b.dataset.v); this.renderBet(); } };
    const note = `${mine ? `You have 🪙 ${fmt(mine.amount)} on ${mine.side === 'a' ? v.a : v.b}. Pick again to change it. ` : ''}Pays 2x if you're right. Draws are refunded. Your bank: 🪙 ${fmt(chips)}. Bets close in ${Math.max(0, Math.ceil(BET_TIME - v.t))}s.`;
    if ($('betNote').textContent !== note) $('betNote').textContent = note;
    $('betSend').textContent = mine ? 'CHANGE BET' : 'BET';
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
    this.myBetFight = this.view.a + this.view.b;
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
    this.liftOut();
    // Invites time out.
    if (this.invite && performance.now() > this.invite.until) this.answer(false);
    this.tickDeal();
    if (!this.referee) { this.render(); return; }
    // Someone never drew (left, lost connection): they stand pat.
    for (const g of [...this.hands.values()]) {
      if (performance.now() - g.at > (DRAW_TIME + 8) * 1000) { g.da = g.da || []; g.db = g.db || []; this.pokerCheck(g); }
    }
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
          if (!gone(x)) this.place(x, lost ? new THREE.Vector3(sp[0], 0, sp[1]) : new THREE.Vector3(ar.x + i * 6, 0, ar.z + this.r + 12), lost ? Math.atan2(sp[0], sp[1]) : 0);
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
