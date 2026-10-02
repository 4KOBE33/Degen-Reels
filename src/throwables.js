// Everything you can throw: Cherry Bombs, Loaded Dice, Flash Chips and Ghost Pepper Sauce.
// They share one arc and bounce model; each one does its own thing when it goes off.
import * as THREE from 'three';
import { ITEMS } from './config.js';
import { part, toon, canvasTexture } from './toon.js';
import { sfx } from './audio.js';

const SPEED = 17;
const LIFT = 4.5;
const GRAVITY = 22;

// Dice faces: 1-6 pips on a red casino die.
const PIPS = {
  1: [[0.5, 0.5]],
  2: [[0.25, 0.25], [0.75, 0.75]],
  3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]],
  5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
  6: [[0.25, 0.22], [0.75, 0.22], [0.25, 0.5], [0.75, 0.5], [0.25, 0.78], [0.75, 0.78]],
};
let faceMats = null;
function diceFaces() {
  if (faceMats) return faceMats;
  faceMats = {};
  for (let n = 1; n <= 6; n++) {
    const tex = canvasTexture(64, 64, (c, w, h) => {
      c.fillStyle = '#e63946';
      c.fillRect(0, 0, w, h);
      c.strokeStyle = '#7a1020';
      c.lineWidth = 4;
      c.strokeRect(2, 2, w - 4, h - 4);
      c.fillStyle = '#fff6e0';
      for (const [x, y] of PIPS[n]) {
        c.beginPath();
        c.arc(x * w, y * h, 6, 0, Math.PI * 2);
        c.fill();
      }
    });
    faceMats[n] = toon(0xffffff, { map: tex });
  }
  return faceMats;
}

function buildMesh(id, roll) {
  const g = new THREE.Group();
  let spark = null;
  if (id === 'dice') {
    // BoxGeometry faces: +x, -x, +y (top), -y, +z, -z. The rolled number ends up on top.
    const f = diceFaces();
    const sides = [1, 2, 3, 4, 5, 6].filter((n) => n !== roll && n !== 7 - roll);
    const cube = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), [f[sides[0]], f[sides[1]], f[roll], f[7 - roll], f[sides[2]], f[sides[3]]]);
    cube.castShadow = true;
    g.add(cube);
  } else if (id === 'flash') {
    const chip = part(new THREE.CylinderGeometry(0.2, 0.2, 0.07, 18), 0xf8fafc, { ink: 0.02, shadow: false });
    chip.rotation.x = Math.PI / 2;
    const rim = part(new THREE.TorusGeometry(0.2, 0.025, 6, 18), 0xffd23f, { ink: 0, shadow: false });
    g.add(chip, rim);
    spark = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    g.add(spark);
  } else if (id === 'sauce') {
    const bottle = part(new THREE.CylinderGeometry(0.1, 0.12, 0.34, 10), 0xd62828, { ink: 0.02, shadow: false });
    const neck = part(new THREE.CylinderGeometry(0.04, 0.06, 0.14, 8), 0xd62828, { ink: 0.015, shadow: false });
    neck.position.y = 0.23;
    const cap = part(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 8), 0x2d6a4f, { ink: 0.01, shadow: false });
    cap.position.y = 0.32;
    g.add(bottle, neck, cap);
  } else {
    const ball = part(new THREE.SphereGeometry(0.2, 12, 10), 0xe63946, { ink: 0.03, shadow: false });
    const stem = part(new THREE.CylinderGeometry(0.025, 0.025, 0.25, 6), 0x2d6a4f, { ink: 0.015, shadow: false });
    stem.position.set(0.05, 0.25, 0);
    stem.rotation.z = -0.4;
    spark = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
    spark.position.set(0.1, 0.36, 0);
    g.add(ball, stem, spark);
  }
  return { mesh: g, spark };
}

export class Throwables {
  constructor(raid) {
    this.raid = raid;
    this.list = [];
    this.pools = [];
    this.arc = null;
  }

  clear() {
    for (const g of this.list) this.raid.scene.remove(g.mesh);
    for (const p of this.pools) this.endPool(p);
    this.list = [];
    this.pools = [];
  }

  launch(origin, dir) {
    const pos = origin.clone().addScaledVector(dir, 0.6);
    const vel = dir.clone().multiplyScalar(SPEED);
    vel.y += LIFT;
    return { pos, vel };
  }

  // Move one step: gravity, bounces off walls and floors. Returns true on a hard bounce.
  step(g, dt) {
    let bounced = false;
    g.vel.y -= GRAVITY * dt;
    const speed = g.vel.length();
    if (speed > 0.01) {
      const dir = g.vel.clone().divideScalar(speed);
      const hit = this.raid.raycast(g.pos, dir, speed * dt + 0.15, g.owner, { solidsOnly: true });
      if (hit.hit && hit.normal) {
        const n = hit.normal;
        g.pos.copy(hit.point).addScaledVector(n, 0.16);
        g.vel.addScaledVector(n, -2 * g.vel.dot(n)).multiplyScalar(0.45);
        bounced = speed > 3;
        g.touched = true;
      } else g.pos.addScaledVector(g.vel, dt);
    }
    const floor = this.raid.map.groundAt(g.pos.x, g.pos.z, g.pos.y) + 0.15;
    if (g.pos.y < floor) {
      g.pos.y = floor;
      g.touched = true;
      if (g.vel.y < 0) {
        bounced = g.vel.y < -3;
        g.vel.y = Math.abs(g.vel.y) < 2 ? 0 : -g.vel.y * 0.35;
        g.vel.x *= 0.6;
        g.vel.z *= 0.6;
      }
    }
    return bounced;
  }

  spawn(owner, origin, dir, id = 'grenade') {
    const def = ITEMS[id];
    const { pos, vel } = this.launch(origin, dir);
    const roll = 1 + Math.floor(Math.random() * 6);
    const { mesh, spark } = buildMesh(id, roll);
    mesh.position.copy(pos);
    this.raid.scene.add(mesh);
    const spin = new THREE.Vector3(Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5);
    this.list.push({ id, def, mesh, spark, pos, vel, owner, fuse: def.fuse, blink: 0, roll, spin });
    sfx.lever(pos, this.raid.listener);
  }

  update(dt) {
    const raid = this.raid;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const g = this.list[i];
      g.fuse -= dt;
      if (this.step(g, dt)) sfx.tick(g.pos, raid.listener);
      g.mesh.position.copy(g.pos);
      const moving = g.vel.lengthSq() > 0.5;
      if (g.id === 'dice' && !moving && g.touched) {
        // Settle with the rolled number facing up.
        g.mesh.rotation.x *= 0.7;
        g.mesh.rotation.z *= 0.7;
      } else {
        g.mesh.rotation.x += g.spin.x * dt;
        g.mesh.rotation.y += g.spin.y * dt;
        g.mesh.rotation.z += g.spin.z * dt;
      }
      if (g.spark) {
        g.blink += dt * (g.fuse < 0.6 ? 18 : 7);
        g.spark.visible = Math.floor(g.blink) % 2 === 0;
      }
      // Hot sauce smashes on whatever it hits first.
      const boom = g.def.effect === 'fire' ? g.touched || g.fuse <= 0 : g.fuse <= 0;
      if (boom) {
        raid.scene.remove(g.mesh);
        this.list.splice(i, 1);
        this.detonate(g);
      }
    }
    for (let i = this.pools.length - 1; i >= 0; i--) {
      if (!this.updatePool(this.pools[i], dt)) this.pools.splice(i, 1);
    }
  }

  detonate(g) {
    const raid = this.raid;
    const at = g.pos.clone().setY(g.pos.y + 0.3);
    const def = g.def;
    if (def.effect === 'frag') {
      raid.explode(at, { owner: g.owner, damage: def.damage, splash: def.splash });
    } else if (def.effect === 'dice') {
      // The higher the roll, the bigger the boom. Snake eyes barely pops.
      const r = g.roll;
      const jackpot = r === 6;
      const label = r === 1 ? '🎲 1 · snake eyes' : jackpot ? '🎲 6 · JACKPOT!' : `🎲 ${r}`;
      raid.fx.number(at.clone().setY(at.y + 1.2), label, jackpot ? '#ffd23f' : r === 1 ? '#9ca3af' : '#fff6e0', jackpot ? 1.6 : 1.1);
      if (r === 1) {
        raid.fx.puff(at, 0x9ca3af, 1.2);
        raid.explode(at, { owner: g.owner, damage: 15, splash: 2.5 });
      } else {
        raid.explode(at, { owner: g.owner, damage: 20 + r * 16 + (jackpot ? 30 : 0), splash: def.splash + (r - 3) * 0.6 + (jackpot ? 1.5 : 0) });
        if (jackpot) raid.fx.confetti(at.clone().setY(at.y + 1), 40);
      }
    } else if (def.effect === 'flash') {
      this.flash(g, at);
    } else if (def.effect === 'fire') {
      this.startPool(g, at);
    }
  }

  // Blind and stun everyone nearby who can see the flash.
  flash(g, at) {
    const raid = this.raid;
    const def = g.def;
    sfx.zap(at, raid.listener);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), raid.fx.fadeMaterial(0xffffff));
    ball.position.copy(at);
    raid.fx.add(ball, 0.5, (o, t) => { o.scale.setScalar(1 + t * 6); o.material.opacity = 1 - t; });
    const sees = (eye) => {
      const d = eye.distanceTo(at);
      if (d > def.splash) return 0;
      const dir = at.clone().sub(eye).normalize();
      if (raid.raycast(eye, dir, d, null, { solidsOnly: true }).hit) return 0;
      return 1 - d / def.splash;
    };
    for (const a of raid.actors) {
      if (!a.alive || a.isPlayer) continue;
      const eye = a.center(new THREE.Vector3()).setY(a.pos.y + (a.isBoss ? 4 : 1.4));
      const k = sees(eye);
      if (k <= 0) continue;
      a.stunned = def.stun * (a.isBoss ? 0.4 : 1) * (0.5 + 0.5 * k);
      if (g.owner && a.target !== undefined && !a.target) a.target = g.owner;
      raid.fx.number(eye.clone().setY(eye.y + 1), '💫', '#fff6e0', 1);
    }
    // You get blinded too if you're looking its way.
    const p = raid.player;
    if (p && p.alive && raid.camera) {
      const eye = raid.camera.position.clone();
      const k = sees(eye);
      if (k > 0) {
        const look = new THREE.Vector3(0, 0, -1).applyQuaternion(raid.camera.quaternion);
        const facing = look.dot(at.clone().sub(eye).normalize());
        raid.hud.flashbang(Math.min(1, k * 1.5) * (facing > 0.2 ? 1 : 0.35));
      }
    }
  }

  startPool(g, at) {
    const raid = this.raid;
    const def = g.def;
    sfx.boom(at, raid.listener);
    const ground = raid.map.groundAt(at.x, at.z, at.y);
    const group = new THREE.Group();
    group.position.set(at.x, ground + 0.06, at.z);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(def.splash, 28), new THREE.MeshBasicMaterial({ color: 0xff6a00, transparent: true, opacity: 0.55, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2;
    group.add(disc);
    const flameMats = [new THREE.MeshBasicMaterial({ color: 0xff7a1a }), new THREE.MeshBasicMaterial({ color: 0xffd23f })];
    const flames = [];
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * def.splash * 0.85;
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.2, 6), flameMats[i % 2]);
      f.position.set(Math.cos(a) * r, 0.6, Math.sin(a) * r);
      f.userData.phase = Math.random() * 6;
      group.add(f);
      flames.push(f);
    }
    raid.scene.add(group);
    // It counts as a fire for warming up in the snow.
    const warm = { x: at.x, z: at.z };
    raid.map.hazards.fires.push(warm);
    this.pools.push({ group, flames, at: new THREE.Vector3(at.x, ground, at.z), def, owner: g.owner, t: def.burnTime, tick: 0, warm });
  }

  updatePool(p, dt) {
    p.t -= dt;
    const fade = Math.min(1, p.t / 1);
    for (const f of p.flames) f.scale.set(1, (0.6 + Math.abs(Math.sin(p.t * 9 + f.userData.phase)) * 0.8) * fade, 1);
    p.tick -= dt;
    if (p.tick <= 0) {
      p.tick = 0.5;
      for (const a of this.raid.actors) {
        if (!a.alive) continue;
        if (Math.hypot(a.pos.x - p.at.x, a.pos.z - p.at.z) > p.def.splash + (a.radius || 0.4)) continue;
        if (a.pos.y > p.at.y + 2.5) continue;
        this.raid.damage(a, p.def.burn * 0.5 * (a === p.owner ? 0.5 : 1), p.owner, a.center(new THREE.Vector3()));
      }
    }
    if (p.t <= 0) { this.endPool(p); return false; }
    return true;
  }

  endPool(p) {
    this.raid.scene.remove(p.group);
    const fires = this.raid.map.hazards.fires;
    const i = fires.indexOf(p.warm);
    if (i >= 0) fires.splice(i, 1);
  }

  // Points along the path a throw would take, for the aiming arc.
  path(owner, origin, dir, id = 'grenade') {
    const def = ITEMS[id] || ITEMS.grenade;
    const g = { ...this.launch(origin, dir), owner };
    const pts = [g.pos.clone()];
    const dt = 1 / 30;
    let bounces = 0;
    for (let t = 0; t < def.fuse && bounces < 2; t += dt) {
      if (this.step(g, dt)) bounces++;
      pts.push(g.pos.clone());
      if (def.effect === 'fire' && g.touched) break;
    }
    return pts;
  }

  // The aiming arc: a trail of dots plus a ring showing how far it reaches.
  showArc(pts, id = 'grenade') {
    const raid = this.raid;
    if (!this.arc) {
      if (!pts) return;
      const dotGeo = new THREE.SphereGeometry(0.07, 6, 5);
      const dotMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9 });
      const dots = Array.from({ length: 32 }, () => new THREE.Mesh(dotGeo, dotMat));
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 48), new THREE.MeshBasicMaterial({ color: 0xff5d5d, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      this.arc = new THREE.Group();
      this.arc.add(ring, ...dots);
      this.arc.userData = { dots, ring };
      raid.scene.add(this.arc);
    }
    this.arc.visible = !!pts;
    if (!pts) return;
    const def = ITEMS[id] || ITEMS.grenade;
    const { dots, ring } = this.arc.userData;
    ring.scale.setScalar(def.splash);
    ring.material.color.setHex(def.ring || 0xff5d5d);
    dots.forEach((d, i) => {
      const p = pts[i * 2 + 1];
      d.visible = !!p;
      if (p) d.position.copy(p);
    });
    const end = pts[pts.length - 1];
    ring.position.set(end.x, raid.map.groundAt(end.x, end.z, end.y) + 0.06, end.z);
  }

  // A bot picks a throw angle that lands near `to`.
  aim(from, to) {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const d = Math.hypot(dx, dz) || 1;
    let best = null;
    for (let pitch = -0.3; pitch <= 0.9; pitch += 0.05) {
      const dir = new THREE.Vector3((dx / d) * Math.cos(pitch), Math.sin(pitch), (dz / d) * Math.cos(pitch));
      const vh = SPEED * Math.cos(pitch);
      const vy = SPEED * Math.sin(pitch) + LIFT;
      const h0 = from.y - to.y;
      const tLand = (vy + Math.sqrt(Math.max(0, vy * vy + 2 * GRAVITY * h0))) / GRAVITY;
      const err = Math.abs(vh * tLand - d);
      if (!best || err < best.err) best = { dir, err };
    }
    return best.dir;
  }
}
