// The Hub between raids: stash and loadout, the Back Room (gambling), the Fence (selling),
// your look, your records (stats, achievements, collection log) and settings.
// Everything here is plain HTML on top of the 3D backdrop.
import { HUB_SLOTS, ITEMS, LOOT, RARITY_BY_TIER } from './config.js';
import {
  itemInfo, isGun, rollLoot, addToList, addToStash, makeGun, makeItem, fullAmmo,
} from './items.js';
import { save } from './save.js';
import { iconHtml, gunIcon } from './icons.js';
import { renderBinds, wireBinds } from './keys.js';
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

const $ = (id) => document.getElementById(id);
const LOADOUT_SLOTS = 8;
const BETS = [25, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const hex = (c) => `#${Number(c).toString(16).padStart(6, '0')}`;

// ---------- card games ----------
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const drawCard = () => ({ rank: RANKS[Math.floor(Math.random() * 13)], suit: SUITS[Math.floor(Math.random() * 4)] });
const cardValue = (c) => (c.rank === 'A' ? 11 : 'JQK'.includes(c.rank) ? 10 : Number(c.rank));
function handValue(hand) {
  let total = 0;
  let aces = 0;
  for (const c of hand) {
    if (c.rank === 'A') { total += 11; aces++; } else if ('JQK'.includes(c.rank)) total += 10;
    else total += Number(c.rank);
  }
  while (total > 21 && aces) { total -= 10; aces--; }
  return total;
}
const cardHtml = (c, hidden, i = 0) => (hidden ? `<span class="pcard back" style="--i:${i}"></span>`
  : `<span class="pcard ${c.suit === '♥' || c.suit === '♦' ? 'red' : ''}" style="--i:${i}"><i>${c.rank}</i><em>${c.suit}</em><i class="flip">${c.rank}</i></span>`);

// ---------- Loot Reels ----------
const REEL_SYMBOLS = ['🍒', '🍋', '🔔', '7️⃣', '💎', '🪙', '🎲', '⭐'];
const ROW = 62;
const PRIZE_SYMBOL = ['🍒', '🔔', '7️⃣', '💎'];

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
const PLINKO_ROWS = 12;
const PLINKO = {
  low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
  medium: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
  high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
};
const PW = 560;
const PH = 430;
const PDX = 38;
const PDY = 29;
const PTOP = 34;
const pegX = (row, k) => PW / 2 + (k - (row + 2) / 2) * PDX;
const bucketColor = (m) => (m >= 10 ? '#e63946' : m >= 3 ? '#ff6b3d' : m >= 1.5 ? '#ff9f43' : m >= 1 ? '#ffc83d' : '#ffe08a');
const MINE_COUNTS = [1, 3, 5, 10];
// Payout multiplier after `picks` safe tiles with `bombs` hidden in 25 (with a small house edge).
function minesMult(bombs, picks) {
  let m = 0.97;
  for (let i = 0; i < picks; i++) m *= (25 - i) / (25 - bombs - i);
  return m;
}

export class Hub {
  constructor({ onDeploy, onMapChange }) {
    this.onDeploy = onDeploy;
    this.onMapChange = onMapChange || (() => {});
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

    $('hubTabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      this.tab = b.dataset.tab;
      initAudio();
      this.render();
    });
    $('hubWallet').addEventListener('click', (e) => {
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
    $('deploy').addEventListener('click', () => this.deploy());
    this.render();
  }

  show() { $('hub').hidden = false; this.render(); }
  hide() { $('hub').hidden = true; }

  get data() { return save.get(); }

  toast(text) {
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
    document.querySelectorAll('#hubTabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.tab));
    const body = {
      loadout: () => this.renderLoadout(),
      backroom: () => this.renderBackRoom(),
      fence: () => this.renderFence(),
      look: () => this.renderLook(),
      records: () => this.renderRecords(),
      settings: () => this.renderSettings(),
    }[this.tab]();
    $('hubBody').innerHTML = body;
    $('hubBody').dataset.tab = this.tab;
    if (this.tab === 'backroom' && this.game === 'crash') this.drawCrash();
    if (this.tab === 'backroom' && this.game === 'plinko') this.drawPlinko();
    if (this.tab === 'look') {
      this.preview.setLook(wornLook(d.look), d.loadout.weapons.find(Boolean));
      this.preview.mount($('lookSlot'));
    }
    const hasGun = d.loadout.weapons.some(Boolean);
    const m = MAPS[d.selectedMap];
    $('deploy').innerHTML = hasGun ? `DEPLOY<small>${m.icon} ${m.name}</small>` : 'DEPLOY<small>no gun packed!</small>';
  }

  renderHeader() {
    const d = this.data;
    const lv = levelInfo(d.xp);
    const look = wornLook(d.look);
    const hat = LOOKS.hat.find((h) => h.id === look.hat);
    const stashValue = d.stash.items.reduce((n, it) => n + itemInfo(it).value, 0);
    $('hubWallet').innerHTML = `
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
      <span class="icon">${iconHtml(item)}</span><span class="nm" style="color:${info.css}">${escapeHtml(info.name)}</span>
      <span class="meta">${isGun(item) ? `${Number.isFinite(item.ammo) ? item.ammo : fullAmmo(item.kind, item.rarity)} ammo` : item.qty > 1 ? `×${item.qty}` : ''}</span>${extra}</button>`;
  }

  renderLoadout() {
    const d = this.data;
    const lo = d.loadout;
    const noGuns = !d.stash.items.some(isGun) && !lo.weapons.some(Boolean);
    const maps = Object.entries(MAPS).map(([id, m]) => `<button class="mapcard ${d.selectedMap === id ? 'on' : ''}" data-act="map" data-m="${id}">
        <span class="icon">${m.icon}</span><b>${m.name}</b><small>${m.size} · ${m.danger}</small><span class="blurb">${m.blurb}</span></button>`).join('');
    return `<p class="howto">Pick a map, drop in, loot what you can, fight off the machines, and reach an open exit before time runs out. <b>Die and you lose everything you brought.</b> The best loot only drops in deadly zones.</p>
      <h3>Choose a map</h3><div class="maps">${maps}</div>
      <div class="cols">
      <section><h3>Raid loadout</h3><p class="hint">Whatever you bring is lost if you die. Click to send it back to the stash.</p>
        <div class="wslots">${lo.weapons.map((g, i) => (g ? this.itemCard(g, 'unequip', i) : `<div class="item empty">Weapon ${i + 1}<br><small>empty</small></div>`)).join('')}</div>
        <div class="grid">${lo.items.map((it, i) => this.itemCard(it, 'unpack', i)).join('')}${Array(Math.max(0, LOADOUT_SLOTS - lo.items.length)).fill('<div class="item empty"></div>').join('')}</div>
        ${noGuns ? '<button class="btn" data-act="freekit">Grab a free kit (Pea Shooter, bandages, a Cherry Bomb)</button>' : ''}
      </section>
      <section><h3>Stash</h3><p class="hint">Click to pack it for the raid.</p>
        <div class="grid">${d.stash.items.map((it, i) => this.itemCard(it, 'pack', i)).join('') || '<p class="hint">Empty. Go raid!</p>'}</div>
      </section></div>`;
  }

  renderFence() {
    const d = this.data;
    const valuables = d.stash.items.filter((it) => !isGun(it) && ITEMS[it.id].kind === 'valuable');
    const total = valuables.reduce((n, it) => n + itemInfo(it).value, 0);
    return `<h3>The Fence</h3><p class="hint">Sells anything for its full value in chips. No questions asked.</p>
      ${valuables.length ? `<button class="btn" data-act="sellvaluables">Sell all valuables · 🪙 ${fmt(total)}</button>` : ''}
      <div class="grid">${d.stash.items.map((it, i) => this.itemCard(it, 'sell', i, `<span class="price">Sell 🪙${fmt(itemInfo(it).value)}</span>`)).join('') || '<p class="hint">Nothing to sell.</p>'}</div>`;
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
        ${tile('📦', 'Containers searched', fmt(s.containers))}${tile('🎰', 'Raid slots pulled', fmt(s.slotPulls))}${tile('⏱️', 'Time in raids', `${mins} min`)}${tile('🗺️', 'Maps escaped', `${Object.keys(s.extractsByMap).length} / 3`)}
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

  renderSettings() {
    const s = this.data.settings;
    return `<h3>Settings</h3>
      <label class="slider">Mouse sensitivity <b id="sensVal">${s.sensitivity.toFixed(2)}x</b><input type="range" id="sens" min="0.1" max="3" step="0.05" value="${s.sensitivity}"></label>
      <label class="slider">Field of view <b id="fovVal">${s.fov}°</b><input type="range" id="fov" min="60" max="100" step="1" value="${s.fov}"></label>
      <label class="slider">Volume <b id="volVal">${Math.round(s.volume * 100)}%</b><input type="range" id="vol" min="0" max="1" step="0.05" value="${s.volume}"></label>
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
        <div class="session"><small>This session</small><b class="${net > 0 ? 'win' : net < 0 ? 'loss' : ''}">${net > 0 ? '+' : ''}${fmt(net)}</b><small>Stash 🪙 ${fmt(d.stash.chips)}</small></div>
      </aside>
      <section class="table">${stage}${recent ? `<div class="recent"><small>Recent</small>${recent}</div>` : ''}</section>
    </div>`;
  }

  betChips(disabled = false) {
    return `<div class="betchips"><small>BET</small>${BETS.map((b) => `<button class="cchip c${b} ${b === this.bet ? 'on' : ''}" data-act="bet" data-b="${b}" ${disabled ? 'disabled' : ''}>${b >= 1000 ? `${b / 1000}K` : b}</button>`).join('')}</div>`;
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
    let prize = '<div class="prize empty">Pull the lever. Every pull pays out something: chips, gear, or if you\'re lucky, a Legendary.</div>';
    if (r && !r.running && r.prize) {
      const p = r.prize;
      prize = p.chips
        ? `<div class="prize r0"><span class="pi">🪙</span><div><small>PAID OUT</small><b>🪙 ${fmt(p.chips)} chips</b></div></div>`
        : `<div class="prize r${itemInfo(p).rarity}"><span class="pi">${iconHtml(p, 'gicon big')}</span><div><small>${['Common', 'Rare', 'Epic', 'LEGENDARY'][itemInfo(p).rarity]}${r.isNew ? ' · NEW TO YOUR COLLECTION!' : ''}</small><b style="color:${itemInfo(p).css}">${escapeHtml(itemInfo(p).name)}</b><small>Worth 🪙 ${fmt(itemInfo(p).value)} · sent to your stash</small></div></div>`;
    }
    const big = r && !running && r.prize && !r.prize.chips && itemInfo(r.prize).rarity >= 2;
    return `<div class="machines">${machines}</div>
      <div class="cabinet m${this.machine} ${running ? 'spinning' : ''} ${big ? 'bigwin' : ''}">
        <div class="cabtop">${m.name.toUpperCase()}</div>
        <div class="reelwin">${reels}<div class="payline"></div></div>
        <button class="btn big spinbtn" data-act="pull" ${running ? 'disabled' : ''}>${running ? 'SPINNING…' : `PULL · 🪙 ${fmt(m.cost)}`}</button>
      </div>${prize}`;
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
    return `${this.betChips(playing)}
      <div class="felt bjtable">
        <div class="hand"><span class="who">DEALER ${g ? `<b>${dealerVal}${playing ? ' + ?' : ''}</b>` : ''}</span><div class="cards">${g ? g.dealer.map((c, i) => cardHtml(c, playing && i === 1, i)).join('') : ghost}</div></div>
        <div class="felttext">BLACKJACK PAYS 3 TO 2 · DEALER STANDS ON 17 · SPLIT ANY PAIR</div>
        <div class="hands">${hands}</div>
      </div>
      <div class="row">${playing ? `<button class="btn" data-act="hit">Hit</button><button class="btn" data-act="stand">Stand</button>${canDouble ? `<button class="btn" data-act="double">Double · 🪙 ${fmt(h.bet)}</button>` : ''}${canSplit ? `<button class="btn split" data-act="split">✂️ Split · 🪙 ${fmt(h.bet)}</button>` : ''}`
    : `<button class="btn big" data-act="deal">DEAL · 🪙 ${fmt(this.bet)}</button>`}</div>
      ${g && g.msg ? `<p class="msg ${g.win ? 'win' : g.win === false ? 'loss' : ''}">${g.msg}</p>` : ''}`;
  }

  renderRoulette() {
    const r = this.roulette;
    const seg = 360 / 37;
    const grad = WHEEL.map((n, i) => `${n === 0 ? '#16a34a' : RED.has(n) ? '#d62828' : '#1b0f2b'} ${(i * seg).toFixed(3)}deg ${((i + 1) * seg).toFixed(3)}deg`).join(', ');
    const labels = WHEEL.map((n, i) => `<span style="transform:rotate(${((i + 0.5) * seg).toFixed(2)}deg)"><i>${n}</i></span>`).join('');
    const angle = r ? r.angle : 0;
    const choices = [['red', 'Red', '2x'], ['black', 'Black', '2x'], ['odd', 'Odd', '2x'], ['even', 'Even', '2x'], ['green', 'Green 0', '14x']];
    return `${this.betChips(r && r.spinning)}
      <div class="roulette">
        <div class="wheelwrap"><div class="pointer">▼</div>
          <div class="rwheel" style="background:conic-gradient(${grad});transform:rotate(${angle}deg)">${labels}</div><div class="hubcap">${r && !r.spinning ? `<b class="${r.color}">${r.n}</b>` : '🎡'}</div></div>
        <div class="rbets">${choices.map(([k, n, x]) => `<button class="rbet ${k}" data-act="spin" data-k="${k}" ${r && r.spinning ? 'disabled' : ''}><b>${n}</b><small>pays ${x}</small></button>`).join('')}</div>
      </div>
      ${r && r.msg ? `<p class="msg ${r.won ? 'win' : 'loss'}">${r.msg}</p>` : '<p class="hint">Pick what to bet on. The wheel does the rest.</p>'}`;
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
    return `${playing ? '' : this.betChips()}
      ${playing ? '' : `<div class="minecount"><small>BOMBS</small>${MINE_COUNTS.map((n) => `<button class="subtab ${n === this.mineCount ? 'on' : ''}" data-act="minecount" data-n="${n}">${n}</button>`).join('')}</div>`}
      <div class="mines">
        <div class="mgrid">${tiles}</div>
        <div class="mside">
          <div class="mstat"><small>MULTIPLIER</small><b>${mult.toFixed(2)}x</b></div>
          <div class="mstat"><small>NEXT GEM</small><b>${nextMult.toFixed(2)}x</b></div>
          <div class="mstat"><small>${playing ? 'CASH OUT FOR' : 'BOMBS'}</small><b>${playing ? `🪙 ${fmt(Math.floor(g.bet * mult))}` : `💣 ${bombs}`}</b></div>
          ${playing
    ? `<button class="btn big cashout" data-act="minecash" ${picks ? '' : 'disabled'}>CASH OUT</button>`
    : `<button class="btn big" data-act="minestart">START · 🪙 ${fmt(this.bet)}</button>`}
        </div>
      </div>
      ${g && g.msg ? `<p class="msg ${g.won ? 'win' : 'loss'}">${g.msg}</p>` : '<p class="hint">Pick tiles to find gems. Every gem raises the multiplier. Hit a bomb and you lose the bet. More bombs, bigger multipliers.</p>'}`;
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
    return `${this.betChips()}
      <div class="minecount"><small>RISK</small>${risks}</div>
      <div class="plinko"><canvas id="plinkoBoard" width="${PW}" height="${PH}"></canvas><div class="plast">${last}</div></div>
      <div class="row"><button class="btn big" data-act="plinkodrop">DROP · 🪙 ${fmt(this.bet)}</button></div>
      <p class="hint">Every drop costs one bet, and you can have several balls bouncing at once. Edges pay big; the middle doesn't.</p>`;
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
    return `${c && c.running ? '' : this.betChips()}
      <div class="crashbox"><canvas id="crashGraph" class="crashgraph" width="640" height="240"></canvas>
        <div id="crashMult" class="mult ${c && c.crashed ? 'crashed' : ''}">${c ? `${c.mult.toFixed(2)}x` : '1.00x'}</div></div>
      <div class="row">${c && c.running
    ? `<button id="crashBtn" class="btn big cashout" data-act="cashout">CASH OUT 🪙${fmt(Math.floor(c.bet * c.mult))}</button>`
    : `<button class="btn big" data-act="launch">LAUNCH 🚀 · 🪙 ${fmt(this.bet)}</button>`}</div>
      ${c && c.msg ? `<p class="msg ${c.crashed ? 'loss' : 'win'}">${c.msg}</p>` : '<p class="hint">The multiplier climbs until the rocket blows up. Cash out before it does.</p>'}`;
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
    if (e.target.id === 'vol') { save.update((d) => { d.settings.volume = Number(e.target.value); }); setVolume(s.volume); $('volVal').textContent = `${Math.round(s.volume * 100)}%`; }
    if (e.target.id === 'lookName') { save.update((d) => { d.look.name = e.target.value.slice(0, 14); }); this.renderHeader(); }
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
        save.update((x) => {
          if (isGun(it)) {
            const slot = x.loadout.weapons.indexOf(null);
            if (slot < 0) { this.toast('Both weapon slots are full.'); return; }
            x.loadout.weapons[slot] = it;
            x.stash.items.splice(i, 1);
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
      case 'unequip':
        save.update((x) => { addToStash(x.stash.items, x.loadout.weapons[i]); x.loadout.weapons[i] = null; });
        break;
      case 'unpack':
        save.update((x) => { addToStash(x.stash.items, x.loadout.items[i]); x.loadout.items.splice(i, 1); });
        break;
      case 'freekit':
        save.update((x) => { x.loadout.weapons[0] = makeGun('pistol', 0); addToList(x.loadout.items, makeItem('bandage', 2), LOADOUT_SLOTS); addToList(x.loadout.items, makeItem('grenade', 1), LOADOUT_SLOTS); });
        this.toast('Free kit packed. Try not to lose it.');
        break;
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
      case 'lookpart': this.lookPart = b.dataset.p; break;
      case 'lookopt': {
        const part = b.dataset.p;
        const opt = LOOKS[part].find((o) => String(o.id) === b.dataset.id);
        if (!opt) return;
        if (!lookUnlocked(opt)) { this.toast(`🔒 ${unlockText(opt)}`); sfx.deny(); return; }
        save.update((x) => { x.look[part] = opt.id; });
        sfx.pickup();
        break;
      }
      case 'lookrandom':
        save.update((x) => {
          for (const [part] of LOOK_PARTS) {
            const open = LOOKS[part].filter((o) => lookUnlocked(o));
            x.look[part] = open[Math.floor(Math.random() * open.length)].id;
          }
        });
        break;
      case 'rectab': this.recTab = b.dataset.r; break;
      case 'reset':
        if (!this.armedReset) { this.armedReset = true; break; }
        this.armedReset = false;
        save.reset();
        save.update((x) => { x.loadout = { weapons: [null, null], items: [] }; x.look.color = LOOKS.color[0].id; x.collectionSeeded = true; });
        this.toast('Progress wiped. Fresh start.');
        break;
      case 'map':
        if (d.selectedMap !== b.dataset.m) {
          save.update((x) => { x.selectedMap = b.dataset.m; });
          this.onMapChange(b.dataset.m);
        }
        break;
      case 'game': this.game = b.dataset.g; break;
      case 'bet': this.bet = Number(b.dataset.b); break;
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
    let prize = rollLoot(m.tier);
    if (prize.chips) prize = { chips: prize.chips * 3 };
    // What the reels land on: a triple for anything Rare or better, a near miss otherwise.
    const rarity = prize.chips ? -1 : itemInfo(prize).rarity;
    let finals;
    if (rarity >= 1) finals = Array(3).fill(PRIZE_SYMBOL[rarity]);
    else if (prize.chips) finals = ['🪙', '🪙', REEL_SYMBOLS[Math.floor(Math.random() * 3)]];
    else {
      const a = REEL_SYMBOLS[Math.floor(Math.random() * REEL_SYMBOLS.length)];
      finals = [a, a, a === '🍒' ? '🍋' : '🍒'];
    }
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
      let out = null;
      let payout = 0;
      if (prize.chips) {
        payout = prize.chips;
        this.earn(prize.chips);
        sfx.win();
      } else {
        const key = itemKey(prize);
        r.isNew = !this.data.collection[key];
        save.update((x) => addToStash(x.stash.items, prize));
        out = progress((x) => { x.collection[key] = (x.collection[key] || 0) + 1; });
        payout = itemInfo(prize).value;
        if (itemInfo(prize).rarity >= 3) sfx.jackpot(); else sfx.win();
      }
      this.settleBet('🎰', m.cost, payout, (s) => { s.reelsPulled++; });
      if (out) this.announce(out);
      if (this.tab === 'backroom' && this.game === 'slots') this.render();
      else this.renderHeader();
    }, (1.3 + 2 * 0.45) * 1000 + 150);
  }

  // ---------- Blackjack ----------

  deal() {
    if (this.bj && this.bj.state === 'play') return;
    if (!this.spend(this.bet)) return;
    this.bj = { hands: [{ cards: [drawCard(), drawCard()], bet: this.bet }], active: 0, dealer: [drawCard(), drawCard()], state: 'play', msg: '', wagered: this.bet };
    sfx.tick();
    if (handValue(this.bj.hands[0].cards) === 21) this.settle();
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

  settle() {
    const g = this.bj;
    const live = g.hands.some((h) => handValue(h.cards) <= 21);
    if (live) while (handValue(g.dealer) < 17) g.dealer.push(drawCard());
    const dv = handValue(g.dealer);
    const dealerBJ = dv === 21 && g.dealer.length === 2;
    let pay = 0;
    let natural = false;
    for (const h of g.hands) {
      const p = handValue(h.cards);
      let won = 0;
      if (p > 21) h.result = { text: 'BUST', cls: 'loss' };
      else if (p === 21 && h.cards.length === 2 && !h.split && !dealerBJ) { won = Math.floor(h.bet * 2.5); natural = true; h.result = { text: 'BLACKJACK!', cls: 'win' }; }
      else if (dv > 21 || p > dv) { won = h.bet * 2; h.result = { text: 'WIN', cls: 'win' }; }
      else if (p === dv) { won = h.bet; h.result = { text: 'PUSH', cls: '' }; }
      else h.result = { text: 'LOSE', cls: 'loss' };
      pay += won;
    }
    const net = pay - g.wagered;
    const dealerText = dv > 21 ? `Dealer busts with ${dv}` : `Dealer has ${dv}`;
    g.msg = net > 0 ? `${natural ? '🂡 BLACKJACK! ' : ''}${dealerText}. Won 🪙 ${fmt(net)}.` : net < 0 ? `${dealerText}. Lost 🪙 ${fmt(-net)}.` : `${dealerText}. Even money.`;
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
    const crashAt = Math.min(50, Math.max(1.05, Math.floor((0.96 / (1 - u)) * 100) / 100));
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

  deploy() {
    initAudio();
    const d = this.data;
    const lo = d.loadout;
    if (!lo.weapons.some(Boolean) && !this.warnedNoGun) {
      this.warnedNoGun = true;
      this.toast('No gun packed! Click DEPLOY again to go in with just your fists.');
      return;
    }
    this.warnedNoGun = false;
    // Whatever you bring leaves the stash for good unless you extract with it.
    const loadout = JSON.parse(JSON.stringify(lo));
    save.update((x) => { x.loadout = { weapons: [null, null], items: [] }; });
    this.onDeploy({
      mapId: d.selectedMap,
      name: (d.look.name || '').trim() || 'High Roller',
      look: wornLook(d.look),
      loadout,
    });
  }
}
