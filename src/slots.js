// Loot slots in the raid. Pay chips you found, pull the lever, and go do something else:
// when the reels stop, the prize pops out of the tray. Three of a kind pays out three prizes.
import * as THREE from 'three';
import { RAID_SLOT_COST } from './config.js';
import { part, canvasTexture } from './toon.js';
import { rollLoot, itemInfo } from './items.js';
import { sfx } from './audio.js';

const SPIN_TIME = 2.4;
const REEL_STOPS = [1.0, 1.5, 2.0];
const SYMBOLS = ['🍒', '💎', '🔔', '7️⃣', '🎲', '🔫', '💰'];
const JACKPOT_CHANCE = 0.08;
const TIER_COLORS = { 1: 0x2a9d8f, 2: 0xe63946, 3: 0x7b2cbf };
const TIER_NAMES = { 1: 'PENNY SLOTS', 2: 'LUCKY 7s', 3: 'HIGH ROLLER' };

function marqueeTexture(name, cost) {
  return canvasTexture(512, 160, (c, w, h) => {
    c.fillStyle = '#1b0f2b';
    c.fillRect(0, 0, w, h);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = "68px 'Luckiest Guy', 'Arial Black', sans-serif";
    c.fillStyle = '#ffd23f';
    c.shadowColor = '#ffd23f';
    c.shadowBlur = 18;
    c.fillText(name, w / 2, h * 0.4);
    c.shadowBlur = 0;
    c.font = "40px 'Luckiest Guy', 'Arial Black', sans-serif";
    c.fillStyle = '#fff6e0';
    c.fillText(`🪙 ${cost} PER PULL`, w / 2, h * 0.8);
  });
}

export class SlotMachine {
  constructor(raid, { x, z, rot = 0, tier = 1 }) {
    this.raid = raid;
    this.tier = tier;
    this.cost = RAID_SLOT_COST[tier];
    this.name = TIER_NAMES[tier];
    this.position = new THREE.Vector3(x, 0, z);
    // Machines face +Z before rotation; you stand in front of them.
    const front = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    this.front = front;
    this.spot = this.position.clone().addScaledVector(front, 1.9);
    this.user = null;
    this.t = 0;
    this.reels = [0, 0, 0].map(() => ({ offset: Math.random() * SYMBOLS.length, final: 0, stopped: false }));
    this.blink = 0;
    this.flashTime = 0;

    const fixed = new THREE.Group();
    fixed.position.set(x, 0, z);
    fixed.rotation.y = rot;
    const base = part(new THREE.BoxGeometry(1.8, 0.3, 1.4), 0x24103d);
    base.position.y = 0.15;
    const body = part(new THREE.BoxGeometry(1.6, 2.0, 1.2), TIER_COLORS[tier]);
    body.position.y = 1.3;
    const top = part(new THREE.BoxGeometry(1.8, 0.62, 1.3), 0x1b0f2b);
    top.position.y = 2.62;
    const marquee = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.53), new THREE.MeshBasicMaterial({ map: marqueeTexture(this.name, this.cost) }));
    marquee.position.set(0, 2.62, 0.66);
    const tray = part(new THREE.BoxGeometry(1.2, 0.18, 0.35), 0xd4a63a, { ink: 0.02 });
    tray.position.set(0, 0.75, 0.68);
    const frame = part(new THREE.BoxGeometry(1.42, 0.74, 0.08), 0xd4a63a, { ink: 0.02 });
    frame.position.set(0, 1.8, 0.6);
    fixed.add(base, body, top, marquee, tray, frame);
    raid.map.statics.add(fixed);

    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    this.screenTex = canvasTexture(384, 170, () => {});
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.62), new THREE.MeshBasicMaterial({ map: this.screenTex }));
    screen.position.set(0, 1.8, 0.645);
    g.add(screen);
    this.bulbs = [];
    for (let i = 0; i < 7; i++) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff1b8 }));
      bulb.position.set(-0.75 + i * 0.25, 2.97, 0.62);
      g.add(bulb);
      this.bulbs.push(bulb);
    }
    this.lever = new THREE.Group();
    this.lever.position.set(0.88, 1.5, 0.1);
    const stick = part(new THREE.CylinderGeometry(0.05, 0.05, 0.85, 8), 0xd1d5db, { ink: 0.015 });
    stick.position.y = 0.42;
    const knob = part(new THREE.SphereGeometry(0.13, 12, 10), 0xe63946, { ink: 0.02 });
    knob.position.y = 0.88;
    this.lever.add(stick, knob);
    g.add(this.lever);
    raid.scene.add(g);

    const sideways = Math.abs(Math.sin(rot)) > 0.5;
    const w = sideways ? 1.4 : 1.8;
    const d = sideways ? 1.8 : 1.4;
    raid.map.addCollider({ type: 'box', minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: 2.95 });
    this.drawScreen();
  }

  prompt(c) {
    if (this.user) return 'Spinning…';
    return `<b>E</b> Pull the lever · 🪙 ${this.cost} · ${this.name}`;
  }

  use(c) {
    if (this.user) return 'Already spinning';
    if (c.chips < this.cost) return `Need 🪙 ${this.cost} raid chips (you have ${c.chips})`;
    c.chips -= this.cost;
    this.user = c;
    this.t = 0;
    this.jackpot = Math.random() < JACKPOT_CHANCE;
    const finals = this.jackpot ? Array(3).fill(Math.floor(Math.random() * SYMBOLS.length)) : [0, 1, 2].map(() => Math.floor(Math.random() * SYMBOLS.length));
    if (!this.jackpot && finals[0] === finals[1] && finals[1] === finals[2]) finals[2] = (finals[2] + 1) % SYMBOLS.length;
    this.reels.forEach((r, i) => { r.final = finals[i]; r.stopped = false; });
    sfx.lever(this.position, this.raid.listener);
    return null;
  }

  update(dt) {
    this.blink += dt * (this.user ? 12 : 2.5);
    this.flashTime = Math.max(0, this.flashTime - dt);
    const flashing = this.flashTime > 0;
    this.bulbs.forEach((b, i) => {
      const on = (Math.floor(this.blink) + i) % 2 === 0;
      b.material.color.setHex(flashing ? (on ? 0xffd23f : 0xff3fa4) : (on ? 0xfff1b8 : 0x6b4a2a));
    });
    const pullAngle = this.user ? Math.max(0, 1 - this.t * 3) : 0;
    this.lever.rotation.x += (pullAngle * 1.2 - this.lever.rotation.x) * Math.min(1, dt * 20);
    if (!this.user) return;

    this.t += dt;
    const lastTick = this.tickCount || 0;
    this.reels.forEach((reel, i) => {
      if (this.t < REEL_STOPS[i]) reel.offset += dt * 14;
      else if (!reel.stopped) {
        reel.stopped = true;
        reel.offset = reel.final;
        sfx.reelStop(this.position, this.raid.listener);
      }
    });
    this.tickCount = Math.floor(this.t * 12);
    if (this.tickCount !== lastTick && this.t < REEL_STOPS[2]) sfx.tick(this.position, this.raid.listener);
    this.drawScreen();
    if (this.t >= SPIN_TIME) this.payout();
  }

  payout() {
    const c = this.user;
    this.user = null;
    const prizes = this.jackpot ? 3 : 1;
    let best = null;
    for (let i = 0; i < prizes; i++) {
      // Jackpots roll a tier higher.
      const loot = rollLoot(Math.min(4, this.tier + (this.jackpot ? 1 : 0)));
      const side = new THREE.Vector3(-this.front.z, 0, this.front.x).multiplyScalar((i - (prizes - 1) / 2) * 1.1);
      const at = this.position.clone().addScaledVector(this.front, 1.8).add(side);
      if (loot.chips) this.raid.chips.spawnBurst(at.clone().setY(1), loot.chips, null, { speed: 2 });
      else {
        this.raid.dropItem(at, loot, this.position.clone().addScaledVector(this.front, 1.0));
        if (!best || itemInfo(loot).rarity > itemInfo(best).rarity) best = loot;
      }
    }
    if (this.jackpot) {
      this.flashTime = 2.5;
      this.raid.fx.confetti(this.position.clone().setY(3));
      sfx.jackpot(this.position, this.raid.listener);
      if (c && c.isPlayer) this.raid.hud.toast('🎰 JACKPOT! Three prizes!', 'big');
    } else {
      sfx.win(this.position, this.raid.listener);
      if (c && c.isPlayer) this.raid.hud.toast(best ? `The slot paid out: ${itemInfo(best).name}` : 'The slot paid out some chips');
    }
  }

  drawScreen() {
    const { ctx: c } = this.screenTex.userData;
    const w = 384;
    const h = 170;
    c.fillStyle = '#1b0f2b';
    c.fillRect(0, 0, w, h);
    const colW = w / 3;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = '84px sans-serif';
    this.reels.forEach((reel, i) => {
      const x = colW * i + 6;
      c.save();
      c.beginPath();
      c.rect(x, 8, colW - 12, h - 16);
      c.clip();
      c.fillStyle = '#fff6e0';
      c.fillRect(x, 8, colW - 12, h - 16);
      const n = SYMBOLS.length;
      const idx = Math.floor(reel.offset);
      const frac = reel.offset - idx;
      for (let k = -1; k <= 1; k++) {
        const sym = SYMBOLS[(((idx + k) % n) + n) % n];
        c.fillText(sym, x + (colW - 12) / 2, h / 2 + (frac - k) * 120 + 6);
      }
      c.restore();
    });
    this.screenTex.needsUpdate = true;
  }
}
