/* global io */
(() => {
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const socket = io({ autoConnect: false });

  let cfg = null;
  let myId = null;
  let roomCode = null;
  let state = null;
  let lastPhase = null;

  // Smoothed render positions, keyed by entity id.
  const renderPos = new Map();
  const prevChips = new Map();
  const flashUntil = new Map();
  const effects = [];

  const view = { scale: 1, camX: 0, camY: 0, w: 0, h: 0 };
  const keys = {};
  const mouse = { x: 0, y: 0, down: false };

  // ---------- joining ----------

  const params = new URLSearchParams(location.search);
  $('room').value = params.get('room') || '';
  try { $('name').value = localStorage.getItem('degen-name') || ''; } catch (e) { /* storage blocked */ }

  function join() {
    const name = $('name').value.trim();
    try { localStorage.setItem('degen-name', name); } catch (e) { /* storage blocked */ }
    socket.connect();
    socket.emit('join', { name, room: $('room').value.trim() }, (res) => {
      if (res.error) {
        $('joinError').textContent = res.error;
        socket.disconnect();
        return;
      }
      myId = res.id;
      roomCode = res.room;
      cfg = res.config;
      history.replaceState(null, '', `?room=${roomCode}`);
      $('join').hidden = true;
      $('hud').hidden = false;
      $('inviteText').textContent = `Room ${roomCode}`;
      buildWagerButtons();
      buildCarpet();
      requestAnimationFrame(frame);
      setInterval(sendInput, 1000 / 30);
    });
  }

  $('play').addEventListener('click', join);
  $('name').addEventListener('keydown', (e) => e.key === 'Enter' && join());
  $('room').addEventListener('keydown', (e) => e.key === 'Enter' && join());
  $('copy').addEventListener('click', () => {
    const link = `${location.origin}${location.pathname}?room=${roomCode}`;
    navigator.clipboard.writeText(link).then(() => {
      $('copy').textContent = 'Copied!';
      setTimeout(() => { $('copy').textContent = 'Copy invite link'; }, 1500);
    }).catch(() => { $('inviteText').textContent = link; });
  });

  socket.on('disconnect', () => {
    if (myId) $('banner').innerHTML = 'DISCONNECTED<small>Refresh to rejoin</small>';
  });

  // ---------- input ----------

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    keys[e.key.toLowerCase()] = true;
    if (state && state.phase === 'betting' && ['1', '2', '3'].includes(e.key)) placeWager(Number(e.key) - 1);
  });
  window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.down = false; });
  canvas.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
  canvas.addEventListener('mousedown', () => { mouse.down = true; });
  window.addEventListener('mouseup', () => { mouse.down = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function sendInput() {
    const me = myPlayer();
    let a = 0;
    if (me) {
      const pos = renderPos.get(me.id) || me;
      const sx = (pos.x - view.camX) * view.scale + view.w / 2;
      const sy = (pos.y - view.camY) * view.scale + view.h / 2;
      a = Math.atan2(mouse.y - sy, mouse.x - sx);
    }
    socket.emit('input', {
      u: !!(keys.w || keys.arrowup),
      d: !!(keys.s || keys.arrowdown),
      l: !!(keys.a || keys.arrowleft),
      r: !!(keys.d || keys.arrowright),
      a: Math.round(a * 100) / 100,
      s: mouse.down || !!keys[' '],
    });
  }

  // ---------- server events ----------

  socket.on('state', (s) => {
    const now = performance.now();
    for (const p of s.players) {
      const before = prevChips.get(p.id);
      if (before !== undefined && s.phase === 'fight') {
        const diff = p.chips - before;
        if (diff < 0) {
          flashUntil.set(p.id, now + 120);
          addText(p.x, p.y - 30, `${diff}`, '#ff6b6b');
        } else if (diff > 0) {
          addText(p.x, p.y - 30, `+${diff}`, '#ffd23f');
        }
      }
      prevChips.set(p.id, p.chips);
    }
    state = s;
    if (s.phase !== lastPhase) {
      onPhaseChange(s.phase);
      lastPhase = s.phase;
    }
  });

  socket.on('fx', (e) => {
    const now = performance.now();
    if (e.type === 'boom') effects.push({ type: 'boom', x: e.x, y: e.y, r: e.r, t: now, life: 450 });
    if (e.type === 'bust') {
      effects.push({ type: 'bust', x: e.x, y: e.y, color: e.color, t: now, life: 900 });
      addText(e.x, e.y - 50, 'BUST!', '#ffffff', 1200);
    }
  });

  function addText(x, y, text, color, life = 800) {
    effects.push({ type: 'text', x, y, text, color, t: performance.now(), life });
  }

  function myPlayer() {
    return state && state.players.find((p) => p.id === myId);
  }

  // ---------- phase overlays ----------

  let spinStart = 0;

  function onPhaseChange(phase) {
    $('betting').hidden = phase !== 'betting';
    $('spin').hidden = phase !== 'spin';
    $('results').hidden = phase !== 'results';
    if (phase === 'spin') {
      spinStart = performance.now();
      $('spinResult').innerHTML = '';
      document.querySelectorAll('.reel').forEach((r) => r.classList.remove('landed'));
    }
    if (phase === 'fight') renderPos.clear();
  }

  function buildWagerButtons() {
    const box = $('wagers');
    box.innerHTML = '';
    cfg.wagers.forEach((w, i) => {
      const total = w.odds.reduce((a, b) => a + b, 0);
      const pct = (tier) => Math.round((w.odds[tier] / total) * 100);
      const btn = document.createElement('button');
      btn.className = 'wager';
      btn.innerHTML = `
        <div class="title">${w.name}</div>
        <div class="cost">${w.cost ? `🪙 ${w.cost} chips` : 'FREE'}</div>
        <div class="odds">
          🥄 ${pct(0)}% · 🔫 ${pct(1)}%<br>
          ⚡💥 ${pct(2)}% · 🚀 ${pct(3)}%<br>
          🎰 Jackpot ${Math.round(w.jackpot * 100)}%
        </div>
        <div class="key">press ${i + 1}</div>`;
      btn.addEventListener('click', () => placeWager(i));
      box.appendChild(btn);
    });
  }

  function placeWager(i) {
    socket.emit('wager', i);
  }

  function updateOverlays(now) {
    const me = myPlayer();
    if (!state || !me) return;

    if (state.phase === 'betting') {
      $('betRound').textContent = state.round;
      $('betTimer').textContent = state.timeLeft;
      const m = state.modifier;
      $('ruleCard').innerHTML = `${m.icon} House rule: <b>${m.name}</b><br>${m.desc}`;
      document.querySelectorAll('.wager').forEach((b, i) => b.classList.toggle('selected', i === me.wager));
      $('betNote').innerHTML = me.bailout
        ? `You were broke, so the house spotted you <b>${me.chips}</b> chips. Don't make it weird.`
        : `Your stack: <b>🪙 ${me.chips}</b>`;
    }

    if (state.phase === 'spin') {
      const reels = document.querySelectorAll('.reel');
      const elapsed = now - spinStart;
      const spin = me.spin;
      const symbols = [...cfg.fillerSymbols, ...Object.values(cfg.weapons).map((w) => w.symbol)];
      reels.forEach((reel, i) => {
        const stopAt = 900 + i * 600;
        const span = reel.firstElementChild;
        if (!spin || elapsed < stopAt) {
          reel.classList.add('spinning');
          span.textContent = symbols[Math.floor(now / 70 + i * 3) % symbols.length];
        } else {
          if (reel.classList.contains('spinning')) reel.classList.add('landed');
          reel.classList.remove('spinning');
          span.textContent = spin.reels[i];
        }
      });
      if (spin && elapsed > 900 + 2 * 600 + 200 && !$('spinResult').innerHTML) {
        const w = cfg.weapons[spin.weapon];
        $('spinResult').innerHTML = `You got the <span class="gun">${w.name}</span>`
          + (spin.jackpot
            ? `<div class="jackpot">JACKPOT! +${spin.payout} chips &amp; armor</div>`
            : (spin.weapon === 'spoon' ? '<div>…good luck with that.</div>' : ''));
      }
      if (!spin) $('spinResult').textContent = 'Sitting this one out. You\'re in next round.';
    }

    if (state.phase === 'results') {
      const r = state.result;
      $('winnerText').textContent = r && r.winnerName
        ? `${r.winnerId === myId ? 'YOU WIN' : `${r.winnerName} wins`}! +${r.bonus}`
        : 'Everybody went bust!';
      $('resultsTimer').textContent = state.timeLeft;
      const rows = [...state.players].sort((a, b) => b.wins - a.wins || b.chips - a.chips);
      $('standings').innerHTML = '<tr><th>Player</th><th>Chips</th><th>Busts</th><th>Wins</th></tr>'
        + rows.map((p) => `<tr class="${p.id === (r && r.winnerId) ? 'win' : ''} ${p.id === myId ? 'me' : ''}">
            <td>${escapeHtml(p.name)}${p.isBot ? ' 🤖' : ''}</td><td>🪙 ${p.chips}</td><td>${p.kills}</td><td>🏆 ${p.wins}</td></tr>`).join('');
    }
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- HUD ----------

  function updateHud() {
    const me = myPlayer();
    if (!state || !me) return;
    const w = cfg.weapons[me.weapon];
    $('stats').innerHTML = `<div class="chips">🪙 ${me.chips}</div>`
      + (me.armor > 0 ? `<div>🛡️ ${me.armor} armor</div>` : '')
      + `<div>${w.symbol} ${w.name}</div>`;

    const alive = state.players.filter((p) => p.alive).length;
    const labels = {
      betting: 'PLACE YOUR BETS',
      spin: 'SPINNING…',
      fight: `FIGHT! · ${alive} left`,
      results: 'ROUND OVER',
    };
    $('phase').innerHTML = `${labels[state.phase]} · ${state.timeLeft}s`
      + `<small>${state.modifier.icon} ${state.modifier.name}</small>`;

    const rows = [...state.players].sort((a, b) => b.wins - a.wins || b.chips - a.chips);
    $('board').innerHTML = rows.map((p) => `<div class="${state.phase === 'fight' && p.inRound && !p.alive ? 'dead' : ''}">
        <span style="color:${p.color}">${escapeHtml(p.name)}${p.id === myId ? ' ★' : ''}</span>
        <span>🏆${p.wins} 🪙${p.chips}</span></div>`).join('');

    $('feed').innerHTML = state.feed.slice(-5).map((f) => `<div>${escapeHtml(f.text)}</div>`).join('');

    let banner = '';
    if (state.phase === 'fight') {
      if (!me.inRound) banner = 'SPECTATING<small>You joined mid-round. You\'re in next round.</small>';
      else if (!me.alive) banner = '💸 BUSTED 💸<small>Spectating… the house will spot you chips next round.</small>';
    }
    if (socket.connected) $('banner').innerHTML = banner;
  }

  // ---------- rendering ----------

  let carpet = null;

  // The casino floor never changes, so draw it once.
  function buildCarpet() {
    carpet = document.createElement('canvas');
    carpet.width = cfg.arena.w;
    carpet.height = cfg.arena.h;
    const c = carpet.getContext('2d');
    c.fillStyle = '#8e1b2c';
    c.fillRect(0, 0, carpet.width, carpet.height);
    const step = 80;
    for (let y = 0; y <= carpet.height; y += step) {
      for (let x = 0; x <= carpet.width; x += step) {
        const ox = (y / step) % 2 ? step / 2 : 0;
        c.fillStyle = '#a8263a';
        diamond(c, x + ox, y, 22);
        c.fillStyle = '#d4a63a';
        diamond(c, x + ox, y, 6);
      }
    }
  }

  function diamond(c, x, y, r) {
    c.beginPath();
    c.moveTo(x, y - r);
    c.lineTo(x + r, y);
    c.lineTo(x, y + r);
    c.lineTo(x - r, y);
    c.closePath();
    c.fill();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  let lastFrame = performance.now();

  function frame(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    resize();
    if (state) {
      smoothPositions(dt);
      draw(now);
      updateHud();
      updateOverlays(now);
    }
    requestAnimationFrame(frame);
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    view.w = w;
    view.h = h;
    view.dpr = dpr;
    view.scale = Math.min(w / 1200, h / 800);
  }

  function smoothPositions(dt) {
    const k = 1 - Math.exp(-dt * 18);
    const seen = new Set();
    const track = (id, x, y) => {
      seen.add(id);
      const r = renderPos.get(id);
      if (!r) renderPos.set(id, { x, y });
      else { r.x += (x - r.x) * k; r.y += (y - r.y) * k; }
    };
    for (const p of state.players) track(p.id, p.x, p.y);
    for (const b of state.bullets) track(`b${b.id}`, b.x, b.y);
    for (const id of renderPos.keys()) if (!seen.has(id)) renderPos.delete(id);
  }

  function draw(now) {
    const me = myPlayer();
    let focus = { x: cfg.arena.w / 2, y: cfg.arena.h / 2 };
    if (me && me.alive) focus = renderPos.get(me.id) || me;
    else if (state.phase === 'fight') {
      const leader = state.players.filter((p) => p.alive).sort((a, b) => b.chips - a.chips)[0];
      if (leader) focus = renderPos.get(leader.id) || leader;
    }
    view.camX += (focus.x - view.camX) * 0.15;
    view.camY += (focus.y - view.camY) * 0.15;

    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.fillStyle = '#120821';
    ctx.fillRect(0, 0, view.w, view.h);

    ctx.save();
    ctx.translate(view.w / 2, view.h / 2);
    ctx.scale(view.scale, view.scale);
    ctx.translate(-view.camX, -view.camY);

    // Floor and gold rail.
    ctx.drawImage(carpet, 0, 0);
    ctx.lineWidth = 14;
    ctx.strokeStyle = '#1b0f2b';
    ctx.strokeRect(-7, -7, cfg.arena.w + 14, cfg.arena.h + 14);
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#ffd23f';
    ctx.strokeRect(-3, -3, cfg.arena.w + 6, cfg.arena.h + 6);

    for (const o of cfg.obstacles) drawObstacle(o, now);
    for (const pk of state.pickups) drawChip(pk.x, pk.y, pk.v, now);
    for (const b of state.bullets) drawBullet(b);
    for (const p of state.players) if (p.alive || state.phase !== 'fight') drawPlayer(p, now);
    drawEffects(now);

    ctx.restore();
  }

  function drawObstacle(o, now) {
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#1b0f2b';
    if (o.kind === 'table') {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      roundRect(o.x + 6, o.y + 10, o.w, o.h, 30);
      ctx.fill();
      ctx.fillStyle = '#6b3a1e';
      roundRect(o.x, o.y, o.w, o.h, 30);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1f8a4c';
      roundRect(o.x + 12, o.y + 12, o.w - 24, o.h - 24, 20);
      ctx.fill();
      // A couple of cards lying on the felt.
      ctx.fillStyle = '#fff6e0';
      ctx.save();
      ctx.translate(o.x + o.w / 2, o.y + o.h / 2);
      ctx.rotate(-0.2);
      roundRect(-26, -16, 22, 32, 4); ctx.fill();
      ctx.rotate(0.4);
      roundRect(4, -16, 22, 32, 4); ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      roundRect(o.x + 5, o.y + 8, o.w, o.h, 10);
      ctx.fill();
      ctx.fillStyle = '#6a2c91';
      roundRect(o.x, o.y, o.w, o.h, 10);
      ctx.fill();
      ctx.stroke();
      const horizontal = o.w >= o.h;
      const count = 3;
      for (let i = 0; i < count; i++) {
        const size = Math.min(o.w, o.h) * 0.5;
        const cx = horizontal ? o.x + (o.w / count) * (i + 0.5) : o.x + o.w / 2;
        const cy = horizontal ? o.y + o.h / 2 : o.y + (o.h / count) * (i + 0.5);
        const blink = Math.floor(now / 300 + i) % 3 === 0;
        ctx.fillStyle = blink ? '#ffd23f' : '#fff6e0';
        ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
      }
    }
  }

  function drawChip(x, y, value, now) {
    const bob = Math.sin(now / 200 + x) * 2;
    const color = value >= 20 ? '#1d4ed8' : value >= 10 ? '#e63946' : '#2a9d8f';
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(0, 10 - bob, 11, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color;
    ctx.strokeStyle = '#1b0f2b';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#fff6e0';
    ctx.lineWidth = 3;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(0, 0, 7.5, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawBullet(b) {
    const pos = renderPos.get(`b${b.id}`) || b;
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(b.a);
    ctx.strokeStyle = '#1b0f2b';
    ctx.lineWidth = 3;
    if (b.w === 'spoon') {
      ctx.strokeStyle = '#e5e7eb';
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(-10, 0, 18, -1, 1); ctx.stroke();
    } else if (b.w === 'rocket') {
      ctx.fillStyle = '#ff9f43';
      ctx.beginPath(); ctx.arc(-16, 0, 6 + Math.random() * 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#5ee27a';
      roundRect(-12, -7, 24, 14, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e63946';
      ctx.beginPath(); ctx.moveTo(12, -7); ctx.lineTo(20, 0); ctx.lineTo(12, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else {
      const r = b.w === 'pistol' ? 6 : 5;
      ctx.fillStyle = b.w === 'shotgun' ? '#ff9f43' : '#ffd23f';
      ctx.beginPath(); ctx.ellipse(0, 0, r + 3, r, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  const GUN_SHAPES = {
    spoon: { len: 26, wid: 6, color: '#d1d5db' },
    pistol: { len: 22, wid: 10, color: '#374151' },
    smg: { len: 30, wid: 10, color: '#4b5563' },
    shotgun: { len: 38, wid: 11, color: '#8b5a2b' },
    rocket: { len: 40, wid: 18, color: '#3f7d3a' },
  };

  function drawPlayer(p, now) {
    const pos = renderPos.get(p.id) || p;
    const R = cfg.playerRadius;
    const angle = p.id === myId && p.alive ? myAimAngle(pos) : p.a;
    const flashing = (flashUntil.get(p.id) || 0) > now;
    const walking = state.phase === 'fight';
    const squish = walking ? 1 + Math.sin(now / 90 + pos.x * 0.05) * 0.04 : 1;

    ctx.save();
    ctx.translate(pos.x, pos.y);

    // Shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(0, R - 2, R * 0.9, R * 0.35, 0, 0, Math.PI * 2); ctx.fill();

    // Gun, behind the body.
    const gun = GUN_SHAPES[p.weapon] || GUN_SHAPES.pistol;
    ctx.save();
    ctx.rotate(angle);
    ctx.fillStyle = gun.color;
    ctx.strokeStyle = '#1b0f2b';
    ctx.lineWidth = 4;
    roundRect(R * 0.4, -gun.wid / 2, R * 0.6 + gun.len, gun.wid, 4);
    ctx.fill(); ctx.stroke();
    if (p.weapon === 'spoon') {
      ctx.beginPath(); ctx.ellipse(R + gun.len + 4, 0, 9, 7, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();

    // Armor ring.
    if (p.armor > 0) {
      ctx.strokeStyle = '#7dd3fc';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(0, 0, R + 7, 0, Math.PI * 2); ctx.stroke();
    }

    // Body.
    ctx.scale(1 / squish, squish);
    ctx.fillStyle = flashing ? '#ffffff' : p.color;
    ctx.strokeStyle = '#1b0f2b';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // Shine.
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.ellipse(-R * 0.35, -R * 0.45, R * 0.35, R * 0.2, -0.5, 0, Math.PI * 2); ctx.fill();

    // Eyes that look where you aim.
    const ex = Math.cos(angle);
    const ey = Math.sin(angle);
    for (const side of [-1, 1]) {
      const bx = ex * 7 + -ey * side * 7;
      const by = ey * 7 + ex * side * 7 - 3;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#1b0f2b';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(bx, by, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#1b0f2b';
      ctx.beginPath(); ctx.arc(bx + ex * 2.5, by + ey * 2.5, 2.8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // Name and stack.
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.font = "16px 'Luckiest Guy', sans-serif";
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#1b0f2b';
    ctx.fillStyle = p.id === myId ? '#ffd23f' : '#ffffff';
    const label = `${p.name}${p.isBot ? ' 🤖' : ''}`;
    ctx.strokeText(label, pos.x, pos.y - R - 26);
    ctx.fillText(label, pos.x, pos.y - R - 26);
    ctx.font = "14px 'Luckiest Guy', sans-serif";
    ctx.fillStyle = '#ffd23f';
    const stack = `🪙${p.chips}${p.armor > 0 ? `  🛡️${p.armor}` : ''}`;
    ctx.strokeText(stack, pos.x, pos.y - R - 10);
    ctx.fillText(stack, pos.x, pos.y - R - 10);
  }

  // Use the live mouse angle for your own player so aiming feels instant.
  function myAimAngle(pos) {
    const sx = (pos.x - view.camX) * view.scale + view.w / 2;
    const sy = (pos.y - view.camY) * view.scale + view.h / 2;
    return Math.atan2(mouse.y - sy, mouse.x - sx);
  }

  function drawEffects(now) {
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      const t = (now - e.t) / e.life;
      if (t >= 1) { effects.splice(i, 1); continue; }
      ctx.save();
      if (e.type === 'boom') {
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = '#ff9f43';
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (0.4 + t * 0.6), 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 0.5 * (1 - t), 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#1b0f2b';
        ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (0.4 + t * 0.6), 0, Math.PI * 2); ctx.stroke();
      } else if (e.type === 'bust') {
        ctx.globalAlpha = 1 - t;
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2;
          const d = 20 + t * 70;
          ctx.fillStyle = k % 2 ? e.color : '#ffd23f';
          ctx.beginPath(); ctx.arc(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, 7 * (1 - t) + 2, 0, Math.PI * 2); ctx.fill();
        }
      } else if (e.type === 'text') {
        ctx.globalAlpha = 1 - t * t;
        ctx.textAlign = 'center';
        ctx.font = "22px 'Luckiest Guy', sans-serif";
        ctx.lineWidth = 5;
        ctx.strokeStyle = '#1b0f2b';
        ctx.fillStyle = e.color;
        const y = e.y - t * 40;
        ctx.strokeText(e.text, e.x, y);
        ctx.fillText(e.text, e.x, y);
      }
      ctx.restore();
    }
  }
})();
