// The Gun Wheel: a big wheel out on the map. Walk up holding a gun, bet it, and spin.
// It eats the gun, or spits out a different one (maybe worse, maybe a lot better).
import * as THREE from 'three';
import { WEAPONS } from './config.js';
import { part, canvasTexture } from './toon.js';
import { makeGun, itemInfo, isGun, addToList } from './items.js';
import { sfx } from './audio.js';
import { keyName } from './keys.js';

export const GW_OUT = {
  bust: { label: 'BUST', icon: '💀', color: '#3a2a4f', step: null },
  down: { label: 'DOWN', icon: '⬇️', color: '#64748b', step: -1 },
  same: { label: 'SWAP', icon: '🔁', color: '#22a06b', step: 0 },
  up: { label: 'UP', icon: '⬆️', color: '#3b82f6', step: 1 },
  jackpot: { label: 'JACKPOT', icon: '💎', color: '#ffc83d', step: 2 },
};
// 20 slices: 45% bust, 15% down, 20% swap, 15% up, 5% jackpot.
export const GW_SLICES = ['bust', 'same', 'bust', 'up', 'bust', 'down', 'bust', 'same', 'bust', 'up', 'bust', 'jackpot', 'bust', 'same', 'down', 'bust', 'same', 'up', 'down', 'bust'];
const SPIN = 3.8;
const R = 1.25; // wheel radius
const STEP = (Math.PI * 2) / GW_SLICES.length;
const KINDS = Object.keys(WEAPONS).filter((k) => k !== 'fists');

function wheelTexture() {
  return canvasTexture(512, 512, (c, w) => {
    const r = w / 2;
    GW_SLICES.forEach((k, i) => {
      // Slice i is centred (i + 0.5) slices clockwise from the top.
      const a0 = -Math.PI / 2 + i * STEP;
      c.beginPath();
      c.moveTo(r, r);
      c.arc(r, r, r - 6, a0, a0 + STEP);
      c.closePath();
      c.fillStyle = GW_OUT[k].color;
      c.fill();
      c.lineWidth = 4;
      c.strokeStyle = '#1b0f2b';
      c.stroke();
      c.save();
      c.translate(r, r);
      c.rotate(a0 + STEP / 2 + Math.PI / 2);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = '40px sans-serif';
      c.fillText(GW_OUT[k].icon, 0, -r * 0.74);
      c.restore();
    });
    c.beginPath();
    c.arc(r, r, r - 4, 0, Math.PI * 2);
    c.lineWidth = 10;
    c.strokeStyle = '#ffd23f';
    c.stroke();
  });
}

function signTexture() {
  return canvasTexture(512, 150, (c, w, h) => {
    c.fillStyle = '#1b0f2b';
    c.fillRect(0, 0, w, h);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = "70px 'Luckiest Guy', 'Arial Black', sans-serif";
    c.fillStyle = '#ffd23f';
    c.shadowColor = '#ffd23f';
    c.shadowBlur = 16;
    c.fillText('GUN WHEEL', w / 2, h * 0.4);
    c.shadowBlur = 0;
    c.font = "32px 'Luckiest Guy', 'Arial Black', sans-serif";
    c.fillStyle = '#fff6e0';
    c.fillText('BET THE GUN IN YOUR HAND', w / 2, h * 0.8);
  });
}

// What the wheel pays out for a gun, given where it landed. null = it ate the gun.
export function wheelPrize(gun, out) {
  const step = GW_OUT[out].step;
  if (step === null) return null;
  const want = gun.rarity + step;
  if (want < 0) return null;
  const others = KINDS.filter((k) => k !== gun.kind);
  return makeGun(others[Math.floor(Math.random() * others.length)], Math.min(3, want));
}

export class GunWheel {
  constructor(raid, { x, z, rot = 0 }) {
    this.raid = raid;
    this.position = new THREE.Vector3(x, 0, z);
    this.front = new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot));
    this.spot = this.position.clone().addScaledVector(this.front, 1.6);
    this.range = 2.2;
    this.spin = null; // { t, from, to, slice, gun, by }
    this.angle = 0;
    this.blink = 0;

    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    const base = part(new THREE.BoxGeometry(2.4, 0.35, 1.2), 0x24103d);
    base.position.y = 0.17;
    const postL = part(new THREE.BoxGeometry(0.22, 3.1, 0.22), 0xd4a63a, { ink: 0.02 });
    postL.position.set(-1.0, 1.7, -0.25);
    const postR = postL.clone();
    postR.position.x = 1.0;
    const back = part(new THREE.CylinderGeometry(R + 0.12, R + 0.12, 0.16, 40), 0x1b0f2b);
    back.rotation.x = Math.PI / 2;
    back.position.set(0, 2.0, -0.12);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.68), new THREE.MeshBasicMaterial({ map: signTexture() }));
    sign.position.set(0, 3.75, -0.05);
    const signBack = part(new THREE.BoxGeometry(2.4, 0.78, 0.12), 0x1b0f2b);
    signBack.position.set(0, 3.75, -0.14);
    const pointer = part(new THREE.ConeGeometry(0.18, 0.4, 3), 0xff3fa4, { ink: 0.02 });
    pointer.rotation.z = Math.PI;
    pointer.position.set(0, 2.0 + R + 0.12, 0.08);
    g.add(base, postL, postR, back, sign, signBack, pointer);
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(R, 48), new THREE.MeshBasicMaterial({ map: wheelTexture() }));
    this.disc.position.set(0, 2.0, 0.0);
    const hub = part(new THREE.CylinderGeometry(0.22, 0.22, 0.2, 16), 0xffd23f, { ink: 0.02 });
    hub.rotation.x = Math.PI / 2;
    hub.position.set(0, 2.0, 0.08);
    g.add(this.disc, hub);
    this.bulbs = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff1b8 }));
      b.position.set(Math.sin(a) * (R + 0.2), 2.0 + Math.cos(a) * (R + 0.2), 0.0);
      g.add(b);
      this.bulbs.push(b);
    }
    raid.scene.add(g);
    this.group = g;
    const sideways = Math.abs(Math.sin(rot)) > 0.5;
    const w = sideways ? 1.2 : 2.4;
    const d = sideways ? 2.4 : 1.2;
    raid.map.addCollider({ type: 'box', minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: 4.2 });
  }

  prompt(c) {
    if (this.spin) return 'The wheel is spinning…';
    const gun = c.weapons && c.weapons[c.active];
    if (!isGun(gun)) return `🎡 <b>Gun Wheel</b>: hold the gun you want to bet (${keyName('weapon1')} / ${keyName('weapon2')})`;
    if (gun.free) return '🎡 Free loadout guns can\'t go on the wheel';
    return `<b>${keyName('use')}</b> Bet your <b>${itemInfo(gun).name}</b> on the Gun Wheel · 45% bust`;
  }

  use(c) {
    if (this.spin || this.pending) return 'Already spinning';
    const slot = c.active;
    const gun = c.weapons[slot];
    if (!isGun(gun)) return 'Hold the gun you want to bet';
    if (gun.free) return 'Free loadout guns can\'t go on the wheel';
    c.weapons[slot] = null;
    c.refreshWeapon();
    const raid = this.raid;
    // Remember what went in: the prize goes back in that hand, and if the spin never happens
    // (a dropped connection) the gun comes back.
    this.pending = { gun, slot, at: performance.now() };
    if (raid.isClient && c.isPlayer) {
      raid.net.send({ k: 'gw', i: raid.gunWheels.indexOf(this), gun });
      return null;
    }
    this.roll(c, gun);
    return null;
  }

  // Host or solo: decide where it lands and what it pays, then tell everyone.
  roll(by, gun) {
    const slice = Math.floor(Math.random() * GW_SLICES.length);
    const out = GW_SLICES[slice];
    const prize = wheelPrize(gun, out);
    const over = gun.rarity + (GW_OUT[out].step || 0) - 3;
    const chips = prize && over > 0 ? Math.round(itemInfo(gun).value * over) : 0;
    const raid = this.raid;
    const owner = by && by.isPlayer ? (raid.net ? raid.net.me : 'me') : by && by.owner;
    if (raid.isHost) raid.net.rel({ k: 'gws', i: raid.gunWheels.indexOf(this), slice, gun, prize, chips, owner, name: by ? by.name : '' });
    this.start(slice, gun, { prize, chips, owner, name: by ? by.name : '' });
  }

  start(slice, gun, { prize = null, chips = 0, owner = null, name = '' } = {}) {
    const raid = this.raid;
    let mine = owner && owner === (raid.net ? raid.net.me : 'me');
    if (mine && this.refunded) { mine = false; this.refunded = false; }
    // Land the pointer inside the slice, after a few full turns.
    const land = (slice + 0.2 + Math.random() * 0.6) * STEP;
    const base = this.angle - (this.angle % (Math.PI * 2));
    this.spin = { t: 0, from: this.angle, to: base + Math.PI * 2 * 5 + land, slice, gun, prize, chips, mine, name };
    sfx.lever(this.position, raid.listener);
  }

  update(dt) {
    // We bet a gun and never heard back (connection trouble): hand it back.
    if (this.pending && !this.spin && performance.now() - this.pending.at > 9000) {
      const p = this.raid.player;
      if (p && p.alive) { this.give(p, this.pending.gun, this.pending.slot); this.raid.hud.toast('🎡 The wheel jammed. Your gun is back.'); }
      this.pending = null;
      this.refunded = true; // if the answer turns up late after all, don't pay twice

    }
    this.blink += dt * (this.spin ? 14 : 2);
    const flash = this.flash > 0;
    this.flash = Math.max(0, (this.flash || 0) - dt);
    this.bulbs.forEach((b, i) => {
      const on = (Math.floor(this.blink) + i) % 2 === 0;
      b.material.color.setHex(flash ? (on ? 0xffd23f : 0xff3fa4) : (on ? 0xfff1b8 : 0x6b4a2a));
    });
    if (!this.spin) return;
    const s = this.spin;
    const before = this.angle;
    s.t += dt;
    const k = Math.min(1, s.t / SPIN);
    const ease = 1 - (1 - k) ** 3;
    this.angle = s.from + (s.to - s.from) * ease;
    this.disc.rotation.z = this.angle;
    if (Math.floor(before / STEP) !== Math.floor(this.angle / STEP)) sfx.tick(this.position, this.raid.listener);
    if (k >= 1) this.finish();
  }

  // Put a gun in your hands: the slot it was bet from, any free slot, the backpack, or at your feet.
  give(p, gun, slot = p.active) {
    if (slot !== undefined && !p.weapons[slot]) {
      p.weapons[slot] = gun;
      p.active = slot;
      p.refreshWeapon();
      return;
    }
    if (p.equip(gun) || addToList(p.backpack, gun, p.room)) return;
    this.raid.dropItem(p.pos.clone(), gun, p.pos);
  }

  finish() {
    const { slice, gun, prize, chips, mine, name } = this.spin;
    this.spin = null;
    const raid = this.raid;
    const out = GW_SLICES[slice];
    const o = GW_OUT[out];
    const top = this.position.clone().setY(4.6);
    raid.fx.number(top, `${o.icon} ${o.label}`, o.color === '#3a2a4f' ? '#ff7b85' : o.color, 1.6);
    if (out === 'bust' || !prize) sfx.deny(this.position, raid.listener);
    else if (out === 'jackpot') { this.flash = 2.5; raid.fx.confetti(top.clone()); sfx.jackpot(this.position, raid.listener); } else sfx.win(this.position, raid.listener);
    if (name) raid.feed(`🎡 ${name} ${prize ? `spun a ${itemInfo(prize).name} on the Gun Wheel` : `lost a ${itemInfo(gun).name} to the Gun Wheel`}`);
    if (!mine) return;
    // Our spin: the winnings go straight into our hands.
    const p = raid.player;
    const slot = this.pending ? this.pending.slot : p.active;
    this.pending = null;
    if (prize && p.alive) {
      this.give(p, { ...prize }, slot);
      if (chips) p.chips += chips;
    }
    raid.hud.toast(prize
      ? `🎡 ${o.label}! Your ${itemInfo(gun).name} became a ${itemInfo(prize).name}${chips ? ` (+🪙 ${chips})` : ''}. It's in your hands.`
      : `💀 BUST. The wheel ate your ${itemInfo(gun).name}.`, out === 'jackpot' || (prize && prize.rarity >= 3) ? 'big' : '');
    raid.run.wheelSpins = (raid.run.wheelSpins || 0) + 1;
  }
}
