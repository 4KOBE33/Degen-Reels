// CRASH: a multiplier climbs from 1.00x and can crash at any moment. Cash out before it does.
// One shared round runs on the big screen; everyone at the machine plays the same rocket.
import * as THREE from 'three';
import { part, canvasTexture } from './toon.js';
import { Seat } from './tables.js';
import { sfx } from './audio.js';

const WAIT_TIME = 6;
const CRASHED_TIME = 3;
const GROWTH = 0.22;

// Most rounds die early; a few go to the moon. Small house edge.
function rollCrashPoint() {
  const u = Math.random();
  return Math.min(50, Math.max(1, Math.floor((0.96 / (1 - u)) * 100) / 100));
}

export class CrashMachine {
  constructor(game, x, z) {
    this.game = game;
    this.x = x;
    this.z = z;
    this.title = 'Crash';
    this.phase = 'waiting';
    this.t = WAIT_TIME;
    this.mult = 1;
    this.crashAt = rollCrashPoint();
    this.history = [];
    const { world, scene } = game;

    // A big billboard on legs, facing both ways.
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const base = part(new THREE.BoxGeometry(4.6, 0.4, 1.4), 0x1b0f2b);
    base.position.y = 0.2;
    const legL = part(new THREE.BoxGeometry(0.3, 2.4, 0.3), 0x374151);
    legL.position.set(-1.9, 1.4, 0);
    const legR = legL.clone();
    legR.position.x = 1.9;
    const frame = part(new THREE.BoxGeometry(4.8, 2.8, 0.5), 0xe63946);
    frame.position.y = 3.6;
    const crown = part(new THREE.ConeGeometry(0.5, 0.9, 4), 0xffd23f, { ink: 0.03 });
    crown.position.y = 5.4;
    crown.rotation.y = Math.PI / 4;
    const deskF = part(new THREE.BoxGeometry(3.2, 1.0, 0.6), 0x2b2140);
    deskF.position.set(0, 0.5, 1.2);
    const deskB = deskF.clone();
    deskB.position.z = -1.2;
    g.add(base, legL, legR, frame, crown, deskF, deskB);
    world.statics.add(g);
    world.addCollider({ type: 'box', minX: x - 2.4, maxX: x + 2.4, minZ: z - 1.5, maxZ: z + 1.5, top: 1.0 });

    this.tex = canvasTexture(512, 280, () => {});
    const mat = new THREE.MeshBasicMaterial({ map: this.tex });
    for (const side of [1, -1]) {
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.4), mat);
      screen.position.set(x, 3.6, z + side * 0.26);
      if (side < 0) screen.rotation.y = Math.PI;
      scene.add(screen);
    }

    this.seats = [];
    for (const side of [1, -1]) {
      for (const dx of [-1, 1]) {
        const seat = new Seat(game, this, x + dx * 1.1, z + side * 2.2);
        seat.yaw = side > 0 ? 0 : Math.PI;
        this.seats.push(seat);
      }
    }
    this.draw();
  }

  onKey(seat, key) {
    if (key !== '1') return;
    if (this.phase === 'waiting' && !seat.stake) {
      if (!seat.takeBet(seat.bet)) return;
      seat.stake = seat.bet;
      seat.message = `You're in for 🪙 ${seat.stake}. Cash out with 1 before it crashes!`;
      sfx.lever(seat.spot, this.game.listener);
    } else if (this.phase === 'flying' && seat.stake) {
      this.cashOut(seat);
    }
  }

  cashOut(seat) {
    const amount = Math.floor(seat.stake * this.mult);
    seat.message = `Cashed out at <b>${this.mult.toFixed(2)}x</b>: 🪙 ${amount}!`;
    seat.pay(amount);
    if (this.mult >= 5) this.game.feed(`🚀 ${seat.user.name} cashed out at ${this.mult.toFixed(2)}x!`);
    seat.stake = 0;
  }

  forfeit(seat) {
    seat.stake = 0;
    seat.message = '';
  }

  update(dt) {
    for (const seat of this.seats) {
      seat.update(dt);
      // Bots buy in and pick a cash-out target.
      if (seat.user && !seat.user.isPlayer) {
        if (this.phase === 'waiting' && !seat.stake && !seat.botSkip) {
          const bet = Math.min(this.game.floor.bets[0], Math.floor(seat.user.chips / 4));
          if (bet > 0 && seat.takeBet(bet)) {
            seat.stake = bet;
            seat.botTarget = 1.2 + Math.random() * Math.random() * 4;
          }
          seat.botSkip = true;
        }
        if (this.phase === 'flying' && seat.stake && this.mult >= seat.botTarget) this.cashOut(seat);
        seat.botTimer = 99;
      }
    }

    this.t -= dt;
    if (this.phase === 'waiting' && this.t <= 0) {
      this.phase = 'flying';
      this.flyTime = 0;
      this.mult = 1;
    } else if (this.phase === 'flying') {
      this.flyTime += dt;
      this.mult = Math.exp(GROWTH * this.flyTime);
      if (this.mult >= this.crashAt) {
        this.mult = this.crashAt;
        this.phase = 'crashed';
        this.t = CRASHED_TIME;
        this.history.unshift(this.crashAt);
        this.history.length = Math.min(this.history.length, 5);
        sfx.boom(new THREE.Vector3(this.x, 0, this.z), this.game.listener);
        for (const seat of this.seats) {
          if (seat.stake && seat.user) {
            seat.message = `CRASHED at ${this.crashAt.toFixed(2)}x. You lose 🪙 ${seat.stake}.`;
            seat.stake = 0;
          }
        }
      }
    } else if (this.phase === 'crashed' && this.t <= 0) {
      this.phase = 'waiting';
      this.t = WAIT_TIME;
      this.crashAt = rollCrashPoint();
      for (const seat of this.seats) {
        seat.botSkip = false;
        // Bots leave after a round or two.
        if (seat.user && !seat.user.isPlayer && Math.random() < 0.6) seat.leave(seat.user);
      }
    }
    this.draw();
  }

  draw() {
    const { ctx: c } = this.tex.userData;
    const w = 512;
    const h = 280;
    c.fillStyle = '#1b0f2b';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(255,255,255,0.08)';
    c.lineWidth = 2;
    for (let i = 1; i < 6; i++) {
      c.beginPath();
      c.moveTo(0, (h / 6) * i);
      c.lineTo(w, (h / 6) * i);
      c.stroke();
    }
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    if (this.phase === 'waiting') {
      c.fillStyle = '#ffd23f';
      c.font = "54px 'Luckiest Guy', 'Arial Black', sans-serif";
      c.fillText('CRASH', w / 2, 70);
      c.fillStyle = '#fff6e0';
      c.font = "34px 'Luckiest Guy', 'Arial Black', sans-serif";
      c.fillText(`NEXT ROCKET IN ${Math.ceil(this.t)}`, w / 2, 135);
      c.font = "26px 'Luckiest Guy', 'Arial Black', sans-serif";
      c.fillText(this.history.map((m) => `${m.toFixed(2)}x`).join('   '), w / 2, 215);
    } else {
      // The climbing curve.
      const tMax = Math.max(6, this.flyTime);
      const mMax = Math.max(2, this.mult * 1.15);
      const crashed = this.phase === 'crashed';
      c.strokeStyle = crashed ? '#e63946' : '#5ee27a';
      c.lineWidth = 6;
      c.beginPath();
      let px = 20;
      let py = h - 20;
      for (let i = 0; i <= 40; i++) {
        const tt = (this.flyTime * i) / 40;
        const m = Math.exp(GROWTH * tt);
        px = 20 + (tt / tMax) * (w - 60);
        py = h - 20 - ((m - 1) / (mMax - 1)) * (h - 60);
        if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
      }
      c.stroke();
      c.font = '40px sans-serif';
      c.fillText(crashed ? '💥' : '🚀', px, py - 6);
      c.fillStyle = crashed ? '#e63946' : '#fff6e0';
      c.font = "84px 'Luckiest Guy', 'Arial Black', sans-serif";
      c.fillText(`${this.mult.toFixed(2)}x`, w / 2, 95);
      if (crashed) {
        c.font = "36px 'Luckiest Guy', 'Arial Black', sans-serif";
        c.fillText('CRASHED!', w / 2, 160);
      }
    }
    this.tex.needsUpdate = true;
  }

  panel(seat) {
    let action = '';
    if (this.phase === 'waiting') {
      action = seat.stake
        ? `<p>Rocket launches in ${Math.ceil(this.t)}…</p>`
        : `<p class="bet">Bet <b>🪙 ${seat.bet}</b> <span class="hint">scroll or Z / X to change</span></p>
          <div class="choices"><span><kbd>1</kbd> Buy in (launch in ${Math.ceil(this.t)})</span></div>`;
    } else if (this.phase === 'flying') {
      action = seat.stake
        ? `<p class="mult">${this.mult.toFixed(2)}x</p><div class="choices"><span><kbd>1</kbd> CASH OUT 🪙 ${Math.floor(seat.stake * this.mult)}</span></div>`
        : `<p class="mult">${this.mult.toFixed(2)}x</p><p>Wait for the next rocket.</p>`;
    } else {
      action = `<p class="mult crashed">💥 ${this.crashAt.toFixed(2)}x</p>`;
    }
    return `<h3>🚀 Crash</h3>${action}
      ${seat.message ? `<p class="msg">${seat.message}</p>` : ''}
      <p class="hint"><kbd>E</kbd> Leave${seat.stake ? ' (you lose your bet)' : ''}</p>`;
  }
}
