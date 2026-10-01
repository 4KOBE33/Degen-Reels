// The on-screen HUD: chips, weapon, leaderboard, feed, crosshair and messages.
import { WEAPONS, WIN_CHIPS } from './config.js';

const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

export class Hud {
  constructor() {
    this.toastTimer = 0;
    this.boardTimer = 0;
    this.feedItems = [];
    this.lastPrompt = undefined;
  }

  update(dt, game) {
    const p = game.player;
    if (!p) return;
    const w = WEAPONS[p.weapon];
    $('chips').textContent = p.chips;
    $('armor').hidden = p.armor <= 0;
    $('armor').textContent = `🛡️ ${p.armor}`;
    $('weapon').innerHTML = `<span class="icon">${w.icon}</span> ${w.name}${Number.isFinite(p.ammo) ? ` <span class="ammo">${p.ammo}</span>` : ''}`;
    $('goal').style.width = `${Math.min(100, (p.chips / WIN_CHIPS) * 100)}%`;

    this.boardTimer -= dt;
    if (this.boardTimer <= 0) {
      this.boardTimer = 0.25;
      const rows = [...game.combatants].sort((a, b) => b.chips - a.chips);
      $('board').innerHTML = `<div class="title">Biggest stacks · first to ${WIN_CHIPS}</div>`
        + rows.map((c) => `<div class="${c.alive ? '' : 'dead'} ${c.isPlayer ? 'me' : ''}"><span>${escapeHtml(c.name)}</span><span>🪙${c.chips}</span></div>`).join('');
    }

    this.toastTimer -= dt;
    if (this.toastTimer <= 0) $('toast').classList.remove('show');

    const now = performance.now();
    this.feedItems = this.feedItems.filter((f) => now - f.t < 7000);
    $('feed').innerHTML = this.feedItems.map((f) => `<div>${escapeHtml(f.text)}</div>`).join('');

    const respawn = $('respawn');
    if (respawn && !p.alive) respawn.textContent = `Back in ${Math.ceil(p.respawnIn)}…`;
    $('crosshair').hidden = !p.alive;
  }

  prompt(html) {
    if (html === this.lastPrompt) return;
    this.lastPrompt = html;
    $('prompt').hidden = !html;
    if (html) $('prompt').innerHTML = html;
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

  showBust(by) {
    $('center').hidden = false;
    $('center').innerHTML = `<h2>💸 BUSTED 💸</h2><p>${by ? `${escapeHtml(by)} took your last chip.` : 'You blew yourself up. Classic.'}</p><p id="respawn"></p>`;
    clearTimeout(this.bustTimer);
    this.bustTimer = setTimeout(() => this.hideCenter(), 4000);
  }

  showCashout(winner, everyone) {
    const rows = [...everyone].sort((a, b) => b.chips - a.chips);
    $('center').hidden = false;
    $('center').innerHTML = `<h2>${winner.isPlayer ? 'YOU CASHED OUT!' : `${escapeHtml(winner.name)} CASHED OUT`}</h2>
      <table>${rows.map((c) => `<tr class="${c === winner ? 'win' : ''}"><td>${escapeHtml(c.name)}</td><td>🪙 ${c.chips}</td><td>${c.kills} busts</td></tr>`).join('')}</table>
      <p>New round in a few seconds…</p>`;
  }

  hideCenter() {
    $('center').hidden = true;
  }
}
