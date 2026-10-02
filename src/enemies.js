// The machines that run the casino towns. They attack anyone who isn't a machine.
//   Slotbot   – a walking slot machine that fires short bursts
//   Dicer     – a flying die that circles you and plinks away
//   Card Shark – a playing card that sprints at you and slices
//   Bouncer   – a hulking bruiser that charges in and hits like a truck
//   Roulette Roller – a runaway roulette wheel that rams you
//   Jackpot Turret – bolted onto rooftops; slow, heavy, long-range shots
//   Pit Boss  – a giant golden slot mech: bullet sweeps, rockets, summons, ground slams
import * as THREE from 'three';
import { ENEMIES } from './config.js';
import { part, toon, canvasTexture } from './toon.js';
import { resolve } from './physics.js';
import { sfx } from './audio.js';

const tmp = new THREE.Vector3();
const hitMat = new THREE.MeshBasicMaterial({ visible: false });

function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

let reelTex = null;
function reels() {
  if (reelTex) return reelTex;
  reelTex = canvasTexture(256, 96, (c, w, h) => {
    c.fillStyle = '#fff6e0';
    c.fillRect(0, 0, w, h);
    c.font = '60px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    ['🍒', '7️⃣', '💀'].forEach((s, i) => c.fillText(s, w / 6 + (i * w) / 3, h / 2 + 4));
  });
  return reelTex;
}

let pipTex = null;
function pips() {
  if (pipTex) return pipTex;
  pipTex = canvasTexture(128, 128, (c, w) => {
    c.fillStyle = '#fff6e0';
    c.fillRect(0, 0, w, w);
    c.fillStyle = '#e63946';
    for (const [x, y] of [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]]) {
      c.beginPath();
      c.arc(x * w, y * w, w * 0.1, 0, Math.PI * 2);
      c.fill();
    }
  });
  return pipTex;
}

let wheelTex = null;
function wheelFace() {
  if (wheelTex) return wheelTex;
  wheelTex = canvasTexture(128, 128, (c, w) => {
    const n = 18;
    for (let i = 0; i < n; i++) {
      c.beginPath();
      c.moveTo(w / 2, w / 2);
      c.arc(w / 2, w / 2, w / 2, (i / n) * Math.PI * 2, ((i + 1) / n) * Math.PI * 2);
      c.closePath();
      c.fillStyle = i === 0 ? '#1f8a4c' : i % 2 ? '#1b0f2b' : '#e63946';
      c.fill();
    }
    c.beginPath();
    c.arc(w / 2, w / 2, w * 0.22, 0, Math.PI * 2);
    c.fillStyle = '#6b3a1e';
    c.fill();
  });
  return wheelTex;
}

let cardTex = null;
function cardFace() {
  if (cardTex) return cardTex;
  cardTex = canvasTexture(128, 180, (c, w, h) => {
    c.fillStyle = '#fff6e0';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#1b0f2b';
    c.font = 'bold 40px serif';
    c.fillText('A', 10, 42);
    c.font = '90px serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('♠', w / 2, h / 2 + 8);
  });
  return cardTex;
}

function hpBar() {
  const tex = canvasTexture(128, 20, () => {});
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(1.8, 0.28, 1);
  sprite.renderOrder = 12;
  sprite.visible = false;
  sprite.userData.draw = (f) => {
    const { ctx } = tex.userData;
    ctx.clearRect(0, 0, 128, 20);
    ctx.fillStyle = '#1b0f2b';
    ctx.fillRect(0, 0, 128, 20);
    ctx.fillStyle = f > 0.5 ? '#5ee27a' : f > 0.25 ? '#ffd23f' : '#ff5d5d';
    ctx.fillRect(3, 3, 122 * Math.max(0, f), 14);
    tex.needsUpdate = true;
  };
  return sprite;
}

function buildModel(type) {
  const g = new THREE.Group();
  const parts = {};
  if (type === 'slotbot' || type === 'boss') {
    const boss = type === 'boss';
    const s = boss ? 3.2 : 1;
    const bodyMat = toon(boss ? 0xffc83d : 0xe63946, { unique: true, emissive: 0xffffff, emissiveIntensity: 0 });
    const body = part(new THREE.BoxGeometry(1.6, 1.9, 1.2), bodyMat);
    body.position.y = 1.75;
    const top = part(new THREE.BoxGeometry(1.8, 0.55, 1.3), 0x1b0f2b);
    top.position.y = 2.95;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.5), new THREE.MeshBasicMaterial({ map: reels() }));
    screen.position.set(0, 2.1, -0.61);
    screen.rotation.y = Math.PI;
    const eye = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.14, 0.05), new THREE.MeshBasicMaterial({ color: 0xff3fa4 }));
    eye.position.set(0, 2.95, -0.66);
    const cannon = part(new THREE.CylinderGeometry(0.16, 0.2, 1.1, 10), 0x374151);
    cannon.rotation.x = Math.PI / 2;
    cannon.position.set(0.95, 1.8, -0.4);
    const lever = part(new THREE.SphereGeometry(0.18, 10, 8), 0xffd23f);
    lever.position.set(-0.95, 2.6, 0);
    g.add(body, top, screen, eye, cannon, lever);
    const legs = [];
    for (const side of [-1, 1]) {
      const leg = part(new THREE.BoxGeometry(0.35, 0.9, 0.45), 0x2b2140);
      leg.position.set(side * 0.45, 0.45, 0);
      g.add(leg);
      legs.push(leg);
    }
    if (boss) {
      const crown = part(new THREE.CylinderGeometry(0.6, 0.55, 0.35, 8, 1, true), toon(0xffd23f, { unique: true, side: THREE.DoubleSide }));
      crown.position.y = 3.4;
      g.add(crown);
      const cannon2 = cannon.clone();
      cannon2.position.x = -0.95;
      g.add(cannon2);
      // Weak spots that show up later in the fight: a core on his back, then the crown socket.
      const core = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.75, 0.06), new THREE.MeshBasicMaterial({ color: 0xff9f1c }));
      core.position.set(0, 2.0, 0.63);
      core.visible = false;
      const socket = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff3fa4 }));
      socket.position.set(0, 3.3, 0);
      socket.visible = false;
      g.add(core, socket);
      Object.assign(parts, { crown, core, socket });
    }
    g.scale.setScalar(s);
    Object.assign(parts, { body, legs, eye, bodyMat, muzzle: new THREE.Vector3(0.95, 1.8, -1.0) });
    parts.hit = new THREE.Mesh(new THREE.BoxGeometry(1.8, 3.1, 1.4), hitMat);
    parts.hit.position.y = 1.6;
    g.add(parts.hit);
    // Weak spot: the little lever knob on a Slotbot's side (small and hard to hit),
    // the jackpot screen on the boss.
    if (boss) {
      parts.crit = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.6, 0.3), hitMat);
      parts.crit.position.set(0, 2.1, -0.62);
      parts.critMult = 2.5;
    } else {
      parts.crit = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), hitMat);
      parts.crit.position.copy(lever.position);
      parts.critMult = 2.5;
    }
    g.add(parts.crit);
  } else if (type === 'dicer') {
    const bodyMat = toon(0xffffff, { unique: true, map: pips(), emissive: 0xffffff, emissiveIntensity: 0 });
    const die = part(new THREE.BoxGeometry(0.9, 0.9, 0.9), bodyMat, { ink: 0.04 });
    die.position.y = 2.4;
    const rotor = part(new THREE.BoxGeometry(1.6, 0.05, 0.16), 0x374151, { ink: 0.015, shadow: false });
    rotor.position.y = 3.0;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3fa4 }));
    eye.position.set(0, 2.4, -0.47);
    g.add(die, rotor, eye);
    Object.assign(parts, { body: die, rotor, eye, bodyMat, muzzle: new THREE.Vector3(0, 2.4, -0.5) });
    parts.hit = new THREE.Mesh(new THREE.SphereGeometry(0.75, 8, 6), hitMat);
    parts.hit.position.y = 2.4;
    g.add(parts.hit);
    // Weak spot: the little rotor hub on top. Hard to hit from the ground, so it pays big.
    parts.crit = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.5), hitMat);
    parts.crit.position.set(0, 3.05, 0);
    parts.critMult = 3;
    g.add(parts.crit);
  } else if (type === 'gator') {
    const bodyMat = toon(0x4d7c0f, { unique: true, emissive: 0xffffff, emissiveIntensity: 0 });
    const body = part(new THREE.BoxGeometry(1.1, 0.55, 2.6), bodyMat, { ink: 0.04 });
    body.position.set(0, 0.45, 0.2);
    const belly = part(new THREE.BoxGeometry(0.9, 0.2, 2.3), 0xd9f99d, { ink: 0, shadow: false });
    belly.position.set(0, 0.2, 0.2);
    const head = part(new THREE.BoxGeometry(0.8, 0.35, 1.3), bodyMat, { ink: 0.035 });
    head.position.set(0, 0.5, -1.6);
    const jaw = part(new THREE.BoxGeometry(0.75, 0.18, 1.2), 0x3f6212, { ink: 0.03 });
    jaw.position.set(0, 0.28, -1.55);
    const tail = part(new THREE.ConeGeometry(0.45, 2.2, 6), bodyMat, { ink: 0.035 });
    tail.rotation.x = Math.PI / 2;
    tail.position.set(0, 0.45, 2.5);
    g.add(body, belly, head, jaw, tail);
    const eyes = new THREE.Group();
    for (const side of [-1, 1]) {
      const eye = part(new THREE.SphereGeometry(0.13, 8, 6), 0xfacc15, { ink: 0.02, shadow: false });
      eye.position.set(side * 0.25, 0.75, -1.2);
      eyes.add(eye);
    }
    g.add(eyes);
    // Ridge spikes down the back.
    for (let i = 0; i < 5; i++) {
      const spike = part(new THREE.ConeGeometry(0.1, 0.25, 4), 0x365314, { ink: 0, shadow: false });
      spike.position.set(0, 0.8, -0.6 + i * 0.5);
      g.add(spike);
    }
    const legs = [];
    for (const [x, z] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.9], [0.6, 0.9]]) {
      const leg = part(new THREE.BoxGeometry(0.25, 0.35, 0.35), 0x3f6212, { ink: 0.02 });
      leg.position.set(x, 0.15, z);
      g.add(leg);
      legs.push(leg);
    }
    Object.assign(parts, { body, legs, jaw, eye: eyes.children[0], bodyMat, muzzle: new THREE.Vector3(0, 0.5, -2.2) });
    parts.hit = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.9, 4.2), hitMat);
    parts.hit.position.set(0, 0.45, 0);
    g.add(parts.hit);
    // Weak spot: right between the eyes.
    parts.crit = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.3, 0.35), hitMat);
    parts.crit.position.set(0, 0.75, -1.25);
    parts.critMult = 2.0;
    g.add(parts.crit);
  } else if (type === 'bouncer') {
    // A slab of a robot in a black suit and shades.
    const bodyMat = toon(0x1f2937, { unique: true, emissive: 0xffffff, emissiveIntensity: 0 });
    const torso = part(new THREE.BoxGeometry(1.7, 1.6, 1.0), bodyMat, { ink: 0.05 });
    torso.position.y = 2.0;
    const shirt = part(new THREE.BoxGeometry(0.5, 1.2, 0.05), 0xfff6e0, { ink: 0 });
    shirt.position.set(0, 2.05, -0.52);
    const tie = part(new THREE.BoxGeometry(0.16, 0.9, 0.06), 0xe63946, { ink: 0 });
    tie.position.set(0, 2.0, -0.56);
    const head = part(new THREE.BoxGeometry(0.9, 0.75, 0.85), 0x9ca3af, { ink: 0.04 });
    head.position.y = 3.15;
    const shades = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.18, 0.06), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    shades.position.set(0, 3.25, -0.45);
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.03), new THREE.MeshBasicMaterial({ color: 0xff3fa4 }));
    eye.position.set(0, 3.25, -0.49);
    g.add(torso, shirt, tie, head, shades, eye);
    const fists = [];
    for (const side of [-1, 1]) {
      const arm = part(new THREE.BoxGeometry(0.4, 1.2, 0.45), bodyMat, { ink: 0.03 });
      arm.position.set(side * 1.05, 1.9, -0.1);
      const fist = part(new THREE.BoxGeometry(0.6, 0.55, 0.6), 0x9ca3af, { ink: 0.03 });
      fist.position.set(side * 1.05, 1.25, -0.6);
      g.add(arm, fist);
      fists.push(fist);
    }
    const legs = [];
    for (const side of [-1, 1]) {
      const leg = part(new THREE.BoxGeometry(0.5, 1.2, 0.55), 0x111827, { ink: 0.03 });
      leg.position.set(side * 0.45, 0.6, 0);
      g.add(leg);
      legs.push(leg);
    }
    Object.assign(parts, { body: torso, legs, fists, eye, bodyMat, muzzle: new THREE.Vector3(0, 1.4, -1) });
    parts.hit = new THREE.Mesh(new THREE.BoxGeometry(2.0, 3.0, 1.2), hitMat);
    parts.hit.position.y = 1.5;
    g.add(parts.hit);
    parts.crit = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.8, 0.9), hitMat);
    parts.crit.position.y = 3.15;
    parts.critMult = 2.2;
    g.add(parts.crit);
  } else if (type === 'roller') {
    // A roulette wheel on its edge: red and black pockets, a gold hub, an angry eye.
    const bodyMat = toon(0xffffff, { unique: true, map: wheelFace(), emissive: 0xffffff, emissiveIntensity: 0 });
    const wheel = new THREE.Group();
    wheel.position.y = 1.2;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.45, 28), [toon(0x6b3a1e), bodyMat, bodyMat]);
    disc.rotation.z = Math.PI / 2;
    disc.castShadow = true;
    const hub = part(new THREE.CylinderGeometry(0.3, 0.3, 0.6, 12), 0xd4a63a, { ink: 0.02 });
    hub.rotation.z = Math.PI / 2;
    wheel.add(disc, hub);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3fa4 }));
    eye.position.set(0, 1.25, -0.36);
    g.add(wheel, eye);
    Object.assign(parts, { body: disc, wheel, eye, bodyMat, muzzle: new THREE.Vector3(0, 1.2, -0.6) });
    parts.hit = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.3, 2.3), hitMat);
    parts.hit.position.y = 1.2;
    g.add(parts.hit);
    // Weak spot: the hub.
    parts.crit = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.6), hitMat);
    parts.crit.position.y = 1.2;
    parts.critMult = 2.5;
    g.add(parts.crit);
  } else if (type === 'turret') {
    // A one-armed bandit welded to a tripod, with a cannon where the reels should be.
    const bodyMat = toon(0xd4a63a, { unique: true, emissive: 0xffffff, emissiveIntensity: 0 });
    const base = part(new THREE.CylinderGeometry(0.75, 0.95, 0.5, 12), 0x374151, { ink: 0.03 });
    base.position.y = 0.25;
    const post = part(new THREE.CylinderGeometry(0.2, 0.2, 0.7, 8), 0x374151, { ink: 0.02 });
    post.position.y = 0.8;
    const head = part(new THREE.BoxGeometry(1.1, 0.9, 1.1), bodyMat, { ink: 0.04 });
    head.position.y = 1.55;
    const barrel = part(new THREE.CylinderGeometry(0.13, 0.17, 1.6, 10), 0x1f2937, { ink: 0.02 });
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 1.55, -1.2);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.22, 12), new THREE.MeshBasicMaterial({ color: 0xff3fa4 }));
    lens.position.set(0, 1.75, -0.56);
    lens.rotation.y = Math.PI;
    const lever = new THREE.Group();
    lever.position.set(0.6, 1.6, 0);
    const stick = part(new THREE.CylinderGeometry(0.05, 0.05, 0.8, 6), 0x9ca3af, { ink: 0.01 });
    stick.position.y = 0.4;
    const knob = part(new THREE.SphereGeometry(0.13, 8, 6), 0xe63946, { ink: 0.01 });
    knob.position.y = 0.8;
    lever.add(stick, knob);
    g.add(base, post, head, barrel, lens, lever);
    Object.assign(parts, { body: head, eye: lens, lever, bodyMat, muzzle: new THREE.Vector3(0, 1.55, -2.0) });
    parts.hit = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.0, 1.3), hitMat);
    parts.hit.position.y = 1.0;
    g.add(parts.hit);
    parts.crit = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.2), hitMat);
    parts.crit.position.set(0, 1.75, -0.58);
    parts.critMult = 2.5;
    g.add(parts.crit);
  } else if (type === 'shark') {
    const bodyMat = toon(0xffffff, { unique: true, emissive: 0xffffff, emissiveIntensity: 0 });
    const card = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.7, 0.1), [bodyMat, bodyMat, bodyMat, bodyMat,
      toon(0xffffff, { map: cardFace() }), toon(0xb5172b)]);
    card.castShadow = true;
    card.position.y = 1.55;
    const blade = part(new THREE.BoxGeometry(0.08, 0.08, 0.9), 0xd1d5db, { ink: 0.015 });
    blade.position.set(0.75, 1.4, -0.4);
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.04), new THREE.MeshBasicMaterial({ color: 0xff3fa4 }));
    eye.position.set(0, 2.05, -0.07);
    g.add(card, blade, eye);
    const legs = [];
    for (const side of [-1, 1]) {
      const leg = part(new THREE.BoxGeometry(0.14, 0.7, 0.14), 0x1b0f2b, { ink: 0.015 });
      leg.position.set(side * 0.3, 0.35, 0);
      g.add(leg);
      legs.push(leg);
    }
    Object.assign(parts, { body: card, legs, eye, blade, bodyMat, muzzle: new THREE.Vector3(0, 1.5, -0.5) });
    parts.hit = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.2, 0.6), hitMat);
    parts.hit.position.y = 1.2;
    g.add(parts.hit);
    // Weak spot: the eye band at the top of the card.
    parts.crit = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.22, 0.75), hitMat);
    parts.crit.position.set(0, 2.05, 0);
    parts.critMult = 2.0;
    g.add(parts.crit);
  }
  return { group: g, parts };
}

export class Machine {
  constructor(raid, type, x, z, y = 0) {
    this.raid = raid;
    this.type = type;
    this.def = ENEMIES[type];
    this.name = this.def.name;
    this.team = 'machine';
    this.isBoss = type === 'boss';
    this.maxHp = Math.round(this.def.hp * (raid.map.toughness || 1));
    this.hp = this.maxHp;
    this.armor = 0;
    this.alive = true;
    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3();
    this.home = new THREE.Vector3(x, y, z);
    this.yaw = Math.random() * Math.PI * 2;
    this.radius = this.def.radius || (this.isBoss ? 2.4 : type === 'dicer' ? 0.6 : type === 'gator' ? 1.0 : 0.8);
    this.target = null;
    this.lostFor = 0;
    this.thinkIn = Math.random() * 0.5;
    this.cooldown = 1 + Math.random();
    this.windup = 0;
    this.burstLeft = 0;
    this.burstTimer = 0;
    this.flash = 0;
    this.dead = 0;
    this.phase = 0;
    this.strafe = Math.random() < 0.5 ? -1 : 1;
    this.wanderTo = null;
    // The Pit Boss gets meaner as he gets weaker: speed, fire rate and damage per phase.
    this.bossPhase = 1;
    this.rage = { speed: 1, rate: 1, dmg: 1 };
    this.invuln = 0;

    const { group, parts } = buildModel(type);
    this.group = group;
    this.parts = parts;
    parts.hit.userData.actor = this;
    this.hitMesh = parts.hit;
    if (parts.crit) {
      parts.crit.userData.actor = this;
      parts.crit.userData.crit = parts.critMult;
      this.critMesh = parts.crit;
    }
    this.bar = hpBar();
    this.bar.position.y = this.def.bar || (this.isBoss ? 11.5 : type === 'dicer' ? 3.4 : type === 'gator' ? 1.8 : 3.6);
    this.bar.userData.draw(1);
    if (!this.isBoss) group.add(this.bar);
    group.position.copy(this.pos);
    raid.scene.add(group);
  }

  head(out = new THREE.Vector3()) {
    const h = this.def.head || (this.isBoss ? 6 : this.type === 'dicer' ? 2.4 : this.type === 'gator' ? 0.7 : 1.8);
    return out.set(this.pos.x, this.pos.y + h, this.pos.z);
  }

  center(out = new THREE.Vector3()) {
    return this.head(out);
  }

  hurt(attacker) {
    this.flash = 0.1;
    this.bar.visible = true;
    this.bar.userData.draw(this.hp / this.maxHp);
    if (attacker && attacker.team !== 'machine' && attacker.alive) {
      this.target = attacker;
      this.lostFor = 0;
      if (this.windup <= 0 && this.cooldown <= 0) this.cooldown = 0.4;
    }
  }

  // Can we see this actor from where we are?
  canSee(a) {
    const from = this.head(tmp.clone());
    const to = a.center ? a.center(new THREE.Vector3()) : a.pos.clone().setY(a.pos.y + 1);
    const d = from.distanceTo(to);
    if (this.raid.throws.smokeBlocks(from, to)) return false;
    return !this.raid.raycast(from, to.sub(from).normalize(), d, this, { solidsOnly: true }).hit;
  }

  think() {
    const raid = this.raid;
    // Keep chasing a valid target; otherwise look for the nearest visible non-machine.
    if (this.target && (!this.target.alive || this.target.downed || this.target.pos.distanceTo(this.pos) > this.def.aggro * 2.2)) this.target = null;
    if (!this.target) {
      let best = null;
      let bestD = this.def.aggro;
      for (const a of raid.combatants) {
        if (!a.alive || a.downed) continue;
        const d = a.pos.distanceTo(this.pos);
        if (d < bestD && this.canSee(a)) { bestD = d; best = a; }
      }
      if (best) {
        this.target = best;
        this.windup = 0.9;
        sfx.alert(this.pos, raid.listener);
      }
    }
    if (this.target) {
      this.seesTarget = this.canSee(this.target);
      this.lostFor = this.seesTarget ? 0 : this.lostFor + 0.4;
      if (this.lostFor > 8) this.target = null;
    }
    if (this.type === 'gator') {
      if (this.target && this.target.pos.distanceTo(this.home) > 20) this.target = null;
      if (!this.target) this.wanderTo = this.home.clone();
    } else if (this.def.fixed) {
      this.wanderTo = null;
    } else if (!this.target && (!this.wanderTo || Math.random() < 0.05)) {
      this.wanderTo = this.home.clone().add(new THREE.Vector3((Math.random() - 0.5) * 16, 0, (Math.random() - 0.5) * 16));
    }
    if (Math.random() < 0.15) this.strafe *= -1;
  }

  update(dt) {
    const raid = this.raid;
    // Driven by the party host: glide to the reported spot.
    if (this.puppet && this.alive) {
      const k = Math.min(1, dt * 10);
      if (this.netPos) this.pos.lerp(this.netPos, k);
      if (this.netYaw !== undefined) this.yaw += Math.atan2(Math.sin(this.netYaw - this.yaw), Math.cos(this.netYaw - this.yaw)) * k;
      this.flash = Math.max(0, this.flash - dt);
      this.parts.bodyMat.emissiveIntensity = this.flash > 0 ? 0.7 : 0;
      this.group.position.copy(this.pos);
      this.group.rotation.y = this.yaw;
      this.group.rotation.z = this.stunned > 0 ? Math.sin(performance.now() / 70) * 0.12 : 0;
      return true;
    }
    if (!this.alive) {
      this.dead += dt;
      this.group.rotation.x = Math.min(Math.PI / 2, this.dead * 4) * (this.type === 'dicer' ? 0 : 1);
      if (this.type === 'dicer') this.group.position.y = Math.max(-2, this.pos.y - this.dead * 6);
      return this.dead < 4;
    }

    // Machines far from the player nap to save CPU.
    const p = raid.focus;
    const far = p && this.pos.distanceTo(p) > 120 && !this.target;
    if (far) return true;

    // Flash Chip: dazed, wobbling, not shooting.
    if (this.stunned > 0) {
      this.stunned -= dt;
      this.group.rotation.z = this.stunned > 0 ? Math.sin(this.stunned * 14) * 0.12 : 0;
      this.burstLeft = 0;
      return true;
    }

    this.thinkIn -= dt;
    if (this.thinkIn <= 0) {
      this.thinkIn = 0.4;
      this.think();
    }
    this.cooldown -= dt;
    this.windup -= dt;
    this.flash = Math.max(0, this.flash - dt);
    this.parts.bodyMat.emissiveIntensity = this.flash > 0 ? 0.7 : 0;

    const def = this.def;
    let mx = 0;
    let mz = 0;
    let speed = def.speed * this.rage.speed;
    this.invuln = Math.max(0, this.invuln - dt);
    if (this.isBoss) {
      // Weaker = angrier.
      const f = this.hp / this.maxHp;
      const want = f < 0.33 ? 3 : f < 0.66 ? 2 : 1;
      if (want > this.bossPhase) this.setBossPhase(want);
      if (this.parts.socket.visible) this.parts.socket.scale.setScalar(1 + Math.sin(performance.now() / 120) * 0.15);
      if (this.parts.core.visible) this.parts.core.material.color.setHSL(0.08, 1, 0.5 + Math.sin(performance.now() / 150) * 0.15);
      if (this.invuln > 0) { speed = 0; this.burstLeft = 0; }
    }
    const t = this.target;
    if (t) {
      const dx = t.pos.x - this.pos.x;
      const dz = t.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz) || 0.01;
      const wantYaw = Math.atan2(-dx, -dz);
      this.yaw += angleDiff(this.yaw, wantYaw) * Math.min(1, dt * (this.isBoss ? 2 : 5));
      const facing = Math.abs(angleDiff(this.yaw, wantYaw)) < 0.35;

      if (this.def.melee) {
        if (d > 1.6) { mx = dx / d; mz = dz / d; }
        if (d < def.range && this.cooldown <= 0 && this.windup <= 0) {
          this.cooldown = def.rate;
          if (this.parts.blade) this.parts.blade.rotation.y = -1.2;
          if (this.parts.jaw) this.parts.jaw.rotation.x = 0.6;
          raid.meleeHit(this, t, def.damage);
        }
        if (d < 8 && this.cooldown < def.rate * 0.5) speed *= 1.35;
        if (def.charge && d < 12 && d > 3) speed *= def.charge;
      } else if (this.type === 'dicer') {
        const ideal = 11;
        mx = (-dz / d) * this.strafe;
        mz = (dx / d) * this.strafe;
        if (d > ideal + 3 || !this.seesTarget) { mx += dx / d; mz += dz / d; } else if (d < ideal - 3) { mx -= dx / d; mz -= dz / d; }
      } else {
        const ideal = this.isBoss ? 9 : def.range * 0.55;
        if (d > ideal || !this.seesTarget) { mx = dx / d; mz = dz / d; } else if (!this.isBoss) { mx = (-dz / d) * this.strafe * 0.4; mz = (dx / d) * this.strafe * 0.4; }
      }

      if (!def.melee) {
        // Bursts: start one when ready, then fire shots spaced by burstGap.
        if (this.burstLeft === 0 && this.cooldown <= 0 && this.windup <= 0 && this.seesTarget && facing && d < def.range) {
          this.burstLeft = def.burst;
          this.burstTimer = 0;
          this.cooldown = (def.rate + Math.random() * 0.6) / this.rage.rate;
        }
        if (this.burstLeft > 0) {
          this.burstTimer -= dt;
          if (this.burstTimer <= 0) {
            this.burstTimer = def.burstGap;
            this.burstLeft--;
            const origin = this.muzzleWorld();
            const aim = t.center ? t.center(new THREE.Vector3()) : t.pos.clone().setY(t.pos.y + 1);
            const err = def.accuracy * (0.6 + d / 30);
            aim.x += (Math.random() - 0.5) * err * d;
            aim.y += (Math.random() - 0.5) * err * d * 0.6;
            aim.z += (Math.random() - 0.5) * err * d;
            raid.machineShot(this, origin, aim.sub(origin).normalize(), Math.round(def.damage * this.rage.dmg));
          }
        }
      }
      if (this.isBoss && this.invuln <= 0) this.bossMoves(dt, t, d);
    } else if (this.wanderTo) {
      const dx = this.wanderTo.x - this.pos.x;
      const dz = this.wanderTo.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 1) { mx = (dx / d) * 0.5; mz = (dz / d) * 0.5; this.yaw += angleDiff(this.yaw, Math.atan2(-dx, -dz)) * Math.min(1, dt * 3); }
    }

    // The boss stays inside the casino.
    if (this.isBoss) {
      const cz = raid.map.casino;
      const nx = this.pos.x + mx;
      const nz = this.pos.z + mz;
      if (Math.abs(nx - cz.x) > cz.w / 2 - 6 || nz > cz.z + cz.d / 2 - 6 || nz < cz.z - cz.d / 2 + 22) { mx = 0; mz = 0; }
    }

    const accel = Math.min(1, dt * 6);
    this.vel.x += (mx * speed - this.vel.x) * accel;
    this.vel.z += (mz * speed - this.vel.z) * accel;
    this.vel.y -= 24 * dt;
    if (this.type === 'dicer') this.vel.y = 0;
    this.pos.addScaledVector(this.vel, dt);
    if (this.type !== 'dicer') resolve(this.pos, this.vel, this.radius, raid.map);
    else {
      const y = this.pos.y;
      this.pos.y = 0;
      resolve(this.pos, this.vel, this.radius, raid.map);
      this.pos.y = y;
    }

    // Animation.
    this.anim = (this.anim || 0) + dt * Math.hypot(this.vel.x, this.vel.z) * 2.2;
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    if (this.parts.legs) {
      this.parts.legs[0].rotation.x = Math.sin(this.anim) * 0.6;
      this.parts.legs[1].rotation.x = -Math.sin(this.anim) * 0.6;
    }
    if (this.type === 'dicer') {
      this.group.position.y = Math.sin(performance.now() / 300 + this.home.x) * 0.25;
      this.parts.body.rotation.x += dt * 1.5;
      this.parts.body.rotation.z += dt;
      this.parts.rotor.rotation.y += dt * 30;
    }
    if (this.type === 'roller') {
      // Roll the wheel the way it's going; wobble a little.
      this.parts.wheel.rotation.x -= dt * Math.hypot(this.vel.x, this.vel.z) / 1.1;
      this.parts.wheel.rotation.z = Math.sin(performance.now() / 160) * 0.06;
    }
    if (this.type === 'turret') this.parts.lever.rotation.x = this.burstLeft > 0 ? 0.8 : this.parts.lever.rotation.x * 0.9;
    if (this.type === 'bouncer') {
      const swing = this.cooldown > this.def.rate - 0.25 ? 1 : 0;
      this.parts.fists[0].position.z = -0.6 - swing * 0.7;
      this.parts.fists[1].position.z = -0.6 + swing * 0.2;
    }
    if (this.parts.blade) this.parts.blade.rotation.y += (0 - this.parts.blade.rotation.y) * Math.min(1, dt * 8);
    if (this.parts.jaw) this.parts.jaw.rotation.x += (0 - this.parts.jaw.rotation.x) * Math.min(1, dt * 6);
    if (this.type === 'gator') {
      // Only the eyes poke out of the water while it waits.
      const lurking = !this.target && this.pos.distanceTo(this.home) < 2.5;
      this.sink = (this.sink || 0) + ((lurking ? 1 : 0) - (this.sink || 0)) * Math.min(1, dt * 3);
      this.group.position.y = -0.62 * this.sink;
      this.bar.visible = this.bar.visible && !lurking;
    }
    // Eyes glow brighter while winding up to shoot.
    this.parts.eye.material.color.setHex(this.target ? (this.windup > 0 ? 0xffffff : 0xff3fa4) : 0x7dd3fc);
    return true;
  }

  muzzleWorld() {
    const m = this.parts.muzzle.clone().multiplyScalar(this.isBoss ? 3.2 : 1);
    m.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    return m.add(this.group.position);
  }

  // Boss phases: where the weak spot is, how hard he goes, what he looks like.
  setBossPhase(n, announce = true) {
    if (!this.isBoss || n === this.bossPhase) return;
    this.bossPhase = n;
    const p = this.parts;
    const raid = this.raid;
    if (n === 1) {
      // Back to square one (he reset after everyone left).
      p.crit.position.set(0, 2.1, -0.62);
      p.crit.scale.set(1, 1, 1);
      p.core.visible = false;
      p.socket.visible = false;
      p.crown.visible = true;
      p.bodyMat.color.setHex(0xffc83d);
      this.rage = { speed: 1, rate: 1, dmg: 1 };
      p.critMult = 2.5;
      p.crit.userData.crit = p.critMult;
      return;
    } else if (n === 2) {
      // OVERCLOCKED: the screen armors up, a hot core opens on his back.
      p.crit.position.set(0, 2.0, 0.66);
      p.crit.scale.set(1, 1.2, 1);
      p.core.visible = true;
      p.bodyMat.color.setHex(0xff9f1c);
      this.rage = { speed: 1.35, rate: 1.35, dmg: 1.25 };
      p.critMult = 3;
    } else if (n === 3) {
      // TILT: the crown blows off. The socket underneath is the only soft spot left.
      p.crit.position.set(0, 3.3, 0);
      p.crit.scale.set(0.6, 0.7, 2.6);
      p.core.visible = false;
      p.crown.visible = false;
      p.socket.visible = true;
      p.bodyMat.color.setHex(0xe63946);
      this.rage = { speed: 1.7, rate: 1.7, dmg: 1.5 };
      p.critMult = 3.5;
    }
    p.crit.userData.crit = p.critMult;
    if (!announce) return;
    this.invuln = 1.6;
    this.windup = 1.6;
    this.burstLeft = 0;
    this.phase = 2;
    raid.fx.explosion(this.center(new THREE.Vector3()), 6);
    sfx.alert(this.pos, raid.listener);
    if (!this.puppet) raid.slam(this, 12, 20);
    const msg = n === 2
      ? '🔥 PHASE 2: The Pit Boss is OVERCLOCKED! His screen is armored: shoot the glowing core on his BACK.'
      : '💥 PHASE 3: TILT! His crown blew off. Hit the socket on TOP of his head, and don\'t stand still.';
    raid.feed(msg);
    if (raid.player && raid.player.alive && raid.player.pos.distanceTo(this.pos) < 90) raid.hud.toast(msg, 'big');
    if (this.puppet) return;
    // Backup arrives.
    const call = n === 2 ? ['roller', 'roller'] : ['bouncer', 'dicer', 'dicer'];
    for (const type of call) {
      const m = raid.spawnMachine(type, this.pos.x + (Math.random() - 0.5) * 12, this.pos.z + (Math.random() - 0.5) * 12);
      m.summoned = true;
      m.target = this.target;
    }
  }

  // A full circle of chip bullets.
  coinRing(count, dmg) {
    const origin = this.center(new THREE.Vector3());
    origin.y -= 1.5;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.2;
      this.raid.machineShot(this, origin, new THREE.Vector3(Math.cos(a), -0.04, Math.sin(a)).normalize(), dmg);
    }
    sfx.boom(this.pos, this.raid.listener);
  }

  // Rockets raining down around the target.
  jackpotRain(t, n) {
    for (let i = 0; i < n; i++) {
      setTimeout(() => {
        if (!this.alive || !t.alive) return;
        const aim = t.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 9, 0, (Math.random() - 0.5) * 9));
        const origin = aim.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, 32, (Math.random() - 0.5) * 4));
        this.raid.spawnRocket(origin, aim.sub(origin).normalize(), this, 0, 34);
      }, i * 220);
    }
    this.raid.feed('🎰 JACKPOT RAIN!');
  }

  // The Pit Boss's special attacks, cycling every few seconds. More of them, faster, each phase.
  bossMoves(dt, t, d) {
    this.phase -= dt;
    if (this.phase > 0) return;
    const raid = this.raid;
    const roll = Math.random();
    const ph = this.bossPhase;
    if (ph >= 2) {
      this.phase = (ph === 3 ? 2.2 : 3.0) + Math.random() * 1.2;
      if (d < (ph === 3 ? 9 : 7)) raid.slam(this, ph === 3 ? 12 : 9, ph === 3 ? 42 : 34);
      else if (roll < 0.3) this.coinRing(ph === 3 ? 26 : 18, Math.round(6 * this.rage.dmg));
      else if (roll < 0.55 && ph === 3) this.jackpotRain(t, 7);
      else if (roll < 0.55 && raid.machines.filter((m) => m.alive && m.type === 'roller' && m.summoned).length < 3) {
        for (let i = 0; i < 2; i++) {
          const m = raid.spawnMachine('roller', this.pos.x + (Math.random() - 0.5) * 8, this.pos.z + (Math.random() - 0.5) * 8);
          m.summoned = true;
          m.target = t;
        }
        raid.feed('🎡 The Pit Boss spun up Roulette Rollers!');
      } else {
        for (let i = 0; i < (ph === 3 ? 5 : 4); i++) {
          setTimeout(() => {
            if (!this.alive || !t.alive) return;
            const origin = this.muzzleWorld();
            origin.y += 1;
            const aim = t.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 5, 0.5, (Math.random() - 0.5) * 5));
            raid.spawnRocket(origin, aim.sub(origin).normalize(), this, 0, Math.round(40 * this.rage.dmg));
          }, i * 260);
        }
      }
      return;
    }
    this.phase = 3.5 + Math.random() * 1.5;
    if (d < 7) {
      raid.slam(this, 8, 30);
    } else if (roll < 0.4) {
      for (let i = 0; i < 3; i++) {
        setTimeout(() => {
          if (!this.alive || !t.alive) return;
          const origin = this.muzzleWorld();
          origin.y += 1;
          const aim = t.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, 0.5, (Math.random() - 0.5) * 6));
          raid.spawnRocket(origin, aim.sub(origin).normalize(), this, 0, 40);
        }, i * 350);
      }
    } else if (roll < 0.65 && raid.machines.filter((m) => m.alive && m.type === 'dicer' && m.summoned).length < 4) {
      for (let i = 0; i < 2; i++) {
        const m = raid.spawnMachine('dicer', this.pos.x + (Math.random() - 0.5) * 8, this.pos.z + (Math.random() - 0.5) * 8);
        m.summoned = true;
        m.target = t;
      }
      raid.feed('🎲 The Pit Boss rolled out more Dicers!');
    }
  }
}
