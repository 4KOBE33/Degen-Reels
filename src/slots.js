// Walk-up slot machines. Pull one to bet chips on a weapon.
import * as THREE from 'three';
import { MACHINES, WEAPONS, WEAPON_TIERS, JACKPOT, FILLER_SYMBOLS, RARITIES, RARITY_ODDS } from './config.js';
import { save } from './save.js';
import { part, canvasTexture } from './toon.js';
import { sfx } from './audio.js';

const SPIN_TIME = 2.4;
const REEL_STOPS = [1.0, 1.5, 2.0];
const SYMBOLS = [...Object.values(WEAPONS).filter((w) => !w.melee || w.name === 'Lucky Spoon').map((w) => w.icon), ...FILLER_SYMBOLS];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

export function weightedIndex(weights) {
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

// Each boost step makes rarer guns more likely.
export function rollRarity(boost) {
  return weightedIndex(RARITY_ODDS.map((w, i) => w * (1 + boost * 0.8) ** i));
}

function marqueeTexture(tier, cost) {
  return canvasTexture(512, 160, (c, w, h) => {
    c.fillStyle = '#1b0f2b';
    c.fillRect(0, 0, w, h);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = "70px 'Luckiest Guy', 'Arial Black', sans-serif";
    c.fillStyle = '#ffd23f';
    c.shadowColor = '#ffd23f';
    c.shadowBlur = 18;
    c.fillText(tier.name, w / 2, h * 0.4);
    c.shadowBlur = 0;
    c.font = "40px 'Luckiest Guy', 'Arial Black', sans-serif";
    c.fillStyle = '#fff6e0';
    c.fillText(`🪙 ${cost} PER PULL`, w / 2, h * 0.8);
  });
}

export class SlotMachine {
  constructor(game, x, z, tierIndex) {
    this.game = game;
    this.tier = MACHINES[tierIndex];
    this.tierIndex = tierIndex;
    this.cost = Math.round(game.floor.bets[0] * this.tier.costMult);
    this.position = new THREE.Vector3(x, 0, z);
    this.useSpot = new THREE.Vector3(x, 0, z + 1.9);
    this.user = null;
    this.t = 0;
    this.result = null;
    this.reels = [0, 0, 0].map(() => ({ offset: Math.random() * SYMBOLS.length, final: 0 }));
    this.blink = 0;

    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const base = part(new THREE.BoxGeometry(1.8, 0.3, 1.4), 0x24103d);
    base.position.y = 0.15;
    const body = part(new THREE.BoxGeometry(1.6, 2.0, 1.2), this.tier.color);
    body.position.y = 1.3;
    const top = part(new THREE.BoxGeometry(1.8, 0.62, 1.3), 0x1b0f2b);
    top.position.y = 2.62;
    const marquee = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.53), new THREE.MeshBasicMaterial({ map: marqueeTexture(this.tier, this.cost) }));
    marquee.position.set(0, 2.62, 0.66);
    const tray = part(new THREE.BoxGeometry(1.2, 0.18, 0.35), 0xd4a63a, { ink: 0.02 });
    tray.position.set(0, 0.75, 0.68);
    const panel = part(new THREE.BoxGeometry(1.25, 0.12, 0.3), 0x1b0f2b, { ink: 0.02 });
    panel.position.set(0, 1.18, 0.68);
    panel.rotation.x = 0.4;
    // Static parts get merged with the rest of the casino; screen, bulbs and lever animate.
    const fixed = new THREE.Group();
    fixed.position.set(x, 0, z);
    fixed.add(base, body, top, marquee, tray, panel);
    game.world.statics.add(fixed);
    for (let i = 0; i < 3; i++) {
      const btn = part(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 10), [0xff5d5d, 0xffd23f, 0x5ee27a][i], { ink: 0.015, shadow: false });
      btn.position.set(-0.35 + i * 0.35, 1.25, 0.72);
      btn.rotation.x = 0.4;
      fixed.add(btn);
    }

    // Reel window drawn into a canvas each frame while spinning.
    this.screenTex = canvasTexture(384, 170, () => {});
    const frame = part(new THREE.BoxGeometry(1.42, 0.74, 0.08), 0xd4a63a, { ink: 0.02 });
    frame.position.set(0, 1.8, 0.6);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.62), new THREE.MeshBasicMaterial({ map: this.screenTex }));
    screen.position.set(0, 1.8, 0.645);
    fixed.add(frame);
    g.add(screen);

    // Marquee bulbs.
    this.bulbs = [];
    for (let i = 0; i < 7; i++) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff1b8 }));
      bulb.position.set(-0.75 + i * 0.25, 2.97, 0.62);
      g.add(bulb);
      this.bulbs.push(bulb);
    }

    // Lever on the right side.
    this.lever = new THREE.Group();
    this.lever.position.set(0.88, 1.5, 0.1);
    const stick = part(new THREE.CylinderGeometry(0.05, 0.05, 0.85, 8), 0xd1d5db, { ink: 0.015 });
    stick.position.y = 0.42;
    const knob = part(new THREE.SphereGeometry(0.13, 12, 10), 0xe63946, { ink: 0.02 });
    knob.position.y = 0.88;
    this.lever.add(stick, knob);
    g.add(this.lever);

    game.scene.add(g);
    game.world.addCollider({ type: 'box', minX: x - 0.9, maxX: x + 0.9, minZ: z - 0.7, maxZ: z + 0.75, top: 2.95 });
    this.drawScreen();
  }

  get busy() { return !!this.user; }
  get spot() { return this.useSpot; }

  prompt(c) {
    if (this.user) return 'Machine in use';
    return `<b>E</b> Pull the lever · 🪙 ${this.cost} · ${this.tier.name}`;
  }

  use(c) { return this.pull(c); }

  // Returns a message if the pull was refused.
  pull(c) {
    if (this.user) return 'Machine is busy';
    if (c.chips <= this.cost) return `Need more than ${this.cost} chips`;
    c.chips -= this.cost;
    this.user = c;
    c.busy = this;
    c.yaw = 0;
    this.t = 0;

    const weapon = pick(WEAPON_TIERS[weightedIndex(this.tier.odds)]);
    const jackpot = Math.random() < this.tier.jackpot;
    const sym = WEAPONS[weapon].icon;
    const symbols = [sym, sym, sym];
    if (!jackpot) symbols[Math.floor(Math.random() * 3)] = pick(SYMBOLS.filter((s) => s !== sym));
    const rarity = weapon === 'spoon' ? 0 : rollRarity(this.tierIndex + this.game.floor.rarityBoost);
    this.result = { weapon, rarity, jackpot, cost: this.cost };
    symbols.forEach((s, i) => { this.reels[i].final = SYMBOLS.indexOf(s); });
    sfx.lever(this.position, this.game.listener);
    return null;
  }

  update(dt) {
    this.blink += dt * (this.user ? 12 : 2.5);
    const flashing = this.flashTime > 0;
    this.flashTime = Math.max(0, (this.flashTime || 0) - dt);
    this.bulbs.forEach((b, i) => {
      const on = (Math.floor(this.blink) + i) % 2 === 0;
      b.material.color.setHex(flashing ? (on ? 0xffd23f : 0xff3fa4) : (on ? 0xfff1b8 : 0x6b4a2a));
    });

    const pullAngle = this.user ? Math.max(0, 1 - this.t * 3) : 0;
    this.lever.rotation.x += (pullAngle * 1.2 - this.lever.rotation.x) * Math.min(1, dt * 20);

    if (!this.user) return;
    this.t += dt;
    let lastTick = this.tickCount || 0;
    this.reels.forEach((reel, i) => {
      if (this.t < REEL_STOPS[i]) reel.offset += dt * 14;
      else if (!reel.stopped) {
        reel.stopped = true;
        reel.offset = reel.final;
        sfx.reelStop(this.position, this.game.listener);
      }
    });
    this.tickCount = Math.floor(this.t * 12);
    if (this.tickCount !== lastTick && this.t < REEL_STOPS[2]) sfx.tick(this.position, this.game.listener);
    this.drawScreen();

    if (this.t >= SPIN_TIME) this.payout();
  }

  payout() {
    const c = this.user;
    const r = this.result;
    this.user = null;
    c.busy = null;
    this.reels.forEach((reel) => { reel.stopped = false; });
    if (!c.alive) return;
    c.setWeapon(r.weapon, r.rarity);
    const name = c.weaponName;
    if (r.jackpot) {
      const winnings = JACKPOT.flat + r.cost * JACKPOT.multiplier;
      c.armor = JACKPOT.armor;
      this.flashTime = 2.5;
      const mouth = this.position.clone().add(new THREE.Vector3(0, 0.9, 0.9));
      this.game.chips.spawnBurst(mouth, winnings, null, { toward: c.pos, speed: 5 });
      this.game.fx.confetti(this.position.clone().add(new THREE.Vector3(0, 3, 0.6)));
      sfx.jackpot(this.position, this.game.listener);
      this.game.feed(`🎰 ${c.name} hit the JACKPOT on ${this.tier.name}!`);
      if (c.isPlayer) {
        this.game.hud.toast(`JACKPOT! ${name} + armor + ${winnings} chips`, 'big');
        this.game.unlocked(save.update((d) => { d.jackpots++; }));
      }
    } else {
      sfx.win(this.position, this.game.listener);
      if (c.isPlayer) this.game.hud.toast(r.weapon === 'spoon' ? `${name}… good luck with that` : `You got a ${name}!`, r.rarity >= 2 ? 'big' : '');
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
    // Pay line.
    c.strokeStyle = '#e63946';
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(0, h / 2);
    c.lineTo(8, h / 2);
    c.moveTo(w - 8, h / 2);
    c.lineTo(w, h / 2);
    c.stroke();
    this.screenTex.needsUpdate = true;
  }
}

// A row of machines along the back wall: cheap ones on the left, whales on the right.
export function buildSlotRow(game) {
  const machines = [];
  const perTier = Math.round(game.floor.slots / 3);
  const spacing = 3;
  const gap = 3;
  const total = perTier * 3 * spacing + gap * 2 - spacing;
  let x = -total / 2;
  for (let tier = 0; tier < 3; tier++) {
    for (let i = 0; i < perTier; i++) {
      machines.push(new SlotMachine(game, x, game.world.slotZ, tier));
      x += spacing;
    }
    x += gap;
  }
  return machines;
}
