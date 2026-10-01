// The on-screen HUD: chips, weapon, floor timer, table panels, feed, crosshair and run screens.
import { WEAPONS, RARITIES, FLOORS } from './config.js';

const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function clock(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class Hud {
  constructor() {
    this.toastTimer = 0;
    this.slowTimer = 0;
    this.feedItems = [];
    this.lastPrompt = undefined;
    this.lastPanel = undefined;
    this.onNewRun = () => {};
    this.onMenu = () => {};
    $('runAgain').addEventListener('click', () => this.onNewRun());
    $('toMenu').addEventListener('click', () => this.onMenu());
  }

  update(dt, game) {
    const p = game.player;
    if (!p) return;
    const w = WEAPONS[p.weapon];
    const rarity = RARITIES[p.rarity];
    $('chips').textContent = p.chips;
    $('armor').hidden = p.armor <= 0;
    $('armor').textContent = `🛡️ ${p.armor}`;
    $('weapon').innerHTML = `<span class="icon">${w.icon}</span> <span style="color:${p.rarity ? rarity.css : 'inherit'}">${escapeHtml(p.weaponName)}</span>${Number.isFinite(p.ammo) ? ` <span class="ammo">${p.ammo}</span>` : ''}`;

    // Progress toward the elevator fee.
    const fee = game.floor.fee;
    const ready = p.chips > fee;
    $('goal').style.width = `${Math.min(100, (p.chips / fee) * 100)}%`;
    $('goal').classList.toggle('ready', ready);
    $('goalText').textContent = ready ? '✅ Elevator fee covered!' : `Elevator fee 🪙 ${fee}`;

    const t = game.timeLeft;
    $('floorName').textContent = `FLOOR ${game.floorIndex + 1} · ${game.floor.name.toUpperCase()}`;
    $('timer').textContent = `⏰ ${clock(t)}`;
    $('timer').classList.toggle('urgent', t < 30);

    this.slowTimer -= dt;
    if (this.slowTimer <= 0) {
      this.slowTimer = 0.25;
      const rows = [...game.combatants].filter((c) => c.alive).sort((a, b) => b.chips - a.chips).slice(0, 8);
      $('board').innerHTML = '<div class="title">On this floor</div>'
        + rows.map((c) => `<div class="${c.isPlayer ? 'me' : ''}"><span>${escapeHtml(c.name)}</span><span>🪙${c.chips}</span></div>`).join('');
      const now = performance.now();
      this.feedItems = this.feedItems.filter((f) => now - f.t < 7000);
      $('feed').innerHTML = this.feedItems.map((f) => `<div>${escapeHtml(f.text)}</div>`).join('');
    }

    this.toastTimer -= dt;
    if (this.toastTimer <= 0) $('toast').classList.remove('show');
    $('crosshair').hidden = !p.alive || !!p.busy;
  }

  prompt(html) {
    if (html === this.lastPrompt) return;
    this.lastPrompt = html;
    $('prompt').hidden = !html;
    if (html) $('prompt').innerHTML = html;
  }

  panel(html) {
    if (html === this.lastPanel) return;
    this.lastPanel = html;
    $('table').hidden = !html;
    if (html) $('table').innerHTML = html;
  }

  toast(text, kind = '') {
    const el = $('toast');
    el.textContent = text;
    el.className = `show ${kind}`;
    this.toastTimer = kind === 'big' ? 3.5 : 2.5;
  }

  feed(text) {
    this.feedItems.push({ text, t: performance.now() });
    if (this.feedItems.length > 6) this.feedItems.shift();
    this.slowTimer = 0;
  }

  hitmarker() {
    const el = $('hitmarker');
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  hurt() {
    const el = $('vignette');
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  floorIntro(index, floor) {
    const el = $('intro');
    el.innerHTML = `<div class="kicker">FLOOR ${index + 1} OF ${FLOORS.length}</div><h2>${escapeHtml(floor.name)}</h2>
      <p>Make 🪙 ${floor.fee} and pay the elevator before closing time (${Math.round(floor.time / 60)} min).</p>`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  // Fade to black, swap floors, fade back in.
  elevatorRide(nextIndex, swap) {
    const el = $('fade');
    el.innerHTML = `<h2>▲ GOING UP</h2><p>Floor ${nextIndex + 1}: ${escapeHtml(FLOORS[nextIndex].name)}</p>`;
    el.classList.add('show');
    setTimeout(() => {
      swap();
      setTimeout(() => el.classList.remove('show'), 300);
    }, 1400);
  }

  showRunOver({ won, reason, by, floor, chips, kills, newHats }) {
    const el = $('runover');
    let title;
    let line;
    if (won) {
      title = '💰 YOU CASHED OUT! 💰';
      line = `You beat all ${FLOORS.length} floors and walked out with 🪙 ${chips}.`;
    } else if (reason === 'closing') {
      title = '⏰ CLOSING TIME';
      line = `Security threw you out of Floor ${floor} before you paid the elevator.`;
    } else {
      title = '💸 BUSTED 💸';
      line = by ? `${escapeHtml(by)} took your last chip on Floor ${floor}.` : `You busted yourself on Floor ${floor}. Classic.`;
    }
    $('runTitle').textContent = title;
    $('runLine').innerHTML = `${line}<br>Rivals busted this run: <b>${kills}</b>`;
    $('runUnlocks').innerHTML = newHats && newHats.length
      ? `🔓 Unlocked: ${newHats.map((h) => `<b>${h} hat</b>`).join(', ')}`
      : (won ? '' : 'Back to Floor 1. Your unlocks stay, everything else is gone.');
    el.hidden = false;
    this.panel(null);
    this.prompt(null);
  }

  hideRunOver() {
    $('runover').hidden = true;
  }
}
