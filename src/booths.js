// More gambling out on the maps, next to the slot machines: a Lucky Dice table and a Double or
// Nothing coin flip. You pay with raid chips; the host (or you, solo) decides how it lands and
// everyone nearby watches the dice tumble or the coin spin. Winnings go straight into the
// gambler's chips with a fountain of chips for show.
import * as THREE from 'three';
import { part, canvasTexture } from './toon.js';
import { sfx } from './audio.js';
import { keyName } from './keys.js';

const fmt = (n) => Math.round(n).toLocaleString('en-US');

function marquee(title, sub, color) {
  return canvasTexture(512, 170, (c, w, h) => {
    c.fillStyle = '#1b0f2b';
    c.fillRect(0, 0, w, h);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = "70px 'Luckiest Guy', 'Arial Black', sans-serif";
    c.fillStyle = color;
    c.shadowColor = color;
    c.shadowBlur = 18;
    c.fillText(title, w / 2, h * 0.38);
    c.shadowBlur = 0;
    c.font = "34px 'Luckiest Guy', 'Arial Black', sans-serif";
    c.fillStyle = '#fff6e0';
    c.fillText(sub, w / 2, h * 0.8);
  });
}

// ---------- Lucky Dice ----------

// Faces in BoxGeometry order (+x, -x, +y, -y, +z, -z).
const FACE_VALUES = [3, 4, 1, 6, 2, 5];
const PIPS = {
  1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};
let dieMats = null;
function diceMaterials() {
  if (dieMats) return dieMats;
  dieMats = FACE_VALUES.map((v) => new THREE.MeshBasicMaterial({
    map: canvasTexture(128, 128, (c, w) => {
      c.fillStyle = '#fff6e0';
      c.fillRect(0, 0, w, w);
      c.strokeStyle = '#1b0f2b';
      c.lineWidth = 10;
      c.strokeRect(5, 5, w - 10, w - 10);
      c.fillStyle = v === 1 ? '#e63946' : '#1b0f2b';
      for (const [px, py] of PIPS[v]) { c.beginPath(); c.arc(w / 2 + px * 32, w / 2 + py * 32, v === 1 ? 17 : 12, 0, Math.PI * 2); c.fill(); }
    }),
  }));
  return dieMats;
}
// The rotation that puts face `v` on top.
const FACE_UP = {
  1: new THREE.Euler(0, 0, 0), 6: new THREE.Euler(Math.PI, 0, 0), 2: new THREE.Euler(-Math.PI / 2, 0, 0),
  5: new THREE.Euler(Math.PI / 2, 0, 0), 3: new THREE.Euler(0, 0, Math.PI / 2), 4: new THREE.Euler(0, 0, -Math.PI / 2),
};

// What a roll pays, as a multiple of the stake.
export function dicePays(a, b) {
  if (a === 1 && b === 1) return { x: 0, text: 'SNAKE EYES' };
  if (a === b) return { x: 3, text: `DOUBLE ${a}s · 3x` };
  if (a + b === 7) return { x: 1, text: 'LUCKY 7 · money back' };
  if (a + b >= 9) return { x: 1.5, text: `${a + b} · 1.5x` };
  return { x: 0, text: `${a + b} · no luck` };
}

// ---------- the booths ----------

const STAKE_BY_TIER = { dice: [30, 30, 60, 120, 200], coin: [150, 150, 300, 600, 1000] };
const ROLL_TIME = { dice: 1.6, coin: 1.9 };

export class Booth {
  constructor(raid, { kind, x, z, rot = 0 }) {
    this.raid = raid;
    this.kind = kind;
    this.position = new THREE.Vector3(x, 0, z);
    this.front = new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot));
    this.spot = this.position.clone().addScaledVector(this.front, 1.7);
    this.range = 2.2;
    this.tier = Math.max(1, Math.min(4, raid.map.tierAt(x, z)));
    this.stake = STAKE_BY_TIER[kind][this.tier];
    this.run = null;
    this.blink = 0;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    if (kind === 'dice') this.buildDice(g); else this.buildCoin(g);
    raid.scene.add(g);
    this.group = g;
    // The result, on a little sign that pops up over the booth for a few seconds.
    this.labelTex = canvasTexture(1024, 200, () => {});
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.labelTex, transparent: true, depthWrite: false }));
    this.label.scale.set(3.6, 0.7, 1);
    this.label.position.set(x, kind === 'dice' ? 3.4 : 3.7, z);
    this.label.renderOrder = 6;
    this.label.visible = false;
    raid.scene.add(this.label);
    this.labelT = 0;
    const sideways = Math.abs(Math.sin(rot)) > 0.5;
    const w = sideways ? 1.3 : 2.2;
    const d = sideways ? 2.2 : 1.3;
    raid.map.addCollider({ type: 'box', minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: 1.0 });
  }

  buildDice(g) {
    const legs = part(new THREE.BoxGeometry(2.0, 0.75, 1.1), 0x6b3a1e);
    legs.position.y = 0.375;
    const felt = part(new THREE.BoxGeometry(2.2, 0.12, 1.3), 0x1f8a4c, { ink: 0.02 });
    felt.position.y = 0.81;
    const rail = part(new THREE.BoxGeometry(2.2, 0.22, 0.12), 0xd4a63a, { ink: 0.02 });
    rail.position.set(0, 0.95, -0.6);
    g.add(legs, felt, rail);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.63), new THREE.MeshBasicMaterial({ map: marquee('LUCKY DICE', `🪙 ${this.stake} · DOUBLES PAY 3x`, '#5ee27a') }));
    sign.position.set(0, 2.5, -0.55);
    const post = part(new THREE.BoxGeometry(0.1, 1.6, 0.1), 0x1b0f2b);
    post.position.set(0, 1.7, -0.62);
    g.add(post, sign);
    this.dice = [-0.35, 0.35].map((dx) => {
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), diceMaterials());
      d.position.set(dx, 1.04, 0.05);
      d.rotation.y = Math.random() * Math.PI;
      g.add(d);
      return d;
    });
  }

  buildCoin(g) {
    const base = part(new THREE.CylinderGeometry(0.55, 0.75, 0.9, 16), 0x1b0f2b);
    base.position.y = 0.45;
    const top = part(new THREE.CylinderGeometry(0.85, 0.85, 0.1, 24), 0xd4a63a, { ink: 0.02 });
    top.position.y = 0.95;
    g.add(base, top);
    const faces = ['👑', '💀'].map((icon, i) => new THREE.MeshBasicMaterial({
      map: canvasTexture(256, 256, (c, w) => {
        c.fillStyle = i ? '#7a1028' : '#ffd23f';
        c.beginPath(); c.arc(w / 2, w / 2, w / 2 - 2, 0, Math.PI * 2); c.fill();
        c.strokeStyle = i ? '#ff7b85' : '#fff6e0';
        c.lineWidth = 14;
        c.setLineDash([22, 16]);
        c.beginPath(); c.arc(w / 2, w / 2, w / 2 - 18, 0, Math.PI * 2); c.stroke();
        c.setLineDash([]);
        c.font = '120px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(icon, w / 2, w / 2 + 8);
      }),
    }));
    const edge = new THREE.MeshBasicMaterial({ color: 0xb8860b });
    this.coin = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.1, 32), [edge, faces[0], faces[1]]);
    this.coin.position.y = 1.06;
    g.add(this.coin);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.7), new THREE.MeshBasicMaterial({ map: marquee('DOUBLE OR NOTHING', `UP TO 🪙 ${fmt(this.stake)} · 👑 WINS`, '#ffd23f') }));
    sign.position.set(0, 2.7, -0.4);
    const post = part(new THREE.BoxGeometry(0.1, 1.8, 0.1), 0x1b0f2b);
    post.position.set(0, 1.8, -0.5);
    g.add(post, sign);
  }

  showLabel(text, color) {
    const { ctx: c } = this.labelTex.userData;
    c.clearRect(0, 0, 1024, 200);
    c.font = "88px 'Luckiest Guy', 'Arial Black', sans-serif";
    const w = Math.min(1000, c.measureText(text).width + 70);
    c.fillStyle = 'rgba(20,10,34,0.9)';
    c.beginPath();
    if (c.roundRect) c.roundRect(512 - w / 2, 30, w, 140, 40); else c.rect(512 - w / 2, 30, w, 140);
    c.fill();
    c.lineWidth = 8;
    c.strokeStyle = color;
    c.stroke();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = color;
    c.fillText(text, 512, 106, 960);
    this.labelTex.needsUpdate = true;
    this.label.visible = true;
    this.labelT = 3.5;
  }

  // What you'd put down: the dice have a set price; the coin takes up to its limit.
  stakeFor(c) { return this.kind === 'dice' ? this.stake : Math.min(this.stake, c.chips); }

  prompt(c) {
    if (this.run || this.pending) return 'Rolling…';
    const s = this.stakeFor(c);
    if (this.kind === 'dice') return `<b>${keyName('use')}</b> 🎲 Roll the dice · 🪙 ${this.stake} · doubles pay 3x`;
    if (s < 20) return '🪙 Double or Nothing: bring at least 20 raid chips';
    return `<b>${keyName('use')}</b> 🪙 Flip for ${fmt(s)}: 👑 doubles it, 💀 takes it`;
  }

  use(c) {
    if (this.run || this.pending) return 'Already rolling';
    const stake = this.stakeFor(c);
    if (this.kind === 'dice' && c.chips < stake) return `Need 🪙 ${stake} raid chips (you have ${c.chips})`;
    if (this.kind === 'coin' && stake < 20) return 'Bring at least 20 raid chips';
    c.chips -= stake;
    const raid = this.raid;
    if (raid.isClient && c.isPlayer) {
      // The host rolls; if the answer never comes (connection trouble), the chips come back.
      this.pending = { stake, at: performance.now() };
      raid.net.send({ k: 'gm', i: raid.booths.indexOf(this), stake });
      return null;
    }
    this.roll(c, stake);
    return null;
  }

  // Host or solo: decide the result and tell everyone.
  roll(by, stake) {
    const raid = this.raid;
    const r = this.kind === 'dice'
      ? [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]
      : Math.random() < 0.47 ? 'heads' : 'tails';
    const owner = by && by.isPlayer ? (raid.net ? raid.net.me : 'me') : by && by.owner;
    const name = by ? by.name : '';
    if (raid.isHost) raid.net.rel({ k: 'gms', i: raid.booths.indexOf(this), r, stake, owner, name });
    this.start(r, stake, owner, name);
  }

  start(r, stake, owner, name) {
    const raid = this.raid;
    const me = raid.net ? raid.net.me : 'me';
    let mine = owner === me;
    if (mine && this.refunded) { mine = false; this.refunded = false; }
    if (mine) this.pending = null;
    this.run = { t: 0, r, stake, mine, name, spin: [Math.random() * 4 + 6, Math.random() * 4 + 6].map((n) => n * (Math.random() < 0.5 ? -1 : 1)) };
    sfx.lever(this.position, raid.listener);
  }

  update(dt) {
    // Paid and never heard back: give the chips back.
    if (this.pending && !this.run && performance.now() - this.pending.at > 9000) {
      const p = this.raid.player;
      if (p && p.alive) { p.chips += this.pending.stake; this.raid.hud.toast('🎲 The table jammed. Your chips are back.'); }
      this.pending = null;
      this.refunded = true;
    }
    if (this.labelT > 0) { this.labelT -= dt; if (this.labelT <= 0) this.label.visible = false; }
    const run = this.run;
    if (!run) {
      if (this.coin) this.coin.rotation.y += dt * 0.6;
      return;
    }
    run.t += dt;
    const T = ROLL_TIME[this.kind];
    const k = Math.min(1, run.t / T);
    if (this.kind === 'dice') {
      this.dice.forEach((d, i) => {
        if (k < 0.85) {
          // Tumbling: up, over and across the felt.
          const hop = Math.abs(Math.sin(k * Math.PI * 3)) * (1 - k) * 0.9;
          d.position.y = 1.04 + hop;
          d.position.x = (i ? 0.35 : -0.35) + Math.sin(k * 9 + i) * 0.18 * (1 - k);
          d.rotation.x += dt * run.spin[0];
          d.rotation.z += dt * run.spin[1] * (i ? -1 : 1);
        } else {
          // Settle with the rolled face up.
          d.position.y = 1.04;
          const q = new THREE.Quaternion().setFromEuler(FACE_UP[run.r[i]]);
          q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 0.5 + 0.3));
          d.quaternion.slerp(q, Math.min(1, dt * 18));
        }
      });
      if (Math.floor(run.t * 10) !== Math.floor((run.t - dt) * 10) && k < 0.85) sfx.tick(this.position, this.raid.listener);
    } else {
      // Up in the air, spinning end over end, down flat on the pedestal.
      const h = Math.sin(k * Math.PI) * 2.6;
      this.coin.position.y = 1.06 + h;
      const turns = 7;
      const final = run.r === 'heads' ? 0 : Math.PI;
      const ease = 1 - (1 - k) ** 2;
      this.coin.rotation.set(turns * Math.PI * 2 * ease + final * ease, this.coin.rotation.y, 0);
      if (k >= 1) this.coin.rotation.x = final;
    }
    if (k >= 1) this.finish();
  }

  finish() {
    const raid = this.raid;
    const run = this.run;
    this.run = null;
    let x;
    let text;
    if (this.kind === 'dice') ({ x, text } = dicePays(run.r[0], run.r[1]));
    else { x = run.r === 'heads' ? 2 : 0; text = run.r === 'heads' ? '👑 HEADS · DOUBLED' : '💀 TAILS'; }
    const win = Math.floor(run.stake * x);
    const top = this.position.clone().setY(3.2);
    this.showLabel(text, x > 1 ? '#5ee27a' : x === 1 ? '#fff6e0' : '#ff7b85');
    if (win > run.stake) {
      sfx.win(this.position, raid.listener);
      raid.fx.confetti(top.clone(), win >= run.stake * 3 ? 50 : 20);
      raid.fx.number(top.clone().setY(4.4), `+${fmt(win)}`, '#ffd23f', 1.4);
    } else if (win === 0) sfx.deny();
    if (run.name && win >= 300) raid.feed(`${this.kind === 'dice' ? '🎲' : '🪙'} ${run.name} won 🪙 ${fmt(win)} at ${this.kind === 'dice' ? 'Lucky Dice' : 'Double or Nothing'}`);
    if (!run.mine) return;
    const p = raid.player;
    if (p && p.alive && win) p.chips += win;
    raid.hud.toast(win > run.stake ? `${text}! +🪙 ${fmt(win)} raid chips` : win ? `${text}. Chips back.` : `${text}. Lost 🪙 ${fmt(run.stake)}.`, win >= run.stake * 3 ? 'big' : '');
    raid.run.gambles = (raid.run.gambles || 0) + 1;
  }
}
