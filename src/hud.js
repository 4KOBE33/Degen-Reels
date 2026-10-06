// The raid HUD: health, armor, weapons, quick items, minimap, exits, boss bar, bag and map screens.
import { TIER_COLORS } from './containers.js';
import { WEAPONS, PLAYER, EXTRACT_TIME, ITEMS } from './config.js';
import { itemInfo, itemTitle, isGun, fullAmmo, isBelt, isConsumable } from './items.js';
import { iconHtml } from './icons.js';
import { keyName } from './keys.js';
import { save } from './save.js';
import { levelInfo, TIER_NAMES, lookName } from './progress.js';

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
    this.onReload = () => {};
    this.onPickThrow = () => {};
    this.onPickThrowFrom = () => {};
    this.onMove = () => {};
    this.onQuick = () => {};
    this.onLeave = () => {};
    this.mini = $('minimap').getContext('2d');
    this.selected = null; // { where: 'weapon' | 'pack', i }
    this.onEquip = () => {};
    this.onUnequip = () => {};
    $('bagList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const { act, where } = b.dataset;
      const i = Number(b.dataset.i);
      if (act === 'select') this.selected = { where, i };
      if (act === 'drop') { this.onDrop(where, i); this.selected = null; }
      if (act === 'use') this.onUse(b.dataset.id);
      if (act === 'reload') this.onReload();
      if (act === 'pickthrow') this.onPickThrow(b.dataset.id);
      if (act === 'movepack') { this.onMove({ where, i }, { where: 'pack', i: 999 }); this.selected = null; }
      if (act === 'movebelt') { this.onMove({ where, i }, { where: 'belt', i: 999 }); this.selected = null; }
      if (act === 'topack') { this.onMove({ where: 'pocket', i }, { where: 'pack', i: 999 }); this.selected = null; }
      if (act === 'topocket') {
        const p = this.raid && this.raid.player;
        const free = p && p.pocket ? p.pocket.indexOf(null) : -1;
        this.onMove({ where, i }, { where: 'pocket', i: free >= 0 ? free : 0 });
        this.selected = null;
      }
      if (act === 'equip') { this.onEquip(i); this.selected = null; }
      if (act === 'unequip') { this.onUnequip(i); this.selected = null; }
      this.last.bagList = null;
    });
    // Drag and drop: guns onto weapon slots, items around the backpack, anything onto the floor,
    // throwables onto the throwable slot.
    const bag = $('bagList');
    const slotOf = (el) => (el && el.dataset.where ? { where: el.dataset.where, i: Number(el.dataset.i) } : null);
    bag.addEventListener('dragstart', (e) => {
      const el = e.target.closest('[draggable="true"]');
      if (!el) return;
      this.dragging = slotOf(el);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', JSON.stringify(this.dragging));
      el.classList.add('dragging');
      bag.classList.add('isdragging');
    });
    bag.addEventListener('dragend', () => {
      this.dragging = null;
      bag.classList.remove('isdragging');
      $('bag').classList.remove('dropout');
      bag.querySelectorAll('.over, .dragging').forEach((x) => x.classList.remove('over', 'dragging'));
    });
    bag.addEventListener('dragover', (e) => {
      const t = e.target.closest('[data-drop]');
      if (!t || !this.dragging) return;
      e.preventDefault();
      bag.querySelectorAll('.over').forEach((x) => x !== t && x.classList.remove('over'));
      t.classList.add('over');
    });
    bag.addEventListener('dragleave', (e) => { const t = e.target.closest('[data-drop]'); if (t && !t.contains(e.relatedTarget)) t.classList.remove('over'); });
    bag.addEventListener('drop', (e) => {
      const t = e.target.closest('[data-drop]');
      const from = this.dragging;
      if (!t || !from) return;
      e.preventDefault();
      e.stopPropagation();
      const kind = t.dataset.drop;
      if (kind === 'ground') this.onDrop(from.where, from.i);
      else if (kind === 'throw') this.onPickThrowFrom(from);
      else this.onMove(from, { where: t.dataset.where, i: Number(t.dataset.i) });
      this.selected = null;
      this.dragging = null;
      this.last.bagList = null;
    });
    // Drag something anywhere that isn't a slot (off the panel, onto empty space) to drop it.
    const overlay = $('bag');
    overlay.addEventListener('dragover', (e) => {
      if (!this.dragging) return;
      e.preventDefault();
      overlay.classList.toggle('dropout', !e.target.closest('[data-drop]'));
    });
    overlay.addEventListener('drop', (e) => {
      const from = this.dragging;
      overlay.classList.remove('dropout');
      if (!from || e.target.closest('[data-drop]')) return;
      e.preventDefault();
      this.onDrop(from.where, from.i);
      this.selected = null;
      this.dragging = null;
      this.last.bagList = null;
    });
    // Double-click: equip a gun / stash a weapon / use or ready an item.
    bag.addEventListener('dblclick', (e) => {
      const el = e.target.closest('.islot[data-where]');
      if (!el) return;
      this.onQuick(slotOf(el));
      this.selected = null;
      this.last.bagList = null;
    });
    // Right-click does the same, Arc Raiders style.
    bag.addEventListener('contextmenu', (e) => {
      const el = e.target.closest('.islot[data-where]');
      if (!el) return;
      e.preventDefault();
      this.onQuick(slotOf(el));
      this.selected = null;
      this.last.bagList = null;
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
    $('staminaFill').style.width = `${(p.stamina / PLAYER.maxStamina) * 100}%`;
    $('staminaFill').classList.toggle('winded', p.winded);
    const cold = raid.hazards && raid.hazards.cold;
    $('warmRow').hidden = !cold;
    if (cold) {
      $('warmFill').style.width = `${(p.warmth / PLAYER.maxWarmth) * 100}%`;
      $('warmFill').className = p.warmth < 25 ? 'freezing' : '';
      this.set('warmIcon', p.warmSource === 'fire' ? '🔥' : p.warmSource === 'inside' ? '🏠' : p.warmth < 25 ? '🥶' : '❄️');
    }
    $('frost').style.opacity = cold ? Math.max(0, (35 - p.warmth) / 35).toFixed(2) : 0;
    this.set('hpText', `❤️ ${Math.ceil(Math.max(0, p.hp))}${p.armor > 0 ? ` · 🛡️ ${Math.ceil(p.armor)}` : ''}`);
    this.set('raidChips', `🪙 ${p.chips}`);
    // The key list is for learning: it fades after the first 20 seconds once you've a few raids in.
    const learning = (save.get().stats.raids || 0) < 5 || raid.elapsed < 20;
    $('keyhint').classList.toggle('gone', !learning);
    this.set('keyhint', `${keyName('bag')} backpack · ${keyName('map')} map · ${keyName('pov')} camera · ${keyName('heal')} heal · ${keyName('armor')} armor · ${keyName('reload')} reload · ${keyName('throw')} throw · ${keyName('aim')} aim · Esc controls`);
    // Downed banner: bleed-out timer and what you can do about it.
    const dn = $('downed');
    dn.hidden = !(p.downed && p.alive);
    document.body.classList.toggle('isdowned', !dn.hidden);
    if (!dn.hidden) {
      const tok = p.count('token');
      this.set('downed', `<b>YOU'RE DOWN</b><div class="bleed"><i style="width:${Math.max(0, (p.bleed / PLAYER.bleedTime) * 100).toFixed(1)}%"></i></div>
        <small>Bleeding out in ${Math.ceil(p.bleed)}s · ${Math.max(0, Math.ceil(p.downHp))} hits left in you</small>
        <p>${tok ? `<kbd>${keyName('use')}</kbd> hold to use a 🎟️ Second Chance Token (${tok})` : 'Crawl to cover. A friendly raider might come pick you up.'} · <kbd>${keyName('jump')}</kbd> hold to give up</p>`);
    }
    const thr = p.currentThrowable();
    this.set('quick', [
      [keyName('heal'), '🩹', p.count('bandage') + p.count('soda')],
      [keyName('armor'), '🛡️', p.count('plate')],
      [keyName('reload'), '📦', p.count('ammo')],
      [keyName('throw'), thr ? ITEMS[thr].icon : '💣', thr ? p.count(thr) : 0, p.throwables().length > 1 ? `<small>${keyName('cycleThrow')}⇄</small>` : ''],
      ...(p.count('fuel') || p.boost > 0 ? [[keyName('boost'), '🧃', p.boost > 0 ? `${Math.ceil(p.boost)}s` : p.count('fuel')]] : []),
      ...(raid.hazards && raid.hazards.cold ? [[keyName('cocoa'), '☕', p.count('cocoa')]] : []),
    ].map(([key, icon, n, extra = '']) => `<span class="${n ? '' : 'none'}"><kbd>${key}</kbd>${icon}${n}${extra}</span>`).join(''));

    // Weapon slots.
    this.set('weapons', [0, 1].map((i) => {
      const g = p.weapons[i];
      const on = i === p.active ? 'on' : '';
      const wk = keyName(i ? 'weapon2' : 'weapon1');
      if (!g) return `<div class="slot ${on}"><kbd>${wk}</kbd><span class="empty">👊 Empty</span></div>`;
      const info = itemInfo(g);
      // Warn when the gun is running low, and say how to fix it.
      const low = Number.isFinite(g.ammo) && g.ammo <= fullAmmo(g.kind, g.rarity) * 0.2;
      const tip = low && i === p.active ? (p.count('ammo') ? `<em class="tip">${keyName('reload')} to reload</em>` : '<em class="tip out">no ammo boxes</em>') : '';
      return `<div class="slot ${on} ${low ? 'low' : ''}"><kbd>${wk}</kbd><span style="color:${info.css}">${iconHtml(g)} ${escapeHtml(info.name)}</span><b class="ammo">${g.ammo}</b>${tip}</div>`;
    }).join(''));

    // Backpack bar: always visible so you can see loot land.
    const pack = p.backpack.map((it) => `${it.id}${it.qty || ''}${it.kind || ''}`).join('|');
    if (pack !== this.lastPack) {
      const grew = this.lastPack !== undefined && p.backpack.length > (this.lastPackLen || 0);
      this.lastPack = pack;
      this.lastPackLen = p.backpack.length;
      // The bar shows loot; consumables are on the belt (the H/F/R/T counts below).
      const loot = p.backpack.filter((it) => !isBelt(it));
      const newest = p.backpack[p.backpack.length - 1];
      const slots = [];
      for (let i = 0; i < p.capacity; i++) {
        const it = loot[i];
        if (!it) { slots.push('<span class="s"></span>'); continue; }
        const info = itemInfo(it);
        const isNew = grew && it === newest;
        slots.push(`<span class="s ${isNew ? 'new' : ''}" style="border-color:${info.css}" title="${escapeHtml(info.name)}">${iconHtml(it)}${!isGun(it) && it.qty > 1 ? `<i>${it.qty}</i>` : ''}</span>`);
      }
      $('packbar').innerHTML = `<div class="t">🎒 Backpack ${loot.length}/${p.capacity} · 🩹 Belt ${p.beltUsed}/${p.room.belt} · <kbd>Q</kbd> to open</div><div class="slots">${slots.join('')}</div>`;
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
    const call = raid.active ? raid.extracts.find((e) => e.call) : null;
    if (call) {
      const left = Math.ceil((raid.extractTime || EXTRACT_TIME) - call.call.t);
      const inside = raid.extractAt === call;
      const dist = Math.round(Math.hypot(call.x - p.pos.x, call.z - p.pos.z));
      $('extracting').hidden = false;
      $('extracting').classList.toggle('away', !inside);
      this.set('extracting', inside ? `🚁 RIDE IN ${left}s<small>Hold the circle. Everything heard that siren.</small>`
        : `📣 ${escapeHtml(call.name)} RIDE IN ${left}s<small>${dist}m away · be in the circle when it lands</small>`);
    } else if (raid.extractAt && raid.active && raid.extractAt.cooldown > 0) {
      $('extracting').hidden = false;
      this.set('extracting', `RIDE COMING BACK IN ${Math.ceil(raid.extractAt.cooldown)}s<small>Someone just left from here</small>`);
    } else $('extracting').hidden = true;

    // Boss health bar while it's close.
    const b = raid.boss;
    const showBoss = b && b.alive && b.pos.distanceTo(p.pos) < 70;
    $('bossbar').hidden = !showBoss;
    if (showBoss) {
      $('bossFill').style.width = `${(b.hp / b.maxHp) * 100}%`;
      const ph = b.bossPhase || 1;
      this.set('bossName', `👑 ${b.name.toUpperCase()} · ${['', `PHASE 1: HIT ${(b.theme && b.theme.weak) || 'THE SCREEN'}`, 'PHASE 2: OVERCLOCKED · HIT THE CORE ON HIS BACK', 'PHASE 3: TILT · HIT THE TOP OF HIS HEAD'][ph]}${b.invuln > 0 ? ' · 🛡️' : ''}`);
      $('bossbar').dataset.phase = ph;
    }

    this.toastTimer -= dt;
    if (this.toastTimer <= 0) $('toast').classList.remove('show');
    $('crosshair').hidden = !p.alive || !raid.active;
    // Slow guns (sniper, rifle, shotguns, rocket) and reloads: a ring that fills back up around
    // the crosshair until you can fire again.
    const cdOn = p.alive && raid.active && p.cooldown > 0.05 && (p.cdMax || 0) >= 0.5;
    $('cdRing').hidden = !cdOn;
    if (cdOn) {
      const k = Math.max(0, Math.min(1, 1 - p.cooldown / p.cdMax));
      $('cdArc').style.strokeDashoffset = `${(169.65 * (1 - k)).toFixed(1)}`;
      const reloading = p.cdKind === 'reload';
      $('cdRing').classList.toggle('reload', reloading);
      $('cdRing').classList.toggle('almost', k > 0.82);
      const txt = reloading ? `RELOAD ${p.cooldown.toFixed(1)}s` : `${p.cooldown.toFixed(1)}s`;
      if ($('cdText').textContent !== txt) $('cdText').textContent = txt;
      this.cdWas = reloading ? 'reload' : 'shot';
    } else if (this.cdWas) {
      // Ready again: a quick ring pops out from the crosshair.
      const pop = $('cdPop');
      pop.classList.remove('go', 'reload');
      void pop.offsetWidth;
      pop.classList.add('go');
      if (this.cdWas === 'reload') pop.classList.add('reload');
      this.cdWas = null;
    }
    // The crosshair opens up when your aim is worse (running, jumping) and tightens when aiming.
    const gap = 8 * p.aimPenalty();
    this.gap = (this.gap || gap) + (gap - (this.gap || gap)) * Math.min(1, dt * 12);
    $('crosshair').style.setProperty('--gap', `${this.gap.toFixed(1)}px`);
    if (!$('bag').hidden) this.renderBag(p);
  }

  drawMinimap(raid) {
    const ctx = this.mini;
    // The canvas is drawn at twice its on-screen size so it stays sharp.
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    const size = 180;
    const c = size / 2;
    const p = raid.player;
    const view = 150; // meters across
    const img = raid.minimap;
    const scale = img.width / (raid.map.half * 2);
    const toMini = (x, z) => [((x - p.pos.x) / view + 0.5) * size, ((z - p.pos.z) / view + 0.5) * size];
    const clampEdge = (x, y, pad) => {
      const dx = x - c;
      const dy = y - c;
      const d = Math.hypot(dx, dy);
      if (d <= c - pad) return [x, y, false];
      return [c + (dx / d) * (c - pad), c + (dy / d) * (c - pad), true];
    };
    ctx.save();
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath();
    ctx.arc(c, c, c, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = raid.map.mapGround || '#e7c08a';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, (p.pos.x + raid.map.half - view / 2) * scale, (p.pos.z + raid.map.half - view / 2) * scale, view * scale, view * scale, 0, 0, size, size);

    // Range ring.
    ctx.strokeStyle = 'rgba(27,15,43,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(c, c, size * 0.25, 0, Math.PI * 2);
    ctx.stroke();

    // View cone.
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(-p.yaw);
    const cone = ctx.createRadialGradient(0, 0, 4, 0, 0, 60);
    cone.addColorStop(0, 'rgba(255,246,224,0.55)');
    cone.addColorStop(1, 'rgba(255,246,224,0)');
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 60, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Rare loot nearby (Epic and up) glows on the map.
    for (const pk of raid.pickups) {
      if (pk.spot.distanceTo(p.pos) > view / 2) continue;
      const css = pk.item.id === 'gun' ? ['', '', '#c084fc', '#ffc83d'][pk.item.rarity] : (pk.item.id === 'clover' || pk.item.id === 'crown' ? '#ffc83d' : '');
      if (!css) continue;
      const [x, y] = toMini(pk.spot.x, pk.spot.z);
      ctx.fillStyle = css;
      ctx.strokeStyle = '#1b0f2b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r = i % 2 ? 2 : 5;
        ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Unsearched containers nearby: little loot squares, colored by tier.
    for (const k of raid.containers) {
      if (k.opened || Math.abs(k.spot.x - p.pos.x) > 60 || Math.abs(k.spot.z - p.pos.z) > 60) continue;
      const [x, y] = toMini(k.spot.x, k.spot.z);
      ctx.fillStyle = TIER_COLORS[k.tier] || '#e5e7eb';
      ctx.strokeStyle = '#1b0f2b';
      ctx.lineWidth = 1.2;
      ctx.fillRect(x - 2.5, y - 2.5, 5, 5);
      ctx.strokeRect(x - 2.5, y - 2.5, 5, 5);
    }
    // Machines you could hear (within 40m).
    for (const m of raid.machines) {
      if (!m.alive || m.isBoss || m.pos.distanceTo(p.pos) > 40) continue;
      const [x, y] = toMini(m.pos.x, m.pos.z);
      ctx.fillStyle = m.type === 'gator' ? '#4d7c0f' : '#ff5d5d';
      ctx.strokeStyle = '#1b0f2b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // Squadmates: always shown, pinned to the edge when far away.
    for (const c of raid.combatants) {
      if (c.isPlayer || !c.alive || !(c.human || (c.puppet && c.netId && c.netId[0] === 'p'))) continue;
      if (raid.net && raid.net.ally && !raid.net.ally(c)) continue; // enemy players aren't on your map
      const [x, y] = clampEdge(...toMini(c.pos.x, c.pos.z), 8);
      ctx.fillStyle = c.downed ? '#ff9f43' : '#2ee6d6';
      ctx.strokeStyle = '#1b0f2b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (raid.boss && raid.boss.alive) {
      const [bx, by] = clampEdge(...toMini(raid.boss.pos.x, raid.boss.pos.z), 10);
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('👑', bx, by);
    }

    // Open exits, pinned to the rim with a distance when they're off the map.
    ctx.font = "bold 10px Nunito, sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const e of raid.extracts) {
      if (!e.active) continue;
      const [x, y, edge] = clampEdge(...toMini(e.x, e.z), 11);
      ctx.fillStyle = e.call ? (Math.floor(performance.now() / 250) % 2 ? '#ffd23f' : '#ff9f43') : '#5ee27a';
      ctx.strokeStyle = '#1b0f2b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y - 7);
      ctx.lineTo(x + 7, y);
      ctx.lineTo(x, y + 7);
      ctx.lineTo(x - 7, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (edge) {
        const d = Math.round(Math.hypot(e.x - p.pos.x, e.z - p.pos.z));
        const lx = c + (x - c) * 0.78;
        const ly = c + (y - c) * 0.78;
        ctx.fillStyle = 'rgba(27,15,43,0.8)';
        ctx.fillRect(lx - 14, ly - 6, 28, 12);
        ctx.fillStyle = '#5ee27a';
        ctx.fillText(`${d}m`, lx, ly + 0.5);
      }
    }

    // You.
    ctx.translate(c, c);
    ctx.rotate(-p.yaw);
    ctx.fillStyle = '#fff6e0';
    ctx.strokeStyle = '#1b0f2b';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(7, 7);
    ctx.lineTo(0, 3);
    ctx.lineTo(-7, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // North marker on the rim.
    ctx.fillStyle = '#1b0f2b';
    ctx.beginPath();
    ctx.arc(c, 9, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffd23f';
    ctx.font = "bold 11px Nunito, sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', c, 9.5);
  }

  drawBigMap(raid) {
    $('bigmapTitle').textContent = raid.map.name.toUpperCase();
    $('bigmapBoss').textContent = `👑 ${raid.bossName || 'Boss'}`;
    const canvas = $('bigmapCanvas');
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    const s = size / (raid.map.half * 2);
    const tx = (v) => (v + raid.map.half) * s;
    ctx.drawImage(raid.bigmap, 0, 0, size, size);

    // Exits: green open, red closed, each with a name tag.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const e of raid.extracts) {
      const x = tx(e.x);
      const y = tx(e.z);
      ctx.fillStyle = e.active ? '#5ee27a' : '#ff5d5d';
      ctx.strokeStyle = '#1b0f2b';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, y - 12);
      ctx.lineTo(x + 12, y);
      ctx.lineTo(x, y + 12);
      ctx.lineTo(x - 12, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      const label = e.active ? e.name : `${e.name} (closed)`;
      ctx.font = '900 15px Nunito, system-ui, sans-serif';
      const w = ctx.measureText(label).width + 14;
      const ly = e.z > 0 ? y - 26 : y + 26;
      const lx = Math.max(w / 2 + 4, Math.min(size - w / 2 - 4, x));
      ctx.fillStyle = e.active ? 'rgba(20,83,45,0.92)' : 'rgba(127,29,29,0.85)';
      ctx.beginPath();
      ctx.roundRect(lx - w / 2, ly - 11, w, 22, 11);
      ctx.fill();
      ctx.fillStyle = '#fff6e0';
      ctx.fillText(label, lx, ly + 1);
    }
    if (raid.boss && raid.boss.alive) {
      ctx.font = '30px sans-serif';
      ctx.fillText('👑', tx(raid.boss.pos.x), tx(raid.boss.pos.z));
    }
    const p = raid.player;
    ctx.save();
    ctx.translate(tx(p.pos.x), tx(p.pos.z));
    ctx.fillStyle = 'rgba(255,246,224,0.35)';
    ctx.beginPath();
    ctx.arc(0, 0, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(-p.yaw);
    ctx.fillStyle = '#fff6e0';
    ctx.strokeStyle = '#1b0f2b';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(10, 10);
    ctx.lineTo(0, 5);
    ctx.lineTo(-10, 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // Arc Raiders-style inventory: loadout on the left, backpack grid in the middle, details on the right.
  renderBag(p) {
    const slotCard = (item, where, i, big = false) => {
      const sel = this.selected && this.selected.where === where && this.selected.i === i;
      if (!item) {
        const label = where === 'pocket' ? '🔒 Empty pocket<br><small>drag your best find here</small>' : `Weapon ${i + 1}<br><small>drag a gun here</small>`;
        return `<div class="islot empty ${big ? 'big' : ''} ${where}" data-drop="slot" data-where="${where}" data-i="${i}">${big ? `<span class="hint">${label}</span>` : ''}</div>`;
      }
      const tag = where === 'weapon' ? `<span class="wkey">${keyName(i ? 'weapon2' : 'weapon1')}</span>` : '';
      const info = itemInfo(item);
      const qty = !isGun(item) && item.qty > 1 ? `<span class="qty">×${item.qty}</span>` : '';
      const ammo = isGun(item) ? `<span class="qty">${item.ammo}</span>` : '';
      return `<button class="islot r${info.rarity} ${big ? 'big' : ''} ${sel ? 'sel' : ''} ${where === 'weapon' && i === p.active ? 'active' : ''} ${where}" draggable="true" data-drop="slot" data-act="select" data-where="${where}" data-i="${i}" style="--rc:${info.css}" title="Drag to move (drag off the panel to drop) · double-click or right-click to ${isGun(item) ? (where === 'weapon' ? 'stash' : 'equip') : 'use'}">
        <span class="qdrop" data-act="drop" data-where="${where}" data-i="${i}" title="Drop it">✕</span><span class="ic">${iconHtml(item)}</span>${big ? `<span class="nm" style="color:${info.css}">${escapeHtml(info.name)}${where === 'weapon' && i === p.active ? '<small>IN HAND</small>' : ''}</span>` : ''}${tag}${qty}${ammo}<i class="rbar"></i></button>`;
    };

    // Left: weapons, Safe Pocket, throwable and vitals.
    const bar = (cls, icon, label, v, max) => `<div class="vit ${cls}"><span>${icon} ${label}</span><b>${Math.ceil(v)}</b><div class="bar ${cls}"><div style="width:${Math.max(0, Math.min(1, v / max)) * 100}%"></div></div></div>`;
    const pocket = p.pocket || [];
    const throwSlot = (() => {
      const t = p.currentThrowable();
      if (!t) return '<div class="tslot empty" data-drop="throw">Drag a throwable here</div>';
      const others = p.throwables().filter((x) => x !== t).map((x) => `<span title="${escapeHtml(ITEMS[x].name)}">${ITEMS[x].icon}${p.count(x)}</span>`).join('');
      return `<div class="tslot" data-drop="throw"><span class="ic">${ITEMS[t].icon}</span><b>${escapeHtml(ITEMS[t].name)}</b><small>×${p.count(t)}</small>${others ? `<div class="others">${others}</div>` : ''}</div>`;
    })();
    const left = `<section class="invcol gear">
      <h4 class="ilabel">Weapons</h4>
      ${p.weapons.map((g, i) => slotCard(g, 'weapon', i, true)).join('')}
      ${pocket.length ? `<h4 class="ilabel gold">🔒 Safe Pocket <em>kept if you die</em></h4>${pocket.map((it, i) => slotCard(it, 'pocket', i, true)).join('')}` : ''}
      <h4 class="ilabel">Throwable <em>${keyName('throw')} throw · hold ${keyName('cycleThrow')} to pick</em></h4>
      ${throwSlot}
      <div class="vits">
        ${bar('hp', '❤️', 'Health', p.hp, p.maxHp)}
        ${bar('armor', '🛡️', 'Armor', p.armor, PLAYER.maxArmor)}
        ${bar('stamina', '🏃', 'Stamina', p.stamina, PLAYER.maxStamina)}
        <div class="vit chipsline"><span>🪙 Chips</span><b>${p.chips.toLocaleString("en-US")}</b></div>
      </div>
      <div class="dropzone" data-drop="ground">🗑️ Drop: drag here or off the panel, or hit ✕ on an item</div>
    </section>`;

    // Middle: the backpack grid.
    // Loot in the backpack grid, consumables on the belt below it (both point at the same list).
    const cells = [];
    const belt = [];
    p.backpack.forEach((it, i) => (isBelt(it) ? belt.push(slotCard(it, 'belt', i)) : cells.push(slotCard(it, 'pack', i))));
    const empty = (n, where = 'pack') => Array(Math.max(0, n)).fill(`<div class="islot empty" data-drop="slot" data-where="${where}" data-i="999"></div>`).join('');
    const full = p.packUsed / p.capacity;
    const mid = `<section class="invcol pack"><div class="packhead"><h3>Backpack</h3><span class="cap ${full >= 1 ? 'full' : full >= 0.75 ? 'near' : ''}">${p.packUsed}/${p.capacity}</span></div>
      <div class="capbar"><div style="width:${Math.min(1, full) * 100}%"></div></div>
      <div class="igrid">${cells.join('')}${empty(p.capacity - cells.length)}</div>
      <div class="packhead belthead"><h4 class="ilabel">🩹 Belt <em>consumables only · extras can go in the backpack</em></h4><span class="cap small ${belt.length >= p.room.belt ? 'full' : ''}">${belt.length}/${p.room.belt}</span></div>
      <div class="igrid belt">${belt.join('')}${empty(p.room.belt - belt.length, 'belt')}</div>
      <p class="hint small">Drag to move · right-click to equip / use · lost if you die${pocket.length ? ' (except your Safe Pocket)' : ''}</p></section>`;

    // Right: details for the selected item.
    let detail = '<div class="idetail empty"><span class="ic">🎒</span><p>Select an item to see what it does.</p></div>';
    const sel = this.selected;
    const item = sel ? (sel.where === 'weapon' ? p.weapons[sel.i] : sel.where === 'pocket' ? (p.pocket || [])[sel.i] : p.backpack[sel.i]) : null;
    if (item) {
      const info = itemInfo(item);
      const rarityName = ['Common', 'Rare', 'Epic', 'Legendary'][info.rarity];
      let stats = '';
      let actions = '';
      if (isGun(item)) {
        const w = WEAPONS[item.kind];
        const dmg = Math.round(w.damage * [1, 1.15, 1.3, 1.5][item.rarity]);
        stats = `<div class="stat"><span>Damage</span><b>${dmg}${w.pellets > 1 ? ` ×${w.pellets}` : ''}</b></div>
          <div class="stat"><span>Fire rate</span><b>${(1 / w.rate).toFixed(1)}/s</b></div>
          <div class="stat"><span>Range</span><b>${w.range || 'Splash'}${w.range ? 'm' : ''}</b></div>
          <div class="stat"><span>Ammo</span><b>${item.ammo}</b></div>`;
        actions = sel.where === 'pocket' ? '' : sel.where === 'pack'
          ? `<button class="btn" data-act="equip" data-i="${sel.i}">Equip</button>`
          : `<button class="btn" data-act="unequip" data-i="${sel.i}">To backpack</button>`;
      } else {
        stats = `<p class="desc">${escapeHtml(info.def.desc || '')}</p>`;
        const kind = info.def.kind;
        const action = { heal: 'heal', armor: 'armor', warm: 'cocoa', ammo: 'reload', throw: 'throw', boost: 'boost' }[kind];
        const key = action ? keyName(action) : null;
        if (['heal', 'armor', 'warm', 'boost'].includes(kind)) actions = `<button class="btn" data-act="use" data-id="${item.id}">Use <kbd>${key}</kbd></button>`;
        if (kind === 'ammo') actions = `<button class="btn" data-act="reload">Reload now <kbd>${key}</kbd></button>`;
        if (kind === 'throw') {
          const picked = p.currentThrowable() === item.id;
          actions = picked ? '<button class="btn" disabled>Ready to throw ✓</button>' : `<button class="btn" data-act="pickthrow" data-id="${item.id}">Throw this one</button>`;
        }
        if (key) stats += `<p class="keyhint">Shortcut in a raid: <kbd>${key}</kbd>${kind === 'throw' ? ` (hold, then let go · <kbd>${keyName('cycleThrow')}</kbd> switches)` : ''}</p>`;
      }
      const pocket = p.pocket || [];
      if (sel.where === 'belt') actions += `<button class="btn ghost" data-act="movepack" data-where="belt" data-i="${sel.i}">To backpack</button>`;
      if (sel.where === 'pack' && isConsumable(item)) actions += `<button class="btn ghost" data-act="movebelt" data-where="pack" data-i="${sel.i}">To belt</button>`;
      if (sel.where === 'pocket') actions = `<button class="btn" data-act="topack" data-i="${sel.i}">To backpack</button>`;
      else if (pocket.length) actions += `<button class="btn ghost" data-act="topocket" data-where="${sel.where}" data-i="${sel.i}">🔒 Safe Pocket</button>`;
      actions += `<button class="btn ghost" data-act="drop" data-where="${sel.where}" data-i="${sel.i}">Drop</button>`;
      detail = `<div class="idetail" style="--rc:${info.css}">
        <div class="bigicon r${info.rarity}">${iconHtml(item, 'gicon big')}</div>
        <div class="rname">${rarityName}${!isGun(item) && item.qty > 1 ? ` · ×${item.qty}` : ''}</div>
        <h3 style="color:${info.css}">${escapeHtml(info.name)}</h3>
        ${stats}
        <div class="stat value"><span>Sells for</span><b>🪙 ${info.value}</b></div>
        <div class="acts">${actions}</div></div>`;
    }
    const right = `<section class="invcol details">${detail}</section>`;

    const total = [...p.weapons.filter(Boolean), ...p.backpack, ...(p.pocket || []).filter(Boolean)].reduce((n, it) => n + itemInfo(it).value, 0) + p.chips;
    this.set('invHaul', `Haul worth <b>🪙 ${total}</b> if you get out alive`);
    this.set('bagList', left + mid + right);
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

  hitmarker(kill, crit) {
    const el = $('hitmarker');
    el.classList.remove('show', 'kill', 'crit');
    void el.offsetWidth;
    el.classList.add('show');
    if (crit) el.classList.add('crit');
    if (kill) el.classList.add('kill');
  }

  // The throwable wheel. Pass null to hide it.
  throwWheel(opts, pick = -1, p = null) {
    const el = $('twheel');
    if (!opts) { el.hidden = true; this.last.twheel = null; return; }
    el.hidden = false;
    const cur = p && p.currentThrowable();
    const n = opts.length;
    this.set('twheel', `<div class="twcenter">${pick >= 0 ? escapeHtml(ITEMS[opts[pick]].name) : 'Pick a throwable'}</div>${opts.map((id, i) => {
      const a = (i / n) * Math.PI * 2;
      const x = Math.sin(a) * 105;
      const y = -Math.cos(a) * 105;
      return `<div class="twopt ${i === pick ? 'on' : ''} ${id === cur ? 'cur' : ''}" style="transform:translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)"><span>${ITEMS[id].icon}</span><b>×${p ? p.count(id) : ''}</b></div>`;
    }).join('')}`);
  }

  // Flash Chip went off in your face: white screen that fades out.
  flashbang(strength) {
    const el = $('flashbang');
    el.style.transition = 'none';
    el.style.opacity = String(Math.min(1, strength));
    void el.offsetWidth;
    el.style.transition = `opacity ${(1 + strength * 2.5).toFixed(1)}s ease-in`;
    el.style.opacity = '0';
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
    el.innerHTML = `<div class="kicker">DEPLOYING TO</div><h2>${escapeHtml(raid.map.name.toUpperCase())}</h2><p>${open ? `Exits open: <b>${open}</b>. Loot, survive, get out.` : 'Gamble, duel, and cash out at the door when you\'re done.'}</p>`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  // The "you got busted" banner during the kill cam. Pass null to hide it.
  killcam(k) {
    $('downed').hidden = true;
    document.body.classList.remove('isdowned');
    const el = $('killcam');
    el.hidden = !k;
    if (!k) return;
    const hp = k.killer && k.killer.alive ? `<span>${k.killer.isBoss || k.killer.team === 'machine' ? '⚙️' : '❤️'} ${Math.max(0, Math.ceil(k.killer.hp))} health left</span>` : '';
    el.innerHTML = `<div class="kctag">💀 BUSTED BY</div><div class="kcname">${escapeHtml(k.name)}</div>
      <div class="kcinfo">${k.weapon ? `<span>with ${escapeHtml(k.weapon)}</span>` : ''}${k.dealt ? `<span>💥 ${k.dealt} damage to you</span>` : ''}${hp}</div>
      <div class="kcskip">Click or press Space to skip</div>`;
  }

  raidOver(r) {
    $('downed').hidden = true;
    document.body.classList.remove('isdowned');
    const el = $('results');
    const insuredNote = r.kept && r.kept.length ? ` 🔒 Your Safe Pocket kept your ${r.kept.map(escapeHtml).join(' and ')}.` : '';
    let title;
    let line;
    if (r.tutorial && r.success) {
      title = '🎓 TUTORIAL COMPLETE!';
      const stars = (this.raid && this.raid.tutorialStars) || [];
      line = `${stars.length ? `<b class="tutstars">${'⭐'.repeat(stars.length)}${'☆'.repeat(Math.max(0, 3 - stars.length))}</b> ${stars.map(escapeHtml).join(' · ')}<br>` : '<b class="tutstars">☆☆☆</b> No bonus stars this time: try for a crit, a triple grenade kill and a flawless fight.<br>'}You got out alive, and everything you carried is yours to keep. Next up: pick a real map, pack a gun and go. Sell what you find at the 💰 Fence, then try your luck in the 🎰 Back Room.`;
    } else if (r.tutorial) {
      title = '🎓 TUTORIAL OVER';
      line = 'You left the Training Floor. You can play it again any time from the map list or Settings.';
    } else if (r.success) {
      title = '🚁 EXTRACTED!';
      line = `You got out through the ${escapeHtml(r.where)} with <b>🪙 ${r.value}</b> worth of stuff.${r.riders && r.riders.length ? ` Rode out with ${r.riders.map(escapeHtml).join(', ')}.` : ''}`;
    } else if (r.reason === 'time') {
      title = '⏰ LOCKED DOWN';
      line = 'The House locked the place down with you inside. Everything you carried is gone.';
    } else if (r.reason === 'kidnapped') {
      title = '🤌 KIDNAPPED';
      line = 'You went in owing the Mob. They threw you in the back of a van and took everything you were carrying. Consider the debt paid.';
    } else if (r.reason === 'abandon') {
      title = '🏳️ ABANDONED';
      line = 'You bailed on the raid. Everything you carried is gone.';
    } else {
      title = '💀 BUSTED';
      line = `${r.by ? `${escapeHtml(r.by)} got you.` : 'You died.'} Everything you carried is gone.`;
    }
    $('resultsTitle').textContent = title;
    $('resultsLine').innerHTML = `${line}${insuredNote}<br><small>Machines destroyed: ${r.run.machines} · Raiders busted: ${r.run.raiders}${r.run.boss ? ` · 👑 Took down ${this.raid && this.raid.bossName ? this.raid.bossName : 'the boss'}!` : ''}</small>`;
    $('resultsItems').innerHTML = r.items.length || r.chips
      ? `${r.chips ? `<span class="chip">🪙 ${r.chips} chips</span>` : ''}${r.items.map((it) => `<span class="chip ${r.success ? '' : 'lost'}" style="color:${itemInfo(it).css}">${iconHtml(it)} ${escapeHtml(itemTitle(it).slice(itemInfo(it).icon.length + 1))}</span>`).join('')}`
      : '<span class="chip">Nothing</span>';
    $('resultsItems').classList.toggle('lost', !r.success);
    // XP, level, new finds and anything unlocked.
    const pr = r.progress || { xp: 0, achievements: [], looks: [], levelUp: 0 };
    const lv = levelInfo();
    const finds = r.newFinds && r.newFinds.length
      ? `<div class="rnew"><b>📖 New in your collection:</b> ${r.newFinds.map((it) => `<span class="chip" style="color:${itemInfo(it).css}">${iconHtml(it)} ${escapeHtml(itemInfo(it).name)}</span>`).join('')}</div>` : '';
    const achs = pr.achievements.map((a) => `<div class="rach t${a.tier}"><span class="ic">${a.icon}</span><div><b>${escapeHtml(a.name)}</b><small>${TIER_NAMES[a.tier]} achievement · ${escapeHtml(a.desc)}</small></div></div>`).join('');
    const looks = pr.looks.length ? `<div class="rnew">🎨 <b>New look unlocked:</b> ${pr.looks.map((k) => escapeHtml(lookName(k))).join(', ')}</div>` : '';
    $('resultsUnlocks').innerHTML = r.tutorial ? '' : `<div class="rxp"><span class="lvl">LV ${lv.level}</span><div class="xpbar"><i style="width:${(lv.frac * 100).toFixed(1)}%"></i></div><b>+${pr.xp} XP</b></div>
      ${pr.levelUp ? `<div class="rlevel">⭐ LEVEL UP! You're level ${pr.levelUp}</div>` : ''}${finds}${achs}${looks}`;
    el.hidden = false;
    this.prompt(null);
    this.progress(null);
  }
}
