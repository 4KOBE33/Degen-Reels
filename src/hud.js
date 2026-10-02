// The raid HUD: health, armor, weapons, quick items, minimap, exits, boss bar, bag and map screens.
import { WEAPONS, PLAYER, EXTRACT_TIME } from './config.js';
import { itemInfo, itemTitle, isGun } from './items.js';

const $ = (id) => document.getElementById(id);

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function clock(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Compass-style direction from the player's facing to a point.
function bearing(p, x, z) {
  const ang = Math.atan2(-(x - p.pos.x), -(z - p.pos.z));
  let d = ang - p.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
  return arrows[(Math.round(-d / (Math.PI / 4)) + 8) % 8];
}

export class Hud {
  constructor() {
    this.toastTimer = 0;
    this.slow = 0;
    this.feedItems = [];
    this.last = {};
    this.raid = null;
    this.onDrop = () => {};
    this.onUse = () => {};
    this.onLeave = () => {};
    this.mini = $('minimap').getContext('2d');
    $('bagList').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      if (b.dataset.act === 'drop') this.onDrop(b.dataset.where, Number(b.dataset.i));
      if (b.dataset.act === 'use') this.onUse(b.dataset.id);
    });
    $('resultsBack').addEventListener('click', () => this.onLeave());
  }

  set(id, html) {
    if (this.last[id] === html) return;
    this.last[id] = html;
    $(id).innerHTML = html;
  }

  update(dt, raid) {
    this.raid = raid;
    const p = raid.player;
    if (!p) return;

    // Health and armor.
    $('hpFill').style.width = `${Math.max(0, (p.hp / p.maxHp) * 100)}%`;
    $('hpFill').classList.toggle('low', p.hp < 35);
    $('armorFill').style.width = `${(p.armor / PLAYER.maxArmor) * 100}%`;
    this.set('hpText', `❤️ ${Math.ceil(Math.max(0, p.hp))}${p.armor > 0 ? ` · 🛡️ ${Math.ceil(p.armor)}` : ''}`);
    this.set('raidChips', `🪙 ${p.chips}`);
    this.set('quick', [
      ['H', '🩹', p.count('bandage') + p.count('soda')],
      ['F', '🛡️', p.count('plate')],
      ['R', '📦', p.count('ammo')],
    ].map(([key, icon, n]) => `<span class="${n ? '' : 'none'}"><kbd>${key}</kbd>${icon}${n}</span>`).join(''));

    // Weapon slots.
    this.set('weapons', [0, 1].map((i) => {
      const g = p.weapons[i];
      const on = i === p.active ? 'on' : '';
      if (!g) return `<div class="slot ${on}"><kbd>${i + 1}</kbd><span class="empty">👊 Empty</span></div>`;
      const info = itemInfo(g);
      return `<div class="slot ${on}"><kbd>${i + 1}</kbd><span style="color:${info.css}">${info.icon} ${escapeHtml(info.name)}</span><b class="ammo">${g.ammo}</b></div>`;
    }).join(''));

    // Backpack bar: always visible so you can see loot land.
    const pack = p.backpack.map((it) => `${it.id}${it.qty || ''}${it.kind || ''}`).join('|');
    if (pack !== this.lastPack) {
      const grew = this.lastPack !== undefined && p.backpack.length > (this.lastPackLen || 0);
      this.lastPack = pack;
      this.lastPackLen = p.backpack.length;
      const slots = [];
      for (let i = 0; i < p.capacity; i++) {
        const it = p.backpack[i];
        if (!it) { slots.push('<span class="s"></span>'); continue; }
        const info = itemInfo(it);
        const isNew = grew && i === p.backpack.length - 1;
        slots.push(`<span class="s ${isNew ? 'new' : ''}" style="border-color:${info.css}" title="${escapeHtml(info.name)}">${info.icon}${!isGun(it) && it.qty > 1 ? `<i>${it.qty}</i>` : ''}</span>`);
      }
      $('packbar').innerHTML = `<div class="t">🎒 Backpack ${p.backpack.length}/${p.capacity} · <kbd>I</kbd> to open</div><div class="slots">${slots.join('')}</div>`;
    }

    // Timer, zone and exits.
    $('timer').classList.toggle('urgent', raid.timeLeft < 60);
    this.slow -= dt;
    if (this.slow <= 0) {
      this.slow = 0.2;
      this.set('timer', `⏰ ${clock(raid.timeLeft)}`);
      this.set('zone', `${escapeHtml(raid.map.zoneName(p.pos.x, p.pos.z))} <span class="tier t${raid.map.tierAt(p.pos.x, p.pos.z)}">${['', 'SAFE-ISH', 'RISKY', 'DEADLY', 'VAULT'][raid.map.tierAt(p.pos.x, p.pos.z)]}</span>`);
      this.set('exits', raid.extracts.filter((e) => e.active).map((e) => `<div>🟢 ${e.name} · ${Math.round(Math.hypot(e.x - p.pos.x, e.z - p.pos.z))}m ${bearing(p, e.x, e.z)}</div>`).join(''));
      const now = performance.now();
      this.feedItems = this.feedItems.filter((f) => now - f.t < 7000);
      this.set('feed', this.feedItems.map((f) => `<div>${escapeHtml(f.text)}</div>`).join(''));
      this.drawMinimap(raid);
    }

    // Extraction countdown.
    if (raid.extractAt && raid.active) {
      $('extracting').hidden = false;
      this.set('extracting', `EXTRACTING… ${Math.ceil(EXTRACT_TIME - raid.extractT)}<small>Stay in the circle</small>`);
    } else $('extracting').hidden = true;

    // Boss health bar while it's close.
    const b = raid.boss;
    const showBoss = b && b.alive && b.pos.distanceTo(p.pos) < 70;
    $('bossbar').hidden = !showBoss;
    if (showBoss) $('bossFill').style.width = `${(b.hp / b.maxHp) * 100}%`;

    this.toastTimer -= dt;
    if (this.toastTimer <= 0) $('toast').classList.remove('show');
    $('crosshair').hidden = !p.alive || !raid.active;
    $('crosshair').classList.toggle('aim', !!p.aiming);
    if (!$('bag').hidden) this.renderBag(p);
  }

  drawMinimap(raid) {
    const ctx = this.mini;
    const size = 180;
    const p = raid.player;
    const view = 140; // meters across
    const img = raid.minimap;
    const scale = img.width / (raid.map.half * 2);
    ctx.save();
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    const sx = (p.pos.x + raid.map.half - view / 2) * scale;
    const sz = (p.pos.z + raid.map.half - view / 2) * scale;
    ctx.fillStyle = '#c99457';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, sx, sz, view * scale, view * scale, 0, 0, size, size);
    const toMini = (x, z) => [((x - p.pos.x) / view + 0.5) * size, ((z - p.pos.z) / view + 0.5) * size];
    // Exits (clamped to the edge if off-screen).
    for (const e of raid.extracts) {
      if (!e.active) continue;
      let [x, y] = toMini(e.x, e.z);
      const dx = x - size / 2;
      const dy = y - size / 2;
      const d = Math.hypot(dx, dy);
      if (d > size / 2 - 8) { x = size / 2 + (dx / d) * (size / 2 - 8); y = size / 2 + (dy / d) * (size / 2 - 8); }
      ctx.fillStyle = '#5ee27a';
      ctx.strokeStyle = '#1b0f2b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // Enemies you could plausibly hear: within 35m.
    for (const m of raid.machines) {
      if (!m.alive || m.pos.distanceTo(p.pos) > 35) continue;
      const [x, y] = toMini(m.pos.x, m.pos.z);
      ctx.fillStyle = m.isBoss ? '#ffc83d' : '#ff5d5d';
      ctx.fillRect(x - (m.isBoss ? 5 : 2.5), y - (m.isBoss ? 5 : 2.5), m.isBoss ? 10 : 5, m.isBoss ? 10 : 5);
    }
    // You.
    ctx.translate(size / 2, size / 2);
    ctx.rotate(-p.yaw);
    ctx.fillStyle = '#fff6e0';
    ctx.strokeStyle = '#1b0f2b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(6, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  drawBigMap(raid) {
    const canvas = $('bigmapCanvas');
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    const s = size / (raid.map.half * 2);
    const tx = (v) => (v + raid.map.half) * s;
    ctx.drawImage(raid.minimap, 0, 0, size, size);
    for (const e of raid.extracts) {
      ctx.fillStyle = e.active ? '#5ee27a' : '#ff5d5d';
      ctx.strokeStyle = '#1b0f2b';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(tx(e.x), tx(e.z), 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1b0f2b';
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${e.name}${e.active ? '' : ' (closed)'}`, tx(e.x), tx(e.z) + (e.z > 0 ? -16 : 26));
    }
    if (raid.boss && raid.boss.alive) {
      ctx.font = '22px sans-serif';
      ctx.fillText('👑', tx(raid.boss.pos.x), tx(raid.boss.pos.z));
    }
    const p = raid.player;
    ctx.save();
    ctx.translate(tx(p.pos.x), tx(p.pos.z));
    ctx.rotate(-p.yaw);
    ctx.fillStyle = '#fff6e0';
    ctx.strokeStyle = '#1b0f2b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(9, 9);
    ctx.lineTo(0, 4);
    ctx.lineTo(-9, 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  renderBag(p) {
    const row = (item, where, i) => {
      const info = itemInfo(item);
      const usable = !isGun(item) && ['heal', 'armor'].includes(info.def.kind);
      return `<div class="bagrow"><span style="color:${info.css}">${itemTitle(item)}</span>${isGun(item) ? `<small>${item.ammo} ammo</small>` : ''}<span class="v">🪙${info.value}</span>
        ${usable ? `<button class="btn tiny" data-act="use" data-id="${item.id}">Use</button>` : ''}
        <button class="btn tiny ghost" data-act="drop" data-where="${where}" data-i="${i}">Drop</button></div>`;
    };
    const total = [...p.weapons.filter(Boolean), ...p.backpack].reduce((n, it) => n + itemInfo(it).value, 0) + p.chips;
    this.set('bagList', `<h3>Weapons</h3>${p.weapons.map((g, i) => (g ? row(g, 'weapon', i) : '<div class="bagrow empty">Empty slot</div>')).join('')}
      <h3>Backpack ${p.backpack.length}/${p.capacity}</h3>${p.backpack.map((it, i) => row(it, 'pack', i)).join('') || '<div class="bagrow empty">Nothing yet. Go find something shiny.</div>'}
      <p class="haul">Carrying 🪙 ${p.chips} chips · haul worth <b>🪙 ${total}</b> if you get out alive</p>`);
  }

  prompt(html) {
    if (html === this.last.prompt) return;
    this.last.prompt = html;
    $('prompt').hidden = !html;
    if (html) $('prompt').innerHTML = html;
  }

  progress(f, label) {
    $('progress').hidden = f === null;
    if (f !== null) {
      $('progressFill').style.width = `${Math.min(100, f * 100)}%`;
      this.set('progressLabel', label);
    }
  }

  toast(text, kind = '') {
    const el = $('toast');
    el.textContent = text;
    el.className = `show ${kind}`;
    this.toastTimer = kind === 'big' ? 3.5 : 2.2;
  }

  feed(text) {
    this.feedItems.push({ text, t: performance.now() });
    if (this.feedItems.length > 6) this.feedItems.shift();
    this.slow = 0;
  }

  hitmarker(kill) {
    const el = $('hitmarker');
    el.classList.remove('show', 'kill');
    void el.offsetWidth;
    el.classList.add('show');
    if (kill) el.classList.add('kill');
  }

  hurt() {
    const el = $('vignette');
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  raidIntro(raid) {
    const open = raid.extracts.filter((e) => e.active).map((e) => e.name).join(' and ');
    const el = $('intro');
    el.innerHTML = `<div class="kicker">DEPLOYING TO</div><h2>LOST VEGAS</h2><p>Exits open: <b>${open}</b>. Loot, survive, get out.</p>`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  raidOver(r) {
    const el = $('results');
    let title;
    let line;
    if (r.success) {
      title = '🚁 EXTRACTED!';
      line = `You got out through the ${escapeHtml(r.where)} with <b>🪙 ${r.value}</b> worth of stuff.`;
    } else if (r.reason === 'time') {
      title = '⏰ LOCKED DOWN';
      line = 'The House sealed Lost Vegas with you inside. Everything you carried is gone.';
    } else if (r.reason === 'abandon') {
      title = '🏳️ ABANDONED';
      line = 'You bailed on the raid. Everything you carried is gone.';
    } else {
      title = '💀 BUSTED';
      line = `${r.by ? `${escapeHtml(r.by)} got you.` : 'You died.'} Everything you carried is gone.`;
    }
    $('resultsTitle').textContent = title;
    $('resultsLine').innerHTML = `${line}<br><small>Machines destroyed: ${r.run.machines} · Raiders busted: ${r.run.raiders}${r.run.boss ? ' · 👑 Took down the Pit Boss!' : ''}</small>`;
    $('resultsItems').innerHTML = r.items.length || r.chips
      ? `${r.chips ? `<span class="chip">🪙 ${r.chips} chips</span>` : ''}${r.items.map((it) => `<span class="chip ${r.success ? '' : 'lost'}" style="color:${itemInfo(it).css}">${itemTitle(it)}</span>`).join('')}`
      : '<span class="chip">Nothing</span>';
    $('resultsItems').classList.toggle('lost', !r.success);
    $('resultsUnlocks').innerHTML = r.newHats && r.newHats.length ? `🔓 Unlocked: ${r.newHats.map((h) => `<b>${h} hat</b>`).join(', ')}` : '';
    el.hidden = false;
    this.prompt(null);
    this.progress(null);
  }
}
