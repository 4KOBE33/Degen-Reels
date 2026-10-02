// The Hub between raids: stash and loadout, the Back Room (gambling), the Fence (selling),
// your look, and settings. Everything here is plain HTML on top of the 3D backdrop.
import { HUB_SLOTS, COLORS, HATS, HAT_UNLOCKS, ITEMS } from './config.js';
import {
  itemInfo, itemTitle, isGun, rollLoot, addToList, addToStash, makeGun, makeItem, weightedIndex, fullAmmo,
} from './items.js';
import { save } from './save.js';
import { MAPS } from './map.js';
import { escapeHtml } from './hud.js';
import { sfx, initAudio, setVolume } from './audio.js';

const $ = (id) => document.getElementById(id);
const HAT_ICONS = { top: '🎩', cowboy: '🤠', visor: '🃏', party: '🥳', crown: '👑' };
const LOADOUT_SLOTS = 8;
const BETS = [25, 100, 250, 1000];

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const drawCard = () => ({ rank: RANKS[Math.floor(Math.random() * 13)], suit: SUITS[Math.floor(Math.random() * 4)] });
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
const cardHtml = (c, hidden) => (hidden ? '<span class="pcard back"></span>'
  : `<span class="pcard ${c.suit === '♥' || c.suit === '♦' ? 'red' : ''}">${c.rank}${c.suit}</span>`);

export class Hub {
  constructor({ onDeploy, onMapChange }) {
    this.onDeploy = onDeploy;
    this.onMapChange = onMapChange || (() => {});
    this.tab = 'loadout';
    this.game = 'slots';
    this.bet = 100;
    this.bj = null;
    this.crash = null;
    this.slotSpin = null;
    this.armedReset = false;
    const d = save.get();
    if (!d.loadout) save.update((x) => { x.loadout = { weapons: [null, null], items: [] }; });
    if (!d.selectedMap || !MAPS[d.selectedMap]) save.update((x) => { x.selectedMap = 'vegas'; });
    if (d.look.color === null) save.update((x) => { x.look.color = COLORS[Math.floor(Math.random() * COLORS.length)]; });

    $('hubTabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      this.tab = b.dataset.tab;
      initAudio();
      this.render();
    });
    $('hubBody').addEventListener('click', (e) => this.onClick(e));
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

  // ---------- rendering ----------

  render() {
    const d = this.data;
    const stashValue = d.stash.items.reduce((n, it) => n + itemInfo(it).value, 0);
    $('hubWallet').innerHTML = `🪙 <b>${d.stash.chips}</b><small>Stash worth 🪙 ${stashValue} · Raids ${d.stats.raids} · Extracts ${d.stats.extracts} · Best haul 🪙 ${d.stats.bestHaul}</small>`;
    document.querySelectorAll('#hubTabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.tab));
    const body = {
      loadout: () => this.renderLoadout(),
      backroom: () => this.renderBackRoom(),
      fence: () => this.renderFence(),
      look: () => this.renderLook(),
      settings: () => this.renderSettings(),
    }[this.tab]();
    $('hubBody').innerHTML = body;
    if (this.tab === 'backroom' && this.game === 'crash') this.drawCrash();
    const lo = d.loadout;
    const hasGun = lo.weapons.some(Boolean);
    const m = MAPS[d.selectedMap];
    $('deploy').innerHTML = hasGun ? `DEPLOY TO ${m.name.toUpperCase()}` : 'DEPLOY (no gun!)';
  }

  itemCard(item, act, i, extra = '') {
    const info = itemInfo(item);
    return `<button class="item r${info.rarity}" data-act="${act}" data-i="${i}" title="${escapeHtml(info.name)} · worth 🪙${info.value}">
      <span class="icon">${info.icon}</span><span class="nm" style="color:${info.css}">${escapeHtml(info.name)}</span>
      <span class="meta">${isGun(item) ? `${Number.isFinite(item.ammo) ? item.ammo : fullAmmo(item.kind, item.rarity)} ammo` : item.qty > 1 ? `×${item.qty}` : ''}</span>${extra}</button>`;
  }

  renderLoadout() {
    const d = this.data;
    const lo = d.loadout;
    const noGuns = !d.stash.items.some(isGun) && !lo.weapons.some(Boolean);
    const maps = Object.entries(MAPS).map(([id, m]) => `<button class="mapcard ${d.selectedMap === id ? 'on' : ''}" data-act="map" data-m="${id}">
        <span class="icon">${m.icon}</span><b>${m.name}</b><small>${m.size} · ${m.danger}</small><span class="blurb">${m.blurb}</span></button>`).join('');
    return `<h3>Choose a map</h3><div class="maps">${maps}</div>
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
      ${valuables.length ? `<button class="btn" data-act="sellvaluables">Sell all valuables · 🪙 ${total}</button>` : ''}
      <div class="grid">${d.stash.items.map((it, i) => this.itemCard(it, 'sell', i, `<span class="price">Sell 🪙${itemInfo(it).value}</span>`)).join('') || '<p class="hint">Nothing to sell.</p>'}</div>`;
  }

  renderLook() {
    const { look } = this.data;
    return `<h3>Your look</h3>
      <input id="lookName" maxlength="14" placeholder="Your name" value="${escapeHtml(look.name || '')}">
      <div class="label">Color</div>
      <div class="swatches">${COLORS.map((c) => `<button class="swatch ${c === look.color ? 'on' : ''}" data-act="color" data-c="${c}" style="background:#${c.toString(16).padStart(6, '0')}" aria-label="Color"></button>`).join('')}</div>
      <div class="label">Hat</div>
      <div class="hats">${HATS.map((h) => {
    const open = save.hatUnlocked(h);
    const tip = open ? `${h} hat` : `Locked: ${HAT_UNLOCKS[h].text}`;
    return `<button class="hat ${h === look.hat ? 'on' : ''} ${open ? '' : 'locked'}" data-act="hat" data-h="${h}" title="${tip}" aria-label="${tip}">${open ? HAT_ICONS[h] : '🔒'}</button>`;
  }).join('')}</div>
      <p class="hint">${HATS.filter((h) => !save.hatUnlocked(h)).map((h) => `🔒 ${h}: ${HAT_UNLOCKS[h].text}`).join(' · ') || 'Every hat unlocked. Fancy.'}</p>`;
  }

  renderSettings() {
    const s = this.data.settings;
    return `<h3>Settings</h3>
      <label class="slider">Mouse sensitivity <b id="sensVal">${s.sensitivity.toFixed(2)}x</b><input type="range" id="sens" min="0.1" max="3" step="0.05" value="${s.sensitivity}"></label>
      <label class="slider">Field of view <b id="fovVal">${s.fov}°</b><input type="range" id="fov" min="60" max="100" step="1" value="${s.fov}"></label>
      <label class="slider">Volume <b id="volVal">${Math.round(s.volume * 100)}%</b><input type="range" id="vol" min="0" max="1" step="0.05" value="${s.volume}"></label>
      <button class="btn ghost" data-act="reset">${this.armedReset ? 'Click again to wipe ALL progress' : 'Reset progress'}</button>`;
  }

  renderBackRoom() {
    const d = this.data;
    const tabs = [['slots', '🎰 Loot Reels'], ['blackjack', '🃏 Blackjack'], ['roulette', '🎡 Roulette'], ['crash', '🚀 Crash']]
      .map(([k, n]) => `<button class="subtab ${this.game === k ? 'on' : ''}" data-act="game" data-g="${k}">${n}</button>`).join('');
    const bets = `<div class="bets">Bet: ${BETS.map((b) => `<button class="bet ${b === this.bet ? 'on' : ''}" data-act="bet" data-b="${b}">🪙${b}</button>`).join('')}</div>`;
    let game = '';
    if (this.game === 'slots') {
      const s = this.slotSpin;
      game = `<p class="hint">Spend stash chips on a mystery prize. Gold Reels are the only way to win a Legendary here.</p>
        <div class="reels">${(s ? s.show : ['🎰', '🎰', '🎰']).map((x) => `<span>${x}</span>`).join('')}</div>
        <div class="row">${HUB_SLOTS.map((m, i) => `<button class="btn" data-act="pull" data-i="${i}" ${s && s.running ? 'disabled' : ''}>${m.name}<br><small>🪙 ${m.cost}</small></button>`).join('')}</div>
        ${s && s.prize ? `<p class="msg">${s.prize}</p>` : ''}`;
    } else if (this.game === 'blackjack') {
      const g = this.bj;
      const playing = g && g.state === 'play';
      game = `${bets}${g ? `<div class="hands"><div><span class="who">Dealer ${playing ? '' : handValue(g.dealer)}</span>${g.dealer.map((c, i) => cardHtml(c, playing && i === 1)).join('')}</div>
        <div><span class="who">You ${handValue(g.hand)}</span>${g.hand.map((c) => cardHtml(c)).join('')}</div></div>` : ''}
        <div class="row">${playing ? `<button class="btn" data-act="hit">Hit</button><button class="btn" data-act="stand">Stand</button>${g.hand.length === 2 ? '<button class="btn" data-act="double">Double</button>' : ''}`
    : '<button class="btn" data-act="deal">Deal</button>'}</div>${g && g.msg ? `<p class="msg">${g.msg}</p>` : ''}`;
    } else if (this.game === 'roulette') {
      const r = this.roulette;
      game = `${bets}<div class="wheel ${r && r.spinning ? 'spin' : ''} ${r && !r.spinning ? r.color : ''}">${r ? (r.spinning ? '…' : r.n) : '?'}</div>
        <div class="row"><button class="btn red" data-act="spin" data-k="red">Red · 2x</button><button class="btn black" data-act="spin" data-k="black">Black · 2x</button><button class="btn green" data-act="spin" data-k="green">Green · 14x</button></div>
        ${r && r.msg ? `<p class="msg">${r.msg}</p>` : ''}`;
    } else {
      const c = this.crash;
      game = `${c && c.running ? '' : bets}<canvas id="crashGraph" class="crashgraph" width="520" height="200"></canvas>
        <div id="crashMult" class="mult ${c && c.crashed ? 'crashed' : ''}">${c ? `${c.mult.toFixed(2)}x` : '1.00x'}</div>
        <div class="row">${c && c.running
    ? `<button id="crashBtn" class="btn big cashout" data-act="cashout">CASH OUT 🪙${Math.floor(c.bet * c.mult)}</button>`
    : '<button class="btn big" data-act="launch">LAUNCH 🚀</button>'}</div>
        <p class="hint">The multiplier climbs until the rocket blows up. Cash out before it does.</p>
        ${c && c.msg ? `<p class="msg">${c.msg}</p>` : ''}`;
    }
    return `<h3>The Back Room</h3><div class="subtabs">${tabs}</div><div class="game">${game}</div>
      <p class="hint">Stash chips: 🪙 ${d.stash.chips}. The house edge is real.</p>`;
  }

  // ---------- actions ----------

  spend(amount) {
    if (this.data.stash.chips < amount) {
      this.toast(`You need 🪙 ${amount} in your stash.`);
      sfx.deny();
      return false;
    }
    save.update((d) => { d.stash.chips -= amount; });
    return true;
  }

  earn(amount) {
    save.update((d) => { d.stash.chips += amount; });
  }

  onInput(e) {
    const s = this.data.settings;
    if (e.target.id === 'sens') { save.update((d) => { d.settings.sensitivity = Number(e.target.value); }); $('sensVal').textContent = `${s.sensitivity.toFixed(2)}x`; }
    if (e.target.id === 'fov') { save.update((d) => { d.settings.fov = Number(e.target.value); }); $('fovVal').textContent = `${s.fov}°`; }
    if (e.target.id === 'vol') { save.update((d) => { d.settings.volume = Number(e.target.value); }); setVolume(s.volume); $('volVal').textContent = `${Math.round(s.volume * 100)}%`; }
    if (e.target.id === 'lookName') save.update((d) => { d.look.name = e.target.value.slice(0, 14); });
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
        this.toast(`Sold for 🪙 ${v}`);
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
        this.toast(`Sold everything for 🪙 ${total}`);
        break;
      }
      case 'color': save.update((x) => { x.look.color = Number(b.dataset.c); }); break;
      case 'hat':
        if (!save.hatUnlocked(b.dataset.h)) { this.toast(`🔒 ${HAT_UNLOCKS[b.dataset.h].text} to unlock.`); return; }
        save.update((x) => { x.look.hat = b.dataset.h; });
        break;
      case 'reset':
        if (!this.armedReset) { this.armedReset = true; break; }
        this.armedReset = false;
        save.reset();
        save.update((x) => { x.loadout = { weapons: [null, null], items: [] }; x.look.color = COLORS[0]; });
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
      case 'pull': this.pullSlot(HUB_SLOTS[i]); return;
      case 'deal': this.deal(); break;
      case 'hit': this.bj.hand.push(drawCard()); if (handValue(this.bj.hand) >= 21) this.settle(); break;
      case 'stand': this.settle(); break;
      case 'double':
        if (!this.spend(this.bj.bet)) return;
        this.bj.bet *= 2;
        this.bj.hand.push(drawCard());
        this.settle();
        break;
      case 'spin': this.spinRoulette(b.dataset.k); return;
      case 'launch': this.launchCrash(); return;
      case 'cashout': this.cashOutCrash(); return;
      default: return;
    }
    this.render();
  }

  pullSlot(machine) {
    if (this.slotSpin && this.slotSpin.running) return;
    if (!this.spend(machine.cost)) return;
    const symbols = ['🍒', '💎', '🔔', '7️⃣', '🎲', '🔫', '💰'];
    const spin = { running: true, show: ['❔', '❔', '❔'], prize: '' };
    this.slotSpin = spin;
    sfx.lever();
    let ticks = 0;
    const timer = setInterval(() => {
      ticks++;
      spin.show = spin.show.map((s, k) => (ticks > 8 + k * 4 ? s : symbols[Math.floor(Math.random() * symbols.length)]));
      if (ticks % 2 === 0) sfx.tick();
      if (ticks > 18) {
        clearInterval(timer);
        spin.running = false;
        let loot = rollLoot(machine.tier);
        if (loot.chips) loot = { chips: loot.chips * 3 };
        if (loot.chips) {
          this.earn(loot.chips);
          spin.prize = `Paid out 🪙 ${loot.chips}.`;
          sfx.win();
        } else {
          save.update((x) => addToStash(x.stash.items, loot));
          const info = itemInfo(loot);
          spin.prize = `You won: <b style="color:${info.css}">${itemTitle(loot)}</b> (worth 🪙${info.value})`;
          if (info.rarity >= 3) sfx.jackpot(); else sfx.win();
        }
      }
      if (this.tab === 'backroom' && this.game === 'slots') this.render();
    }, 80);
    this.render();
  }

  deal() {
    if (this.bj && this.bj.state === 'play') return;
    if (!this.spend(this.bet)) return;
    this.bj = { bet: this.bet, hand: [drawCard(), drawCard()], dealer: [drawCard(), drawCard()], state: 'play', msg: '' };
    if (handValue(this.bj.hand) === 21) this.settle();
  }

  settle() {
    const g = this.bj;
    const p = handValue(g.hand);
    if (p <= 21) while (handValue(g.dealer) < 17) g.dealer.push(drawCard());
    const dv = handValue(g.dealer);
    let pay = 0;
    if (p > 21) g.msg = `Bust with ${p}. Lost 🪙 ${g.bet}.`;
    else if (p === 21 && g.hand.length === 2 && !(dv === 21 && g.dealer.length === 2)) { pay = Math.floor(g.bet * 2.5); g.msg = `BLACKJACK! Won 🪙 ${pay}.`; }
    else if (dv > 21 || p > dv) { pay = g.bet * 2; g.msg = `${dv > 21 ? `Dealer busts (${dv})` : `${p} beats ${dv}`}. Won 🪙 ${pay}.`; }
    else if (p === dv) { pay = g.bet; g.msg = `Push at ${p}. Bet returned.`; }
    else g.msg = `Dealer has ${dv}. Lost 🪙 ${g.bet}.`;
    if (pay) { this.earn(pay); sfx.win(); } else sfx.deny();
    g.state = 'done';
  }

  spinRoulette(kind) {
    if (this.roulette && this.roulette.spinning) return;
    if (!this.spend(this.bet)) return;
    const bet = this.bet;
    this.roulette = { spinning: true };
    sfx.lever();
    this.render();
    setTimeout(() => {
      const n = Math.floor(Math.random() * 37);
      const color = n === 0 ? 'green' : RED.has(n) ? 'red' : 'black';
      const pays = kind === 'green' ? 14 : 2;
      const won = color === kind;
      if (won) { this.earn(bet * pays); sfx.win(); } else sfx.deny();
      this.roulette = { spinning: false, n, color, msg: `${n} ${color.toUpperCase()}. ${won ? `Won 🪙 ${bet * pays}!` : `Lost 🪙 ${bet}.`}` };
      if (this.tab === 'backroom') this.render();
    }, 1600);
  }

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
        c.msg = `💥 CRASHED at ${c.crashAt.toFixed(2)}x. Lost 🪙 ${c.bet}.`;
        sfx.boom();
        if (this.tab === 'backroom' && this.game === 'crash') this.render();
        this.drawCrash();
        return;
      }
      // Only touch the number and the button text, so the button you're clicking stays put.
      const mult = document.getElementById('crashMult');
      const btn = document.getElementById('crashBtn');
      if (mult) mult.textContent = `${c.mult.toFixed(2)}x`;
      if (btn) btn.textContent = `CASH OUT 🪙${Math.floor(c.bet * c.mult)}`;
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
    ctx.fillStyle = 'rgba(27,15,43,0.85)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(0, (h / 5) * i);
      ctx.lineTo(w, (h / 5) * i);
      ctx.stroke();
    }
    if (!c || !c.points.length) {
      ctx.fillStyle = '#fff6e0';
      ctx.font = "28px 'Luckiest Guy', sans-serif";
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
    c.msg = `✅ Cashed out at ${c.mult.toFixed(2)}x: won 🪙 ${win}!`;
    sfx.win();
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
      color: d.look.color,
      hat: save.hatUnlocked(d.look.hat) ? d.look.hat : 'top',
      loadout,
    });
  }
}

export { weightedIndex };
