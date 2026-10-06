// The Hub between raids: stash and loadout, the Back Room (gambling), the Fence (selling),
// your look, your records (stats, achievements, collection log) and settings.
// Everything here is plain HTML on top of the 3D backdrop.
import { GUN_TIERS, bossTheme, BACKPACK_SLOTS, BAG_UPGRADES, HUB_SLOTS, ITEMS, LOOT, QUALITY, RARITY_BY_TIER, WEAPONS, bagBonus } from './config.js';
import {
  itemInfo, isGun, rollLoot, addToList, addToStash, makeGun, makeItem, fullAmmo, weightedIndex, holdRoom, holdLimitText,
} from './items.js';
import { save } from './save.js';
import { cloud, net as cloudNet } from './cloud.js';
import { iconHtml, gunIcon } from './icons.js';
import { keyName, renderBinds, wireBinds } from './keys.js';
import { MAPS } from './map.js';
import { escapeHtml } from './hud.js';
import { sfx, initAudio, setVolume } from './audio.js';
import {
  progress, levelInfo, ACHIEVEMENTS, TIER_NAMES, collectionEntries, collectionProgress, GUN_KINDS, lookUnlocked, itemKey,
} from './progress.js';
import {
  LOOKS, LOOK_PARTS, unlockText, wornLook,
} from './looks.js';
import { LookPreview } from './preview.js';
import { BUILD } from './version.js';
import { Shoe, cardValue, handValue, isNatural } from './cards.js';
import { MOB_MIN, MOB_MAX, mobDebt, borrow, repay } from './mob.js';
import { contracts, contractView, claim as claimContract, reroll as rerollContract, resetsIn, readyCount } from './contracts.js';

const $ = (id) => document.getElementById(id);
const LOADOUT_SLOTS = 8;
export const BETS = [25, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
// High-roller tables open up as you level up from raiding.
export const BET_LEVEL = { 25000: 5, 50000: 10, 100000: 15 };
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const hex = (c) => `#${Number(c).toString(16).padStart(6, '0')}`;

// ---------- card games ----------
export const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
// Blackjack is dealt from a real six-deck shoe (see cards.js).
const shoe = new Shoe();
const drawCard = () => shoe.draw();
const cardHtml = (c, hidden, i = 0) => (hidden ? `<span class="pcard back" style="--i:${i}"></span>`
  : `<span class="pcard ${c.suit === '♥' || c.suit === '♦' ? 'red' : ''}" style="--i:${i}"><i>${c.rank}</i><em>${c.suit}</em><i class="flip">${c.rank}</i></span>`);

// ---------- Loot Reels ----------
export const REEL_SYMBOLS = ['🍒', '🍋', '🔔', '7️⃣', '💎', '🪙', '🎲', '⭐'];
const ROW = 62;
// The Loot Reels paytable, as multiples of what the pull cost. Matching three always wins big;
// a gun prize comes with chips on top so the whole win is worth the multiple. Pays back about 95%.
// [weight, symbol, pays (x cost), gun rarity]
const REEL_PAYS = [
  [50, null, 0.1, -1], // near miss: a few chips back
  [25, 'item', 0.7, -1], // two coins: a bit of loot
  [15, '🍒', 1.5, -1],
  [7, '🔔', 3, 1],
  [2.6, '7️⃣', 6, 2],
  [0.4, '💎', 25, 3],
];
export const REEL_HITS = REEL_PAYS.map(([, sym, x, r]) => ({ sym, x, r }));
const round5 = (n) => Math.max(5, Math.round(n / 5) * 5);

// One pull of a Loot Reels machine: what it pays ({ item, chips, hit }) and where the reels land.
export function reelPull(m) {
  const hit = weightedIndex(REEL_PAYS.map(([w]) => w));
  const [, sym, x, rarity] = REEL_PAYS[hit];
  const target = m.cost * x;
  let item = null;
  let chips = 0;
  let finals;
  if (hit === 0) {
    chips = round5(target);
    const a = REEL_SYMBOLS[Math.floor(Math.random() * REEL_SYMBOLS.length)];
    finals = [a, a, a === '🍒' ? '🍋' : '🍒'];
  } else if (hit === 1) {
    const loot = rollLoot(m.tier);
    if (loot.chips) chips = round5(target); else { item = loot; chips = round5(Math.max(0, target - itemInfo(loot).value)); }
    finals = ['🪙', '🪙', REEL_SYMBOLS[Math.floor(Math.random() * 3)]];
  } else {
    if (rarity >= 0) {
      // A gun of that rarity worth no more than the win (the rest comes as chips). Better
      // machines lean toward their own tier's guns.
      const pool = [...new Set(GUN_TIERS.slice(0, Math.min(GUN_TIERS.length, m.tier + 1)).flat())].filter((k) => !WEAPONS[k].melee).map((k) => makeGun(k, rarity));
      const fits = pool.filter((g) => itemInfo(g).value <= target).sort((a, b) => itemInfo(b).value - itemInfo(a).value);
      item = fits.length ? fits[Math.floor(Math.random() * Math.min(3, fits.length))] : pool.sort((a, b) => itemInfo(a).value - itemInfo(b).value)[0];
    }
    chips = round5(Math.max(0, target - (item ? itemInfo(item).value : 0)));
    finals = [sym, sym, sym];
  }
  return { prize: { item, chips, hit }, finals };
}
export const PRIZE_SYMBOL = ['🍒', '🔔', '7️⃣', '💎'];

// Rough odds from one pull, for the machine cards.
function reelOdds(tier) {
  const table = LOOT[tier];
  const total = table.reduce((n, [w]) => n + w, 0);
  const gun = (table.find(([, w]) => w === 'gun') || [0])[0] / total;
  const legItems = table.filter(([, w]) => ITEMS[w] && ITEMS[w].legendary).reduce((n, [w]) => n + w, 0) / total;
  return { legendary: gun * RARITY_BY_TIER[tier][3] + legItems * 100, epic: gun * RARITY_BY_TIER[tier][2], gun: gun * 100 };
}

const GAMES = [
  ['slots', '🎰', 'Loot Reels', 'Spin for a mystery prize'],
  ['blackjack', '🃏', 'Blackjack', 'Beat the dealer to 21'],
  ['roulette', '🎡', 'Roulette', 'Pick a color, spin the wheel'],
  ['crash', '🚀', 'Crash', 'Cash out before it blows'],
  ['mines', '💎', 'Mines', 'Find gems, dodge the bombs'],
  ['plinko', '🔴', 'Plinko', 'Drop a ball, pray for the edges'],
];
// Plinko: 12 rows of pegs, 13 buckets. Riskier boards pay more at the edges and less in the middle.
export const PLINKO_ROWS = 12;
export const PLINKO = {
  low: [9, 3, 1.5, 1.3, 1.1, 0.95, 0.5, 0.95, 1.1, 1.3, 1.5, 3, 9],
  medium: [29, 9, 4, 2, 1, 0.6, 0.3, 0.6, 1, 2, 4, 9, 29],
  high: [140, 22, 8, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8, 22, 140],
};
const PW = 560;
const PH = 430;
const PDX = 38;
const PDY = 29;
const PTOP = 34;
const pegX = (row, k) => PW / 2 + (k - (row + 2) / 2) * PDX;
export const bucketColor = (m) => (m >= 10 ? '#e63946' : m >= 3 ? '#ff6b3d' : m >= 1.5 ? '#ff9f43' : m >= 1 ? '#ffc83d' : '#ffe08a');
export const MINE_COUNTS = [1, 3, 5, 10];
// Payout multiplier after `picks` safe tiles with `bombs` hidden in 25 (with a small house edge).
export function minesMult(bombs, picks) {
  let m = 0.95;
  for (let i = 0; i < picks; i++) m *= (25 - i) / (25 - bombs - i);
  return m;
}

// The Shop's supplies: [item, price]. Pricier than the Fence pays, so selling and rebuying loses.
// [item, price, level it unlocks at]
const SUPPLIES = [
  ['bandage', 150, 1], ['ammo', 120, 1], ['plate', 200, 1], ['soda', 350, 3], ['cocoa', 160, 3], ['grenade', 250, 4], ['smoke', 200, 4],
  ['dice', 300, 5], ['flash', 260, 5], ['fuel', 220, 6], ['sauce', 280, 7], ['sticky', 350, 8], ['emp', 380, 10], ['cluster', 500, 12],
  ['token', 2500, 14], ['keycard', 4500, 18],
];
// The Armory opens at level 4. More guns, and better ones, as you level up.
const ARMORY_LEVEL = 4;
const ARMORY_STOCK = [[4, 2], [7, 3], [10, 4], [14, 5], [18, 6]]; // [level, guns on offer]
const ARMORY_RARITY = [[8, 1], [12, 2], [18, 3]]; // [level, best rarity it can stock]
const armoryStock = (lv) => ARMORY_STOCK.filter(([l]) => lv >= l).reduce((n, [, c]) => c, 0);
const armoryRarity = (lv) => ARMORY_RARITY.filter(([l]) => lv >= l).reduce((n, [, r]) => r, 0);
// Safe Pocket slots: one with any bought backpack, two with the best one. Never with the free loadout.
const pocketSlots = (bag) => (bag >= BAG_UPGRADES.length ? 2 : bag >= 1 ? 1 : 0);

// Why a Shop look is still locked ('' once you can buy it).
function shopLookLock(o, d) {
  const u = o.unlock;
  if (u.lvl && levelInfo(d.xp).level < u.lvl) return `Level ${u.lvl}`;
  if (u.boss && !(d.stats.bossKills > 0)) return `Level ${u.lvl} + beat the Pit Boss`;
  return '';
}

// The top tabs, and the pages inside each one (a row of sub-tabs when there's more than one).
const TAB_GROUPS = {
  loadout: [['loadout', '🎒 Loadout']],
  backroom: [['backroom', '🎰 Back Room']],
  shop: [['shop', '🛒 Buy'], ['fence', '💰 Sell (Fence)']],
  profile: [['look', '🎨 Look'], ['records', '🏆 Records'], ['leaders', '👑 Leaders'], ['settings', '⚙️ Account & Settings']],
};
const groupOf = (tab) => Object.keys(TAB_GROUPS).find((g) => TAB_GROUPS[g].some(([t]) => t === tab)) || 'loadout';

const FREE_LOCKED = 'The free loadout is locked in. Raid with it as is.';
const hasFreeKit = (lo) => lo.weapons.some((g) => g && g.free) || lo.items.some((it) => it.free);

export class Hub {
  constructor({ onDeploy, onMapChange, onPartyStart = null, onSettings = null, onJoinRaid = null, net = null }) {
    this.onDeploy = onDeploy;
    this.onPartyStart = onPartyStart;
    this.net = net;
    this.partyCode = '';
    this.onMapChange = onMapChange || (() => {});
    this.onSettings = onSettings;
    this.onJoinRaid = onJoinRaid;
    this.tab = 'loadout';
    this.game = 'slots';
    this.bet = 100;
    this.bj = null;
    this.crash = null;
    this.roulette = null;
    this.mines = null;
    this.mineCount = 3;
    this.plinko = { risk: 'medium', balls: [], results: [], flash: [], loop: false };
    this.reels = null;
    this.machine = 0;
    this.session = 0;
    this.history = [];
    this.lookPart = 'color';
    this.recTab = 'overview';
    this.armedReset = false;
    this.preview = new LookPreview();
    const d = save.get();
    if (!d.loadout) save.update((x) => { x.loadout = { weapons: [null, null], items: [] }; });
    if (!d.selectedMap || !MAPS[d.selectedMap]) save.update((x) => { x.selectedMap = 'vegas'; });
    if (d.look.color === null) save.update((x) => { x.look.color = LOOKS.color[Math.floor(Math.random() * 8)].id; });
    // Older profiles: count what's already in the stash as found, and award anything already earned.
    progress((x) => {
      if (x.collectionSeeded) return;
      x.collectionSeeded = true;
      for (const it of x.stash.items) { const k = itemKey(it); x.collection[k] = (x.collection[k] || 0) + (it.qty || 1); }
    });

    this.lastIn = {}; // the page you were last on in each top tab
    $('hubTabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      const g = b.dataset.tab;
      this.tab = this.lastIn[g] || TAB_GROUPS[g][0][0];
      initAudio();
      this.render();
    });
    $('hubWallet').addEventListener('click', (e) => {
      if (e.target.closest('.acctchip')) {
        initAudio();
        if (cloud.user) { this.tab = 'settings'; this.render(); } else this.openAuth();
        return;
      }
      if (!e.target.closest('.prof')) return;
      this.tab = 'records';
      this.recTab = 'overview';
      this.render();
    });
    $('hubBody').addEventListener('click', (e) => this.onClick(e));
    wireBinds($('hubBody'), () => this.render(), (t) => this.toast(t));
    // Cash out on press, not release: every millisecond counts.
    $('hubBody').addEventListener('pointerdown', (e) => {
      if (e.target.closest('[data-act="cashout"]')) { e.preventDefault(); this.cashOutCrash(); }
    });
    $('hubBody').addEventListener('input', (e) => this.onInput(e));
    if (net) {
      const rerender = () => { if (this.tab === 'loadout' && !$('hub').hidden && !(document.activeElement && document.activeElement.id === 'partyCode')) this.render(); else this.renderDeploy(); };
      net.on('room', rerender);
      net.on('status', rerender);
      net.on('error', (m) => this.toast(m.text));
    }
    $('deploy').addEventListener('click', () => this.deploy());
    $('tableClose').addEventListener('click', () => this.closeTable());
    cloud.onUpdate(() => {
      if (!$('hub').hidden && ['settings', 'leaders'].includes(this.tab)) this.render(); else this.renderHeader();
      if (!$('title').hidden) this.renderTitle();
      if (!$('authModal').hidden) this.renderAuth();
    });
    // The title screen and the sign-in window.
    $('title').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      initAudio();
      if (b.dataset.act === 'titleplay') {
        // Brand new? Straight into the tutorial.
        const d = this.data;
        if (!d.tutorialDone && !(d.stats.raids || 0)) this.startTutorial();
        else this.closeTitle();
      } else if (b.dataset.act === 'titletut') this.startTutorial();
      else if (b.dataset.act === 'auth') this.openAuth(b.dataset.mode);
    });
    $('authModal').addEventListener('click', (e) => {
      if (e.target.id === 'authModal') { this.closeAuth(); return; }
      const b = e.target.closest('[data-act]');
      if (!b) return;
      switch (b.dataset.act) {
        case 'authtab': this.keepAuthFields(); this.authMode = b.dataset.mode; this.cloudError = ''; this.renderAuth(); break;
        case 'authgo': this.cloudAction(this.authMode === 'reg' ? 'reg' : 'in'); break;
        case 'authclose': this.closeAuth(); break;
        case 'pinshow': this.keepAuthFields(); this.pinShown = !this.pinShown; this.renderAuth(); break;
        case 'cloudsync': cloud.push(); this.toast('☁️ Saving…'); break;
        case 'cloudout': cloud.logout(); this.toast('Logged out. Progress on this device stays here.'); this.renderAuth(); this.render(); break;
        default: break;
      }
    });
    $('authModal').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); this.closeAuth(); }
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') this.cloudAction(this.authMode === 'reg' ? 'reg' : 'in');
    });
    this.board = null;
    this.boardBy = 'worth';
    this.render();
  }

  // The Training Floor: a guided run with the gear handed to you. Your own loadout stays home.
  startTutorial() {
    if (this.net && this.net.inParty) { this.toast('Leave your party first: the tutorial is a solo run.'); return; }
    initAudio();
    if (!$('title').hidden) { $('title').hidden = true; document.body.classList.remove('titleup'); }
    const d = this.data;
    this.onDeploy({
      mapId: 'training',
      name: (d.look.name || '').trim() || 'High Roller',
      look: wornLook(d.look),
      loadout: { weapons: [null, null], items: [], pocket: 0 },
      opts: { tutorial: true },
    });
  }

  show() {
    $('hub').hidden = false;
    // Back from the Training Floor: put the menu backdrop back on your map and say well done.
    if (window.degen && window.degen.mapId === 'training') this.onMapChange(this.data.selectedMap);
    if (this.tutorialReward) {
      const r = this.tutorialReward.reward;
      this.tutorialReward = null;
      setTimeout(() => this.toast(r ? `🎓 Tutorial complete! Here's 🪙 ${fmt(r)} to get you started. Pick a map and go!` : '🎓 Tutorial complete! You\'re ready.'), 500);
      this.tab = 'loadout';
      this.loStage = 'maps';
    }
    this.render();
    // Back from a raid with a contract finished: say so.
    const ready = readyCount();
    if (ready > (this.ctReady || 0)) setTimeout(() => this.toast(`📋 ${ready} contract${ready > 1 ? 's' : ''} ready to claim on the Loadout page!`), 600);
    this.ctReady = ready;
  }

  // Playing a Back Room game at a table in the Lounge: just the game, and a way back.
  openTable(game) {
    this.tab = 'backroom';
    this.game = game;
    document.body.classList.add('tablemode');
    this.show();
  }

  closeTable() {
    document.body.classList.remove('tablemode');
    this.hide();
    if (this.onTableClose) this.onTableClose();
  }
  hide() {
    $('hub').hidden = true;
    // Pulled into a raid (a party leader deployed) while still on the title screen: get out of the way.
    if (!$('title').hidden) { $('title').hidden = true; document.body.classList.remove('titleup'); }
    this.closeAuth();
  }

  get data() { return save.get(); }

  toast(text) {
    // At a Lounge table the hub is hidden: say it in the raid instead.
    if ($('hub').hidden && this.raidToast) { this.raidToast(text); return; }
    const el = $('hubToast');
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  // Shout about anything a change unlocked.
  announce(out) {
    if (!out) return;
    const bits = [];
    if (out.levelUp) bits.push(`⭐ Level ${out.levelUp}!`);
    for (const a of out.achievements) bits.push(`🏆 ${a.name}`);
    if (out.looks.length) bits.push(`🎨 ${out.looks.length} new look${out.looks.length > 1 ? 's' : ''}`);
    if (bits.length) { this.toast(bits.join(' · ')); sfx.jackpot(); }
  }

  // ---------- rendering ----------

  render() {
    const d = this.data;
    this.renderHeader();
    const group = groupOf(this.tab);
    this.lastIn[group] = this.tab;
    document.querySelectorAll('#hubTabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === group));
    const body = {
      loadout: () => this.renderLoadout(),
      backroom: () => this.renderBackRoom(),
      fence: () => this.renderFence(),
      look: () => this.renderLook(),
      records: () => this.renderRecords(),
      settings: () => this.renderSettings(),
      leaders: () => this.renderLeaders(),
      shop: () => this.renderShop(),
    }[this.tab]();
    const pages = TAB_GROUPS[group];
    const bar = pages.length > 1 ? `<nav class="groupbar">${pages.map(([t, n]) => `<button class="${t === this.tab ? 'on' : ''}" data-act="hubpage" data-t="${t}">${n}</button>`).join('')}</nav>` : '';
    $('hubBody').innerHTML = bar + body;
    $('hubBody').dataset.tab = this.tab;
    document.body.classList.toggle('mapstage', this.tab === 'loadout' && this.loStage !== 'gear');
    if (this.tab === 'backroom' && this.game === 'crash') this.drawCrash();
    if (this.tab === 'backroom' && this.game === 'plinko') this.drawPlinko();
    if (this.tab === 'look') {
      this.preview.setLook(wornLook(d.look), d.loadout.weapons.find(Boolean));
      this.preview.mount($('lookSlot'));
    }
    this.renderDeploy();
  }

  renderDeploy() {
    const d = this.data;
    const hasGun = d.loadout.weapons.some(Boolean);
    const m = MAPS[d.selectedMap];
    const party = this.net && this.net.inParty;
    let html = hasGun ? `DEPLOY<small>${m.icon} ${m.name}</small>` : 'DEPLOY<small>no gun packed!</small>';
    if (party && !this.net.isHost) html = this.net.room.inRaid ? 'JOIN RAID<small>drop in next to your squad</small>' : 'WAITING…<small>the party leader deploys everyone</small>';
    else if (party) html = `DEPLOY SQUAD<small>${m.icon} ${m.name} · ${this.net.partySize} players</small>`;
    $('deploy').innerHTML = html;
  }

  // The party panel: create, join, invite code, who's in.
  renderParty() {
    const net = this.net;
    if (!net) return '';
    if (net.status !== 'online' && !net.inParty) {
      return `<section class="party slim"><b>👥 Play with friends</b><small>${net.status === 'connecting' ? 'Connecting…' : 'Party server offline.'}</small>
        <div class="prow"><button class="btn ghost" data-act="pconnect">${net.status === 'connecting' ? 'Connecting…' : 'Connect'}</button></div></section>`;
    }
    if (!net.inParty) {
      return `<section class="party slim"><b>👥 Play with friends</b>
        <div class="prow"><button class="btn" data-act="pcreate">Create party</button>
        <input id="partyCode" maxlength="4" placeholder="CODE" value="${escapeHtml(this.partyCode)}" autocomplete="off">
        <button class="btn ghost" data-act="pjoin">Join</button></div></section>`;
    }
    const r = net.room;
    const me = net.id;
    const mode = r.mode || (r.ffa ? 'ffa' : 'coop');
    const teams = mode === 'teams';
    const bad = this.wrongBuild ? this.wrongBuild() : [];
    const pm = (m) => {
      const off = bad.includes(m) ? (this.partyBuilds.has(m.id) ? ` ⚠️ Build ${this.partyBuilds.get(m.id)}` : ' ⚠️ old version') : '';
      const bld = m.id === me ? BUILD : this.partyBuilds && this.partyBuilds.get(m.id);
      return `<span class="pm ${m.id === r.host ? 'lead' : ''} ${teams ? `t${m.team || 0}` : ''} ${off ? 'oldbuild' : ''}">${m.id === r.host ? '👑' : '🙂'} ${escapeHtml(m.name)}${m.id === me ? ' (you)' : ''}${m.away ? ' 📶 reconnecting…' : ''}${off || (bld ? ` <small class="pbld">Build ${bld}</small>` : '')}</span>`;
    };
    const members = teams
      ? [0, 1].map((t) => `<div class="pteam t${t}"><b>${t ? '🔵 Blue' : '🔴 Red'}</b>${r.members.filter((m) => (m.team || 0) === t).map(pm).join('')}</div>`).join('')
      : r.members.map(pm).join('');
    const MODES = { coop: ['🤝 Co-op', 'Everyone\'s on the same side. No friendly fire.'], ffa: ['⚔️ Free-for-all', 'Every raider for themselves, friends included.'], teams: ['🔴🔵 Teams', 'Red vs Blue. Teams drop in on opposite sides of the map.'] };
    const modeRow = net.isHost
      ? `<div class="pmodes">${Object.entries(MODES).map(([k, [label]]) => `<button class="subtab ${mode === k ? 'on' : ''}" data-act="pmode" data-m="${k}">${label}</button>`).join('')}</div>`
      : `<span class="pffa">${MODES[mode][0]}</span>`;
    return `<section class="party in"><div class="phead"><b>👥 Party <span class="pcode" data-act="pcopy" title="Click to copy">${r.code}</span></b>
        <small>${net.isHost ? 'You\'re the leader: pick the map and hit DEPLOY SQUAD to drop everyone in together.' : `Waiting for ${escapeHtml((r.members.find((m) => m.id === r.host) || {}).name || 'the leader')} to deploy. Pack your loadout!`}${r.inRaid ? ' · Raid in progress…' : ''}${net.status === 'reconnecting' ? ' · 📶 Reconnecting…' : ''}</small></div>
      <div class="pmembers ${teams ? 'split' : ''}">${members}</div>
      ${bad.length ? `<p class="pbuild">⚠️ Not everyone is on the same version of the game, so your maps won't match. Everyone open the same link and refresh the page.</p>` : ''}
      <div class="prow">${modeRow}<small class="pmodehint">${MODES[mode][1]}</small></div>
      <div class="prow">${teams && !r.inRaid ? '<button class="btn ghost" data-act="pteam">Switch team</button>' : ''}
      <button class="btn ghost" data-act="pleave">Leave party</button></div></section>`;
  }

  renderHeader() {
    const d = this.data;
    const lv = levelInfo(d.xp);
    const look = wornLook(d.look);
    const hat = LOOKS.hat.find((h) => h.id === look.hat);
    const stashValue = d.stash.items.reduce((n, it) => n + itemInfo(it).value, 0);
    const u = cloud.user;
    $('hubWallet').innerHTML = `
      <button class="acctchip ${u ? 'in' : ''}" title="${u ? 'Cloud save: account and settings' : 'Log in or make an account to save your progress'}">
        <span class="dot"></span><span><b>${u ? `☁️ ${escapeHtml(u.name)}` : '👤 Guest'}</b><small>${u ? 'progress saved' : 'Sign in to save'}</small></span>
      </button>
      <button class="prof" title="Your records">
        <span class="avatar" style="--c:${hex(look.color)}">${hat && hat.id !== 'none' ? hat.icon : '🙂'}</span>
        <span class="pinfo"><b>${escapeHtml((d.look.name || '').trim() || 'High Roller')}</b>
          <span class="lvrow"><span class="lvlbadge">LV ${lv.level}</span><span class="xpbar"><i style="width:${(lv.frac * 100).toFixed(1)}%"></i></span></span>
          <small>${fmt(lv.into)} / ${fmt(lv.need)} XP</small></span>
      </button>
      <div class="money"><span class="coin">🪙</span><span><b>${fmt(d.stash.chips)}</b><small>chips · stash worth 🪙 ${fmt(stashValue)}</small></span></div>`;
  }

  itemCard(item, act, i, extra = '') {
    const info = itemInfo(item);
    return `<button class="item r${info.rarity}" data-act="${act}" data-i="${i}" title="${escapeHtml(info.name)} · worth 🪙${info.value}">
      ${item.free ? '<span class="freetag">FREE</span>' : ''}<span class="icon">${iconHtml(item)}</span><span class="nm" style="color:${info.css}">${escapeHtml(info.name)}</span>
      <span class="meta">${isGun(item) ? `${Number.isFinite(item.ammo) ? item.ammo : fullAmmo(item.kind, item.rarity)} ammo` : item.qty > 1 ? `×${item.qty}` : ''}</span>${extra}</button>`;
  }

  renderLoadout() {
    return this.loStage === 'gear' ? this.renderGear() : this.renderMapPick();
  }

  // Step 1: where are we going? Big map tiles (and the tutorial), nothing else to think about.
  renderMapPick() {
    const d = this.data;
    const order = ['lounge', 'vegas', 'bayou', 'frost', 'tequila', 'bunker'].filter((id) => MAPS[id]);
    const partyMember = this.net && this.net.inParty && !this.net.isHost;
    const newbie = !d.tutorialDone && (d.stats.raids || 0) < 2;
    const tiles = order.map((id) => {
      const m = MAPS[id];
      const facts = m.safe ? ['🛡️ No machines', '🥊 1v1s', '🎲 Casino games'] : [`⏱️ ${Math.round((m.raidTime || 1080) / 60)} min`, `📏 ${m.size}`, m.indoor ? '🏚️ Indoors' : `👑 ${bossTheme(id).name}`];
      return `<button class="maptile m-${id} ${d.selectedMap === id ? 'on' : ''}" data-act="pickmap" data-m="${id}" ${partyMember && d.selectedMap !== id ? 'disabled' : ''}>
        <span class="mticon">${m.icon}</span><span class="tag d-${m.danger.toLowerCase()}">${m.danger}</span>
        <b>${m.name}</b><small>${m.blurb}</small>
        <span class="mtfacts">${facts.map((x) => `<i>${x}</i>`).join('')}</span>
        <span class="mtgo">${partyMember ? 'Gear up ▶' : 'Choose ▶'}</span></button>`;
    }).join('');
    const tut = `<button class="maptile tut ${newbie ? 'hot' : ''}" data-act="tutorial">
        <span class="mticon">🎓</span><span class="tag d-safe">${newbie ? 'Start here' : 'Practice'}</span>
        <b>Training Floor</b><small>A guided 5-minute run through the basics: moving, looting, shooting, healing and getting out. Nothing to lose.</small>
        <span class="mtfacts"><i>⏱️ 5 min</i><i>🎒 Gear provided</i>${d.tutorialDone ? '' : '<i>🪙 +500 first time</i>'}</span>
        <span class="mtgo">${d.tutorialDone ? 'Play again ▶' : 'Play tutorial ▶'}</span></button>`;
    return `${this.renderContracts()}${this.renderParty()}
      <section class="mappick"><h3>🗺️ Where to? <small>${partyMember ? 'Your party leader picks the map. Gear up for it.' : 'Pick a map, then pack your gear.'}</small></h3>
      <div class="mapgrid">${tut}${tiles}</div></section>`;
  }

  // Step 2: the whole screen for packing: your stash on one side, what you're bringing on the other.
  renderGear() {
    const d = this.data;
    const lo = d.loadout;
    const noGuns = !lo.weapons.some(Boolean);
    const freeKit = hasFreeKit(lo);
    const selId = MAPS[d.selectedMap] ? d.selectedMap : 'vegas';
    const sel = MAPS[selId];
    const facts = sel.safe ? ['🛡️ No machines, no raiders', '🥊 1v1s in The Pit'] : [`⏱️ ${Math.round((sel.raidTime || 1080) / 60)} min raid`, `📏 ${sel.size} map`, sel.indoor ? `👑 ${bossTheme(selId).name}` : `👑 ${bossTheme(selId).name} at 4:00`];
    const packed = lo.weapons.filter(Boolean).length + lo.items.length;
    const pocket = (() => {
      const n = pocketSlots(d.bag || 0);
      if (!n) return '<p class="hint pocketnote">🔒 Buy any backpack in the Shop to get a <b>Safe Pocket</b>: what you put in it during a raid comes home even if you die.</p>';
      if (freeKit) return '<p class="hint pocketnote off">🔒 No Safe Pocket with the free loadout. Bring your own gun to get it.</p>';
      if (noGuns) return '<p class="hint pocketnote off">🔒 Pack a gun of your own to bring your Safe Pocket.</p>';
      return `<p class="hint pocketnote on">🔒 Safe Pocket: ${n} slot${n > 1 ? 's' : ''} this raid. Drag your best find into it in your backpack screen.</p>`;
    })();
    const free = freeKit
      ? '<div class="freebar"><span>🎁 Free loadout packed. It\'s locked in until you raid with it.</span><button class="btn ghost" data-act="unfreekit">✕ Put it back</button></div>'
      : noGuns ? '<button class="btn freekit" data-act="freekit">🎁 FREE LOADOUT<small>No gun? Take a random gun, bandages, an Ammo Box, a Chip Plate and a throwable. You can put it back.</small></button>' : '';
    return `<div class="gearhead m-${selId}">
        <button class="btn ghost gearback" data-act="backmaps">◀ Maps</button>
        <span class="gearicon">${sel.icon}</span>
        <div class="geartxt"><span class="tag d-${sel.danger.toLowerCase()}">${sel.danger}</span><b>${sel.name}</b><small>${facts.join(' · ')}</small></div>
      </div>
      <div class="gearcols">
        <section class="stashsec"><h3>📦 Your stash <small>click something to pack it</small></h3>
          ${this.stashSections('pack', freeKit)}</section>
        <section class="kit"><h3>🎒 Bringing <small>${packed} packed · lost if you die</small></h3>
          ${free}
          <div class="wslots">${lo.weapons.map((g, i) => (g ? this.itemCard(g, freeKit ? 'freelocked' : 'unequip', i) : `<div class="item empty">Weapon ${i + 1}<br><small>empty</small></div>`)).join('')}</div>
          <div class="grid">${lo.items.map((it, i) => this.itemCard(it, freeKit ? 'freelocked' : 'unpack', i)).join('')}${Array(Math.max(0, LOADOUT_SLOTS - lo.items.length)).fill('<div class="item empty"></div>').join('')}</div>
          <p class="hint">${freeKit ? 'Free gear can\'t be swapped piece by piece: put the whole thing back to pack your own.' : 'Click anything here to send it back to your stash.'}</p>
          ${pocket}
        </section>
      </div>`;
  }

  // The stash, sorted into shelves: guns, supplies, throwables, valuables (to sell) and the rest.
  // Best stuff first on each shelf. `act` is what clicking an item does (pack it, or sell it).
  stashSections(act, locked = false) {
    const d = this.data;
    const shelves = [
      ['guns', '🔫 Guns', (it) => isGun(it)],
      ['supplies', '🩹 Healing, armor & ammo', (it) => ['heal', 'armor', 'ammo', 'revive', 'warm', 'boost'].includes(ITEMS[it.id] && ITEMS[it.id].kind)],
      ['throw', '💣 Throwables', (it) => ITEMS[it.id] && ITEMS[it.id].kind === 'throw'],
      ['valuables', '💰 Valuables', (it) => ITEMS[it.id] && ITEMS[it.id].kind === 'valuable'],
      ['other', '🔑 Other', () => true],
    ];
    const used = new Set();
    const out = [];
    for (const [key, label, test] of shelves) {
      const list = [];
      d.stash.items.forEach((it, i) => { if (!used.has(i) && test(it)) { used.add(i); list.push({ it, i }); } });
      if (!list.length) continue;
      list.sort((x, y) => (itemInfo(y.it).rarity || 0) - (itemInfo(x.it).rarity || 0) || itemInfo(y.it).value - itemInfo(x.it).value);
      const worth = list.reduce((n, x) => n + itemInfo(x.it).value, 0);
      const sell = key === 'valuables' ? `<button class="btn shelfsell" data-act="sellvaluables">Sell all · 🪙 ${fmt(worth)}</button>` : '';
      const note = key === 'valuables' && act === 'pack' ? '<small class="shelfnote">Valuables are only worth chips: sell them at the Fence (or right here).</small>' : '';
      const cards = list.map(({ it, i }) => this.itemCard(it, locked && act === 'pack' ? 'freelocked' : act, i, act === 'sell' ? `<span class="price">Sell 🪙${fmt(itemInfo(it).value)}</span>` : '')).join('');
      out.push(`<div class="shelf s-${key}"><div class="shelfhead"><b>${label}</b><small>${list.length} · worth 🪙 ${fmt(worth)}</small>${sell}</div>${note}<div class="grid">${cards}</div></div>`);
    }
    return out.join('') || '<p class="hint">Your stash is empty. Go raid!</p>';
  }

  // Today's guns: six offers that change every day (the same for everyone on that day).
  armory(lv = levelInfo(this.data.xp).level) {
    const cap = armoryRarity(lv);
    const day = new Date().toISOString().slice(0, 10);
    let seed = Number(day.replace(/-/g, ''));
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const kinds = Object.keys(WEAPONS).filter((k) => k !== 'fists');
    const offers = [];
    for (let i = 0; i < 6; i++) {
      const kind = kinds[Math.floor(rnd() * kinds.length)];
      const r = rnd();
      const rolled = i === 5 ? (r < 0.35 ? 3 : 2) : r < 0.5 ? 0 : r < 0.82 ? 1 : 2;
      const rarity = Math.min(rolled, cap);
      const gun = makeGun(kind, rarity);
      // Way more than the Fence pays: the Armory is for when you really want a gun, not a deal.
      const price = Math.max(250, Math.round((itemInfo(gun).value * (3.5 + rarity * 0.5)) / 50) * 50);
      offers.push({ gun, price });
    }
    return { day, offers };
  }

  // The Shop: guns, supplies, insurance, looks and backpacks. Somewhere to put all those chips.
  renderShop() {
    const d = this.data;
    const lv = levelInfo(d.xp).level;
    const chips = d.stash.chips;
    const sec = ['armory', 'supplies', 'looks', 'bags'].includes(this.shopSec) ? this.shopSec : 'armory';
    const tabs = [['armory', `🔫 Armory${lv < ARMORY_LEVEL ? ' 🔒' : ''}`], ['supplies', '🎒 Supplies'], ['looks', '✨ Looks'], ['bags', '👜 Backpacks']]
      .map(([k, l]) => `<button class="subtab ${sec === k ? 'on' : ''}" data-act="shopsec" data-s="${k}">${l}</button>`).join('');
    const lockCard = (icon, name, why) => `<div class="shopcard locked"><span class="sicon">${icon}</span><b>${name}</b><span class="lockd">🔒 ${why}</span></div>`;
    let body = '';
    if (sec === 'armory') {
      const ladder = `<div class="ladder">${ARMORY_STOCK.map(([l, n]) => `<span class="${lv >= l ? 'done' : ''}">Lv ${l}: ${n} guns</span>`).join('')}${ARMORY_RARITY.map(([l, r]) => `<span class="${lv >= l ? 'done' : ''}">Lv ${l}: ${['', 'Rares', 'Epics', 'Legendaries'][r]}</span>`).join('')}</div>`;
      if (lv < ARMORY_LEVEL) {
        body = `<div class="shoplock"><span>🔒</span><div><b>The Armory opens at level ${ARMORY_LEVEL}</b><small>You're level ${lv}. Raid, extract and bust machines to level up. Once it's open, it stocks more guns and better rarities as you climb.</small></div></div>${ladder}`;
      } else {
        const { day, offers } = this.armory(lv);
        const stock = armoryStock(lv);
        const bought = d.shopDay && d.shopDay.day === day ? d.shopDay.bought : [];
        const next = ARMORY_STOCK.find(([l]) => l > lv);
        body = `<p class="hint">New guns every day, one of each, and they don't come cheap. Level up to stock more of them and better rarities.</p>${ladder}<div class="shopgrid">${offers.map((o, i) => {
          if (i >= stock) return lockCard('🔫', 'More stock', `Level ${(ARMORY_STOCK.find(([, n]) => n > i) || [99])[0]}`);
          const info = itemInfo(o.gun);
          const gone = bought.includes(i);
          return `<div class="shopcard r${info.rarity} ${gone ? 'locked' : ''}"><span class="sicon">${iconHtml(o.gun)}</span><b style="color:${info.css}">${escapeHtml(info.name)}</b><small>Fence value 🪙 ${fmt(info.value)}</small>
            ${gone ? '<span class="own">SOLD OUT</span>' : `<button class="btn" data-act="buygun" data-i="${i}" ${chips < o.price ? 'disabled' : ''}>BUY · 🪙 ${fmt(o.price)}</button>`}</div>`;
        }).join('')}</div>${next ? '' : '<p class="hint">Fully stocked. Nice.</p>'}`;
      }
    } else if (sec === 'supplies') {
      body = `<p class="hint">Stock up before a raid. It all goes to your stash. More supplies unlock as you level up.</p><div class="shopgrid">${SUPPLIES.map(([id, price, need]) => {
        const it = ITEMS[id];
        if (lv < need) return lockCard(it.icon, it.name, `Level ${need}`);
        return `<div class="shopcard"><span class="sicon">${it.icon}</span><b>${it.name}</b><small>${escapeHtml(it.desc).slice(0, 70)}${it.desc.length > 70 ? '…' : ''}</small>
          <button class="btn" data-act="buyitem" data-id="${id}" ${chips < price ? 'disabled' : ''}>BUY · 🪙 ${fmt(price)}</button></div>`;
      }).join('')}</div>`;
    } else if (sec === 'looks') {
      const items = [];
      for (const [part, label] of LOOK_PARTS) for (const o of LOOKS[part]) if (o.unlock && o.unlock.buy) items.push({ part, label, o });
      body = `<p class="hint">Looks you can only get here, once you've earned the right. Buy once, wear forever (Look tab).</p><div class="shopgrid">${items.map(({ part, label, o }) => {
        const owned = !!(d.owned && d.owned[String(o.id)]);
        const icon = part === 'color' ? `<span class="swatchbig" style="background:${hex(o.id)}"></span>` : o.icon;
        const why = shopLookLock(o, d);
        if (!owned && why) return lockCard(icon, o.name, why);
        return `<div class="shopcard ${owned ? 'owned' : ''}"><span class="sicon">${icon}</span><b>${o.name}</b><small>${label}</small>
          ${owned ? '<span class="own">✓ OWNED</span>' : `<button class="btn" data-act="buylook" data-id="${o.id}" ${chips < o.unlock.buy ? 'disabled' : ''}>BUY · 🪙 ${fmt(o.unlock.buy)}</button>`}</div>`;
      }).join('')}</div>`;
    } else {
      body = this.renderBags(d.bag || 0);
    }
    return `<h3>🛒 Shop <small class="bank">Bank: 🪙 ${fmt(chips)} · Level ${lv}</small></h3><div class="subtabs shoptabs">${tabs}</div>${body}`;
  }

  renderBags(lv) {
    const d = this.data;
    const tiers = [{ name: 'Starter Backpack', icon: '🎒', slots: 0, cost: 0 }, ...BAG_UPGRADES];
    const cards = tiers.map((u, i) => {
      const owned = i <= lv;
      const next = i === lv + 1;
      const slots = BACKPACK_SLOTS + bagBonus(i);
      return `<div class="shopcard ${owned ? 'owned' : next ? 'next' : 'locked'}">
        <span class="sicon">${u.icon}</span><b>${u.name}</b><small>${slots} backpack slots${pocketSlots(i) ? ` · 🔒 ${pocketSlots(i)} Safe Pocket${pocketSlots(i) > 1 ? 's' : ''}` : ''}</small>
        ${owned ? `<span class="own">${i === lv ? '✓ WEARING' : '✓ OWNED'}</span>`
          : next ? `<button class="btn" data-act="bagup" ${d.stash.chips < u.cost ? 'disabled' : ''}>BUY · 🪙 ${fmt(u.cost)}</button>`
            : `<span class="lockd">🔒 🪙 ${fmt(u.cost)}</span>`}</div>`;
    }).join('');
    return `<p class="hint">Backpack upgrades are yours for good, even if you die: more room for loot in every raid. Any bought backpack also gets a <b>🔒 Safe Pocket</b>: whatever you put in it comes home even if you die. (Not with the free loadout. Bring your own gun.)</p><div class="shopgrid">${cards}</div>`;
  }

  renderFence() {
    const d = this.data;
    const valuables = d.stash.items.filter((it) => !isGun(it) && ITEMS[it.id].kind === 'valuable');
    const total = valuables.reduce((n, it) => n + itemInfo(it).value, 0);
    return `<h3>The Fence</h3><p class="hint">Sells anything for its full value in chips. No questions asked.</p>
      <p class="hint">Stash worth 🪙 ${fmt(d.stash.items.reduce((n, it) => n + itemInfo(it).value, 0))}${valuables.length ? ` · valuables 🪙 ${fmt(total)}` : ''}. Click anything to sell it.</p>
      ${this.stashSections('sell')}`;
  }

  // ---------- Look ----------

  renderLook() {
    const d = this.data;
    const look = wornLook(d.look);
    const opts = LOOKS[this.lookPart];
    const tabs = LOOK_PARTS.map(([p, label]) => {
      const total = LOOKS[p].length;
      const open = LOOKS[p].filter((o) => lookUnlocked(o)).length;
      return `<button class="subtab ${this.lookPart === p ? 'on' : ''}" data-act="lookpart" data-p="${p}">${label} <small>${open}/${total}</small></button>`;
    }).join('');
    const swatch = this.lookPart === 'color' || this.lookPart === 'shoes';
    const grid = opts.map((o) => {
      const open = lookUnlocked(o);
      const on = look[this.lookPart] === o.id;
      const face = swatch ? `<span class="sw" style="background:${hex(o.id)}"></span>` : `<span class="oi">${o.icon}</span>`;
      return `<button class="lookopt ${on ? 'on' : ''} ${open ? '' : 'locked'}" data-act="lookopt" data-p="${this.lookPart}" data-id="${o.id}" title="${escapeHtml(open ? o.name : `🔒 ${unlockText(o)}`)}">
        ${face}<b>${escapeHtml(o.name)}</b>${open ? '' : `<small>🔒 ${escapeHtml(unlockText(o))}</small>`}</button>`;
    }).join('');
    return `<div class="lookwrap">
      <div class="lookstage"><div id="lookSlot" class="lookslot"></div>
        <input id="lookName" maxlength="14" placeholder="Your name" value="${escapeHtml(d.look.name || '')}">
        <div class="row"><button class="btn ghost" data-act="lookrandom">🎲 Randomize</button></div>
        <p class="hint">Drag to spin. Level up and earn achievements to unlock more.</p></div>
      <div class="lookopts"><div class="subtabs">${tabs}</div><div class="optgrid ${swatch ? 'swatches' : ''}">${grid}</div></div>
    </div>`;
  }

  // ---------- Records: stats, achievements, collection ----------

  renderRecords() {
    const tabs = [['overview', '📊 Overview'], ['achievements', '🏆 Achievements'], ['collection', '📖 Collection']]
      .map(([k, n]) => `<button class="subtab ${this.recTab === k ? 'on' : ''}" data-act="rectab" data-r="${k}">${n}</button>`).join('');
    const body = { overview: () => this.renderOverview(), achievements: () => this.renderAchievements(), collection: () => this.renderCollection() }[this.recTab]();
    return `<div class="subtabs">${tabs}</div>${body}`;
  }

  renderOverview() {
    const d = this.data;
    const s = d.stats;
    const lv = levelInfo(d.xp);
    const col = collectionProgress(d);
    const achDone = ACHIEVEMENTS.filter((a) => d.achievements[a.id]).length;
    const rate = s.extracts + s.deaths ? Math.round((s.extracts / (s.extracts + s.deaths)) * 100) : 0;
    const mins = Math.round(s.timePlayed / 60);
    // The rarest thing you've ever extracted.
    const found = collectionEntries().filter((e) => d.collection[e.key]).sort((a, b) => b.rarity - a.rarity || (b.kind ? 1 : 0) - (a.kind ? 1 : 0));
    const best = found[0];
    const bestHtml = best ? `<span style="color:${best.css}">${best.kind ? `<img class="gicon" src="${gunIcon(best.kind, best.rarity) || ''}" alt="">` : best.icon} ${escapeHtml(best.name)}</span>` : 'Nothing yet';
    // The next look you'll unlock by leveling.
    const next = Object.values(LOOKS).flat().filter((o) => o.unlock && o.unlock.level > lv.level).sort((a, b) => a.unlock.level - b.unlock.level)[0];
    const tile = (icon, label, value) => `<div class="stat-tile"><span>${icon}</span><b>${value}</b><small>${label}</small></div>`;
    return `<div class="overview">
      <div class="levelcard"><div class="biglvl">${lv.level}</div><div class="lvbody"><b>Level ${lv.level}</b>
        <div class="xpbar big"><i style="width:${(lv.frac * 100).toFixed(1)}%"></i></div>
        <small>${fmt(lv.into)} / ${fmt(lv.need)} XP to level ${lv.level + 1}${next ? ` · next unlock at level ${next.unlock.level}: ${next.icon || '🎨'} ${escapeHtml(next.name)}` : ''}</small>
        <small>Earn XP by extracting (bigger hauls pay more), busting machines and raiders, and unlocking achievements.</small></div></div>
      <div class="goalrow">
        <button class="goal" data-act="rectab" data-r="collection"><b>📖 Collection</b><span class="xpbar"><i style="width:${((col.found / col.total) * 100).toFixed(1)}%"></i></span><small>${col.found} / ${col.total} found</small></button>
        <button class="goal" data-act="rectab" data-r="achievements"><b>🏆 Achievements</b><span class="xpbar"><i style="width:${((achDone / ACHIEVEMENTS.length) * 100).toFixed(1)}%"></i></span><small>${achDone} / ${ACHIEVEMENTS.length} unlocked</small></button>
        <div class="goal"><b>💎 Rarest find</b><div class="rarest">${bestHtml}</div></div>
      </div>
      <h3>Raiding</h3>
      <div class="stat-tiles">
        ${tile('🎲', 'Raids', fmt(s.raids))}${tile('🚁', 'Extracts', fmt(s.extracts))}${tile('💀', 'Deaths', fmt(s.deaths))}${tile('📈', 'Survival rate', `${rate}%`)}
        ${tile('💰', 'Best haul', `🪙 ${fmt(s.bestHaul)}`)}${tile('🏦', 'Total extracted', `🪙 ${fmt(s.totalHaul)}`)}${tile('🔧', 'Machines busted', fmt(s.machines))}${tile('🤠', 'Raiders busted', fmt(s.raiders))}
        ${tile('👑', 'Pit Bosses', fmt(s.bossKills))}${tile('🎯', 'Critical hits', fmt(s.crits))}${tile('🐊', 'Gators', fmt(s.gators))}${tile('💣', 'Throwables thrown', fmt(s.throws))}
        ${tile('📦', 'Containers searched', fmt(s.containers))}${tile('🎰', 'Raid slots pulled', fmt(s.slotPulls))}${tile('⏱️', 'Time in raids', `${mins} min`)}${tile('🗺️', 'Maps escaped', `${Object.keys(s.extractsByMap).length} / ${Object.keys(MAPS).filter((id) => !MAPS[id].tutorial).length}`)}
      </div>
      <h3>The Back Room</h3>
      <div class="stat-tiles">
        ${tile('🪙', 'Chips wagered', fmt(s.wagered))}${tile('🤑', 'Chips won', fmt(s.gambleWon))}${tile('📊', 'Net', `${s.gambleWon - s.wagered >= 0 ? '+' : ''}${fmt(s.gambleWon - s.wagered)}`)}${tile('💸', 'Biggest win', `🪙 ${fmt(s.biggestWin)}`)}
        ${tile('🎰', 'Reels pulled', fmt(s.reelsPulled))}${tile('🂡', 'Blackjacks', fmt(s.blackjacks))}${tile('🚀', 'Best Crash', `${s.crashBest.toFixed(2)}x`)}${tile('🟢', 'Green wins', fmt(s.rouletteGreens))}${tile('💎', 'Most Mines gems', fmt(s.minesBest))}${tile('🔴', 'Best Plinko hit', `${s.plinkoBest || 0}x`)}
      </div></div>`;
  }

  renderAchievements() {
    const d = this.data;
    const groups = [...new Set(ACHIEVEMENTS.map((a) => a.group))];
    const rewardsFor = (id) => Object.values(LOOKS).flat().filter((o) => o.unlock && o.unlock.ach === id);
    return groups.map((g) => `<h3>${g}</h3><div class="achgrid">${ACHIEVEMENTS.filter((a) => a.group === g).map((a) => {
      const done = !!d.achievements[a.id];
      const [cur, goal] = a.prog(d);
      const pct = Math.min(100, (cur / goal) * 100);
      const rewards = rewardsFor(a.id);
      return `<div class="ach t${a.tier} ${done ? 'done' : 'locked'}">
        <span class="ic">${done ? a.icon : '🔒'}</span>
        <div class="ab"><b>${escapeHtml(a.name)}</b><small class="tier">${TIER_NAMES[a.tier]}</small>
          <p>${escapeHtml(a.desc)}</p>
          ${done ? `<small class="when">✓ Unlocked ${new Date(d.achievements[a.id]).toLocaleDateString()}</small>`
    : `<span class="xpbar"><i style="width:${pct.toFixed(1)}%"></i></span><small>${fmt(Math.min(cur, goal))} / ${fmt(goal)}</small>`}
          ${rewards.length ? `<small class="reward">🎨 Unlocks: ${rewards.map((o) => escapeHtml(o.name)).join(', ')}</small>` : ''}
        </div></div>`;
    }).join('')}</div>`).join('');
  }

  renderCollection() {
    const d = this.data;
    const entries = collectionEntries();
    const col = collectionProgress(d);
    const rarities = ['Common', 'Rare', 'Epic', 'Legendary'];
    const gunRows = GUN_KINDS.map((kind) => {
      const cells = [0, 1, 2, 3].map((r) => {
        const e = entries.find((x) => x.key === `gun:${kind}:${r}`);
        const n = d.collection[e.key] || 0;
        const src = gunIcon(kind, r);
        return `<div class="colcell r${r} ${n ? 'found' : 'missing'}" title="${escapeHtml(`${e.name}\n${e.hint}`)}">
          ${src ? `<img src="${src}" alt="">` : '🔫'}<small>${n ? `×${n}` : '???'}</small></div>`;
      }).join('');
      return `<div class="colrow"><b>${escapeHtml(entries.find((x) => x.key === `gun:${kind}:0`).name)}</b>${cells}</div>`;
    }).join('');
    const itemCells = (group) => entries.filter((e) => e.group === group).sort((a, b) => a.rarity - b.rarity).map((e) => {
      const n = d.collection[e.key] || 0;
      return `<div class="colitem r${e.rarity} ${n ? 'found' : 'missing'}" title="${escapeHtml(e.hint)}">
        <span class="ic">${n ? e.icon : '❔'}</span><b style="${n ? `color:${e.css}` : ''}">${escapeHtml(e.name)}</b><small>${n ? `Found ×${n}` : escapeHtml(e.hint)}</small></div>`;
    }).join('');
    return `<div class="colhead"><div><b>${col.found} / ${col.total}</b> found</div><div class="xpbar big"><i style="width:${((col.found / col.total) * 100).toFixed(1)}%"></i></div>
      <p class="hint">Everything you've ever extracted (or won in the Back Room). Legendaries only drop in deadly zones: the casinos, the vaults, Area 52, the Observatory and Marie's Mansion. Hover anything to see where to look.</p></div>
      <h3>Guns</h3><div class="colguns"><div class="colrow head"><span></span>${rarities.map((r, i) => `<span class="r${i}">${r}</span>`).join('')}</div>${gunRows}</div>
      <h3>Valuables</h3><div class="colitems">${itemCells('Valuables')}</div>
      <h3>Gear</h3><div class="colitems">${itemCells('Gear')}</div>`;
  }

  // Cloud save account: name + PIN, so your progress follows you and shows on the leaderboard.
  renderAccount() {
    const u = cloud.user;
    if (u) {
      const when = cloud.syncedAt ? `last saved ${new Date(cloud.syncedAt).toLocaleTimeString()}` : 'syncing…';
      return `<section class="account in"><b>☁️ Cloud save: ${escapeHtml(u.name)}</b>
        <small>${cloud.status && cloud.status !== 'saved' ? `⚠️ ${escapeHtml(cloud.status)}` : `Your progress saves to the server automatically (${when}). Log in with the same name and PIN on any device.`}</small>
        ${cloud.storage === 'file' ? '<small class="warn">⚠️ The game server has no database set up, so it forgets accounts when it restarts. This device puts yours back automatically.</small>' : ''}
        <div class="prow"><button class="btn ghost" data-act="cloudsync">Save now</button><button class="btn ghost" data-act="cloudout">Log out</button></div></section>`;
    }
    const last = cloud.lastName();
    return `<section class="account"><b>☁️ Cloud save</b>
      <small>${last ? `Last played as <b>${escapeHtml(last)}</b>. Log in to load your cloud save.` : 'You\'re playing as a guest: progress saves on this device only. Make an account to keep it if you switch computers, and to show up on the 👑 leaderboard.'}</small>
      <div class="prow"><button class="btn" data-act="auth" data-mode="in">Log in</button><button class="btn ghost" data-act="auth" data-mode="reg">Create account</button></div></section>`;
  }

  // ---------- daily contracts ----------

  renderContracts() {
    const cs = contracts();
    const d = this.data;
    const diff = ['Easy', 'Medium', 'Hard'];
    const cards = cs.list.map((c, i) => {
      const v = contractView(c, d);
      const pct = Math.round((v.cur / v.goal) * 100);
      const btn = v.claimed ? '<span class="ctdone">✓ Claimed</span>'
        : v.done ? `<button class="btn ctclaim" data-act="claimct" data-i="${i}">CLAIM</button>`
          : !cs.rerolled ? `<button class="ctreroll" data-act="rerollct" data-i="${i}" title="Swap this one for a different contract (one free swap a day)">🎲</button>` : '';
      return `<div class="ctcard t${v.tier} ${v.done && !v.claimed ? 'ready' : ''} ${v.claimed ? 'claimed' : ''}">
        <span class="cticon">${v.icon}</span>
        <div class="ctbody"><small class="ctdiff">${diff[v.tier]}</small><b>${escapeHtml(v.text)}</b>
          <div class="ctbar"><i style="width:${pct}%"></i><span>${fmt(v.cur)} / ${fmt(v.goal)}</span></div>
          <small class="ctrew">🪙 ${fmt(v.chips)} · ⭐ ${v.xp} XP</small></div>${btn}</div>`;
    }).join('');
    return `<section class="contracts"><div class="cthead"><b>📋 Daily Contracts</b><small>New ones in ${resetsIn()}${cs.rerolled ? '' : ' · 🎲 one free swap today'}</small></div><div class="ctgrid">${cards}</div></section>`;
  }

  // ---------- title screen ----------

  showTitle() {
    this.renderTitle();
    $('title').hidden = false;
    document.body.classList.add('titleup');
  }

  closeTitle() {
    $('title').hidden = true;
    document.body.classList.remove('titleup');
    this.render();
  }

  renderTitle() {
    const d = this.data;
    const u = cloud.user;
    const last = cloud.lastName();
    const lv = levelInfo(d.xp);
    const name = (d.look.name || '').trim() || 'High Roller';
    $('titleBody').innerHTML = `
      <div class="titlechar"><div id="titleChar" class="titlecharslot"></div><div class="titletag"><b>${escapeHtml(name)}</b><span>LV ${lv.level} · 🪙 ${fmt(d.stash.chips)}</span></div></div>
      <div class="titlemain">
        <h1 class="logo titlelogo">BEAT THE<br>HOUSE</h1>
        <p class="tagline">Raid the casinos. Bust the Pit Boss. Get out rich, or lose it all.</p>
        <button class="btn big titleplay" data-act="titleplay">▶ PLAY</button>
        <button class="btn ghost titletut" data-act="titletut">🎓 ${d.tutorialDone ? 'Play the tutorial again' : 'How to play (5 min tutorial)'}</button>
        ${u
    ? `<p class="acctline in">☁️ Signed in as <b>${escapeHtml(u.name)}</b>. Your progress saves automatically.</p>`
    : `<div class="titleacct"><button class="btn" data-act="auth" data-mode="in">Log in</button><button class="btn ghost" data-act="auth" data-mode="reg">Create account</button></div>
          <p class="acctline">${last ? `Welcome back, <b>${escapeHtml(last)}</b>! Log in to load your cloud save.` : 'Playing as a guest saves on this device only. An account keeps your progress anywhere and puts you on the leaderboard.'}</p>`}
      </div>
      <small class="titlever">Build ${BUILD}</small>`;
    this.preview.setLook(wornLook(d.look), d.loadout.weapons.find(Boolean));
    this.preview.mount($('titleChar'));
  }

  // ---------- the sign-in window ----------

  openAuth(mode) {
    this.authMode = mode || (cloud.lastName() ? 'in' : 'reg');
    this.cloudError = '';
    if (this.cloudName === undefined || this.cloudName === null) this.cloudName = cloud.lastName() || '';
    this.renderAuth();
    $('authModal').hidden = false;
    const first = $('cloudName') && !$('cloudName').value ? $('cloudName') : $('cloudPin');
    if (first) setTimeout(() => first.focus(), 30);
  }

  closeAuth() {
    $('authModal').hidden = true;
    this.cloudError = '';
  }

  // Remember what's typed so a re-render doesn't wipe it.
  keepAuthFields() {
    if ($('cloudName')) this.cloudName = $('cloudName').value;
    if ($('cloudPin')) this.cloudPin = $('cloudPin').value;
    if ($('cloudPin2')) this.cloudPin2 = $('cloudPin2').value;
  }

  renderAuth() {
    const u = cloud.user;
    const card = $('authCard');
    if (u) {
      const when = cloud.syncedAt ? `last saved ${new Date(cloud.syncedAt).toLocaleTimeString()}` : 'syncing…';
      card.innerHTML = `<button class="authx" data-act="authclose" title="Close">✕</button>
        <h2>☁️ ${escapeHtml(u.name)}</h2>
        <p class="hint">You're signed in. Your progress saves to the server automatically (${when}). Log in with the same name and PIN on any device.</p>
        ${cloud.status && cloud.status !== 'saved' ? `<p class="autherr">⚠️ ${escapeHtml(cloud.status)}</p>` : ''}
        <div class="resbtns"><button class="btn" data-act="authclose">Done</button><button class="btn ghost" data-act="cloudsync">Save now</button><button class="btn ghost" data-act="cloudout">Log out</button></div>`;
      return;
    }
    const reg = this.authMode === 'reg';
    const busy = this.cloudBusy;
    const pinType = this.pinShown ? 'text' : 'password';
    card.innerHTML = `<button class="authx" data-act="authclose" title="Close">✕</button>
      <h2>${reg ? 'Create your account' : 'Welcome back'}</h2>
      <div class="authtabs"><button class="${reg ? '' : 'on'}" data-act="authtab" data-mode="in">Log in</button><button class="${reg ? 'on' : ''}" data-act="authtab" data-mode="reg">Create account</button></div>
      <p class="hint">${reg ? 'Pick a name and a PIN. Your progress (chips, stash, looks, level) saves to it, so you can play on any device and show up on the 👑 leaderboard.' : 'Log in with your name and PIN to load your cloud save onto this device.'}</p>
      <label class="field"><span>Name</span><input id="cloudName" maxlength="16" placeholder="Your name" autocomplete="username" value="${escapeHtml(this.cloudName || '')}"></label>
      <label class="field"><span>PIN <small>4-8 numbers</small></span><span class="pinrow"><input id="cloudPin" maxlength="8" placeholder="••••" inputmode="numeric" pattern="[0-9]*" type="${pinType}" autocomplete="${reg ? 'new-password' : 'current-password'}" value="${escapeHtml(this.cloudPin || '')}"><button class="btn ghost pinshow" data-act="pinshow" title="${this.pinShown ? 'Hide' : 'Show'} PIN">${this.pinShown ? '🙈' : '👁️'}</button></span></label>
      ${reg ? `<label class="field"><span>PIN again</span><input id="cloudPin2" maxlength="8" placeholder="••••" inputmode="numeric" pattern="[0-9]*" type="${pinType}" autocomplete="new-password" value="${escapeHtml(this.cloudPin2 || '')}"></label>` : ''}
      ${this.cloudError ? `<p class="autherr">⚠️ ${escapeHtml(this.cloudError)}</p>` : ''}
      ${busy && cloudNet.waking ? '<p class="authwait">⏳ Waking up the server. Free servers nap when nobody\'s playing, so this can take up to a minute…</p>' : ''}
      <button class="btn big authgo" data-act="authgo" ${busy ? 'disabled' : ''}>${busy ? (reg ? 'Creating…' : 'Logging in…') : reg ? 'CREATE ACCOUNT' : 'LOG IN'}</button>
      <p class="dim">${reg ? 'Write your PIN down: there\'s no email to reset it. Whatever you\'ve got on this device comes with you.' : 'Logging in replaces the progress on this device with your cloud save.'}</p>
      ${cloud.storage === 'file' ? '<p class="dim warn">⚠️ The game server has no database yet, so it can forget accounts when it restarts. This device puts yours back automatically.</p>' : ''}`;
  }

  // Richest players everywhere.
  renderLeaders() {
    const b = this.board;
    if (!b || b.by !== this.boardBy) this.loadBoard();
    const me = cloud.user && cloud.user.name.toLowerCase();
    const rows = b && b.rows ? b.rows.map((r, i) => `<tr class="${me && r.name.toLowerCase() === me ? 'me' : ''}"><td class="rk">${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</td><td>${escapeHtml(r.name)}</td><td>LV ${r.level}</td>
      <td class="num">🪙 ${fmt(r.chips)}</td><td class="num">💰 ${fmt(r.worth)}</td></tr>`).join('') : '';
    return `<h3>👑 High Rollers</h3>
      <div class="subtabs"><button class="subtab ${this.boardBy === 'worth' ? 'on' : ''}" data-act="boardby" data-by="worth">Net worth</button><button class="subtab ${this.boardBy === 'chips' ? 'on' : ''}" data-act="boardby" data-by="chips">Chips</button><button class="subtab" data-act="boardrefresh">↻ Refresh</button></div>
      <p class="hint">Net worth is your chips plus everything in your stash at Fence prices.${cloud.user ? '' : ' <b>Make an account (the 👤 Guest button up top) to get on the board.</b>'}</p>
      ${b && b.error ? `<p class="hint">⚠️ Couldn't reach the leaderboard: ${escapeHtml(b.error)}</p>` : ''}
      ${!b ? `<p class="hint">${cloudNet.waking ? '⏳ Waking up the server. Free servers nap when nobody\'s playing, so this can take up to a minute…' : 'Loading…'}</p>` : rows ? `<table class="board"><tr><th></th><th>Player</th><th>Level</th><th class="num">Chips</th><th class="num">Net worth</th></tr>${rows}</table>` : (b.error ? '' : '<p class="hint">Nobody on the board yet. Be the first!</p>')}`;
  }

  async loadBoard() {
    if (this.boardLoading) return;
    this.boardLoading = true;
    const by = this.boardBy;
    try { this.board = await cloud.leaderboard(by); } catch (e) { this.board = { by, error: e.message }; }
    this.boardLoading = false;
    if (this.tab === 'leaders' && !$('hub').hidden) this.render();
  }

  async cloudAction(kind) {
    if (this.cloudBusy) return;
    this.keepAuthFields();
    const name = (this.cloudName || '').trim();
    const pin = (this.cloudPin || '').trim();
    this.cloudError = '';
    const fail = (msg) => { this.cloudError = msg; this.renderAuth(); };
    if (!/^[A-Za-z0-9 _-]{3,16}$/.test(name)) { fail('Pick a name that\'s 3-16 letters or numbers (spaces, - and _ are fine).'); return; }
    if (!/^\d{4,8}$/.test(pin)) { fail('Your PIN has to be 4-8 numbers (no letters).'); return; }
    if (kind === 'reg' && (this.cloudPin2 || '').trim() !== pin) { fail('The two PINs don\'t match.'); return; }
    this.cloudBusy = kind;
    this.renderAuth();
    try {
      if (kind === 'reg') { await cloud.register(name, pin); this.toast(`☁️ Account made. Your progress is saved as ${name}.`); }
      else { await cloud.login(name, pin); this.toast(`☁️ Welcome back, ${cloud.user.name}! Cloud save loaded.`); }
      this.board = null;
      if (this.onSettings) this.onSettings();
      this.cloudPin = '';
      this.cloudPin2 = '';
      this.cloudBusy = null;
      this.closeAuth();
      if (!$('title').hidden) this.renderTitle();
      this.render();
      return;
    } catch (e) { this.cloudError = e.message; }
    this.cloudBusy = null;
    this.renderAuth();
    this.render();
  }

  renderSettings() {
    const s = this.data.settings;
    return `${this.renderAccount()}<section class="account"><b>🎓 Tutorial</b><small>A guided 5-minute run through the basics on the Training Floor. Nothing to lose.</small><div class="prow"><button class="btn" data-act="tutorial">🎓 Play the tutorial${this.data.tutorialDone ? ' again' : ''}</button></div></section><h3>Settings</h3>
      <label class="slider">Mouse sensitivity <b id="sensVal">${s.sensitivity.toFixed(2)}x</b><input type="range" id="sens" min="0.1" max="3" step="0.05" value="${s.sensitivity}"></label>
      <label class="slider">Field of view <b id="fovVal">${s.fov}°</b><input type="range" id="fov" min="60" max="100" step="1" value="${s.fov}"></label>
      <label class="slider">Volume <b id="volVal">${Math.round(s.volume * 100)}%</b><input type="range" id="vol" min="0" max="1" step="0.05" value="${s.volume}"></label>
      <label class="slider">Music <b id="musVal">${Math.round((s.music ?? 0.45) * 100)}%</b><input type="range" id="mus" min="0" max="1" step="0.05" value="${s.music ?? 0.45}"></label>
      <div class="qrow"><span>Voice chat</span>${['off', 'ptt', 'open'].map((v) => `<button class="subtab ${(s.voice || 'off') === v ? 'on' : ''}" data-act="voice" data-v="${v}">${{ off: 'Off', ptt: `Push to talk (${keyName('talk')})`, open: 'Open mic' }[v]}</button>`).join('')}</div>
      <p class="hint">Talk to your party. In a raid, voices get quieter with distance (and anyone close enough can hear you, enemies too). Your browser will ask for the microphone.</p>
      <div class="qrow"><span>Tutorial tips</span>${['auto', 'on', 'off'].map((t) => `<button class="subtab ${(s.tutorial || 'auto') === t ? 'on' : ''}" data-act="tutorial" data-t="${t}">${{ auto: 'First 3 raids', on: 'Always', off: 'Off' }[t]}</button>`).join('')}</div>
      <div class="qrow"><span>Graphics</span>${['auto', 'low', 'medium', 'high'].map((q) => `<button class="subtab ${(s.quality || 'auto') === q ? 'on' : ''}" data-act="quality" data-q="${q}">${q === 'auto' ? 'Auto' : QUALITY[q].label}</button>`).join('')}</div>
      <p class="hint">Lower graphics if the game stutters, especially if you lead a party (your computer runs the world for everyone). Auto lowers it for you when frames get slow.</p>
      <h3>Controls</h3>
      <div id="hubBinds">${renderBinds()}</div>
      <button class="btn ghost" data-act="reset">${this.armedReset ? 'Click again to wipe ALL progress' : 'Reset progress'}</button>`;
  }

  // ---------- the Back Room ----------

  renderBackRoom() {
    const d = this.data;
    const rail = GAMES.map(([k, icon, name, tag]) => `<button class="gamecard ${this.game === k ? 'on' : ''}" data-act="game" data-g="${k}">
      <span class="gi">${icon}</span><span><b>${name}</b><small>${tag}</small></span></button>`).join('');
    const net = this.session;
    const recent = this.history.slice(-8).reverse().map((h) => `<span class="${h.net > 0 ? 'win' : h.net < 0 ? 'loss' : ''}">${h.icon} ${h.net > 0 ? '+' : ''}${fmt(h.net)}</span>`).join('');
    const stage = {
      slots: () => this.renderReels(), blackjack: () => this.renderBlackjack(), roulette: () => this.renderRoulette(), crash: () => this.renderCrash(), mines: () => this.renderMines(), plinko: () => this.renderPlinko(),
    }[this.game]();
    return `<div class="backroom">
      <aside class="gamerail">${rail}
        ${this.renderMob()}
        <div class="session"><small>This<br>session</small><b class="${net > 0 ? 'win' : net < 0 ? 'loss' : ''}">${net > 0 ? '+' : ''}${fmt(net)}</b><small>Stash 🪙 ${fmt(d.stash.chips)}</small></div>
      </aside>
      <section class="table split">${stage.replace('<!--recent-->', recent ? `<div class="recent"><small>Recent</small>${recent}</div>` : '')}</section>
    </div>`;
  }

  // The Mob: hold to borrow, or pay back what you owe.
  renderMob() {
    const owe = mobDebt();
    if (owe) {
      const can = this.data.stash.chips >= owe;
      return `<div class="mob owing" title="Go into a raid still owing them and they'll come for you."><span>🤌 You owe the Mob <b>🪙 ${fmt(owe)}</b></span>
        <button class="btn tiny ${can ? 'green' : ''}" data-act="mobpay" ${can ? '' : 'disabled'}>Pay back</button></div>`;
    }
    const asking = this.mobAsk && performance.now() - this.mobAsk < 8000;
    if (asking) {
      return `<div class="mob asking"><span>🤌 <b>Sure?</b> They'll lend 🪙 ${MOB_MIN}–${fmt(MOB_MAX)} at 50–150% interest. Go into a raid owing them and they kidnap you.</span>
        <button class="btn tiny green" data-act="mobyes">Take the money</button><button class="btn tiny" data-act="mobno">No thanks</button></div>`;
    }
    return `<button class="mob borrow" data-act="mobask" title="The Mob spots you anywhere from ${MOB_MIN} to ${fmt(MOB_MAX)} chips, at 50% to 150% interest (the bigger the loan, the worse it gets). Pay it back before your next raid, or else.">
      🤌 Borrow from the Mob <small>🪙 ${MOB_MIN}–${fmt(MOB_MAX)}</small></button>`;
  }

  // Every game: the game itself on the left, bets and buttons in a column on the right, so the
  // whole thing fits on the screen without scrolling.
  split(view, ctrl) {
    return `<div class="gview">${view}</div><aside class="gctrl">${ctrl}<!--recent--></aside>`;
  }

  betChips(disabled = false) {
    const lv = levelInfo(this.data.xp).level;
    return `<div class="betchips"><small>BET</small>${BETS.map((b) => {
      const need = BET_LEVEL[b] || 0;
      const locked = lv < need;
      return `<button class="cchip c${b} ${b === this.bet ? 'on' : ''} ${locked ? 'locked' : ''}" data-act="bet" data-b="${b}" ${disabled ? 'disabled' : ''} title="${locked ? `Unlocks at level ${need}` : ''}">${b >= 1000 ? `${b / 1000}K` : b}${locked ? `<i>LV${need}</i>` : ''}</button>`;
    }).join('')}</div>`;
  }

  renderReels() {
    const m = HUB_SLOTS[this.machine];
    const r = this.reels;
    const running = r && r.running;
    const machines = HUB_SLOTS.map((mc, i) => {
      const odds = reelOdds(mc.tier);
      return `<button class="machine m${i} ${this.machine === i ? 'on' : ''}" data-act="machine" data-i="${i}" ${running ? 'disabled' : ''}>
        <b>${mc.name}</b><span>🪙 ${fmt(mc.cost)}</span><small>Epic ${odds.epic.toFixed(1)}% · Legendary ${odds.legendary.toFixed(1)}%</small></button>`;
    }).join('');
    const strips = r ? r.strips : [0, 1, 2].map(() => this.randomStrip(3));
    const reels = strips.map((strip, k) => `<div class="reel"><div class="strip" id="strip${k}" style="${r && r.animating ? '' : `transform:translateY(${-(strip.length - 3) * ROW}px)`}">${strip.map((s) => `<span>${s}</span>`).join('')}</div></div>`).join('');
    let prize = '<div class="prize empty">Three of a kind pays big: 🍒 1.5x · 🔔 Rare gun 3x · 7️⃣ Epic gun 6x · 💎 Legendary 25x. Every pull pays something.</div>';
    if (r && !r.running && r.prize) {
      const p = r.prize;
      const it = p.item;
      const info = it && itemInfo(it);
      const hit = REEL_HITS[p.hit] || REEL_HITS[0];
      const head = hit.sym && hit.sym !== 'item' ? `${hit.sym}${hit.sym}${hit.sym} · PAYS ${hit.x}x` : p.hit === 1 ? 'TWO COINS' : 'SO CLOSE';
      prize = `<div class="prize r${info ? info.rarity : 0}"><span class="pi">${it ? iconHtml(it, 'gicon big') : '🪙'}</span><div><small>${head}${r.isNew ? ' · NEW TO YOUR COLLECTION!' : ''}</small>
        ${it ? `<b style="color:${info.css}">${escapeHtml(info.name)}</b>` : ''}${p.chips ? `<b>${it ? '+ ' : ''}🪙 ${fmt(p.chips)} chips</b>` : ''}
        <small>${it ? `Worth 🪙 ${fmt(info.value)} · sent to your stash` : 'Paid out to your stash'}</small></div></div>`;
    }
    const big = r && !running && r.prize && r.prize.hit >= 3;
    return this.split(`<div class="cabinet m${this.machine} ${running ? 'spinning' : ''} ${big ? 'bigwin' : ''}">
        <div class="cabtop">${m.name.toUpperCase()}</div>
        <div class="reelwin">${reels}<div class="payline"></div></div>
      </div>`, `<div class="machines">${machines}</div>
        <button class="btn big spinbtn" data-act="pull" ${running ? 'disabled' : ''}>${running ? 'SPINNING…' : `PULL · 🪙 ${fmt(m.cost)}`}</button>${prize}`);
  }

  renderBlackjack() {
    const g = this.bj;
    const playing = g && g.state === 'play';
    const dealerVal = g ? (playing ? handValue([g.dealer[0]]) : handValue(g.dealer)) : '';
    const ghost = '<span class="pcard ghost"></span><span class="pcard ghost"></span>';
    const hands = g ? g.hands.map((h, i) => {
      const v = handValue(h.cards);
      const on = playing && i === g.active && g.hands.length > 1;
      const tag = h.result ? `<span class="hres ${h.result.cls}">${h.result.text}</span>` : '';
      return `<div class="hand ${on ? 'active' : ''} ${playing && i !== g.active && g.hands.length > 1 ? 'idle' : ''}">
        <span class="who">${g.hands.length > 1 ? `HAND ${i + 1}` : 'YOU'} <b>${v}</b> <small>🪙 ${fmt(h.bet)}${h.doubled ? ' · doubled' : ''}</small></span>
        <div class="cards">${h.cards.map((c, k) => cardHtml(c, false, k)).join('')}</div>${tag}</div>`;
    }).join('') : `<div class="hand"><span class="who">YOU</span><div class="cards">${ghost}</div></div>`;
    const h = playing ? g.hands[g.active] : null;
    const canSplit = h && h.cards.length === 2 && cardValue(h.cards[0]) === cardValue(h.cards[1]) && g.hands.length < 4 && !h.fromAces;
    const canDouble = h && h.cards.length === 2 && !h.fromAces;
    return this.split(`<div class="felt bjtable">
        <div class="hand"><span class="who">DEALER ${g ? `<b>${dealerVal}${playing ? ' + ?' : ''}</b>` : ''}</span><div class="cards">${g ? g.dealer.map((c, i) => cardHtml(c, playing && i === 1, i)).join('') : ghost}</div></div>
        <div class="felttext">BLACKJACK PAYS 3 TO 2 · DEALER PEEKS · STANDS ON 17</div>
        <div class="hands">${hands}</div>
      </div>`, `${playing ? '' : this.betChips()}
      <div class="row gbtns">${playing ? `<button class="btn" data-act="hit">Hit</button><button class="btn" data-act="stand">Stand</button>${canDouble ? `<button class="btn" data-act="double">Double · 🪙 ${fmt(h.bet)}</button>` : ''}${canSplit ? `<button class="btn split" data-act="split">✂️ Split · 🪙 ${fmt(h.bet)}</button>` : ''}`
    : `<button class="btn big" data-act="deal">DEAL · 🪙 ${fmt(this.bet)}</button>`}</div>
      ${g && g.msg ? `<p class="msg ${g.win ? 'win' : g.win === false ? 'loss' : ''}">${g.msg}</p>` : ''}
      <small class="shoenote">${shoe.decks}-deck shoe · ${shoe.left} cards left${g && g.shuffled ? ' · fresh shuffle' : shoe.reshuffle ? ' · shuffle next hand' : ''}</small>`);
  }

  renderRoulette() {
    const r = this.roulette;
    const seg = 360 / 37;
    const grad = WHEEL.map((n, i) => `${n === 0 ? '#16a34a' : RED.has(n) ? '#d62828' : '#1b0f2b'} ${(i * seg).toFixed(3)}deg ${((i + 1) * seg).toFixed(3)}deg`).join(', ');
    const labels = WHEEL.map((n, i) => `<span style="transform:rotate(${((i + 0.5) * seg).toFixed(2)}deg)"><i>${n}</i></span>`).join('');
    const angle = r ? r.angle : 0;
    const choices = [['red', 'Red', '2x'], ['black', 'Black', '2x'], ['odd', 'Odd', '2x'], ['even', 'Even', '2x'], ['green', 'Green 0', '14x']];
    return this.split(`<div class="wheelwrap"><div class="pointer">▼</div>
          <div class="rwheel" style="background:conic-gradient(${grad});transform:rotate(${angle}deg)">${labels}</div><div class="hubcap">${r && !r.spinning ? `<b class="${r.color}">${r.n}</b>` : '🎡'}</div></div>`,
    `${this.betChips(r && r.spinning)}
        <div class="rbets">${choices.map(([k, n, x]) => `<button class="rbet ${k}" data-act="spin" data-k="${k}" ${r && r.spinning ? 'disabled' : ''}><b>${n}</b><small>pays ${x}</small></button>`).join('')}</div>
      ${r && r.msg ? `<p class="msg ${r.won ? 'win' : 'loss'}">${r.msg}</p>` : '<p class="hint">Pick what to bet on. The wheel does the rest.</p>'}`);
  }

  renderMines() {
    const g = this.mines;
    const playing = g && g.running;
    const bombs = playing || g ? (g ? g.bombs : this.mineCount) : this.mineCount;
    const picks = g ? g.picks : 0;
    const mult = g ? minesMult(g.bombs, picks) : 1;
    const nextMult = minesMult(bombs, picks + 1);
    const tiles = Array.from({ length: 25 }, (_, i) => {
      const open = g && (g.revealed.has(i) || !g.running);
      const bomb = g && g.bombsAt.has(i);
      const cls = !g ? '' : g.revealed.has(i) ? (bomb ? 'boom' : 'gem') : !g.running ? (bomb ? 'bomb dim' : 'gem dim') : '';
      return `<button class="mtile ${cls}" data-act="mine" data-i="${i}" ${!playing || g.revealed.has(i) ? 'disabled' : ''}>${open ? (bomb ? '💣' : '💎') : ''}</button>`;
    }).join('');
    return this.split(`<div class="mgrid">${tiles}</div>`, `${playing ? '' : this.betChips()}
      ${playing ? '' : `<div class="minecount"><small>BOMBS</small>${MINE_COUNTS.map((n) => `<button class="subtab ${n === this.mineCount ? 'on' : ''}" data-act="minecount" data-n="${n}">${n}</button>`).join('')}</div>`}
        <div class="mside">
          <div class="mstat"><small>MULTIPLIER</small><b>${mult.toFixed(2)}x</b></div>
          <div class="mstat"><small>NEXT GEM</small><b>${nextMult.toFixed(2)}x</b></div>
          <div class="mstat"><small>${playing ? 'CASH OUT FOR' : 'BOMBS'}</small><b>${playing ? `🪙 ${fmt(Math.floor(g.bet * mult))}` : `💣 ${bombs}`}</b></div>
          ${playing
    ? `<button class="btn big cashout" data-act="minecash" ${picks ? '' : 'disabled'}>CASH OUT</button>`
    : `<button class="btn big" data-act="minestart">START · 🪙 ${fmt(this.bet)}</button>`}
        </div>
      ${g && g.msg ? `<p class="msg ${g.won ? 'win' : 'loss'}">${g.msg}</p>` : '<p class="hint">Find gems, dodge bombs. Every gem raises the multiplier.</p>'}`);
  }

  startMines() {
    if (this.mines && this.mines.running) return;
    if (!this.spend(this.bet)) return;
    const bombsAt = new Set();
    while (bombsAt.size < this.mineCount) bombsAt.add(Math.floor(Math.random() * 25));
    this.mines = { bet: this.bet, bombs: this.mineCount, bombsAt, revealed: new Set(), picks: 0, running: true, msg: '' };
    sfx.lever();
  }

  pickMine(i) {
    const g = this.mines;
    if (!g || !g.running || g.revealed.has(i)) return;
    g.revealed.add(i);
    if (g.bombsAt.has(i)) {
      g.running = false;
      g.won = false;
      g.msg = `💥 BOOM! Lost 🪙 ${fmt(g.bet)} after ${g.picks} gem${g.picks === 1 ? '' : 's'}.`;
      sfx.boom();
      this.settleBet('💎', g.bet, 0);
      return;
    }
    g.picks++;
    sfx.pickup();
    // Found every gem: auto cash out.
    if (g.picks === 25 - g.bombs) this.cashMines();
  }

  cashMines() {
    const g = this.mines;
    if (!g || !g.running || !g.picks) return;
    g.running = false;
    const win = Math.floor(g.bet * minesMult(g.bombs, g.picks));
    g.won = true;
    g.msg = `✅ Cashed out at ${minesMult(g.bombs, g.picks).toFixed(2)}x: won 🪙 ${fmt(win)}!`;
    this.earn(win);
    sfx.win();
    this.settleBet('💎', g.bet, win, (s) => { s.minesBest = Math.max(s.minesBest || 0, g.picks); });
  }

  renderPlinko() {
    const pl = this.plinko;
    const risks = ['low', 'medium', 'high'].map((r) => `<button class="subtab ${pl.risk === r ? 'on' : ''}" data-act="plinkorisk" data-r="${r}" ${pl.balls.length ? 'disabled' : ''}>${r[0].toUpperCase() + r.slice(1)}</button>`).join('');
    const last = pl.results.slice(-10).reverse().map((m) => `<span style="background:${bucketColor(m)}">${m}x</span>`).join('');
    return this.split(`<div class="plinko"><canvas id="plinkoBoard" width="${PW}" height="${PH}"></canvas><div class="plast">${last}</div></div>`,
      `${this.betChips()}
      <div class="minecount"><small>RISK</small>${risks}</div>
      <button class="btn big" data-act="plinkodrop">DROP · 🪙 ${fmt(this.bet)}</button>
      <p class="hint">Drop as many balls as you like. Edges pay big; the middle doesn't.</p>`);
  }

  dropPlinko() {
    if (!this.spend(this.bet)) return;
    const pl = this.plinko;
    // Decide the path up front: left or right at every row.
    const steps = Array.from({ length: PLINKO_ROWS }, () => (Math.random() < 0.5 ? 0 : 1));
    pl.balls.push({ bet: this.bet, risk: pl.risk, steps, t: 0, jitter: (Math.random() - 0.5) * 6 });
    sfx.tick();
    this.renderHeader();
    if (!pl.loop) this.plinkoLoop();
  }

  plinkoLoop() {
    const pl = this.plinko;
    let last = performance.now();
    pl.loop = true;
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      for (const b of pl.balls) {
        const before = Math.floor(b.t);
        b.t += dt * 7.5;
        if (Math.floor(b.t) !== before && b.t < PLINKO_ROWS) sfx.tick();
      }
      // Balls that reached the bottom pay out.
      for (const b of pl.balls.filter((x) => x.t >= PLINKO_ROWS + 0.6)) {
        const bucket = b.steps.reduce((n, st) => n + st, 0);
        const mult = PLINKO[b.risk][bucket];
        const win = Math.floor(b.bet * mult);
        if (win) this.earn(win);
        pl.results.push(mult);
        pl.flash[bucket] = 1;
        if (mult >= 3) sfx.win(); else if (mult < 1) sfx.deny();
        this.settleBet('🔴', b.bet, win, (st) => { st.plinkoBest = Math.max(st.plinkoBest || 0, mult); });
        if (this.tab === 'backroom' && this.game === 'plinko') {
          const el = document.querySelector('.plast');
          if (el) el.innerHTML = pl.results.slice(-10).reverse().map((m) => `<span style="background:${bucketColor(m)}">${m}x</span>`).join('');
          const ses = document.querySelector('.session b');
          if (ses) { ses.textContent = `${this.session > 0 ? '+' : ''}${fmt(this.session)}`; ses.className = this.session > 0 ? 'win' : this.session < 0 ? 'loss' : ''; }
        }
        this.renderHeader();
      }
      pl.balls = pl.balls.filter((x) => x.t < PLINKO_ROWS + 0.6);
      for (let i = 0; i < pl.flash.length; i++) pl.flash[i] = Math.max(0, (pl.flash[i] || 0) - dt * 2);
      this.drawPlinko();
      if (pl.balls.length || pl.flash.some((f) => f > 0)) requestAnimationFrame(tick);
      else {
        pl.loop = false;
        if (this.tab === 'backroom' && this.game === 'plinko') this.render();
      }
    };
    requestAnimationFrame(tick);
  }

  // Where a ball is: hop from gap to gap down the rows with a little bounce.
  plinkoPos(b) {
    const row = Math.min(PLINKO_ROWS, Math.floor(b.t));
    const f = Math.min(1, b.t - row);
    let rights = 0;
    for (let i = 0; i < row; i++) rights += b.steps[i];
    const xAt = (r, n) => PW / 2 + (n - r / 2) * PDX;
    const x0 = xAt(row, rights);
    const x1 = row < PLINKO_ROWS ? xAt(row + 1, rights + b.steps[row]) : x0;
    const y0 = PTOP - 16 + row * PDY;
    const x = x0 + (x1 - x0) * f + (row === 0 ? b.jitter * (1 - f) : 0);
    const y = y0 + PDY * f - Math.sin(f * Math.PI) * 9;
    return [x, Math.min(y, PTOP + PLINKO_ROWS * PDY + 8)];
  }

  drawPlinko() {
    const canvas = document.getElementById('plinkoBoard');
    if (!canvas) return;
    const c = canvas.getContext('2d');
    const pl = this.plinko;
    c.clearRect(0, 0, PW, PH);
    for (let r = 0; r < PLINKO_ROWS; r++) {
      for (let k = 0; k < r + 3; k++) {
        c.beginPath();
        c.arc(pegX(r, k), PTOP + r * PDY, 4.5, 0, Math.PI * 2);
        c.fillStyle = '#fff6e0';
        c.fill();
      }
    }
    const mults = PLINKO[pl.risk];
    const by = PTOP + PLINKO_ROWS * PDY + 2;
    mults.forEach((m, i) => {
      const x = PW / 2 + (i - PLINKO_ROWS / 2) * PDX;
      const lift = (pl.flash[i] || 0) * 6;
      c.fillStyle = bucketColor(m);
      c.beginPath();
      if (c.roundRect) c.roundRect(x - PDX / 2 + 2, by + 6 - lift, PDX - 4, 26, 6); else c.rect(x - PDX / 2 + 2, by + 6 - lift, PDX - 4, 26);
      c.fill();
      c.lineWidth = 3;
      c.strokeStyle = (pl.flash[i] || 0) > 0 ? '#ffffff' : '#1b0f2b';
      c.stroke();
      c.fillStyle = '#1b0f2b';
      c.font = `900 ${m >= 100 ? 10 : 11}px Nunito, sans-serif`;
      c.textAlign = 'center';
      c.fillText(`${m}x`, x, by + 23 - lift);
    });
    for (const b of pl.balls) {
      const [x, y] = this.plinkoPos(b);
      c.beginPath();
      c.arc(x, y, 8, 0, Math.PI * 2);
      c.fillStyle = '#ff3fa4';
      c.fill();
      c.lineWidth = 3;
      c.strokeStyle = '#1b0f2b';
      c.stroke();
      c.beginPath();
      c.arc(x - 2.5, y - 2.5, 2.5, 0, Math.PI * 2);
      c.fillStyle = 'rgba(255,255,255,0.8)';
      c.fill();
    }
  }

  renderCrash() {
    const c = this.crash;
    return this.split(`<div class="crashbox"><canvas id="crashGraph" class="crashgraph" width="640" height="320"></canvas>
        <div id="crashMult" class="mult ${c && c.crashed ? 'crashed' : ''}">${c ? `${c.mult.toFixed(2)}x` : '1.00x'}</div></div>`,
      `${c && c.running ? '' : this.betChips()}
      ${c && c.running
    ? `<button id="crashBtn" class="btn big cashout" data-act="cashout">CASH OUT 🪙${fmt(Math.floor(c.bet * c.mult))}</button>`
    : `<button class="btn big" data-act="launch">LAUNCH 🚀 · 🪙 ${fmt(this.bet)}</button>`}
      ${c && c.msg ? `<p class="msg ${c.crashed ? 'loss' : 'win'}">${c.msg}</p>` : '<p class="hint">The multiplier climbs until the rocket blows up. Cash out before it does.</p>'}`);
  }

  // ---------- actions ----------

  // Chips out for a bet.
  spend(amount) {
    if (this.data.stash.chips < amount) {
      this.toast(`You need 🪙 ${fmt(amount)} in your stash.`);
      sfx.deny();
      return false;
    }
    save.update((d) => { d.stash.chips -= amount; d.stats.wagered += amount; });
    return true;
  }

  // Chips back from a bet (stake included).
  earn(amount) {
    save.update((d) => { d.stash.chips += amount; d.stats.gambleWon += amount; d.stats.biggestWin = Math.max(d.stats.biggestWin, amount); });
  }

  // Log a finished bet: session total, recent results, achievements.
  settleBet(icon, wager, payout, statChange = null) {
    this.session += payout - wager;
    this.history.push({ icon, net: payout - wager });
    this.announce(progress((d) => { if (statChange) statChange(d.stats); }));
  }

  onInput(e) {
    const s = this.data.settings;
    if (e.target.id === 'sens') { save.update((d) => { d.settings.sensitivity = Number(e.target.value); }); $('sensVal').textContent = `${s.sensitivity.toFixed(2)}x`; }
    if (e.target.id === 'fov') { save.update((d) => { d.settings.fov = Number(e.target.value); }); $('fovVal').textContent = `${s.fov}°`; }
    if (e.target.id === 'mus') { save.update((d) => { d.settings.music = Number(e.target.value); }); if (this.onSettings) this.onSettings(); $('musVal').textContent = `${Math.round(Number(e.target.value) * 100)}%`; }
    if (e.target.id === 'vol') { save.update((d) => { d.settings.volume = Number(e.target.value); }); setVolume(s.volume); $('volVal').textContent = `${Math.round(s.volume * 100)}%`; }
    if (e.target.id === 'lookName') { save.update((d) => { d.look.name = e.target.value.slice(0, 14); }); this.renderHeader(); if (this.net) this.net.profile(this.profileName(), wornLook(this.data.look)); }
    if (e.target.id === 'partyCode') this.partyCode = e.target.value.toUpperCase();
  }

  onClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    initAudio();
    const act = b.dataset.act;
    const i = Number(b.dataset.i);
    const d = this.data;
    switch (act) {
      case 'pack': {
        const it = d.stash.items[i];
        if (hasFreeKit(d.loadout)) { this.toast(FREE_LOCKED); break; }
        save.update((x) => {
          if (isGun(it)) {
            const slot = x.loadout.weapons.indexOf(null);
            if (slot < 0) { this.toast('Both weapon slots are full.'); return; }
            x.loadout.weapons[slot] = it;
            x.stash.items.splice(i, 1);
          } else if (holdRoom(x.loadout.items, it) <= 0) {
            this.toast(holdLimitText(it));
          } else if (itemInfo(it).stack > 1) {
            const copy = { ...it };
            addToList(x.loadout.items, copy, LOADOUT_SLOTS);
            if (copy.qty === it.qty) { this.toast('Loadout is full.'); return; }
            it.qty = copy.qty;
            if (it.qty <= 0) x.stash.items.splice(i, 1);
          } else {
            if (x.loadout.items.length >= LOADOUT_SLOTS) { this.toast('Loadout is full.'); return; }
            x.loadout.items.push({ ...it });
            x.stash.items.splice(i, 1);
          }
        });
        break;
      }
      // The free loadout is locked: nothing goes in or out (so it can't be farmed for gear or chips).
      case 'unequip': {
        if (hasFreeKit(d.loadout)) { this.toast(FREE_LOCKED); break; }
        save.update((x) => { addToStash(x.stash.items, x.loadout.weapons[i]); x.loadout.weapons[i] = null; });
        break;
      }
      case 'unpack': {
        if (hasFreeKit(d.loadout)) { this.toast(FREE_LOCKED); break; }
        save.update((x) => { addToStash(x.stash.items, x.loadout.items[i]); x.loadout.items.splice(i, 1); });
        break;
      }
      case 'mobask': this.mobAsk = performance.now(); break;
      case 'mobno': this.mobAsk = 0; break;
      case 'mobyes': {
        this.mobAsk = 0;
        if (mobDebt()) break;
        const { lent, owe } = borrow();
        sfx.cashout();
        this.toast(`🤌 The Mob spots you 🪙 ${fmt(lent)}. You owe them 🪙 ${fmt(owe)} (${Math.round((owe / lent - 1) * 100)}% interest). Pay it back before your next raid... or else.`);
        break;
      }
      case 'mobpay': {
        if (repay()) { sfx.win(); this.toast('🤌 Pleasure doing business. You\'re square with the Mob.'); } else this.toast('You can\'t cover it yet.');
        break;
      }
      case 'freekit': {
        // Free loadout: only when you've got no gun packed. It replaces the whole loadout (anything you'd
        // packed goes back to the stash) and is then locked until you raid with it or put it back.
        if (d.loadout.weapons.some(Boolean)) break;
        const gun = { ...makeGun(['pistol', 'smg', 'shotgun', 'revolver'][Math.floor(Math.random() * 4)], 0), free: true };
        const thrown = ['grenade', 'dice', 'flash', 'sauce', 'sticky', 'smoke'][Math.floor(Math.random() * 6)];
        save.update((x) => {
          for (const it of x.loadout.items) if (!it.free) addToStash(x.stash.items, it);
          x.loadout.weapons = x.loadout.weapons.map(() => null);
          x.loadout.weapons[0] = gun;
          x.loadout.items = [makeItem('bandage', 2), makeItem('ammo', 1), makeItem('plate', 1), makeItem(thrown, 1)].map((it) => ({ ...it, free: true }));
        });
        this.toast(`Free loadout packed: ${itemInfo(gun).name} and a ${ITEMS[thrown].name}. Try not to lose it.`);
        break;
      }
      case 'sell': {
        const it = d.stash.items[i];
        const v = itemInfo(it).value;
        save.update((x) => { x.stash.items.splice(i, 1); x.stash.chips += v; });
        sfx.pickup();
        this.toast(`Sold for 🪙 ${fmt(v)}`);
        break;
      }
      case 'sellvaluables': {
        let total = 0;
        save.update((x) => {
          x.stash.items = x.stash.items.filter((it) => {
            if (isGun(it) || ITEMS[it.id].kind !== 'valuable') return true;
            total += itemInfo(it).value;
            return false;
          });
          x.stash.chips += total;
        });
        sfx.win();
        this.toast(`Sold everything for 🪙 ${fmt(total)}`);
        break;
      }
      case 'pconnect': this.net.connect(); break;
      case 'pcreate': this.net.create(this.profileName(), wornLook(d.look)); break;
      case 'pjoin': {
        const code = (($('partyCode') || {}).value || '').toUpperCase().trim();
        if (code.length < 4) { this.toast('Type the 4-letter party code first.'); return; }
        this.net.join(code, this.profileName(), wornLook(d.look));
        break;
      }
      case 'pleave': this.net.leave(); break;
      case 'pmode': this.net.setMode(b.dataset.m); return;
      case 'pteam': {
        const mine = this.net.room.members.find((m) => m.id === this.net.id);
        this.net.setTeam(mine && mine.team ? 0 : 1);
        return;
      }
      case 'pcopy':
        try { navigator.clipboard.writeText(this.net.room.code); this.toast(`Copied ${this.net.room.code}. Send it to your friends!`); } catch (err) { this.toast(`Party code: ${this.net.room.code}`); }
        return;
      case 'auth': this.openAuth(b.dataset.mode); return;
      case 'tutorial': this.startTutorial(); return;
      case 'pickmap':
        if (!(this.net && this.net.inParty && !this.net.isHost) && d.selectedMap !== b.dataset.m) {
          save.update((x) => { x.selectedMap = b.dataset.m; });
          this.onMapChange(b.dataset.m);
        }
        this.loStage = 'gear';
        break;
      case 'backmaps': this.loStage = 'maps'; break;
      case 'freelocked': this.toast('That\'s free gear. Put the whole free loadout back to pack your own.'); return;
      case 'unfreekit':
        save.update((x) => {
          x.loadout.weapons = x.loadout.weapons.map((g) => (g && g.free ? null : g));
          x.loadout.items = x.loadout.items.filter((it) => !it.free);
        });
        this.toast('Free loadout put back. Pack whatever you like.');
        break;
      case 'claimct': {
        const out = claimContract(i);
        if (out) { sfx.jackpot(); this.toast(`📋 Contract done! +🪙 ${fmt(out.chips)} and ⭐ ${out.xp} XP`); this.announce(out); }
        break;
      }
      case 'rerollct': if (rerollContract(i)) { sfx.tick(); this.toast('🎲 New contract!'); } break;
      case 'hidenewbie': try { localStorage.setItem('bth.hideGuide', '1'); } catch (err) { /* private mode */ } break;
      case 'cloudreg': this.cloudAction('reg'); return;
      case 'cloudin': this.cloudAction('in'); return;
      case 'cloudout': cloud.logout(); this.toast('Logged out. Progress on this device stays here.'); break;
      case 'cloudsync': cloud.push(); this.toast('☁️ Saving…'); return;
      case 'boardby': this.boardBy = b.dataset.by; this.board = null; break;
      case 'boardrefresh': this.board = null; break;
      case 'voice':
        save.update((x) => { x.settings.voice = b.dataset.v; });
        if (this.onSettings) this.onSettings();
        break;
      case 'tutorial': save.update((x) => { x.settings.tutorial = b.dataset.t; }); break;
      case 'shopsec': this.shopSec = b.dataset.s; break;
      case 'buygun': {
        const lv = levelInfo(d.xp).level;
        if (lv < ARMORY_LEVEL || i >= armoryStock(lv)) break;
        const { day, offers } = this.armory(lv);
        const o = offers[i];
        const bought = d.shopDay && d.shopDay.day === day ? d.shopDay.bought : [];
        if (!o || bought.includes(i) || d.stash.chips < o.price) break;
        save.update((x) => {
          x.stash.chips -= o.price;
          addToStash(x.stash.items, { ...o.gun });
          x.shopDay = { day, bought: [...bought, i] };
        });
        sfx.pickup();
        this.toast(`🔫 ${itemInfo(o.gun).name} is in your stash.`);
        break;
      }
      case 'buyitem': {
        const sup = SUPPLIES.find(([id]) => id === b.dataset.id);
        if (!sup || levelInfo(d.xp).level < sup[2]) break;
        const price = sup[1];
        if (d.stash.chips < price) { this.toast(`You need 🪙 ${fmt(price)}.`); break; }
        save.update((x) => { x.stash.chips -= price; addToStash(x.stash.items, makeItem(b.dataset.id, 1)); });
        sfx.pickup();
        this.toast(`${ITEMS[b.dataset.id].icon} ${ITEMS[b.dataset.id].name} added to your stash.`);
        break;
      }
      case 'buylook': {
        const o = LOOK_PARTS.map(([part]) => LOOKS[part].find((x) => String(x.id) === b.dataset.id)).find(Boolean);
        if (!o || !o.unlock || !o.unlock.buy || shopLookLock(o, d)) break;
        const price = o.unlock.buy;
        if (d.stash.chips < price) break;
        save.update((x) => { x.stash.chips -= price; x.owned = { ...(x.owned || {}), [b.dataset.id]: true }; });
        sfx.jackpot();
        this.toast('✨ Yours! Put it on in the 🎨 Look tab.');
        break;
      }
      case 'bagup': {
        const lv = d.bag || 0;
        const next = BAG_UPGRADES[lv];
        if (!next) break;
        if (d.stash.chips < next.cost) { this.toast(`You need 🪙 ${fmt(next.cost)} for the ${next.name}.`); break; }
        save.update((x) => { x.stash.chips -= next.cost; x.bag = lv + 1; });
        sfx.jackpot();
        this.toast(`${next.icon} ${next.name}! Your backpack holds ${BACKPACK_SLOTS + bagBonus(lv + 1)} things now.`);
        break;
      }
      case 'quality':
        save.update((x) => { x.settings.quality = b.dataset.q; });
        if (this.onSettings) this.onSettings();
        break;
      case 'lookpart': this.lookPart = b.dataset.p; break;
      case 'lookopt': {
        const part = b.dataset.p;
        const opt = LOOKS[part].find((o) => String(o.id) === b.dataset.id);
        if (!opt) return;
        if (!lookUnlocked(opt)) { this.toast(`🔒 ${unlockText(opt)}`); sfx.deny(); return; }
        save.update((x) => { x.look[part] = opt.id; });
        sfx.pickup();
        this.sendLook();
        break;
      }
      case 'lookrandom':
        save.update((x) => {
          for (const [part] of LOOK_PARTS) {
            const open = LOOKS[part].filter((o) => lookUnlocked(o));
            x.look[part] = open[Math.floor(Math.random() * open.length)].id;
          }
        });
        this.sendLook();
        break;
      case 'rectab': this.recTab = b.dataset.r; break;
      case 'hubpage': this.tab = b.dataset.t; break;
      case 'reset':
        if (!this.armedReset) { this.armedReset = true; break; }
        this.armedReset = false;
        save.reset();
        save.update((x) => { x.loadout = { weapons: [null, null], items: [] }; x.look.color = LOOKS.color[0].id; x.collectionSeeded = true; });
        this.toast('Progress wiped. Fresh start.');
        break;
      case 'allmaps': this.showMaps = !this.showMaps; break;
      case 'mapstep': {
        if (this.net && this.net.inParty && !this.net.isHost) { this.toast('The party leader picks the map.'); return; }
        const order = ['lounge', 'vegas', 'bayou', 'frost', 'tequila', 'bunker'].filter((id) => MAPS[id]);
        const at = Math.max(0, order.indexOf(d.selectedMap));
        const next = order[(at + Number(b.dataset.d) + order.length) % order.length];
        save.update((x) => { x.selectedMap = next; });
        this.onMapChange(next);
        break;
      }
      case 'map':
        this.showMaps = false;
        if (this.net && this.net.inParty && !this.net.isHost) { this.toast('The party leader picks the map.'); return; }
        if (d.selectedMap !== b.dataset.m) {
          save.update((x) => { x.selectedMap = b.dataset.m; });
          this.onMapChange(b.dataset.m);
        }
        break;
      case 'game': this.game = b.dataset.g; break;
      case 'bet': {
        const need = BET_LEVEL[b.dataset.b] || 0;
        if (levelInfo(d.xp).level < need) { this.toast(`🔒 The ${fmt(Number(b.dataset.b))} table opens at level ${need}. Raid to level up!`); break; }
        this.bet = Number(b.dataset.b);
        break;
      }
      case 'machine': if (!(this.reels && this.reels.running)) { this.machine = i; this.reels = null; } break;
      case 'pull': this.pullReels(); return;
      case 'deal': this.deal(); break;
      case 'hit': if (this.bj && this.bj.state === 'play') this.bjHit(); break;
      case 'stand': if (this.bj && this.bj.state === 'play') this.bjNext(); break;
      case 'double': if (this.bj && this.bj.state === 'play') this.bjDouble(); break;
      case 'split': if (this.bj && this.bj.state === 'play') this.bjSplit(); break;
      case 'spin': this.spinRoulette(b.dataset.k); return;
      case 'launch': this.launchCrash(); return;
      case 'minecount': this.mineCount = Number(b.dataset.n); break;
      case 'minestart': this.startMines(); break;
      case 'mine': this.pickMine(i); break;
      case 'minecash': this.cashMines(); break;
      case 'plinkorisk': if (!this.plinko.balls.length) this.plinko.risk = b.dataset.r; break;
      case 'plinkodrop': this.dropPlinko(); return;
      case 'cashout': this.cashOutCrash(); return;
      default: return;
    }
    this.render();
  }

  // ---------- Loot Reels ----------

  randomStrip(n) {
    return Array.from({ length: n }, () => REEL_SYMBOLS[Math.floor(Math.random() * REEL_SYMBOLS.length)]);
  }

  pullReels() {
    if (this.reels && this.reels.running) return;
    const m = HUB_SLOTS[this.machine];
    if (!this.spend(m.cost)) return;
    const { prize, finals } = reelPull(m);
    // Each strip ends [..., above, final, below]; it scrolls so `final` sits on the payline.
    const strips = finals.map((f, k) => [...this.randomStrip(24 + k * 6), f, ...this.randomStrip(1)]);
    const r = { running: true, animating: true, strips, prize, isNew: false };
    this.reels = r;
    sfx.lever();
    this.render();
    // Start the scroll on the next frame so the transition runs.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      strips.forEach((s, k) => {
        const el = document.getElementById(`strip${k}`);
        if (!el) return;
        el.style.transition = `transform ${1.3 + k * 0.45}s cubic-bezier(0.12, 0.8, 0.22, 1.04)`;
        el.style.transform = `translateY(${-(s.length - 3) * ROW}px)`;
      });
    }));
    // Tick sounds while spinning, a clunk as each reel stops.
    let ticks = 0;
    const tick = setInterval(() => { if (++ticks < 22) sfx.tick(); else clearInterval(tick); }, 90);
    [0, 1, 2].forEach((k) => setTimeout(() => sfx.reelStop(), (1.3 + k * 0.45) * 1000));
    setTimeout(() => {
      r.running = false;
      r.animating = false;
      const { payout, isNew } = this.awardReel(m, prize);
      r.isNew = isNew;
      if (prize.hit >= 4) sfx.jackpot(); else if (prize.hit >= 2) sfx.win(); else sfx.pickup();
      if (this.tab === 'backroom' && this.game === 'slots') this.render();
      else this.renderHeader();
    }, (1.3 + 2 * 0.45) * 1000 + 150);
  }

  // Pay out a Loot Reels pull: chips to the bank, gear to the stash (and the collection log).
  awardReel(m, prize) {
    let out = null;
    let isNew = false;
    if (prize.chips) this.earn(prize.chips);
    if (prize.item) {
      const key = itemKey(prize.item);
      isNew = !this.data.collection[key];
      save.update((x) => addToStash(x.stash.items, { ...prize.item }));
      out = progress((x) => { x.collection[key] = (x.collection[key] || 0) + 1; });
    }
    const payout = (prize.chips || 0) + (prize.item ? itemInfo(prize.item).value : 0);
    this.settleBet('🎰', m.cost, payout, (s) => { s.reelsPulled++; });
    if (out) this.announce(out);
    return { payout, isNew };
  }

  // ---------- Blackjack ----------

  deal() {
    if (this.bj && this.bj.state === 'play') return;
    if (!this.spend(this.bet)) return;
    const shuffled = shoe.ready();
    // Dealt like a real table: you, the dealer, you, then the dealer's hole card.
    const mine = [drawCard()];
    const dealer = [drawCard()];
    mine.push(drawCard());
    dealer.push(drawCard());
    this.bj = { shuffled, base: this.bet, hands: [{ cards: mine, bet: this.bet }], active: 0, dealer, state: 'play', msg: '', wagered: this.bet };
    sfx.tick();
    // The dealer peeks, like a real table: a blackjack (theirs or yours) is shown and paid at once.
    if (handValue(this.bj.hands[0].cards) === 21 || handValue(dealer) === 21) this.settle();
  }

  bjHit() {
    const g = this.bj;
    const h = g.hands[g.active];
    h.cards.push(drawCard());
    sfx.tick();
    if (handValue(h.cards) >= 21) this.bjNext();
  }

  bjDouble() {
    const g = this.bj;
    const h = g.hands[g.active];
    if (!this.spend(h.bet)) return;
    g.wagered += h.bet;
    h.bet *= 2;
    h.doubled = true;
    h.cards.push(drawCard());
    this.bjNext();
  }

  // Split a pair into two hands, each with its own bet. Split aces get one card each.
  bjSplit() {
    const g = this.bj;
    const h = g.hands[g.active];
    if (!this.spend(h.bet)) return;
    g.wagered += h.bet;
    const aces = h.cards[0].rank === 'A';
    const a = { cards: [h.cards[0], drawCard()], bet: h.bet, fromAces: aces, split: true };
    const b = { cards: [h.cards[1], drawCard()], bet: h.bet, fromAces: aces, split: true };
    g.hands.splice(g.active, 1, a, b);
    sfx.lever();
    if (aces) { a.done = true; b.done = true; this.bjNext(); return; }
    if (handValue(a.cards) === 21) this.bjNext();
  }

  // Move to the next hand that's still in play, or let the dealer go.
  bjNext() {
    const g = this.bj;
    g.hands[g.active].done = true;
    const next = g.hands.findIndex((h) => !h.done);
    if (next >= 0) g.active = next;
    else this.settle();
  }

  // Real rules: the dealer peeks on the deal, so a dealer blackjack shows up right away and you only
  // lose your bet (or push with your own blackjack). Otherwise you play your hand out, then the dealer
  // turns over the hole card and draws to 17.
  settle() {
    const g = this.bj;
    const dealerBJ = handValue(g.dealer) === 21 && g.dealer.length === 2;
    // The dealer only draws if a hand still needs beating (not bust, not a natural).
    const live = !dealerBJ && g.hands.some((h) => handValue(h.cards) <= 21 && !isNatural(h));
    if (live) while (handValue(g.dealer) < 17) g.dealer.push(drawCard());
    const dv = handValue(g.dealer);
    let pay = 0;
    let natural = false;
    for (const h of g.hands) {
      const p = handValue(h.cards);
      let won = 0;
      if (dealerBJ) {
        if (isNatural(h)) { won = h.bet; h.result = { text: 'PUSH', cls: '' }; }
        else h.result = { text: 'DEALER BJ', cls: 'loss' };
      } else if (p > 21) h.result = { text: 'BUST', cls: 'loss' };
      else if (isNatural(h)) { won = Math.floor(h.bet * 2.5); natural = true; h.result = { text: 'BLACKJACK!', cls: 'win' }; }
      else if (dv > 21 || p > dv) { won = h.bet * 2; h.result = { text: 'WIN', cls: 'win' }; }
      else if (p === dv) { won = h.bet; h.result = { text: 'PUSH', cls: '' }; }
      else h.result = { text: 'LOSE', cls: 'loss' };
      pay += won;
    }
    // Original bet only: whatever went out on top of it to double or split is handed back.
    if (dealerBJ && !natural && !g.hands.some(isNatural)) pay += g.wagered - g.base;
    const net = pay - g.wagered;
    const dealerText = dealerBJ ? 'Dealer flips blackjack' : dv > 21 ? `Dealer busts with ${dv}` : `Dealer has ${dv}`;
    const back = dealerBJ && pay > 0 && net < 0 ? ` (your extra bets came back)` : '';
    g.msg = net > 0 ? `${natural ? '🂡 BLACKJACK! ' : ''}${dealerText}. Won 🪙 ${fmt(net)}.` : net < 0 ? `${dealerText}. Lost 🪙 ${fmt(-net)}${back}.` : `${dealerText}. Even money.`;
    g.win = net > 0 ? true : net < 0 ? false : null;
    if (pay) this.earn(pay);
    if (net > 0) sfx.win(); else if (net < 0) sfx.deny();
    g.state = 'done';
    this.settleBet('🃏', g.wagered, pay, (s) => { if (natural) s.blackjacks++; });
  }

  // ---------- Roulette ----------

  spinRoulette(kind) {
    if (this.roulette && this.roulette.spinning) return;
    if (!this.spend(this.bet)) return;
    const bet = this.bet;
    const n = Math.floor(Math.random() * 37);
    const idx = WHEEL.indexOf(n);
    const seg = 360 / 37;
    const prev = this.roulette ? this.roulette.angle : 0;
    // A few full turns, then stop with n under the pointer.
    const angle = prev - (((prev % 360) + 360) % 360) - 360 * 5 - (idx + 0.5) * seg;
    this.roulette = { spinning: true, angle: prev };
    sfx.lever();
    this.render();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = document.querySelector('.rwheel');
      if (el) {
        el.style.transition = 'transform 3s cubic-bezier(0.15, 0.75, 0.2, 1)';
        el.style.transform = `rotate(${angle}deg)`;
      }
    }));
    const ticks = setInterval(() => sfx.tick(), 140);
    setTimeout(() => {
      clearInterval(ticks);
      const color = n === 0 ? 'green' : RED.has(n) ? 'red' : 'black';
      const won = kind === color || (n !== 0 && ((kind === 'odd' && n % 2 === 1) || (kind === 'even' && n % 2 === 0)));
      const pays = kind === 'green' ? 14 : 2;
      if (won) { this.earn(bet * pays); sfx.win(); } else sfx.deny();
      this.roulette = { spinning: false, angle, n, color, won, msg: `${n} ${color.toUpperCase()}. ${won ? `Won 🪙 ${fmt(bet * pays)}!` : `Lost 🪙 ${fmt(bet)}.`}` };
      this.settleBet('🎡', bet, won ? bet * pays : 0, (s) => { if (won && kind === 'green') s.rouletteGreens++; });
      if (this.tab === 'backroom') this.render();
      else this.renderHeader();
    }, 3100);
  }

  // ---------- Crash ----------

  launchCrash() {
    if (this.crash && this.crash.running) return;
    if (!this.spend(this.bet)) return;
    const u = Math.random();
    // Most rockets pop early, a few fly for ages. Never crashes the instant it launches.
    const crashAt = Math.min(50, Math.max(1.05, Math.floor((0.95 / (1 - u)) * 100) / 100));
    const c = { bet: this.bet, mult: 1, running: true, crashed: false, crashAt, start: performance.now(), msg: '', points: [] };
    this.crash = c;
    sfx.lever();
    this.render();
    this.drawCrash();
    const tick = () => {
      if (!c.running || this.crash !== c) return;
      const t = (performance.now() - c.start) / 1000;
      c.mult = Math.exp(0.22 * t);
      c.points.push([t, c.mult]);
      if (c.mult >= c.crashAt) {
        c.mult = c.crashAt;
        c.running = false;
        c.crashed = true;
        c.msg = `💥 CRASHED at ${c.crashAt.toFixed(2)}x. Lost 🪙 ${fmt(c.bet)}.`;
        sfx.boom();
        this.settleBet('🚀', c.bet, 0);
        if (this.tab === 'backroom' && this.game === 'crash') this.render();
        this.drawCrash();
        return;
      }
      // Only touch the number and the button text, so the button you're clicking stays put.
      const mult = document.getElementById('crashMult');
      const btn = document.getElementById('crashBtn');
      if (mult) mult.textContent = `${c.mult.toFixed(2)}x`;
      if (btn) btn.textContent = `CASH OUT 🪙${fmt(Math.floor(c.bet * c.mult))}`;
      this.drawCrash();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  drawCrash() {
    const canvas = document.getElementById('crashGraph');
    const c = this.crash;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(16,9,28,0.9)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(0, (h / 6) * i);
      ctx.lineTo(w, (h / 6) * i);
      ctx.stroke();
    }
    if (!c || !c.points.length) {
      ctx.fillStyle = 'rgba(255,246,224,0.8)';
      ctx.font = "30px 'Luckiest Guy', sans-serif";
      ctx.textAlign = 'center';
      ctx.fillText('🚀 Ready for launch', w / 2, h / 2 + 10);
      return;
    }
    const last = c.points[c.points.length - 1];
    const tMax = Math.max(5, last[0] * 1.1);
    const mMax = Math.max(2, last[1] * 1.15);
    const X = (t) => 16 + (t / tMax) * (w - 50);
    const Y = (m) => h - 14 - ((m - 1) / (mMax - 1)) * (h - 40);
    ctx.beginPath();
    ctx.moveTo(X(0), Y(1));
    for (const [t, m] of c.points) ctx.lineTo(X(t), Y(m));
    ctx.lineTo(X(last[0]), h);
    ctx.lineTo(X(0), h);
    ctx.closePath();
    ctx.fillStyle = c.crashed ? 'rgba(230,57,70,0.25)' : 'rgba(94,226,122,0.2)';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(X(0), Y(1));
    for (const [t, m] of c.points) ctx.lineTo(X(t), Y(m));
    ctx.strokeStyle = c.crashed ? '#e63946' : '#5ee27a';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.font = '30px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(c.crashed ? '💥' : '🚀', X(last[0]), Y(last[1]) - 4);
  }

  cashOutCrash() {
    const c = this.crash;
    if (!c || !c.running) return;
    c.running = false;
    const win = Math.floor(c.bet * c.mult);
    this.earn(win);
    c.msg = `✅ Cashed out at ${c.mult.toFixed(2)}x: won 🪙 ${fmt(win)}!`;
    sfx.win();
    this.settleBet('🚀', c.bet, win, (s) => { s.crashBest = Math.max(s.crashBest, c.mult); });
    this.render();
    this.drawCrash();
  }

  // Your party sees the look you're wearing (and the raid uses it), so tell them when it changes.
  sendLook() {
    if (this.net && this.net.inParty) this.net.profile(this.profileName(), wornLook(this.data.look));
  }

  profileName() { return (this.data.look.name || '').trim() || 'High Roller'; }

  deploy() {
    initAudio();
    const d = this.data;
    const lo = d.loadout;
    if (window.degen && window.degen.net && window.degen.isHost && !window.degen.net.ended) {
      this.toast('Your squad is still in the raid. Wait for them to get out first.');
      return;
    }
    const party = this.net && this.net.inParty;
    if (party && !this.net.isHost) {
      if (this.net.room.inRaid && this.onJoinRaid) { this.onJoinRaid(); return; }
      this.toast('Only the party leader can deploy. Pack your loadout and hang tight!');
      return;
    }
    if (!lo.weapons.some(Boolean) && !this.warnedNoGun) {
      this.warnedNoGun = true;
      this.toast('No gun packed! Click DEPLOY again to go in with just your fists.');
      return;
    }
    this.warnedNoGun = false;
    if (mobDebt() && !this.warnedMob && this.data.selectedMap !== 'lounge') {
      this.warnedMob = true;
      this.toast(`🤌 You still owe the Mob 🪙 ${fmt(mobDebt())}. Pay up in the Back Room first, or DEPLOY again and take your chances.`);
      return;
    }
    this.warnedMob = false;
    // Party leader: tell everyone to drop in. The actual launch happens when the server echoes it back.
    if (party) { this.onPartyStart(); return; }
    this.launch();
  }

  // Pack the loadout and go. `party` is the party start info in multiplayer.
  launch(party = null) {
    const d = this.data;
    const lo = d.loadout;
    // Back in after a reload: you already have your gear from before.
    const restoring = party && party.join && party.join.restore;
    // Whatever you bring leaves the stash for good unless you extract with it.
    const loadout = restoring ? { weapons: [], items: [] } : JSON.parse(JSON.stringify(lo));
    // The Safe Pocket only comes along with real gear, not the free loadout.
    if (!restoring) loadout.pocket = !hasFreeKit(lo) && lo.weapons.some(Boolean) ? pocketSlots(d.bag || 0) : 0;
    else loadout.pocket = pocketSlots(d.bag || 0);
    if (!restoring) save.update((x) => { x.loadout = { weapons: [null, null], items: [] }; delete x.insured; });
    this.loStage = 'maps';
    this.onDeploy({
      party,
      mapId: party ? party.mapId : d.selectedMap,
      name: (d.look.name || '').trim() || 'High Roller',
      look: wornLook(d.look),
      loadout,
    });
  }
}
