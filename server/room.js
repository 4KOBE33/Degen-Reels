const C = require('./config');

const COLORS = ['#ff5d5d', '#4dabff', '#ffd23f', '#5ee27a', '#c77dff', '#ff9f43', '#2ee6d6', '#ff7eb6'];
const BOT_NAMES = ['Dealer Dan', 'Lucky Lou', 'Big Stack Betty', 'Slots McGee', 'Card Shark', 'Snake Eyes'];
const TAU = Math.PI * 2;

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function weightedIndex(weights) {
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

// Pushes circle `p` (radius r) out of `rect`. Returns true if they overlapped.
function pushOutOfRect(p, r, rect) {
  const cx = Math.max(rect.x, Math.min(p.x, rect.x + rect.w));
  const cy = Math.max(rect.y, Math.min(p.y, rect.y + rect.h));
  const dx = p.x - cx;
  const dy = p.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return false;
  if (d2 === 0) {
    // Center is inside the rect: exit through the nearest edge.
    const left = p.x - rect.x;
    const right = rect.x + rect.w - p.x;
    const top = p.y - rect.y;
    const bottom = rect.y + rect.h - p.y;
    const m = Math.min(left, right, top, bottom);
    if (m === left) p.x = rect.x - r;
    else if (m === right) p.x = rect.x + rect.w + r;
    else if (m === top) p.y = rect.y - r;
    else p.y = rect.y + rect.h + r;
    return true;
  }
  const d = Math.sqrt(d2);
  p.x = cx + (dx / d) * r;
  p.y = cy + (dy / d) * r;
  return true;
}

function pointInRect(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

function clampToArena(p, r) {
  p.x = Math.max(r, Math.min(C.ARENA.w - r, p.x));
  p.y = Math.max(r, Math.min(C.ARENA.h - r, p.y));
}

function placeFreely(p, r) {
  clampToArena(p, r);
  for (const o of C.OBSTACLES) pushOutOfRect(p, r, o);
  clampToArena(p, r);
}

function rollWeapon(wagerIdx) {
  const tier = weightedIndex(C.WAGERS[wagerIdx].odds);
  return pick(C.WEAPON_TIERS[tier]);
}

// Builds three reel symbols: two matching = your gun, three matching = jackpot.
function makeReels(weapon, jackpot) {
  const sym = C.WEAPONS[weapon].symbol;
  if (jackpot) return [sym, sym, sym];
  const others = [
    ...C.FILLER_SYMBOLS,
    ...Object.values(C.WEAPONS).map((w) => w.symbol).filter((s) => s !== sym),
  ];
  const reels = [sym, sym, sym];
  reels[Math.floor(Math.random() * 3)] = pick(others);
  return reels;
}

class Room {
  constructor(code, io, onEmpty) {
    this.code = code;
    this.io = io;
    this.onEmpty = onEmpty;
    this.players = new Map();
    this.bullets = [];
    this.pickups = [];
    this.feed = [];
    this.nextId = 1;
    this.round = 0;
    this.modifier = C.MODIFIERS[0];
    this.result = null;
    this.chipRainTimer = 0;
    this.lastTick = Date.now();
    this.startBetting();
    this.timer = setInterval(() => this.tick(), 1000 / C.TICK_RATE);
  }

  get humans() {
    return [...this.players.values()].filter((p) => !p.isBot);
  }

  get isFull() {
    return this.humans.length >= C.MAX_HUMANS_PER_ROOM;
  }

  // ---------- players ----------

  makePlayer(id, name, isBot) {
    return {
      id, name, isBot,
      color: this.nextColor(),
      x: C.ARENA.w / 2, y: C.ARENA.h / 2, angle: 0,
      chips: C.START_CHIPS, armor: 0, weapon: 'pistol',
      alive: false, inRound: false, bailout: false,
      wager: 0, spin: null, cooldown: 0,
      wins: 0, kills: 0,
      input: { u: false, d: false, l: false, r: false, a: 0, s: false },
      brain: null,
    };
  }

  nextColor() {
    const used = new Set([...this.players.values()].map((p) => p.color));
    return COLORS.find((c) => !used.has(c)) || pick(COLORS);
  }

  addHuman(socket, name) {
    const p = this.makePlayer(socket.id, name, false);
    this.players.set(p.id, p);
    socket.join(this.code);
    this.pushFeed(`${name} pulled up a chair`);
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.pushFeed(`${p.name} cashed out`);
    if (this.humans.length === 0) {
      clearInterval(this.timer);
      this.onEmpty(this);
    }
  }

  setInput(id, input) {
    const p = this.players.get(id);
    if (!p || p.isBot || !input) return;
    const a = Number(input.a);
    p.input = {
      u: !!input.u, d: !!input.d, l: !!input.l, r: !!input.r,
      a: Number.isFinite(a) ? a : 0,
      s: !!input.s,
    };
  }

  setWager(id, idx) {
    const p = this.players.get(id);
    if (!p || this.phase !== 'betting') return;
    if (Number.isInteger(idx) && idx >= 0 && idx < C.WAGERS.length) p.wager = idx;
  }

  syncBots() {
    const wanted = Math.max(0, C.MIN_COMBATANTS - this.humans.length);
    const bots = [...this.players.values()].filter((p) => p.isBot);
    while (bots.length > wanted) this.players.delete(bots.pop().id);
    while (bots.length < wanted) {
      const taken = new Set(bots.map((b) => b.name));
      const name = BOT_NAMES.find((n) => !taken.has(n)) || `Bot ${this.nextId}`;
      const bot = this.makePlayer(`bot${this.nextId++}`, name, true);
      this.players.set(bot.id, bot);
      bots.push(bot);
    }
  }

  pushFeed(text) {
    this.feed.push({ id: this.nextId++, text });
    if (this.feed.length > 6) this.feed.shift();
  }

  fx(event) {
    this.io.to(this.code).emit('fx', event);
  }

  // ---------- phases ----------

  setPhase(phase) {
    this.phase = phase;
    this.phaseEnds = Date.now() + C.PHASE_TIMES[phase] * 1000;
  }

  startBetting() {
    this.setPhase('betting');
    this.round++;
    this.bullets = [];
    this.pickups = [];
    this.result = null;
    this.modifier = this.round === 1 ? C.MODIFIERS[0] : pick(C.MODIFIERS);
    this.syncBots();
    for (const p of this.players.values()) {
      p.alive = false;
      p.inRound = false;
      p.spin = null;
      p.armor = 0;
      p.bailout = p.chips < C.MIN_CHIPS;
      if (p.bailout) p.chips = C.MIN_CHIPS;
      p.wager = p.isBot ? Math.floor(Math.random() * C.WAGERS.length) : 0;
    }
  }

  startSpin() {
    this.setPhase('spin');
    const players = [...this.players.values()];
    const spawns = this.spawnPoints(players.length);
    players.forEach((p, i) => {
      p.inRound = true;
      const wager = C.WAGERS[p.wager];
      // Never let a bet bust you before the fight starts.
      const cost = Math.min(wager.cost, p.chips - 1);
      p.chips -= cost;
      p.weapon = rollWeapon(p.wager);
      const jackpot = Math.random() < wager.jackpot;
      let payout = 0;
      if (jackpot) {
        payout = C.JACKPOT.flatBonus + cost * C.JACKPOT.wagerMultiplier;
        p.armor = C.JACKPOT.armor;
        p.chips += payout;
        this.pushFeed(`🎰 ${p.name} hit the JACKPOT!`);
      }
      p.spin = { reels: makeReels(p.weapon, jackpot), weapon: p.weapon, jackpot, cost, payout };
      p.x = spawns[i].x;
      p.y = spawns[i].y;
      p.angle = Math.atan2(C.ARENA.h / 2 - p.y, C.ARENA.w / 2 - p.x);
      p.cooldown = 0;
    });
  }

  startFight() {
    this.setPhase('fight');
    this.chipRainTimer = 0;
    for (const p of this.players.values()) {
      if (p.inRound) p.alive = true;
    }
  }

  startResults(winner) {
    this.setPhase('results');
    this.bullets = [];
    if (winner) {
      winner.wins++;
      winner.chips += C.WINNER_BONUS;
      this.pushFeed(`🏆 ${winner.name} takes round ${this.round}`);
    }
    this.result = {
      winnerId: winner ? winner.id : null,
      winnerName: winner ? winner.name : null,
      bonus: C.WINNER_BONUS,
    };
  }

  spawnPoints(n) {
    const points = [];
    const start = Math.random() * TAU;
    for (let i = 0; i < n; i++) {
      const a = start + (i / Math.max(1, n)) * TAU;
      const p = {
        x: C.ARENA.w / 2 + Math.cos(a) * C.ARENA.w * 0.38,
        y: C.ARENA.h / 2 + Math.sin(a) * C.ARENA.h * 0.38,
      };
      placeFreely(p, C.PLAYER_RADIUS);
      points.push(p);
    }
    return points;
  }

  // ---------- simulation ----------

  tick() {
    const now = Date.now();
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    const timeUp = now >= this.phaseEnds;

    if (this.phase === 'betting' && timeUp) this.startSpin();
    else if (this.phase === 'spin' && timeUp) this.startFight();
    else if (this.phase === 'fight') {
      this.updateFight(dt, now);
      this.checkFightEnd(timeUp);
    } else if (this.phase === 'results' && timeUp) this.startBetting();

    this.broadcast(now);
  }

  updateFight(dt, now) {
    const speed = C.PLAYER_SPEED * this.modifier.speedMult;

    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (p.isBot) this.botThink(p, now);
      const { u, d, l, r, a, s } = p.input;
      let mx = (r ? 1 : 0) - (l ? 1 : 0);
      let my = (d ? 1 : 0) - (u ? 1 : 0);
      const len = Math.hypot(mx, my);
      if (len > 0) {
        p.x += (mx / len) * speed * dt;
        p.y += (my / len) * speed * dt;
      }
      placeFreely(p, C.PLAYER_RADIUS);
      p.angle = a;
      p.cooldown -= dt;
      if (s && p.cooldown <= 0) this.fire(p);
    }

    this.updateBullets(dt);
    this.updatePickups(now);

    if (this.modifier.chipRain) {
      this.chipRainTimer += dt;
      if (this.chipRainTimer >= C.CHIP_RAIN_INTERVAL) {
        this.chipRainTimer = 0;
        const spot = { x: rand(40, C.ARENA.w - 40), y: rand(40, C.ARENA.h - 40) };
        placeFreely(spot, 12);
        this.pickups.push({ id: this.nextId++, x: spot.x, y: spot.y, value: 10, owner: null, lockUntil: 0 });
      }
    }
  }

  fire(p) {
    const w = C.WEAPONS[p.weapon];
    p.cooldown = w.cooldown;
    const muzzle = C.PLAYER_RADIUS + 8;
    for (let i = 0; i < w.pellets; i++) {
      const a = p.angle + (Math.random() - 0.5) * w.spread;
      this.bullets.push({
        id: this.nextId++,
        owner: p.id,
        weapon: p.weapon,
        x: p.x + Math.cos(p.angle) * muzzle,
        y: p.y + Math.sin(p.angle) * muzzle,
        vx: Math.cos(a) * w.speed,
        vy: Math.sin(a) * w.speed,
        a,
        life: w.life,
      });
    }
  }

  updateBullets(dt) {
    const keep = [];
    for (const b of this.bullets) {
      const w = C.WEAPONS[b.weapon];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;

      let hit = b.life <= 0
        || b.x < 0 || b.y < 0 || b.x > C.ARENA.w || b.y > C.ARENA.h
        || C.OBSTACLES.some((o) => pointInRect(b.x, b.y, o));

      let victim = null;
      if (!hit) {
        for (const p of this.players.values()) {
          if (!p.alive || p.id === b.owner) continue;
          if (Math.hypot(p.x - b.x, p.y - b.y) < C.PLAYER_RADIUS + w.bulletRadius) {
            victim = p;
            hit = true;
            break;
          }
        }
      }

      if (!hit) {
        keep.push(b);
        continue;
      }
      if (w.splash) this.explode(b.x, b.y, w, b.owner);
      else if (victim) this.damage(victim, w.damage, b.owner);
    }
    this.bullets = keep;
  }

  explode(x, y, w, ownerId) {
    this.fx({ type: 'boom', x: Math.round(x), y: Math.round(y), r: w.splash });
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d > w.splash + C.PLAYER_RADIUS) continue;
      let dmg = w.damage * (1 - Math.min(1, d / w.splash) * 0.5);
      if (p.id === ownerId) dmg *= 0.5;
      this.damage(p, dmg, ownerId);
    }
  }

  damage(victim, amount, attackerId) {
    if (!victim.alive) return;
    amount = Math.round(amount * this.modifier.damageMult);
    const absorbed = Math.min(victim.armor, amount);
    victim.armor -= absorbed;
    amount -= absorbed;
    const lost = Math.min(victim.chips, amount);
    if (lost <= 0) return;
    victim.chips -= lost;
    this.dropChips(victim, lost);

    if (victim.chips <= 0) {
      victim.alive = false;
      const killer = this.players.get(attackerId);
      if (killer && killer !== victim) {
        killer.kills++;
        this.pushFeed(`${killer.name} busted ${victim.name}`);
      } else {
        this.pushFeed(`${victim.name} went bust`);
      }
      this.fx({ type: 'bust', x: Math.round(victim.x), y: Math.round(victim.y), color: victim.color });
    }
  }

  // Lost chips scatter on the floor for anyone to grab.
  dropChips(p, amount) {
    const piles = Math.min(8, Math.ceil(amount / 10));
    const each = Math.floor(amount / piles);
    const lockUntil = Date.now() + C.CHIP_OWNER_LOCK_MS;
    for (let i = 0; i < piles; i++) {
      const value = i === piles - 1 ? amount - each * (piles - 1) : each;
      const a = Math.random() * TAU;
      const dist = rand(40, 90);
      const spot = { x: p.x + Math.cos(a) * dist, y: p.y + Math.sin(a) * dist };
      placeFreely(spot, 12);
      this.pickups.push({ id: this.nextId++, x: spot.x, y: spot.y, value, owner: p.id, lockUntil });
    }
  }

  updatePickups(now) {
    const reach = C.PLAYER_RADIUS + 12;
    this.pickups = this.pickups.filter((pk) => {
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        if (pk.owner === p.id && now < pk.lockUntil) continue;
        if (Math.hypot(p.x - pk.x, p.y - pk.y) < reach) {
          p.chips += pk.value;
          return false;
        }
      }
      return true;
    });
  }

  checkFightEnd(timeUp) {
    const alive = [...this.players.values()].filter((p) => p.alive);
    if (alive.length > 1 && !timeUp) return;
    // If time runs out, the biggest stack still standing wins.
    alive.sort((a, b) => b.chips - a.chips);
    this.startResults(alive[0] || null);
  }

  // ---------- bots ----------

  botThink(b, now) {
    if (!b.brain || now > b.brain.next) {
      b.brain = {
        strafe: Math.random() < 0.5 ? -1 : 1,
        jitter: rand(-0.2, 0.2),
        next: now + rand(600, 1600),
      };
    }
    const w = C.WEAPONS[b.weapon];
    const range = w.speed * w.life * 0.8;

    let target = null;
    let best = Infinity;
    for (const p of this.players.values()) {
      if (!p.alive || p === b) continue;
      const d = Math.hypot(p.x - b.x, p.y - b.y);
      if (d < best) { best = d; target = p; }
    }

    let loot = null;
    let lootDist = 220;
    for (const pk of this.pickups) {
      if (pk.owner === b.id && now < pk.lockUntil) continue;
      const d = Math.hypot(pk.x - b.x, pk.y - b.y);
      if (d < lootDist) { lootDist = d; loot = pk; }
    }

    let mx = 0;
    let my = 0;
    let shoot = false;
    if (target) {
      const dx = target.x - b.x;
      const dy = target.y - b.y;
      b.input.a = Math.atan2(dy, dx) + b.brain.jitter;
      shoot = best < range * 1.1;
      if (loot && best > range * 0.6) {
        mx = loot.x - b.x;
        my = loot.y - b.y;
      } else if (best > range * 0.8) {
        mx = dx;
        my = dy;
      } else {
        // Circle-strafe, backing off if too close.
        mx = (-dy / best) * b.brain.strafe - (best < range * 0.4 ? dx / best : 0);
        my = (dx / best) * b.brain.strafe - (best < range * 0.4 ? dy / best : 0);
      }
    } else if (loot) {
      mx = loot.x - b.x;
      my = loot.y - b.y;
    }

    const len = Math.hypot(mx, my) || 1;
    mx /= len;
    my /= len;
    b.input.u = my < -0.3;
    b.input.d = my > 0.3;
    b.input.l = mx < -0.3;
    b.input.r = mx > 0.3;
    b.input.s = shoot;
  }

  // ---------- networking ----------

  broadcast(now) {
    this.io.to(this.code).emit('state', {
      phase: this.phase,
      timeLeft: Math.max(0, Math.ceil((this.phaseEnds - now) / 1000)),
      round: this.round,
      modifier: {
        id: this.modifier.id, name: this.modifier.name, icon: this.modifier.icon, desc: this.modifier.desc,
      },
      result: this.result,
      feed: this.feed,
      players: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, color: p.color, isBot: p.isBot,
        x: Math.round(p.x), y: Math.round(p.y), a: Math.round(p.angle * 100) / 100,
        chips: p.chips, armor: Math.round(p.armor), weapon: p.weapon,
        alive: p.alive, inRound: p.inRound, bailout: p.bailout,
        wager: p.wager, spin: p.spin, wins: p.wins, kills: p.kills,
      })),
      bullets: this.bullets.map((b) => ({
        id: b.id, x: Math.round(b.x), y: Math.round(b.y), w: b.weapon, a: Math.round(b.a * 100) / 100,
      })),
      pickups: this.pickups.map((pk) => ({ id: pk.id, x: Math.round(pk.x), y: Math.round(pk.y), v: pk.value })),
    });
  }
}

module.exports = { Room };
