// The High Roller Lounge's games, played for real on the casino floor. Every table has the game
// built on it: a roulette wheel with a ball, a Loot Reels cabinet, cards dealt from a real shoe, a
// rocket on a launch pad, a mines board and a Plinko wall. Sit down and a small panel takes your
// bets while the camera looks over the table; everyone else in the Lounge watches the same game play
// out, with a board over each table saying who's playing and how it's going.
//
// The player at a table runs the game (their chips, their luck) and tells everyone what happened;
// the host passes it on. One player per table at a time; anyone can watch.
import * as THREE from 'three';
import { HUB_SLOTS, PLAYER } from './config.js';
import { part, toon, canvasTexture } from './toon.js';
import { sfx } from './audio.js';
import { keyName } from './keys.js';
import { save } from './save.js';
import { itemInfo, isGun, makeGun, fullAmmo, addToList } from './items.js';
import { levelInfo } from './progress.js';
import { Shoe, handValue, isNatural } from './cards.js';
import {
  BETS, BET_LEVEL, RED, WHEEL, REEL_SYMBOLS, REEL_HITS, PLINKO, PLINKO_ROWS, bucketColor, MINE_COUNTS, minesMult, reelPull,
} from './hub.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const TOP = 1.15; // felt height on the round tables
const STALE = 90; // seconds without a word from a seated player before the seat counts as free
const TITLES = {
  roulette: '🎡 ROULETTE', slots: '🎰 LOOT REELS', blackjack: '🃏 BLACKJACK', crash: '🚀 CRASH', mines: '💎 MINES', plinko: '🔴 PLINKO', armory: '🔫 ARMORY',
};
// Games built as their own cabinet (no round table under them).
export const CABINET_GAMES = new Set(['slots', 'plinko']);
const HOUSE_GUNS = ['pistol', 'smg', 'shotgun', 'revolver', 'dbarrel', 'ar'];

// ---------- shared bits ----------

// The board over a table: who's playing and what's happening. A sprite, so it faces everyone.
function makeBoard(title, color) {
  const tex = canvasTexture(1024, 400, () => {});
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(3.4, 1.33, 1);
  sprite.renderOrder = 5;
  const draw = (line1, line2 = '', tint = '#fff6e0') => {
    const { ctx: c } = tex.userData;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, 1024, 400);
    c.setTransform(2, 0, 0, 2, 0, 0); // drawn at 2x for sharp text
    c.fillStyle = 'rgba(20,10,34,0.86)';
    c.beginPath();
    if (c.roundRect) c.roundRect(6, 6, 500, 188, 26); else c.rect(6, 6, 500, 188);
    c.fill();
    c.lineWidth = 6;
    c.strokeStyle = color;
    c.stroke();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = color;
    c.font = "44px 'Luckiest Guy', 'Arial Black', sans-serif";
    c.fillText(title, 256, 46);
    c.fillStyle = '#fff6e0';
    c.font = "bold 34px Nunito, 'Arial', sans-serif";
    c.fillText(line1.slice(0, 30), 256, 106);
    c.fillStyle = tint;
    c.font = "bold 32px Nunito, 'Arial', sans-serif";
    c.fillText(line2.slice(0, 32), 256, 156);
    tex.needsUpdate = true;
  };
  return { sprite, draw };
}

// Card faces, drawn once each.
const faceCache = new Map();
function cardFace(c) {
  const key = c ? c.rank + c.suit : 'back';
  if (faceCache.has(key)) return faceCache.get(key);
  const tex = canvasTexture(128, 180, (x, w, h) => {
    x.fillStyle = c ? '#fffdf6' : '#c81d4a';
    x.fillRect(0, 0, w, h);
    x.lineWidth = 6;
    x.strokeStyle = c ? '#d8cfc0' : '#fff6e0';
    x.strokeRect(5, 5, w - 10, h - 10);
    if (!c) {
      x.strokeStyle = 'rgba(255,246,224,0.5)';
      x.lineWidth = 3;
      for (let i = -h; i < w + h; i += 16) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + h, h); x.stroke(); }
      x.fillStyle = '#ffd23f';
      x.font = '54px sans-serif';
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText('♛', w / 2, h / 2);
      return;
    }
    const red = c.suit === '♥' || c.suit === '♦';
    x.fillStyle = red ? '#d62828' : '#1b0f2b';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.font = "bold 40px 'Arial Black', sans-serif";
    x.fillText(c.rank, 30, 30);
    x.font = '30px sans-serif';
    x.fillText(c.suit, 30, 64);
    x.font = '74px sans-serif';
    x.fillText(c.suit, w / 2 + 8, h / 2 + 22);
  });
  faceCache.set(key, tex);
  return tex;
}
const CARD_W = 0.5;
const CARD_H = 0.7;
const cardGeo = new THREE.PlaneGeometry(CARD_W, CARD_H);
function cardMesh(c) {
  const g = new THREE.Group();
  const face = new THREE.Mesh(cardGeo, new THREE.MeshBasicMaterial({ map: cardFace(c) }));
  face.rotation.x = -Math.PI / 2;
  const back = new THREE.Mesh(cardGeo, new THREE.MeshBasicMaterial({ map: cardFace(null) }));
  back.rotation.x = Math.PI / 2;
  back.position.y = -0.002;
  g.add(face, back);
  return g;
}

// ---------- the games ----------

// Each game: build(t) puts its pieces in t.group (front is +z, toward the seat), panel(t) is the HTML
// for the player sitting there, act(t, a, arg) is that player doing something (returns the event to
// share, or null), apply(t, e) plays an event out for everyone, update(t, dt) animates.

const Roulette = {
  build(t) {
    const g = t.group;
    const bowl = part(new THREE.CylinderGeometry(1.32, 1.12, 0.2, 48), 0x6b3a1e, { ink: 0.02 });
    bowl.position.y = TOP + 0.1;
    g.add(bowl);
    const seg = (Math.PI * 2) / 37;
    const tex = canvasTexture(512, 512, (c, w) => {
      const r = w / 2;
      WHEEL.forEach((n, i) => {
        const a0 = i * seg;
        c.beginPath();
        c.moveTo(r, r);
        c.arc(r, r, r - 4, a0, a0 + seg);
        c.closePath();
        c.fillStyle = n === 0 ? '#16a34a' : RED.has(n) ? '#d62828' : '#1b0f2b';
        c.fill();
        c.strokeStyle = '#d4a63a';
        c.lineWidth = 2;
        c.stroke();
        c.save();
        c.translate(r, r);
        c.rotate(a0 + seg / 2);
        c.fillStyle = '#fff6e0';
        c.font = "bold 22px 'Arial Black', sans-serif";
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.translate(r * 0.86, 0);
        c.rotate(Math.PI / 2);
        c.fillText(String(n), 0, 0);
        c.restore();
      });
      c.beginPath();
      c.arc(r, r, r * 0.6, 0, Math.PI * 2);
      c.fillStyle = '#7a4a22';
      c.fill();
      c.lineWidth = 6;
      c.strokeStyle = '#d4a63a';
      c.stroke();
      for (let i = 0; i < 4; i++) {
        c.save();
        c.translate(r, r);
        c.rotate((i * Math.PI) / 2);
        c.fillStyle = '#d4a63a';
        c.fillRect(-6, 0, 12, r * 0.55);
        c.restore();
      }
    });
    const spin = new THREE.Group();
    spin.position.y = TOP + 0.21;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.15, 74), new THREE.MeshBasicMaterial({ map: tex }));
    disc.rotation.x = -Math.PI / 2;
    const turret = part(new THREE.ConeGeometry(0.16, 0.34, 12), 0xd4a63a, { ink: 0.01 });
    turret.position.y = 0.17;
    spin.add(disc, turret);
    g.add(spin);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    ball.position.set(0.8, TOP + 0.27, 0);
    g.add(ball);
    t.rl = { spin, ball, W: 0, run: null, seg };
  },
  busy(t) { return !!t.rl.run; },
  pocketAngle(t, n) { return (WHEEL.indexOf(n) + 0.5) * t.rl.seg; },
  panel(t, T) {
    const busy = !!t.rl.run;
    const picks = [['red', 'Red', '2x'], ['black', 'Black', '2x'], ['odd', 'Odd', '2x'], ['even', 'Even', '2x'], ['green', 'Green 0', '14x']];
    return `${T.chipsHtml(busy)}<div class="tprow">${picks.map(([k, l, x]) => `<button class="btn tpick ${k}" data-act="spin" data-arg="${k}" ${busy ? 'disabled' : ''}>${l} <small>${x}</small></button>`).join('')}</div>`;
  },
  act(t, a, arg, T) {
    if (a !== 'spin' || t.rl.run) return null;
    if (!T.spend(T.bet)) return null;
    return { a: 'spin', bet: T.bet, pick: arg, num: Math.floor(Math.random() * 37) };
  },
  apply(t, e) {
    if (e.a !== 'spin') return;
    const rl = t.rl;
    rl.run = { t: 0, dur: 5.2, W0: rl.W, n: e.num, bet: e.bet, pick: e.pick, mine: e.mine, who: e.n, ticked: 0 };
    t.show(`${e.n} · 🪙 ${fmt(e.bet)} on ${e.pick.toUpperCase()}`, 'No more bets…');
    sfx.lever(t.pos, t.T.raid.listener);
  },
  update(t, dt) {
    const rl = t.rl;
    const run = rl.run;
    if (!run) {
      rl.W += dt * 0.35;
      rl.spin.rotation.y = rl.W;
      if (rl.rest !== undefined) {
        const phi = rl.rest - rl.W;
        rl.ball.position.set(Math.cos(phi) * 0.86, TOP + 0.25, Math.sin(phi) * 0.86);
      }
      return;
    }
    run.t += dt;
    const k = Math.min(1, run.t / run.dur);
    const ease = 1 - (1 - k) ** 2;
    rl.W = run.W0 + 11 * ease;
    rl.spin.rotation.y = rl.W;
    const theta = Roulette.pocketAngle(t, run.n);
    const phi = theta - rl.W - 6 * Math.PI * (1 - (1 - (1 - k) ** 3));
    const inward = Math.max(0, (k - 0.62) / 0.38);
    const rad = 1.22 - (1.22 - 0.86) * inward;
    const hop = k > 0.62 && k < 0.95 ? Math.abs(Math.sin(inward * Math.PI * 4)) * 0.08 * (1 - inward) : 0;
    rl.ball.position.set(Math.cos(phi) * rad, TOP + 0.27 + hop, Math.sin(phi) * rad);
    if (Math.floor(run.t * 7 * (1 - k * 0.8)) !== run.ticked) { run.ticked = Math.floor(run.t * 7 * (1 - k * 0.8)); if (k < 0.97) sfx.tick(t.pos, t.T.raid.listener); }
    if (k < 1) return;
    rl.run = null;
    rl.rest = theta;
    const n = run.n;
    const color = n === 0 ? 'green' : RED.has(n) ? 'red' : 'black';
    const won = run.pick === color || (n !== 0 && ((run.pick === 'odd' && n % 2 === 1) || (run.pick === 'even' && n % 2 === 0)));
    const pays = run.pick === 'green' ? 14 : 2;
    const win = won ? run.bet * pays : 0;
    t.show(`${n} ${color.toUpperCase()}`, won ? `${run.who} WINS 🪙 ${fmt(win)}` : `${run.who} loses 🪙 ${fmt(run.bet)}`, won ? '#5ee27a' : '#ff7b85');
    t.T.pop(t, won ? `+${fmt(win)}` : `${n}`, won ? '#5ee27a' : color === 'red' ? '#ff5d5d' : color === 'green' ? '#5ee27a' : '#fff6e0', won && pays > 2);
    if (run.mine) t.T.settle('🎡', run.bet, win, (s) => { if (won && run.pick === 'green') s.rouletteGreens++; });
  },
};

// Loot Reels: a full-size slot cabinet with real spinning reels and a lever.
const STRIP = REEL_SYMBOLS.length;
const reelAngle = (k) => ((k + 0.5) * Math.PI * 2) / STRIP;
const Slots = {
  build(t) {
    const g = t.group;
    const body = part(new THREE.BoxGeometry(2.4, 2.9, 1.3), 0x7b2cbf);
    body.position.set(0, 1.45, -0.1);
    const trim = part(new THREE.BoxGeometry(2.55, 0.2, 1.4), 0xd4a63a, { ink: 0.02 });
    trim.position.set(0, 2.95, -0.1);
    const crown = part(new THREE.BoxGeometry(2.2, 0.9, 1.0), 0x1b0f2b);
    crown.position.set(0, 3.45, -0.2);
    const title = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.8), new THREE.MeshBasicMaterial({
      map: canvasTexture(512, 200, (c, w, h) => {
        c.fillStyle = '#1b0f2b';
        c.fillRect(0, 0, w, h);
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.font = "92px 'Luckiest Guy', 'Arial Black', sans-serif";
        c.fillStyle = '#ff3fa4';
        c.shadowColor = '#ff3fa4';
        c.shadowBlur = 18;
        c.fillText('LOOT REELS', w / 2, h / 2 + 6);
      }),
    }));
    title.position.set(0, 3.45, 0.31);
    const window_ = part(new THREE.BoxGeometry(2.0, 1.0, 0.1), 0x120818, { ink: 0 });
    window_.position.set(0, 1.95, 0.56);
    const shelf = part(new THREE.BoxGeometry(2.4, 0.18, 0.5), 0xd4a63a, { ink: 0.02 });
    shelf.position.set(0, 1.15, 0.65);
    g.add(body, trim, crown, title, window_, shelf);
    const tex = canvasTexture(1024, 256, (c, w, h) => {
      const cell = w / STRIP;
      REEL_SYMBOLS.forEach((s, k) => {
        c.fillStyle = k % 2 ? '#fff6e0' : '#ffeccc';
        c.fillRect(k * cell, 0, cell, h);
        c.save();
        c.translate(k * cell + cell / 2, h / 2);
        c.rotate(Math.PI / 2);
        c.font = '92px sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(s, 0, 6);
        c.restore();
      });
    });
    t.reels = [-0.62, 0, 0.62].map((x) => {
      const spinner = new THREE.Group();
      spinner.position.set(x, 1.95, 0.32);
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.52, 32, 1, true), new THREE.MeshBasicMaterial({ map: tex }));
      drum.rotation.z = Math.PI / 2;
      spinner.add(drum);
      g.add(spinner);
      const r = { spinner, a: reelAngle(Math.floor(Math.random() * STRIP)), run: null };
      spinner.rotation.x = r.a;
      return r;
    });
    const line = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.035), new THREE.MeshBasicMaterial({ color: 0xff3fa4 }));
    line.position.set(0, 1.95, 0.76);
    g.add(line);
    // The lever, on the right.
    const pivot = new THREE.Group();
    pivot.position.set(1.32, 1.7, 0.1);
    const arm = part(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 8), 0xc0c0c0, { ink: 0.01 });
    arm.position.y = 0.5;
    const knob = part(new THREE.SphereGeometry(0.14, 12, 10), 0xe63946, { ink: 0.01 });
    knob.position.y = 1.0;
    pivot.add(arm, knob);
    g.add(pivot);
    t.lever = { pivot, t: 0 };
    t.bulbs = [];
    for (let i = 0; i < 14; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff1b8 }));
      const k = i / 13;
      b.position.set(-1.1 + k * 2.2, 2.6, 0.57);
      g.add(b);
      t.bulbs.push(b);
    }
    t.blink = 0;
    t.machine = 0;
  },
  busy(t) { return t.reels.some((r) => r.run); },
  panel(t, T) {
    const busy = t.reels.some((r) => r.run);
    const machines = HUB_SLOTS.map((m, i) => `<button class="subtab ${t.machine === i ? 'on' : ''}" data-act="machine" data-arg="${i}" ${busy ? 'disabled' : ''}>${m.name} · 🪙 ${fmt(m.cost)}</button>`).join('');
    return `<div class="tprow">${machines}</div><div class="tprow"><button class="btn big" data-act="pull" ${busy ? 'disabled' : ''}>${busy ? 'SPINNING…' : `PULL · 🪙 ${fmt(HUB_SLOTS[t.machine].cost)}`}</button></div>`;
  },
  act(t, a, arg, T) {
    if (a === 'machine') { t.machine = Number(arg); return null; }
    if (a !== 'pull' || t.reels.some((r) => r.run)) return null;
    const m = HUB_SLOTS[t.machine];
    if (!T.spend(m.cost)) return null;
    const { prize, finals } = reelPull(m);
    return { a: 'pull', m: t.machine, f: finals, pz: prize };
  },
  apply(t, e) {
    if (e.a !== 'pull') return;
    t.lever.t = 0.6;
    t.pull = { mine: e.mine, who: e.n, m: e.m, prize: e.pz, left: 3 };
    e.f.forEach((sym, i) => {
      const r = t.reels[i];
      const k = Math.max(0, REEL_SYMBOLS.indexOf(sym));
      const base = r.a - (r.a % (Math.PI * 2));
      r.run = { t: 0, dur: 1.4 + i * 0.5, from: r.a, to: base + Math.PI * 2 * (4 + i) + reelAngle(k) };
    });
    t.show(`${e.n} pulls ${HUB_SLOTS[e.m].name}`, '🎰 Spinning…');
    sfx.lever(t.pos, t.T.raid.listener);
  },
  update(t, dt) {
    const L = t.lever;
    if (L.t > 0) { L.t = Math.max(0, L.t - dt); L.pivot.rotation.x = Math.sin((1 - L.t / 0.6) * Math.PI) * 1.1; }
    t.blink += dt * (t.pull ? 12 : 2.5);
    const flash = (t.flash = Math.max(0, (t.flash || 0) - dt)) > 0;
    t.bulbs.forEach((b, i) => {
      const on = (Math.floor(t.blink) + i) % 2 === 0;
      b.material.color.setHex(flash ? (on ? 0xffd23f : 0xff3fa4) : on ? 0xfff1b8 : 0x6b4a2a);
    });
    for (const r of t.reels) {
      if (!r.run) continue;
      const run = r.run;
      const before = r.a;
      run.t += dt;
      const k = Math.min(1, run.t / run.dur);
      // Out-ease with a little settle at the end, like a real reel catching.
      const ease = 1 - (1 - k) ** 3 + Math.sin(k * Math.PI) * 0.015 * k;
      r.a = run.from + (run.to - run.from) * Math.min(1.02, ease);
      if (k >= 1) r.a = run.to;
      r.spinner.rotation.x = r.a;
      if (Math.floor(before / (Math.PI / 4)) !== Math.floor(r.a / (Math.PI / 4))) sfx.tick(t.pos, t.T.raid.listener);
      if (k >= 1) {
        r.run = null;
        sfx.reelStop(t.pos, t.T.raid.listener);
        if (t.pull && --t.pull.left === 0) Slots.done(t);
      }
    }
  },
  done(t) {
    const p = t.pull;
    t.pull = null;
    const m = HUB_SLOTS[p.m];
    const prize = p.prize;
    const hit = REEL_HITS[prize.hit] || REEL_HITS[0];
    const info = prize.item && itemInfo(prize.item);
    const what = [info ? info.name : '', prize.chips ? `🪙 ${fmt(prize.chips)}` : ''].filter(Boolean).join(' + ');
    t.show(`${p.who} · ${hit.sym && hit.sym !== 'item' ? `${hit.sym}${hit.sym}${hit.sym} ${hit.x}x` : m.name}`, what, info ? info.css : '#ffd23f');
    t.T.pop(t, hit.x >= 1.5 ? `${hit.x}x!` : `+${fmt(prize.chips || 0)}`, info ? info.css : '#ffd23f', prize.hit >= 3);
    if (prize.hit >= 3) t.flash = 3;
    if (prize.hit >= 4) t.T.raid.feed(`🎰 ${p.who} hit ${hit.sym}${hit.sym}${hit.sym} on the Loot Reels${info ? `: ${info.name}` : ''}!`);
    if (p.mine) {
      const { payout } = t.T.hub.awardReel(m, prize);
      t.T.afterSettle(m.cost, payout);
    }
  },
};

// Blackjack: dealt from a real six-deck shoe, card by card onto the felt.
// Blackjack for up to three players against one dealer. The host runs the table (holds the shoe,
// deals, says whose turn it is); everyone, the host included, sees the same cards fly out and
// settles their own seat. Bets go in during a short countdown, then each seat plays in turn.
const BJ_SEATS = 3;
const SEAT_ANGLE = [-0.62, 0, 0.62];
const BET_WAIT = 8; // seconds after the first bet before the cards come out
const TURN_TIME = 20; // seconds to act before you stand
const seatXZ = (s, r) => [Math.sin(SEAT_ANGLE[s]) * r, Math.cos(SEAT_ANGLE[s]) * r];
const bjEmpty = () => ({ bet: 0, cards: [], doubled: false, done: false });
const Blackjack = {
  multi: true,
  build(t) {
    const g = t.group;
    const shoe = part(new THREE.BoxGeometry(0.5, 0.3, 0.7), 0x1b0f2b, { ink: 0.02 });
    shoe.position.set(1.45, TOP + 0.15, -0.75);
    shoe.rotation.y = -0.4;
    const lip = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.2), new THREE.MeshBasicMaterial({ map: cardFace(null) }));
    lip.position.set(1.36, TOP + 0.31, -0.42);
    lip.rotation.set(-1.0, -0.4, 0);
    g.add(shoe, lip);
    // Painted lines on the felt: the dealer's arc and a betting box for each seat.
    const arc = new THREE.Mesh(new THREE.RingGeometry(1.55, 1.6, 48, 1, Math.PI * 0.15, Math.PI * 0.7), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
    arc.rotation.x = -Math.PI / 2;
    arc.position.y = TOP + 0.005;
    g.add(arc);
    t.stacks = [];
    for (let s = 0; s < BJ_SEATS; s++) {
      const [x, z] = seatXZ(s, 1.55);
      const box = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.24, 4), new THREE.MeshBasicMaterial({ color: 0xfff6e0 }));
      box.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
      box.position.set(x, TOP + 0.005, z);
      const stack = new THREE.Group();
      stack.position.set(x, TOP + 0.02, z);
      g.add(box, stack);
      t.stacks.push(stack);
    }
    t.shoeFrom = new THREE.Vector3(1.36, TOP + 0.35, -0.42);
    t.shoe = new Shoe();
    // Where each seat's player stands, in the world.
    t.group.updateMatrixWorld(true);
    t.seatSpots = Array.from({ length: BJ_SEATS }, (_, s) => {
      const [x, z] = seatXZ(s, 3.3);
      return t.group.localToWorld(new THREE.Vector3(x, 0, z)).setY(0);
    });
    // What everyone sees.
    t.bj = { phase: 'bets', seats: [null, null, null], d: [], turn: -1, meshes: [], anims: [], wait: 0, hole: null, clockEnd: 0, left: t.shoe.left, settled: true };
    // The host's own copy of the round.
    t.bh = { phase: 'bets', seats: [null, null, null], d: [], turn: -1, timer: 0, check: 0 };
  },
  clear(t) {
    for (const m of t.bj.meshes) t.group.remove(m);
    t.bj.meshes = [];
    t.bj.anims = [];
    t.bj.hole = null;
    for (const st of t.stacks) st.clear();
  },
  mySeat(t) { return t.bj.seats.findIndex((x) => x && x.o === t.T.me); },
  // Queue a card flying out of the shoe. who: a seat number, or 'd' for the dealer.
  deal(t, c, who, hidden = false) {
    const b = t.bj;
    const list = who === 'd' ? b.d : b.seats[who].cards;
    list.push(c);
    const i = list.length - 1;
    const mesh = cardMesh(c);
    mesh.position.copy(t.shoeFrom);
    mesh.rotation.z = Math.PI; // starts face down
    mesh.visible = false;
    t.group.add(mesh);
    b.meshes.push(mesh);
    let to;
    if (who === 'd') to = new THREE.Vector3(-0.55 + i * 0.4, TOP + 0.012 + i * 0.002, -0.75);
    else {
      mesh.scale.setScalar(0.8);
      const [x, z] = seatXZ(who, 0.85);
      to = new THREE.Vector3(x - 0.2 + i * 0.2, TOP + 0.012 + i * 0.003, z - i * 0.06);
    }
    b.anims.push({ mesh, from: t.shoeFrom.clone(), to, dur: 0.34, flip: !hidden, who, hidden });
    if (who === 'd' && hidden) b.hole = mesh;
  },
  chips(t, s, bet) {
    const st = t.stacks[s];
    st.clear();
    if (!bet) return;
    const n = Math.min(10, 2 + Math.round(Math.log10(Math.max(10, bet)) * 1.5));
    const colors = [0xe63946, 0x2a9d8f, 0x1b0f2b, 0x7b2cbf, 0xffd23f];
    for (let i = 0; i < n; i++) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.04, 16), new THREE.MeshBasicMaterial({ color: colors[i % colors.length] }));
      c.position.y = i * 0.042;
      st.add(c);
    }
  },
  // Seats and the whole table, as text.
  handLine(x) {
    if (!x.bet) return '<small>no bet</small>';
    const v = handValue(x.cards);
    const tag = x.res ? ` · <b class="${x.net > 0 ? 'w' : x.net < 0 ? 'l' : ''}">${x.res}</b>` : isNatural({ cards: x.cards }) ? ' · BLACKJACK' : v > 21 ? ' · BUST' : '';
    return `🪙 ${fmt(x.bet)}${x.doubled ? ' (doubled)' : ''} · <b>${x.cards.length ? v : '–'}</b>${tag}`;
  },
  panel(t, T) {
    const b = t.bj;
    const me = Blackjack.mySeat(t);
    const animating = b.anims.length > 0 || b.wait > 0;
    const shoeNote = `<small class="tpnote">${t.shoe.decks}-deck shoe · ${b.left} cards left · up to ${BJ_SEATS} players</small>`;
    const dealerV = b.phase === 'play' ? (b.d.length ? `${handValue([b.d[0]])} + ?` : '') : b.d.length ? handValue(b.d) : '';
    const rows = b.seats.map((x, s) => (x ? `<div class="bjseat ${s === me ? 'me' : ''} ${b.turn === s && b.phase === 'play' ? 'turn' : ''}"><span>${b.turn === s && b.phase === 'play' ? '👉 ' : ''}${x.n}${s === me ? ' (you)' : ''}</span><span>${Blackjack.handLine(x)}</span></div>` : `<div class="bjseat open"><span>Seat ${s + 1}</span><span><small>open</small></span></div>`)).join('');
    const table = `<div class="bjtable"><div class="bjseat dealer"><span>🎩 Dealer</span><span><b>${dealerV || '–'}</b></span></div>${rows}</div>`;
    const clock = '<span id="bjClock"></span>';
    if (me < 0) return `${table}<p class="tpnote">Finding you a seat…</p>${shoeNote}`;
    const mine = b.seats[me];
    if (b.phase === 'bets') {
      if (mine.bet || b.pending) return `${table}<p class="tpnote">You're in for 🪙 ${fmt(mine.bet || b.pending)}. ${clock}</p>${shoeNote}`;
      return `${table}${T.chipsHtml(false)}<div class="tprow"><button class="btn big" data-act="deal">BET · 🪙 ${fmt(T.bet)}</button></div><p class="tpnote">${clock || ''}</p>${shoeNote}`;
    }
    if (b.phase === 'play' && b.turn === me && !mine.done) {
      const canDouble = mine.cards.length === 2 && !mine.doubled;
      const dis = animating ? 'disabled' : '';
      return `${table}<div class="tprow"><button class="btn" data-act="hit" ${dis}>Hit</button><button class="btn" data-act="stand" ${dis}>Stand</button>${canDouble ? `<button class="btn" data-act="double" ${dis}>Double · 🪙 ${fmt(mine.bet)}</button>` : ''}</div><p class="tpnote">Your turn. ${clock}</p>${shoeNote}`;
    }
    const waiting = b.phase === 'play' && b.turn >= 0 && b.seats[b.turn] ? `Waiting on ${b.seats[b.turn].n}… ${clock}` : b.phase === 'done' ? 'Next hand in a moment.' : 'Dealer\'s turn.';
    return `${table}<p class="tpnote">${mine.bet ? '' : 'Sitting this hand out. '}${waiting}</p>${shoeNote}`;
  },
  // The player at this table asking the host to do something.
  act(t, a, arg, T) {
    const b = t.bj;
    const me = Blackjack.mySeat(t);
    if (me < 0) return null;
    const mine = b.seats[me];
    if (a === 'deal') {
      if (b.phase !== 'bets' || mine.bet || b.pending) return null;
      if (!T.spend(T.bet)) return null;
      b.pending = T.bet;
      b.pendingAt = performance.now();
      return { a: 'qbet', bet: T.bet };
    }
    if (b.phase !== 'play' || b.turn !== me || mine.done || b.anims.length || b.wait > 0) return null;
    if (a === 'hit') return { a: 'qhit' };
    if (a === 'stand') return { a: 'qstand' };
    if (a === 'double' && mine.cards.length === 2 && !mine.doubled) {
      if (!T.spend(mine.bet)) return null;
      return { a: 'qdbl' };
    }
    return null;
  },

  // ---------- the host runs the table ----------
  host(t, e) {
    const h = t.bh;
    const T = t.T;
    const cast = (x) => T.cast(t, x);
    let s = h.seats.findIndex((x) => x && x.o === e.o);
    if (e.a === 'qsit') {
      if (s < 0) s = h.seats.findIndex((x) => !x);
      if (s < 0) { cast({ a: 'bfull', o: e.o }); return; }
      h.seats[s] = { o: e.o, n: e.n, ...bjEmpty() };
      // The newcomer needs to know who else is here.
      cast({ a: 'bseats', seats: h.seats.map((y) => (y ? { o: y.o, n: y.n, bet: h.phase === 'bets' ? y.bet : 0 } : null)) });
      cast({ a: 'bsit', s, o: e.o, n: e.n });
      return;
    }
    if (s < 0) { if (e.a === 'qbet' || e.a === 'qdbl') cast({ a: 'brefund', o: e.o, bet: e.bet || 0, why: 'not seated' }); return; }
    const x = h.seats[s];
    if (e.a === 'qup') {
      if (h.phase === 'bets') {
        if (x.bet) cast({ a: 'brefund', o: x.o, bet: x.bet, why: 'left' });
        h.seats[s] = null;
        cast({ a: 'bup', s });
        Blackjack.hostMaybeDeal(t);
      } else {
        // Mid-hand: the hand stands as it is; the seat frees up after.
        x.left = true;
        if (h.turn === s) { x.done = true; Blackjack.hostNext(t); }
      }
      return;
    }
    if (e.a === 'qbet') {
      const bet = Math.max(0, Math.floor(Number(e.bet) || 0));
      if (h.phase !== 'bets' || x.bet || !bet) { cast({ a: 'brefund', o: x.o, bet, why: 'too late' }); return; }
      x.bet = bet;
      cast({ a: 'bbet', s, bet });
      if (!h.timer) { h.timer = BET_WAIT; cast({ a: 'bclock', left: BET_WAIT }); }
      Blackjack.hostMaybeDeal(t);
      return;
    }
    if (h.phase !== 'play' || h.turn !== s || x.done) { if (e.a === 'qdbl') cast({ a: 'brefund', o: x.o, bet: x.bet, why: 'too late' }); return; }
    if (e.a === 'qhit') {
      const c = t.shoe.draw();
      x.cards.push(c);
      cast({ a: 'bcard', s, c });
      if (handValue(x.cards) >= 21) { x.done = true; Blackjack.hostNext(t); }
    } else if (e.a === 'qdbl') {
      if (x.cards.length !== 2 || x.doubled) { cast({ a: 'brefund', o: x.o, bet: x.bet, why: 'too late' }); return; }
      x.doubled = true;
      x.bet *= 2;
      const c = t.shoe.draw();
      x.cards.push(c);
      cast({ a: 'bcard', s, c, dbl: 1 });
      x.done = true;
      Blackjack.hostNext(t);
    } else if (e.a === 'qstand') {
      x.done = true;
      Blackjack.hostNext(t);
    }
  },
  hostMaybeDeal(t) {
    const h = t.bh;
    const seated = h.seats.filter(Boolean);
    const bet = seated.filter((x) => x.bet);
    if (!bet.length) { h.timer = 0; return; }
    // Everybody's in: don't make them wait.
    if (bet.length === seated.length && h.timer > 1.5) { h.timer = 1.5; t.T.cast(t, { a: 'bclock', left: 1.5 }); }
  },
  hostDeal(t) {
    const h = t.bh;
    const sh = t.shoe.ready();
    const s = t.shoe;
    const playing = h.seats.map((x, i) => (x && x.bet ? i : -1)).filter((i) => i >= 0);
    if (!playing.length) { h.timer = 0; return; }
    const hands = {};
    for (const i of playing) hands[i] = [s.draw()];
    const d0 = s.draw();
    for (const i of playing) hands[i].push(s.draw());
    const d1 = s.draw();
    h.d = [d0, d1];
    h.phase = 'play';
    h.timer = 0;
    for (const i of playing) { h.seats[i].cards = hands[i]; h.seats[i].done = isNatural({ cards: hands[i] }); }
    for (const x of h.seats) if (x && !x.bet) x.done = true;
    t.T.cast(t, { a: 'bdeal', hands, d: h.d, sh: sh ? 1 : 0, left: s.left });
    h.turn = -1;
    // The dealer peeks: a dealer blackjack ends the hand right there.
    if (handValue(h.d) === 21) { Blackjack.hostDealer(t); return; }
    Blackjack.hostNext(t);
  },
  hostNext(t) {
    const h = t.bh;
    let n = h.turn + 1;
    while (n < BJ_SEATS && !(h.seats[n] && h.seats[n].bet && !h.seats[n].done && !h.seats[n].left)) n++;
    if (n >= BJ_SEATS) { Blackjack.hostDealer(t); return; }
    h.turn = n;
    h.timer = TURN_TIME;
    t.T.cast(t, { a: 'bturn', s: n, left: TURN_TIME });
  },
  hostDealer(t) {
    const h = t.bh;
    const d = [...h.d];
    const live = handValue(d) !== 21 && h.seats.some((x) => x && x.bet && handValue(x.cards) <= 21 && !isNatural({ cards: x.cards }));
    if (live) while (handValue(d) < 17) d.push(t.shoe.draw());
    h.phase = 'done';
    h.turn = -1;
    // Time for everyone to watch it play out before the felt is cleared.
    h.timer = 5 + d.length * 0.6;
    t.T.cast(t, { a: 'bdealer', d, left: t.shoe.left });
  },
  hostUpdate(t, dt) {
    const h = t.bh;
    // Seats whose player is gone (left the Lounge, dropped out).
    h.check -= dt;
    if (h.check <= 0) {
      h.check = 2;
      const raid = t.T.raid;
      h.seats.forEach((x, s) => {
        if (!x || x.o === t.T.me) return;
        if (raid.combatants.some((c) => c.human && c.owner === x.o)) return;
        if (h.phase === 'bets') { h.seats[s] = null; t.T.cast(t, { a: 'bup', s }); } else { x.left = true; if (h.turn === s) { x.done = true; Blackjack.hostNext(t); } }
      });
    }
    if (!h.timer) return;
    h.timer = Math.max(0, h.timer - dt);
    if (h.timer > 0) return;
    if (h.phase === 'bets') Blackjack.hostDeal(t);
    else if (h.phase === 'play') { const x = h.seats[h.turn]; if (x) x.done = true; Blackjack.hostNext(t); }
    else if (h.phase === 'done') {
      h.phase = 'bets';
      h.d = [];
      h.seats.forEach((x, s) => { if (!x) return; if (x.left) { h.seats[s] = null; t.T.cast(t, { a: 'bup', s }); } else Object.assign(x, bjEmpty()); });
      t.T.cast(t, { a: 'bclear' });
    }
  },

  // ---------- everyone plays it out ----------
  apply(t, e) {
    const b = t.bj;
    const T = t.T;
    const mine = e.o === T.me;
    const seatsLine = () => `${b.seats.filter(Boolean).length} / ${BJ_SEATS} seats`;
    switch (e.a) {
      case 'bsit':
        b.seats[e.s] = { o: e.o, n: e.n, ...bjEmpty() };
        if (mine) T.seatAt(t, t.seatSpots[e.s]);
        t.show(`${e.n} sits down`, `${seatsLine()} · place your bets`);
        break;
      case 'bseats':
        e.seats.forEach((y, i) => { if (y && !b.seats[i]) { b.seats[i] = { o: y.o, n: y.n, ...bjEmpty() }; if (y.bet && b.phase === 'bets') { b.seats[i].bet = y.bet; Blackjack.chips(t, i, y.bet); } } });
        break;
      case 'bfull':
        if (mine && T.seat === t) { T.raid.hud.toast('All three seats are taken. Watch, or come back next hand.'); T.raid.setOverlay(null); }
        break;
      case 'bup':
        b.seats[e.s] = null;
        if (!b.seats.some(Boolean)) t.show('Open seats', `Hold ${keyName('use')} to play`);
        break;
      case 'bbet': {
        const x = b.seats[e.s];
        if (!x) break;
        x.bet = e.bet;
        if (x.o === T.me) b.pending = 0;
        Blackjack.chips(t, e.s, e.bet);
        t.show(`${x.n} bets 🪙 ${fmt(e.bet)}`, 'Cards out soon');
        sfx.tick(t.pos, T.raid.listener);
        break;
      }
      case 'brefund':
        if (mine && e.bet) {
          T.hub.earn(e.bet);
          b.pending = 0;
          T.raid.hud.toast(`🃏 🪙 ${fmt(e.bet)} back: ${e.why === 'too late' ? 'the cards were already out' : 'you left the table'}.`);
        }
        break;
      case 'bclock':
        b.clockEnd = performance.now() + e.left * 1000;
        break;
      case 'bdeal': {
        Blackjack.clear(t);
        Object.assign(b, { phase: 'play', d: [], turn: -1, wait: 0, settled: false, left: e.left, pending: 0 });
        const order = Object.keys(e.hands).map(Number).sort();
        for (const s of order) {
          if (!b.seats[s]) b.seats[s] = { o: '', n: 'Player', ...bjEmpty() };
          Object.assign(b.seats[s], { cards: [], doubled: false, done: false, res: '', net: 0 });
          Blackjack.chips(t, s, b.seats[s].bet);
        }
        for (const s of order) Blackjack.deal(t, e.hands[s][0], s);
        Blackjack.deal(t, e.d[0], 'd');
        for (const s of order) Blackjack.deal(t, e.hands[s][1], s);
        Blackjack.deal(t, e.d[1], 'd', true);
        t.show(`🃏 ${order.length} player${order.length > 1 ? 's' : ''} in`, e.sh ? 'Fresh shuffle. Cards out!' : 'Cards out!');
        break;
      }
      case 'bturn': {
        b.turn = e.s;
        b.clockEnd = performance.now() + e.left * 1000;
        const x = b.seats[e.s];
        if (x) t.show(`${x.n}'s turn`, `${handValue(x.cards)} · Dealer ${b.d.length ? handValue([b.d[0]]) : '?'} + ?`);
        if (x && x.o === T.me) sfx.alert();
        break;
      }
      case 'bcard': {
        const x = b.seats[e.s];
        if (!x) break;
        if (e.dbl) { x.bet *= 2; x.doubled = true; Blackjack.chips(t, e.s, x.bet); }
        Blackjack.deal(t, e.c, e.s);
        break;
      }
      case 'bdealer':
        b.phase = 'dealer';
        b.turn = -1;
        b.left = e.left;
        b.finalDealer = e.d;
        b.flipHole = true;
        b.wait = 0.5;
        break;
      case 'bclear':
        // Anyone still watching it play out gets their result now.
        if (!b.settled) Blackjack.finish(t);
        Blackjack.clear(t);
        Object.assign(b, { phase: 'bets', d: [], turn: -1, wait: 0, clockEnd: 0, flipHole: false });
        b.seats.forEach((x) => { if (x) Object.assign(x, bjEmpty(), { res: '', net: 0 }); });
        t.show(`🃏 ${seatsLine()}`, 'Place your bets!');
        break;
      default: break;
    }
    T.refresh(t);
  },
  busy(t) { return t.bj.phase !== 'bets'; },
  // Leaving mid-hand would walk out on chips that are on the felt.
  holdsSeat(t) {
    const b = t.bj;
    const me = Blackjack.mySeat(t);
    return me >= 0 && ((b.pending && performance.now() - b.pendingAt < 10000) || (b.seats[me].bet && b.phase !== 'bets' && !b.settled));
  },
  update(t, dt) {
    const b = t.bj;
    if (!t.T.raid.isClient) Blackjack.hostUpdate(t, dt);
    if (t.T.seat === t) {
      const el = $('bjClock');
      if (el) {
        const left = Math.max(0, Math.ceil((b.clockEnd - performance.now()) / 1000));
        const txt = b.phase === 'bets' ? (b.clockEnd && left ? `Cards out in ${left}s.` : 'Waiting for the first bet.') : b.phase === 'play' && left ? `${left}s on the clock.` : '';
        if (el.textContent !== txt) el.textContent = txt;
      }
    }
    if (b.anims.length) {
      const an = b.anims[0];
      an.t = (an.t || 0) + dt;
      an.mesh.visible = true;
      const k = Math.min(1, an.t / an.dur);
      const e = 1 - (1 - k) ** 2;
      an.mesh.position.lerpVectors(an.from, an.to, e);
      an.mesh.position.y += Math.sin(k * Math.PI) * 0.12;
      an.mesh.rotation.y = (1 - e) * 0.8;
      if (an.flip) an.mesh.rotation.z = Math.PI * (1 - e);
      if (k >= 1) {
        b.anims.shift();
        sfx.tick(t.pos, t.T.raid.listener);
        if (!b.anims.length) Blackjack.settled(t);
        t.T.refresh(t);
      }
      return;
    }
    if (b.wait > 0) {
      b.wait -= dt;
      if (b.flipHole && b.hole) {
        const k = 1 - Math.max(0, b.wait) / 0.5;
        b.hole.rotation.z = Math.PI * (1 - k);
        b.hole.position.y = TOP + 0.012 + Math.sin(k * Math.PI) * 0.15;
      }
      if (b.wait <= 0) {
        if (b.flipHole) { b.flipHole = false; if (b.hole) { b.hole.rotation.z = 0; b.hole.position.y = TOP + 0.014; } }
        Blackjack.dealerStep(t);
      }
    }
  },
  // After the last queued card lands.
  settled(t) {
    const b = t.bj;
    if (b.phase === 'dealer' && b.wait <= 0) Blackjack.dealerStep(t);
  },
  dealerStep(t) {
    const b = t.bj;
    if (b.phase !== 'dealer' || !b.finalDealer) return;
    if (b.d.length < b.finalDealer.length) {
      Blackjack.deal(t, b.finalDealer[b.d.length], 'd');
      b.anims[b.anims.length - 1].dur = 0.45;
      return;
    }
    Blackjack.finish(t);
  },
  // The dealer's done: every seat gets its result; you settle your own.
  finish(t) {
    const b = t.bj;
    if (b.settled) return;
    b.settled = true;
    if (b.finalDealer) b.d = [...b.finalDealer];
    b.phase = 'done';
    const dv = handValue(b.d);
    const dealerBJ = dv === 21 && b.d.length === 2;
    let best = 0;
    let bigWin = false;
    b.seats.forEach((x) => {
      if (!x || !x.bet || !x.cards.length) return;
      const p = handValue(x.cards);
      const natural = isNatural({ cards: x.cards });
      let pay = 0;
      if (dealerBJ) { if (natural) { pay = x.bet; x.res = 'PUSH'; } else x.res = 'Dealer BJ'; }
      else if (p > 21) x.res = 'BUST';
      else if (natural) { pay = Math.floor(x.bet * 2.5); x.res = 'BLACKJACK'; }
      else if (dv > 21) { pay = x.bet * 2; x.res = 'WIN'; }
      else if (p > dv) { pay = x.bet * 2; x.res = 'WIN'; }
      else if (p === dv) { pay = x.bet; x.res = 'PUSH'; }
      else x.res = 'LOSE';
      x.net = pay - x.bet;
      best = Math.max(best, x.net);
      if (natural && !dealerBJ) bigWin = true;
      if (x.o === t.T.me) t.T.settle('🃏', x.bet, pay, (st) => { if (natural && !dealerBJ) st.blackjacks++; });
    });
    t.show(dealerBJ ? 'Dealer BLACKJACK' : dv > 21 ? `Dealer busts (${dv})` : `Dealer ${dv}`,
      b.seats.filter((x) => x && x.res).map((x) => `${x.n} ${x.res}`).join(' · ') || 'No bets', best > 0 ? '#5ee27a' : '#ff7b85');
    if (best > 0) t.T.pop(t, `+${fmt(best)}`, '#5ee27a', bigWin);
    t.T.refresh(t);
  },
};

// Crash: a rocket on the table and a big screen behind it.
const Crash = {
  build(t) {
    const g = t.group;
    const pad = part(new THREE.CylinderGeometry(0.7, 0.85, 0.2, 20), 0x3a3a4f, { ink: 0.02 });
    pad.position.y = TOP + 0.1;
    g.add(pad);
    const rocket = new THREE.Group();
    const hull = part(new THREE.CylinderGeometry(0.22, 0.26, 1.0, 16), 0xfff6e0, { ink: 0.02 });
    hull.position.y = 0.5;
    const nose = part(new THREE.ConeGeometry(0.22, 0.45, 16), 0xe63946, { ink: 0.02 });
    nose.position.y = 1.22;
    const win = part(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 12), 0x2ee6d6, { ink: 0.01 });
    win.rotation.x = Math.PI / 2;
    win.position.set(0, 0.7, 0.23);
    rocket.add(hull, nose, win);
    for (let i = 0; i < 3; i++) {
      const fin = part(new THREE.BoxGeometry(0.04, 0.35, 0.3), 0xe63946, { ink: 0.02 });
      const a = (i / 3) * Math.PI * 2;
      fin.position.set(Math.sin(a) * 0.26, 0.15, Math.cos(a) * 0.26);
      fin.rotation.y = a;
      rocket.add(fin);
    }
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.6, 12), new THREE.MeshBasicMaterial({ color: 0xffb703, transparent: true, opacity: 0.9 }));
    flame.rotation.x = Math.PI;
    flame.position.y = -0.28;
    flame.visible = false;
    rocket.add(flame);
    rocket.position.y = TOP + 0.2;
    g.add(rocket);
    // The screen, on two legs behind the table.
    const screenTex = canvasTexture(512, 300, () => {});
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.0), new THREE.MeshBasicMaterial({ map: screenTex }));
    screen.position.set(0, 3.0, -2.9);
    const frame = part(new THREE.BoxGeometry(3.6, 2.2, 0.15), 0x1b0f2b);
    frame.position.set(0, 3.0, -3.0);
    for (const x of [-1.5, 1.5]) {
      const leg = part(new THREE.BoxGeometry(0.15, 2.0, 0.15), 0xd4a63a, { ink: 0.02 });
      leg.position.set(x, 1.0, -3.0);
      g.add(leg);
    }
    g.add(frame, screen);
    t.cr = { rocket, flame, screenTex, run: null, redraw: 0, history: [] };
    Crash.drawScreen(t);
  },
  mult(run) { return Math.min(run.x, Math.exp(0.22 * run.t)); },
  busy(t) { return !!t.cr.run; },
  panel(t, T) {
    const run = t.cr.run;
    if (run && run.mine && !run.cashed && !run.crashed) {
      return `<div class="tpscore"><b id="tpMult">${Crash.mult(run).toFixed(2)}x</b></div><div class="tprow"><button class="btn big cashout" data-act="cash" id="tpCash">CASH OUT 🪙 ${fmt(Math.floor(run.bet * Crash.mult(run)))}</button></div>`;
    }
    const busy = !!run;
    return `${T.chipsHtml(busy)}<div class="tprow"><button class="btn big" data-act="launch" ${busy ? 'disabled' : ''}>${busy ? 'Rocket in the air…' : `LAUNCH 🚀 · 🪙 ${fmt(T.bet)}`}</button></div>`;
  },
  act(t, a, arg, T) {
    const run = t.cr.run;
    if (a === 'launch' && !run) {
      if (!T.spend(T.bet)) return null;
      const u = Math.random();
      const x = Math.min(50, Math.max(1.05, Math.floor((0.95 / (1 - u)) * 100) / 100));
      return { a: 'go', bet: T.bet, x };
    }
    if (a === 'cash' && run && run.mine && !run.cashed && !run.crashed) return { a: 'cash', m: Math.floor(Crash.mult(run) * 100) / 100 };
    return null;
  },
  apply(t, e) {
    const cr = t.cr;
    if (e.a === 'go') {
      cr.run = { t: 0, x: e.x, bet: e.bet, mine: e.mine, who: e.n, cashed: 0, crashed: false, pts: [], puff: 0 };
      cr.flame.visible = true;
      t.show(`${e.n} · 🪙 ${fmt(e.bet)}`, '🚀 Liftoff!');
      sfx.lever(t.pos, t.T.raid.listener);
    } else if (e.a === 'cash' && cr.run && !cr.run.cashed) {
      const run = cr.run;
      run.cashed = e.m;
      const win = Math.floor(run.bet * e.m);
      t.show(`${run.who} cashed out at ${e.m.toFixed(2)}x`, `WON 🪙 ${fmt(win)}`, '#5ee27a');
      t.T.pop(t, `+${fmt(win)}`, '#5ee27a', e.m >= 5);
      if (run.mine) t.T.settle('🚀', run.bet, win, (s) => { s.crashBest = Math.max(s.crashBest, e.m); });
    }
  },
  update(t, dt) {
    const cr = t.cr;
    const run = cr.run;
    if (!run) {
      if (cr.respawn > 0) {
        cr.respawn -= dt;
        if (cr.respawn <= 0) { cr.rocket.visible = true; cr.rocket.position.set(0, TOP + 0.2, 0); cr.rocket.rotation.set(0, 0, 0); }
      }
      return;
    }
    if (run.crashed) {
      run.after -= dt;
      if (run.after <= 0) { cr.run = null; cr.respawn = 0.6; t.T.refresh(t); }
      return;
    }
    run.t += dt;
    const m = Crash.mult(run);
    run.pts.push([run.t, m]);
    const h = Math.min(4.2, Math.log(m) * 2.6);
    cr.rocket.position.set(Math.sin(run.t * 3) * 0.04 * h, TOP + 0.2 + h, 0);
    cr.rocket.rotation.z = Math.sin(run.t * 2.2) * 0.05;
    cr.flame.scale.y = 0.8 + Math.random() * 0.5;
    run.puff -= dt;
    if (run.puff <= 0 && h > 0.3) {
      run.puff = 0.12;
      t.T.raid.fx.puff(t.group.localToWorld(cr.rocket.position.clone().setY(cr.rocket.position.y - 0.45)), 0xffd9a0, 0.08);
    }
    cr.redraw -= dt;
    if (cr.redraw <= 0) { cr.redraw = 1 / 15; Crash.drawScreen(t); }
    if (run.mine && !run.cashed) {
      const mult = $('tpMult');
      const btn = $('tpCash');
      if (mult) mult.textContent = `${m.toFixed(2)}x`;
      if (btn) btn.textContent = `CASH OUT 🪙 ${fmt(Math.floor(run.bet * m))}`;
    }
    if (m < run.x) return;
    run.crashed = true;
    run.after = 2.2;
    cr.flame.visible = false;
    cr.rocket.visible = false;
    const at = t.group.localToWorld(cr.rocket.position.clone());
    t.T.raid.fx.explosion(at, 1.6);
    sfx.boom(at, t.T.raid.listener);
    Crash.drawScreen(t);
    cr.history.push(run.x);
    if (!run.cashed) {
      t.show(`💥 CRASHED at ${run.x.toFixed(2)}x`, `${run.who} loses 🪙 ${fmt(run.bet)}`, '#ff7b85');
      if (run.mine) t.T.settle('🚀', run.bet, 0);
    } else t.show(`💥 Popped at ${run.x.toFixed(2)}x`, `${run.who} got out at ${run.cashed.toFixed(2)}x`, '#5ee27a');
    t.T.refresh(t);
  },
  drawScreen(t) {
    const cr = t.cr;
    const { ctx: c } = cr.screenTex.userData;
    const w = 512;
    const h = 300;
    c.fillStyle = '#100a1c';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(255,255,255,0.07)';
    c.lineWidth = 2;
    for (let i = 1; i < 6; i++) { c.beginPath(); c.moveTo(0, (h / 6) * i); c.lineTo(w, (h / 6) * i); c.stroke(); }
    const run = cr.run;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    if (run && run.pts.length > 1) {
      const last = run.pts[run.pts.length - 1];
      const tMax = Math.max(5, last[0] * 1.1);
      const mMax = Math.max(2, last[1] * 1.15);
      const X = (tt) => 14 + (tt / tMax) * (w - 40);
      const Y = (mm) => h - 14 - ((mm - 1) / (mMax - 1)) * (h - 40);
      c.beginPath();
      c.moveTo(X(0), Y(1));
      for (const [tt, mm] of run.pts) c.lineTo(X(tt), Y(mm));
      c.strokeStyle = run.crashed ? '#e63946' : '#5ee27a';
      c.lineWidth = 7;
      c.stroke();
      if (run.cashed) {
        const y = Y(run.cashed);
        c.setLineDash([10, 8]);
        c.strokeStyle = '#ffd23f';
        c.lineWidth = 3;
        c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
        c.setLineDash([]);
      }
    }
    const m = run ? Crash.mult(run) : 1;
    c.font = "96px 'Luckiest Guy', 'Arial Black', sans-serif";
    c.fillStyle = run && run.crashed ? '#e63946' : '#fff6e0';
    c.fillText(run ? `${m.toFixed(2)}x` : 'READY', w / 2, 110);
    c.font = "bold 26px Nunito, Arial, sans-serif";
    c.fillStyle = '#ffd23f';
    const hist = cr.history.slice(-6).map((x) => `${x.toFixed(2)}x`).join('  ');
    c.fillText(hist || 'Cash out before it blows', w / 2, 270);
    cr.screenTex.needsUpdate = true;
  },
};

// Mines: a 5x5 board of tiles on the felt.
const Mines = {
  build(t) {
    const g = t.group;
    t.tiles = [];
    for (let i = 0; i < 25; i++) {
      const x = (i % 5) - 2;
      const z = Math.floor(i / 5) - 2;
      const tile = part(new THREE.BoxGeometry(0.36, 0.09, 0.36), 0x5a2a8a, { ink: 0.015 });
      tile.material = tile.material.clone();
      tile.position.set(x * 0.42, TOP + 0.05, z * 0.42 + 0.05);
      g.add(tile);
      t.tiles.push({ mesh: tile, prop: null, pop: 0 });
    }
    t.mn = { run: null };
    t.mineCount = 3;
  },
  reset(t) {
    for (const tl of t.tiles) {
      tl.mesh.material.color.setHex(0x5a2a8a);
      tl.mesh.position.y = TOP + 0.05;
      if (tl.prop) { t.group.remove(tl.prop); tl.prop = null; }
    }
  },
  reveal(t, i, bomb, dim = false) {
    const tl = t.tiles[i];
    if (tl.prop) return;
    tl.mesh.material.color.setHex(bomb ? (dim ? 0x4a2030 : 0xe63946) : dim ? 0x1f4a4a : 0x2ee6d6);
    const prop = bomb
      ? new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), new THREE.MeshBasicMaterial({ color: 0x1b0f2b }))
      : new THREE.Mesh(new THREE.OctahedronGeometry(0.12), new THREE.MeshBasicMaterial({ color: dim ? 0x6fb7b7 : 0x9bf6ff }));
    prop.position.copy(tl.mesh.position).setY(TOP + 0.22);
    t.group.add(prop);
    tl.prop = prop;
    tl.pop = dim ? 0 : 1;
  },
  panel(t, T) {
    const run = t.mn.run;
    if (run && run.mine && run.live) {
      const mult = minesMult(run.bombs, run.picks);
      const grid = Array.from({ length: 25 }, (_, i) => `<button class="tmine ${run.open.has(i) ? 'gem' : ''}" data-act="pick" data-arg="${i}" ${run.open.has(i) ? 'disabled' : ''}>${run.open.has(i) ? '💎' : ''}</button>`).join('');
      return `<div class="tpmines"><div class="tmgrid">${grid}</div><div class="tpside"><div class="tpscore"><b>${mult.toFixed(2)}x</b><small>next ${minesMult(run.bombs, run.picks + 1).toFixed(2)}x</small></div>
        <button class="btn big cashout" data-act="cash" ${run.picks ? '' : 'disabled'}>CASH OUT 🪙 ${fmt(Math.floor(run.bet * mult))}</button></div></div>`;
    }
    const counts = MINE_COUNTS.map((n) => `<button class="subtab ${t.mineCount === n ? 'on' : ''}" data-act="bombs" data-arg="${n}">💣 ${n}</button>`).join('');
    return `${T.chipsHtml(false)}<div class="tprow">${counts}</div><div class="tprow"><button class="btn big" data-act="start">START · 🪙 ${fmt(T.bet)}</button></div>`;
  },
  act(t, a, arg, T) {
    const run = t.mn.run;
    if (a === 'bombs') { t.mineCount = Number(arg); return null; }
    // A new round when the board's free (or a round somebody else left behind is stuck).
    if (a === 'start' && !(run && run.live && run.mine)) {
      if (!T.spend(T.bet)) return null;
      const bombsAt = new Set();
      while (bombsAt.size < t.mineCount) bombsAt.add(Math.floor(Math.random() * 25));
      t.mn.secret = bombsAt;
      return { a: 'start', bet: T.bet, b: t.mineCount };
    }
    if (!run || !run.mine || !run.live) return null;
    const all = [...t.mn.secret];
    if (a === 'pick') {
      const i = Number(arg);
      if (run.open.has(i)) return null;
      const boom = t.mn.secret.has(i);
      const left = 25 - run.bombs - run.picks - 1;
      return boom ? { a: 'pick', i, boom: 1, all } : { a: 'pick', i, ...(left === 0 ? { all } : {}) };
    }
    if (a === 'cash' && run.picks) return { a: 'cash', all };
    return null;
  },
  apply(t, e) {
    const mn = t.mn;
    if (e.a === 'start') {
      Mines.reset(t);
      mn.run = { bet: e.bet, bombs: e.b, picks: 0, open: new Set(), live: true, mine: e.mine, who: e.n };
      t.show(`${e.n} · 🪙 ${fmt(e.bet)} · 💣 ${e.b}`, 'Pick a tile…');
      sfx.lever(t.pos, t.T.raid.listener);
      return;
    }
    const run = mn.run;
    if (!run || !run.live) return;
    if (e.a === 'pick') {
      run.open.add(e.i);
      if (e.boom) {
        Mines.reveal(t, e.i, true);
        run.live = false;
        const at = t.group.localToWorld(t.tiles[e.i].mesh.position.clone());
        t.T.raid.fx.explosion(at, 0.9);
        sfx.boom(at, t.T.raid.listener);
        Mines.end(t, e.all);
        t.show(`💥 BOOM after ${run.picks} gem${run.picks === 1 ? '' : 's'}`, `${run.who} loses 🪙 ${fmt(run.bet)}`, '#ff7b85');
        if (run.mine) t.T.settle('💎', run.bet, 0);
        return;
      }
      run.picks++;
      Mines.reveal(t, e.i, false);
      sfx.pickup();
      const mult = minesMult(run.bombs, run.picks);
      t.show(`${run.who} · ${run.picks} gem${run.picks === 1 ? '' : 's'}`, `${mult.toFixed(2)}x · 🪙 ${fmt(Math.floor(run.bet * mult))}`, '#9bf6ff');
      if (e.all) Mines.cashOut(t, e.all);
      return;
    }
    if (e.a === 'cash') Mines.cashOut(t, e.all);
  },
  cashOut(t, all) {
    const run = t.mn.run;
    run.live = false;
    const mult = minesMult(run.bombs, run.picks);
    const win = Math.floor(run.bet * mult);
    Mines.end(t, all);
    t.show(`${run.who} cashed out at ${mult.toFixed(2)}x`, `WON 🪙 ${fmt(win)}`, '#5ee27a');
    t.T.pop(t, `+${fmt(win)}`, '#5ee27a', mult >= 5);
    if (run.mine) t.T.settle('💎', run.bet, win, (s) => { s.minesBest = Math.max(s.minesBest || 0, run.picks); });
  },
  // Show where everything was.
  end(t, all = []) {
    const bombs = new Set(all);
    for (let i = 0; i < 25; i++) if (!t.mn.run.open.has(i)) Mines.reveal(t, i, bombs.has(i), true);
    t.T.refresh(t);
  },
  update(t, dt) {
    for (const tl of t.tiles) {
      if (!tl.prop) continue;
      tl.prop.rotation.y += dt * 2;
      if (tl.pop > 0) {
        tl.pop = Math.max(0, tl.pop - dt * 2.5);
        tl.prop.position.y = TOP + 0.22 + Math.sin((1 - tl.pop) * Math.PI) * 0.35;
        tl.prop.scale.setScalar(1 + tl.pop * 0.5);
      }
    }
  },
};

// Plinko: a tall board on the wall of pegs, with real balls bouncing down it.
const PDX = 0.25;
const PDY = 0.25;
const PTOP = 4.3;
const Plinko = {
  build(t) {
    const g = t.group;
    const board = part(new THREE.BoxGeometry(3.9, 4.4, 0.2), 0x1b0f2b);
    board.position.set(0, 2.55, -0.1);
    const frame = part(new THREE.BoxGeometry(4.1, 4.6, 0.12), 0xd4a63a, { ink: 0.02 });
    frame.position.set(0, 2.55, -0.24);
    const base = part(new THREE.BoxGeometry(4.1, 0.5, 0.9), 0x7b2cbf);
    base.position.set(0, 0.25, 0.15);
    g.add(board, frame, base);
    const pegGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.16, 8);
    const pegMat = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
    for (let r = 0; r < PLINKO_ROWS; r++) {
      for (let k = 0; k < r + 3; k++) {
        const peg = new THREE.Mesh(pegGeo, pegMat);
        peg.rotation.x = Math.PI / 2;
        peg.position.set((k - (r + 2) / 2) * PDX, PTOP - r * PDY, 0.07);
        g.add(peg);
      }
    }
    t.bucketTex = canvasTexture(1024, 96, () => {});
    const buckets = new THREE.Mesh(new THREE.PlaneGeometry(PDX * 13, 0.3), new THREE.MeshBasicMaterial({ map: t.bucketTex }));
    t.bucketY = PTOP - PLINKO_ROWS * PDY - 0.12;
    buckets.position.set(0, t.bucketY, 0.03);
    g.add(buckets);
    t.pl = { balls: [], flash: [], risk: 'medium', shown: null };
    Plinko.drawBuckets(t, 'medium');
  },
  drawBuckets(t, risk) {
    const pl = t.pl;
    if (pl.shown === risk && !pl.flash.some((f) => f > 0)) return;
    pl.shown = risk;
    const { ctx: c } = t.bucketTex.userData;
    const mults = PLINKO[risk];
    const cw = 1024 / mults.length;
    c.clearRect(0, 0, 1024, 96);
    mults.forEach((m, i) => {
      const lift = (pl.flash[i] || 0) * 14;
      c.fillStyle = (pl.flash[i] || 0) > 0 ? '#ffffff' : bucketColor(m);
      c.beginPath();
      if (c.roundRect) c.roundRect(i * cw + 4, 10 - lift + 14, cw - 8, 62, 10); else c.rect(i * cw + 4, 24 - lift, cw - 8, 62);
      c.fill();
      c.fillStyle = '#1b0f2b';
      c.font = `900 ${m >= 100 ? 24 : 28}px Nunito, Arial, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(`${m}x`, i * cw + cw / 2, 56 - lift);
    });
    t.bucketTex.needsUpdate = true;
  },
  panel(t, T) {
    const risks = ['low', 'medium', 'high'].map((r) => `<button class="subtab ${t.pl.risk === r ? 'on' : ''}" data-act="risk" data-arg="${r}">${r[0].toUpperCase() + r.slice(1)}</button>`).join('');
    return `${T.chipsHtml(false)}<div class="tprow">${risks}</div><div class="tprow"><button class="btn big" data-act="drop">DROP · 🪙 ${fmt(T.bet)}</button></div>`;
  },
  act(t, a, arg, T) {
    if (a === 'risk') {
      if (t.pl.balls.length) return null;
      t.pl.risk = arg;
      Plinko.drawBuckets(t, arg);
      return { a: 'risk', r: arg };
    }
    if (a !== 'drop' || t.pl.balls.length >= 8) return null;
    if (!T.spend(T.bet)) return null;
    return { a: 'drop', bet: T.bet, r: t.pl.risk, s: Array.from({ length: PLINKO_ROWS }, () => (Math.random() < 0.5 ? 0 : 1)), j: Math.round((Math.random() - 0.5) * 100) / 1000 };
  },
  apply(t, e) {
    const pl = t.pl;
    if (e.a === 'risk') { pl.risk = e.r; Plinko.drawBuckets(t, e.r); return; }
    if (e.a !== 'drop') return;
    pl.risk = e.r;
    Plinko.drawBuckets(t, e.r);
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 10), new THREE.MeshBasicMaterial({ color: 0xff3fa4 }));
    t.group.add(mesh);
    pl.balls.push({ mesh, bet: e.bet, risk: e.r, steps: e.s, jitter: e.j || 0, t: 0, mine: e.mine, who: e.n });
    t.show(`${e.n} · 🪙 ${fmt(e.bet)} · ${e.r}`, 'Ball away!');
  },
  busy(t) { return t.pl.balls.length > 0; },
  pos(b) {
    const row = Math.min(PLINKO_ROWS, Math.floor(b.t));
    const f = Math.min(1, b.t - row);
    let rights = 0;
    for (let i = 0; i < row; i++) rights += b.steps[i];
    const xAt = (r, n) => (n - r / 2) * PDX;
    const x0 = xAt(row, rights);
    const x1 = row < PLINKO_ROWS ? xAt(row + 1, rights + b.steps[row]) : x0;
    const y0 = PTOP + 0.16 - row * PDY;
    const x = x0 + (x1 - x0) * f + (row === 0 ? b.jitter * (1 - f) : 0);
    const y = y0 - PDY * f + Math.sin(f * Math.PI) * 0.08;
    return [x, Math.max(y, PTOP - PLINKO_ROWS * PDY - 0.05)];
  },
  update(t, dt) {
    const pl = t.pl;
    for (const b of pl.balls) {
      const before = Math.floor(b.t);
      b.t += dt * 6.5;
      if (Math.floor(b.t) !== before && b.t < PLINKO_ROWS) sfx.tick(t.pos, t.T.raid.listener);
      const [x, y] = Plinko.pos(b);
      b.mesh.position.set(x, y, 0.16);
    }
    for (const b of pl.balls.filter((x) => x.t >= PLINKO_ROWS + 0.6)) {
      t.group.remove(b.mesh);
      const bucket = b.steps.reduce((n, s) => n + s, 0);
      const mult = PLINKO[b.risk][bucket];
      const win = Math.floor(b.bet * mult);
      pl.flash[bucket] = 1;
      t.show(`${b.who} hit ${mult}x`, win >= b.bet ? `WON 🪙 ${fmt(win)}` : `Back 🪙 ${fmt(win)}`, mult >= 1 ? '#5ee27a' : '#ff7b85');
      if (mult >= 3) t.T.pop(t, `${mult}x`, bucketColor(mult), mult >= 9);
      if (b.mine) t.T.settle('🔴', b.bet, win, (s) => { s.plinkoBest = Math.max(s.plinkoBest || 0, mult); });
    }
    pl.balls = pl.balls.filter((x) => x.t < PLINKO_ROWS + 0.6);
    if (pl.flash.some((f) => f > 0)) {
      for (let i = 0; i < pl.flash.length; i++) pl.flash[i] = Math.max(0, (pl.flash[i] || 0) - dt * 2);
      pl.shown = null;
      Plinko.drawBuckets(t, pl.risk);
    }
  },
};

const GAMES = { roulette: Roulette, slots: Slots, blackjack: Blackjack, crash: Crash, mines: Mines, plinko: Plinko };

// ---------- the floor ----------

export class LoungeTables {
  constructor(raid, defs, armory) {
    this.raid = raid;
    this.seat = null; // the table we're sitting at
    this.bet = 100;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.tables = defs.filter((d) => GAMES[d.game]).map((d, i) => this.makeTable(d, i));
    this.spots = this.tables.map((t) => ({
      spot: t.seatPos, range: 3.2, searchTime: 0.2, searchLabel: 'Taking a seat…',
      prompt: () => {
        if (GAMES[t.game].multi) {
          const n = t.bj.seats.filter(Boolean).length;
          if (Blackjack.mySeat(t) < 0 && n >= BJ_SEATS) return `🍿 ${TITLES[t.game]} is full (${n}/${BJ_SEATS}). Watch, or wait for a seat.`;
          return `<b>Hold ${keyName('use')}</b> Play ${TITLES[t.game]}${n ? ` · ${n}/${BJ_SEATS} seats taken` : ''}`;
        }
        if (this.takenByOther(t)) return `🍿 <b>${t.user}</b> is playing ${TITLES[t.game]}. Pull up and watch!`;
        return `<b>Hold ${keyName('use')}</b> Play ${TITLES[t.game]}`;
      },
      open: (by) => { if (by.isPlayer) this.sit(t); },
    }));
    if (armory) this.buildArmory(armory);
  }

  get hub() { return this.raid.casino; }
  get myName() { return this.raid.player ? this.raid.player.name : ''; }
  get me() { return this.raid.net ? this.raid.net.me : 'me'; }

  makeTable(d, index) {
    const raid = this.raid;
    const len = Math.hypot(d.x, d.z) || 1;
    const front = new THREE.Vector3(-d.x / len, 0, -d.z / len);
    // Square the cabinets up with the room.
    if (CABINET_GAMES.has(d.game)) {
      if (Math.abs(front.x) > Math.abs(front.z)) front.set(Math.sign(front.x), 0, 0); else front.set(0, 0, Math.sign(front.z));
    }
    const group = new THREE.Group();
    group.position.set(d.x, 0, d.z);
    group.rotation.y = Math.atan2(front.x, front.z);
    raid.scene.add(group);
    const cabinet = CABINET_GAMES.has(d.game);
    const t = {
      T: this, index, game: d.game, def: d, group, front, pos: new THREE.Vector3(d.x, 1.5, d.z),
      seatPos: new THREE.Vector3(d.x, 0, d.z).addScaledVector(front, cabinet ? 2.4 : 3.3),
      user: null, userAt: 0, cabinet,
    };
    t.show = (a, b, tint) => { t.lines = [a, b, tint]; t.board.draw(a, b, tint); };
    const { sprite, draw } = makeBoard(TITLES[d.game], d.color);
    sprite.position.set(d.x, cabinet ? 5.0 : 3.25, d.z);
    if (cabinet) sprite.position.addScaledVector(front, 0.9);
    raid.scene.add(sprite);
    t.board = { sprite, draw };
    GAMES[d.game].build(t);
    t.show('Open seat', `Hold ${keyName('use')} to play`);
    if (cabinet) {
      const sideways = Math.abs(front.x) > 0.5;
      const w = sideways ? 1.4 : 4.2;
      const dd = sideways ? 4.2 : 1.4;
      raid.map.addCollider({ type: 'box', minX: d.x - w / 2, maxX: d.x + w / 2, minZ: d.z - dd / 2, maxZ: d.z + dd / 2, top: 4.6 });
    }
    return t;
  }

  dispose() {
    for (const t of this.tables) { this.raid.scene.remove(t.group); this.raid.scene.remove(t.board.sprite); }
    if (this.armory) this.raid.scene.remove(this.armory.group);
    $('tablePanel').hidden = true;
    document.body.classList.remove('seated');
    this.seat = null;
  }

  interactables() {
    return this.armory ? [...this.spots, this.armory.spotDef] : this.spots;
  }

  // ---------- sitting down ----------

  // Someone else is sitting here (tracked by who they are on the network, not their name: two
  // people can both be "High Roller").
  takenByOther(t) { return !!t.owner && t.owner !== this.me && !t.stale; }

  sit(t) {
    const multi = !!(GAMES[t.game] && GAMES[t.game].multi);
    if (multi && Blackjack.mySeat(t) < 0 && t.bj.seats.filter(Boolean).length >= BJ_SEATS) {
      this.raid.hud.toast('All the seats are taken. Watch, or wait for one to open.');
      return;
    }
    if (!multi && this.takenByOther(t)) {
      this.raid.hud.toast(`${t.user} is at that table. Watch, or try another one.`);
      return;
    }
    const p = this.raid.player;
    if (!p) return;
    this.seat = t;
    p.pos.copy(t.seatPos);
    p.vel.set(0, 0, 0);
    p.yaw = Math.atan2(t.front.x, t.front.z);
    p.pitch = 0;
    // Frame the game in the top part of the screen, above the bet panel.
    const VIEW = {
      round: [4.4, TOP + 3.4, 0, TOP], slots: [5.2, 2.5, 0, 2.1], plinko: [6.6, 2.8, 0, 2.5],
      crash: [6.4, 3.6, -1.2, 2.7], armory: [5.4, 2.6, -0.6, 2.0],
    }[t.game] || null;
    const [dist, camY, lookFwd, lookY] = VIEW || [4.4, TOP + 3.4, 0, TOP];
    this.camPos.copy(t.pos).setY(0).addScaledVector(t.front, dist).setY(camY);
    this.camLook.copy(t.pos).setY(0).addScaledVector(t.front, lookFwd).setY(lookY);
    if (t.board) t.board.sprite.visible = false; // the panel says it all
    if (multi) this.share(t, { a: 'qsit' });
    else if (t.game !== 'armory') this.share(t, { a: 'sit' });
    this.raid.setOverlay('seat');
    document.body.classList.add('seated');
    this.render();
  }

  // Leaving the seat. Some rounds have to finish first.
  canLeave() {
    const t = this.seat;
    if (!t) return true;
    const busy = (GAMES[t.game] && GAMES[t.game].holdsSeat && GAMES[t.game].holdsSeat(t))
      || (t.mn && t.mn.run && t.mn.run.live && t.mn.run.mine)
      || (t.cr && t.cr.run && t.cr.run.mine && !t.cr.run.cashed && !t.cr.run.crashed);
    if (busy) this.raid.hud.toast('Finish this round first.');
    return !busy;
  }

  leave() {
    const t = this.seat;
    if (!t) return;
    this.seat = null;
    $('tablePanel').hidden = true;
    document.body.classList.remove('seated');
    if (t.board) t.board.sprite.visible = true;
    const p = this.raid.player;
    if (p && p.alive) p.char.root.visible = true;
    if (GAMES[t.game] && GAMES[t.game].multi) this.share(t, { a: 'qup' });
    else if (t.game !== 'armory') this.share(t, { a: 'up' });
  }

  // A multi-seat table gave us a seat: stand there, facing the table.
  seatAt(t, pos) {
    const p = this.raid.player;
    if (!p || this.seat !== t) return;
    p.pos.copy(pos);
    p.vel.set(0, 0, 0);
    p.yaw = Math.atan2(pos.x - t.pos.x, pos.z - t.pos.z);
  }

  // The host, running a multi-seat table: tell everyone (and play it here).
  cast(t, e) {
    e.t = t.index;
    if (this.raid.isHost) this.raid.net.rel({ k: 'tgs', own: '', e });
    this.apply(e);
  }

  // Where the camera goes while we're seated.
  camera(camera, dt) {
    const k = Math.min(1, dt * 5);
    if (!this.camCur) this.camCur = camera.position.clone();
    this.camCur.lerp(this.camPos, k);
    camera.position.copy(this.camCur);
    camera.lookAt(this.camLook);
    if (camera.fov !== 60) camera.fov = 60;
    // Shift the picture up so what we're looking at sits above the bet panel.
    const w = window.innerWidth;
    const h = window.innerHeight;
    const panel = $('tablePanel').offsetHeight || 0;
    camera.setViewOffset(w, h, 0, Math.round(Math.min(h * 0.3, panel * 0.5)), w, h);
  }

  // ---------- money ----------

  spend(n) { return this.hub.spend(n); }
  settle(icon, wager, payout, stat) {
    if (payout) this.hub.earn(payout);
    this.hub.settleBet(icon, wager, payout, stat);
    this.afterSettle(wager, payout);
  }
  afterSettle(wager, payout) {
    if (payout > wager) sfx.win(); else if (payout < wager) sfx.deny();
    this.render();
  }

  chipsHtml(disabled) {
    const lv = levelInfo(save.get().xp).level;
    const chips = save.get().stash.chips;
    return `<div class="betchips tpchips">${BETS.filter((b) => b <= 25000).map((b) => {
      const locked = lv < (BET_LEVEL[b] || 0) || b > chips;
      return `<button class="cchip c${b} ${b === this.bet ? 'on' : ''}" data-act="bet" data-arg="${b}" ${disabled || locked ? 'disabled' : ''}>${b >= 1000 ? `${b / 1000}K` : b}</button>`;
    }).join('')}</div>`;
  }

  // ---------- doing things ----------

  act(t, a, arg) {
    if (a === 'bet') { this.bet = Number(arg); this.render(); return; }
    if (t.game === 'armory') { this.armoryAct(a, arg); return; }
    const e = GAMES[t.game].act(t, a, arg, this);
    if (e) this.share(t, e);
    this.render();
  }

  // Play it here, and tell everyone else.
  share(t, e) {
    e.t = t.index;
    e.n = this.myName;
    e.o = this.me;
    const raid = this.raid;
    if (raid.isClient) raid.net.send({ k: 'tg', e });
    else if (raid.isHost) raid.net.rel({ k: 'tgs', own: this.me, e });
    this.apply({ ...e, mine: true });
  }

  // From the host: a friend's move (host only), passed on to everyone else.
  relay(e, own) {
    if (!e || !this.tables[e.t]) return;
    // A request for the table we run: it's from whoever sent it, and it isn't passed on.
    if (typeof e.a === 'string' && e.a[0] === 'q' && GAMES[this.tables[e.t].game].multi) { this.apply({ ...e, o: own, mine: false }); return; }
    this.raid.net.rel({ k: 'tgs', own, e });
    this.apply({ ...e, mine: false });
  }

  apply(e) {
    const t = this.tables[e.t];
    if (!t) return;
    t.userAt = performance.now();
    if (GAMES[t.game].multi) {
      if (e.a[0] === 'q') { if (!this.raid.isClient) GAMES[t.game].host(t, e); return; }
      GAMES[t.game].apply(t, e);
      return;
    }
    if (e.a === 'sit') { t.user = e.n; t.owner = e.o; t.show(`${e.n} sits down`, 'Place your bets!'); return; }
    if (e.a === 'up') {
      if (t.owner === e.o) { t.user = null; t.owner = null; }
      // Leave the last result up if a game is still playing out.
      if (!GAMES[t.game].busy || !GAMES[t.game].busy(t)) t.show('Open seat', `Hold ${keyName('use')} to play`);
      return;
    }
    t.user = e.n;
    t.owner = e.o;
    GAMES[t.game].apply(t, e);
    if (this.seat === t) this.render();
  }

  refresh(t) { if (this.seat === t) this.render(); }

  pop(t, text, color, big = false) {
    const at = t.board.sprite.position.clone().setY(t.board.sprite.position.y + 0.9);
    this.raid.fx.number(at, text, color, big ? 1.8 : 1.2);
    if (big) { this.raid.fx.confetti(at); sfx.jackpot(t.pos, this.raid.listener); }
  }

  update(dt) {
    const now = performance.now();
    for (const t of this.tables) {
      t.stale = !!t.owner && now - t.userAt > STALE * 1000;
      GAMES[t.game].update(t, dt);
    }
    if (this.armory) this.armory.blink += dt;
  }

  render() {
    const t = this.seat;
    const el = $('tablePanel');
    if (!t) { el.hidden = true; return; }
    el.hidden = false;
    const chips = save.get().stash.chips;
    const body = t.game === 'armory' ? this.armoryPanel() : GAMES[t.game].panel(t, this);
    el.innerHTML = `<div class="tphead"><b>${TITLES[t.game]}</b><span>Stash 🪙 ${fmt(chips)}</span><button class="btn ghost tpleave" data-act="leave">Leave · Esc</button></div>${body}`;
    el.onclick = (ev) => {
      const b = ev.target.closest('[data-act]');
      if (!b || b.disabled) return;
      if (b.dataset.act === 'leave') { if (this.canLeave()) this.raid.setOverlay(null); return; }
      this.act(t, b.dataset.act, b.dataset.arg);
    };
  }

  // ---------- the Armory: free ammo and house guns ----------

  buildArmory({ x, z, rot = 0 }) {
    const raid = this.raid;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    const counter = part(new THREE.BoxGeometry(7, 1.2, 1.4), 0x3a1d5c);
    counter.position.y = 0.6;
    const top = part(new THREE.BoxGeometry(7.2, 0.12, 1.6), 0xd4a63a, { ink: 0.02 });
    top.position.y = 1.26;
    const rack = part(new THREE.BoxGeometry(7, 2.6, 0.2), 0x24103d);
    rack.position.set(0, 2.6, -1.7);
    g.add(counter, top, rack);
    // Guns on the wall rack and ammo crates on the counter.
    HOUSE_GUNS.forEach((k, i) => {
      const gun = part(new THREE.BoxGeometry(0.9, 0.18, 0.1), [0x5a5a6e, 0x2a9d8f, 0x7b4a2a, 0xc0c0c0, 0x7b4a2a, 0x3a3a4f][i], { ink: 0.015 });
      gun.position.set(-2.6 + i * 1.04, 2.2 + (i % 2) * 0.7, -1.55);
      gun.rotation.z = 0.15;
      g.add(gun);
    });
    for (let i = 0; i < 4; i++) {
      const crate = part(new THREE.BoxGeometry(0.5, 0.32, 0.36), 0x5b7a2a, { ink: 0.02 });
      crate.position.set(-2.8 + i * 0.6, 1.48, 0.1);
      crate.rotation.y = (i % 2 ? 0.2 : -0.15);
      g.add(crate);
    }
    const sign = canvasTexture(512, 160, (c, w, h) => {
      c.fillStyle = '#1b0f2b';
      c.fillRect(0, 0, w, h);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = "78px 'Luckiest Guy', 'Arial Black', sans-serif";
      c.fillStyle = '#5ee27a';
      c.shadowColor = '#5ee27a';
      c.shadowBlur = 16;
      c.fillText('🔫 ARMORY', w / 2, h * 0.38);
      c.shadowBlur = 0;
      c.font = "bold 30px Nunito, Arial, sans-serif";
      c.fillStyle = '#fff6e0';
      c.fillText('AMMO · HEALS · ARMOR · GUNS', w / 2, h * 0.8);
    });
    const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.1), new THREE.MeshBasicMaterial({ map: sign }));
    signMesh.position.set(0, 4.4, -1.58);
    g.add(signMesh);
    raid.scene.add(g);
    const front = new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot));
    const sideways = Math.abs(Math.sin(rot)) > 0.5;
    const w = sideways ? 1.6 : 7.2;
    const d = sideways ? 7.2 : 1.6;
    raid.map.addCollider({ type: 'box', minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: 1.3 });
    const t = {
      T: this, game: 'armory', group: g, front, pos: new THREE.Vector3(x, 1.5, z), cabinet: true,
      seatPos: new THREE.Vector3(x, 0, z).addScaledVector(front, 2.0),
    };
    this.armory = {
      group: g, blink: 0, table: t,
      spotDef: {
        spot: t.seatPos, range: 3.4, searchTime: 0.2, searchLabel: 'Stepping up…',
        prompt: () => `<b>Hold ${keyName('use')}</b> 🔫 Armory: free ammo, heals, armor and house guns`,
        open: (by) => { if (by.isPlayer) this.sit(t); },
      },
    };
  }

  armoryPanel() {
    const p = this.raid.player;
    const guns = p.weapons.map((g, i) => (g ? `${i === p.active ? '✋ ' : ''}${itemInfo(g).name}${g.house ? ' <small>(house)</small>' : ''} · ${g.ammo === Infinity ? '∞' : g.ammo}` : '<small>empty</small>')).join(' &nbsp;|&nbsp; ');
    const rack = HOUSE_GUNS.map((k) => {
      const info = itemInfo(makeGun(k, 0));
      return `<button class="btn tpgun" data-act="take" data-arg="${k}">${info.name}</button>`;
    }).join('');
    return `<p class="tpnote">Your guns: ${guns}</p>
      <p class="tpnote">❤️ ${Math.ceil(p.hp)} / ${p.maxHp} &nbsp;|&nbsp; 🛡️ ${Math.ceil(p.armor)} / ${PLAYER.maxArmor}</p>
      <div class="tprow tp3"><button class="btn" data-act="refill">📦 Refill ammo</button>
        <button class="btn" data-act="heal" ${p.hp >= p.maxHp ? 'disabled' : ''}>❤️ Heal up</button>
        <button class="btn" data-act="armor" ${p.armor >= PLAYER.maxArmor ? 'disabled' : ''}>🛡️ Armor up</button></div>
      <p class="tpnote">All free, as often as you like.</p>
      <p class="tpnote">House guns are free to use in the Lounge, but they stay here when you cash out. Pick one to swap it into your hands.</p>
      <div class="tprow">${rack}</div>
      ${p.weapons.some((g) => g && g.house) ? '<div class="tprow"><button class="btn ghost" data-act="return">Hand back the house guns</button></div>' : ''}`;
  }

  armoryAct(a, arg) {
    const p = this.raid.player;
    const hud = this.raid.hud;
    if (a === 'refill') {
      let n = 0;
      for (const g of p.weapons) {
        if (!isGun(g)) continue;
        const full = fullAmmo(g.kind, g.rarity);
        if (Number.isFinite(full) && g.ammo < full) { g.ammo = full; n++; }
      }
      if (n) { sfx.pickup(); hud.toast(`📦 Topped up ${n} gun${n > 1 ? 's' : ''}. On the house.`); } else hud.toast('Your guns are already full.');
    } else if (a === 'heal') {
      if (p.hp >= p.maxHp) hud.toast('You\'re already at full health.');
      else { p.hp = p.maxHp; sfx.heal(); hud.toast('❤️ Patched up to full. On the house.'); }
    } else if (a === 'armor') {
      if (p.armor >= PLAYER.maxArmor) hud.toast('Your armor is already full.');
      else { p.armor = PLAYER.maxArmor; sfx.heal(); hud.toast('🛡️ Fresh plates, full armor. On the house.'); }
    } else if (a === 'take' && HOUSE_GUNS.includes(arg)) {
      const gun = { ...makeGun(arg, 0), free: true, house: true };
      const held = p.weapons[p.active];
      let slot = -1;
      if (!held || held.house) slot = p.active;
      else if (p.weapons.indexOf(null) >= 0) slot = p.weapons.indexOf(null);
      else {
        const house = p.weapons.findIndex((g) => g && g.house);
        if (house >= 0) slot = house;
        else if (addToList(p.backpack, held, p.room)) slot = p.active; // your own gun goes in the bag
      }
      if (slot < 0) { hud.toast('Both hands and your bag are full. Make some room first.'); return; }
      p.weapons[slot] = gun;
      p.active = slot;
      p.refreshWeapon();
      sfx.pickup();
      hud.toast(`🔫 ${itemInfo(gun).name} from the house. It stays here when you cash out.`);
    } else if (a === 'return') {
      p.weapons = p.weapons.map((g) => (g && g.house ? null : g));
      if (!p.weapons[p.active]) { const i = p.weapons.findIndex(Boolean); if (i >= 0) p.active = i; }
      p.refreshWeapon();
      hud.toast('House guns handed back.');
    }
    this.render();
  }
}
