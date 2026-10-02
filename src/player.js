// Your keyboard/mouse controls and the over-the-shoulder camera.
//   WASD move · Space jump · Shift sprint · Mouse aim · Left click shoot · Right click aim down sights
//   1/2 or mouse wheel swap guns · R reload · E use (hold to search) · H heal · F armor plate · Q (or Tab/I/B) bag · M map
//   V switch first/third person
import * as THREE from 'three';
import { WEAPONS } from './config.js';

const BASE_SENSITIVITY = 0.0016;
const AUTO = new Set(['smg', 'fists', 'spoon']);
const CAM_OFFSET = new THREE.Vector3(1.15, 0.6, 4.3);
const AIM_OFFSET = new THREE.Vector3(0.9, 0.45, 2.4);

export class PlayerController {
  constructor(raid, camera, canvas) {
    this.raid = raid;
    this.camera = camera;
    this.canvas = canvas;
    this.keys = {};
    this.firing = false;
    this.aimHeld = false;
    this.locked = false;
    this.camDist = CAM_OFFSET.length();
    this.zoom = 0;
    this.sensitivity = 1;
    this.fov = 72;
    this.search = null;
    this.onLockChange = () => {};
    this.onToggle = () => {};
    this.onPov = () => {};
    this.firstPerson = false;
    this.bob = 0;

    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === 'tab') e.preventDefault();
      if (k === ' ') e.preventDefault();
      if (e.repeat) { this.keys[k] = true; return; }
      this.keys[k] = true;
      const c = this.c;
      if (!c || !c.alive || !this.raid.active) return;
      if (k === 'e') this.pressE = true;
      if (k === '1') c.switchTo(0);
      if (k === '2') c.switchTo(1);
      if (k === 'r') this.say(c.reload(), 'Reloading…');
      if (k === 'h') this.say(c.startUsing(c.count('bandage') ? 'bandage' : 'soda'), null);
      if (k === 'f') this.say(c.startUsing('plate'), null);
      if (k === 'g') this.say(c.startUsing('cocoa'), null);
      // T: hold to see where the Cherry Bomb will land, let go to throw.
      if (k === 't') {
        if (c.count('grenade')) this.throwHeld = true;
        else this.say('No Cherry Bombs. Find 💣 in crates and slots.', null);
      }
      if (k === 'q' || k === 'tab' || k === 'i' || k === 'b') this.onToggle('bag');
      if (k === 'm') this.onToggle('map');
      if (k === 'v') this.togglePov();
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keys[k] = false;
      if (k === 't' && this.throwHeld) {
        this.throwHeld = false;
        const c = this.c;
        if (c && c.alive && this.raid.active) this.say(c.throwGrenade(c.head(new THREE.Vector3()), this.aimRay().dir), null);
      }
    });
    window.addEventListener('blur', () => { this.keys = {}; this.firing = false; this.aimHeld = false; this.throwHeld = false; });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) { this.lock(); return; }
      if (e.button === 0) this.firing = true;
      if (e.button === 2) this.aimHeld = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
      if (e.button === 2) this.aimHeld = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // Mouse wheel swaps guns.
    window.addEventListener('wheel', (e) => {
      if (!this.locked || !this.c || !this.c.alive || !this.raid.active) return;
      if (Math.abs(e.deltaY) < 1) return;
      this.c.switchTo(this.c.active ? 0 : 1);
    }, { passive: true });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.c) return;
      // Slower turning while aiming down sights.
      const s = BASE_SENSITIVITY * this.sensitivity * (this.aimHeld ? 0.55 : 1);
      this.c.yaw -= e.movementX * s;
      this.c.pitch = Math.max(-1.0, Math.min(0.9, this.c.pitch - e.movementY * s));
    });
    // If the browser refuses pointer lock, play without it.
    document.addEventListener('pointerlockerror', () => {
      this.locked = true;
      this.onLockChange(true);
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) { this.firing = false; this.aimHeld = false; this.throwHeld = false; this.keys = {}; }
      this.onLockChange(this.locked);
    });
  }

  togglePov() {
    this.firstPerson = !this.firstPerson;
    this.onPov(this.firstPerson);
  }

  say(refusal, ok) {
    if (refusal) this.raid.hud.toast(refusal);
    else if (ok) this.raid.hud.toast(ok);
  }

  lock() {
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* pointer lock unavailable */ }
  }

  update(dt) {
    const c = this.c;
    const raid = this.raid;
    const hud = raid.hud;
    if (!c) return;
    const k = this.keys;
    const f = (k.w || k.arrowup ? 1 : 0) - (k.s || k.arrowdown ? 1 : 0);
    const r = (k.d || k.arrowright ? 1 : 0) - (k.a || k.arrowleft ? 1 : 0);
    const fx = -Math.sin(c.yaw);
    const fz = -Math.cos(c.yaw);
    let mx = f * fx + r * -fz;
    let mz = f * fz + r * fx;
    const len = Math.hypot(mx, mz);
    if (len > 0) { mx /= len; mz /= len; }
    c.move.set(mx, mz);
    c.sprint = !!k.shift;
    c.aiming = this.aimHeld && c.alive;
    if (k[' ']) c.wantJump = true;

    // E: tap to use, hold to search containers.
    const it = c.alive && raid.active ? raid.nearbyInteractable(c) : null;
    if (this.search) {
      const still = this.search.target === it && k.e && c.alive;
      if (!still) this.search = null;
      else {
        this.search.t += dt;
        if (this.search.t >= this.search.target.searchTime) {
          this.search.target.open(c);
          this.search = null;
        }
      }
    }
    if (this.pressE) {
      this.pressE = false;
      if (it && it.searchTime) this.search = { target: it, t: 0 };
      else if (it) this.say(it.use(c), null);
    }
    hud.prompt(it && !this.search ? it.prompt(c) : null);
    hud.progress(this.search ? this.search.t / this.search.target.searchTime : c.using ? c.using.t / c.using.total : null,
      this.search ? 'Searching…' : c.using ? 'Using…' : '');

    // Cherry Bomb aiming arc.
    if (this.throwHeld && c.alive && raid.active) raid.showArc(raid.grenadeArc(c, c.head(new THREE.Vector3()), this.aimRay().dir));
    else raid.showArc(null);

    if (this.firing && c.alive && raid.active) {
      const weapon = c.weapon;
      const { origin, dir } = this.aimRay();
      // Hold to keep firing the SMG or swinging; other guns fire once per click.
      if (raid.fire(c, origin, dir) && !AUTO.has(weapon)) this.firing = false;
    }
  }

  // The ray through the crosshair, starting at your character (not behind them).
  aimRay() {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const head = this.c.head(new THREE.Vector3());
    const t = Math.max(0, head.clone().sub(this.camera.position).dot(dir));
    return { origin: this.camera.position.clone().addScaledVector(dir, t), dir };
  }

  updateCamera(dt) {
    const c = this.c;
    const raid = this.raid;
    const zoomed = c.aiming;
    this.zoom += ((zoomed ? 1 : 0) - this.zoom) * Math.min(1, dt * 12);
    const scope = zoomed && WEAPONS[c.weapon].zoom ? 0.45 : 0.75;
    const fov = this.fov * (1 - this.zoom * (1 - scope));
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    const head = c.head(new THREE.Vector3());
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(c.pitch, c.yaw, 0, 'YXZ'));
    c.char.firstPerson(this.firstPerson && c.alive);

    if (this.firstPerson && c.alive) {
      // Eyes just in front of the face, with a little bob while you move.
      const speed = Math.hypot(c.vel.x, c.vel.z);
      this.bob += dt * speed * (c.isSprinting ? 1.6 : 1.3);
      const bobAmt = c.onGround ? Math.min(1, speed / 6) * (c.aiming ? 0.2 : 1) : 0;
      this.camera.position.copy(head).addScaledVector(c.forward, 0.05);
      this.camera.position.y += 0.12 + Math.sin(this.bob * 2) * 0.05 * bobAmt;
      this.camera.position.addScaledVector(new THREE.Vector3(-c.forward.z, 0, c.forward.x), Math.cos(this.bob) * 0.03 * bobAmt);
      this.camera.quaternion.copy(q);
      this.camDist = 0.6;
      const s = raid.shake;
      if (s > 0) {
        this.camera.position.x += (Math.random() - 0.5) * s * 0.5;
        this.camera.position.y += (Math.random() - 0.5) * s * 0.5;
      }
      return;
    }

    const offset = CAM_OFFSET.clone().lerp(AIM_OFFSET, this.zoom).applyQuaternion(q);
    const want = offset.length();

    // Pull the camera in if a wall is in the way.
    const hit = raid.raycast(head, offset.clone().normalize(), want + 0.3, c, { solidsOnly: true });
    const allowed = hit.hit ? Math.max(0.6, hit.distance - 0.3) : want;
    this.camDist += (allowed - this.camDist) * Math.min(1, dt * (allowed < this.camDist ? 30 : 6));

    this.camera.position.copy(head).addScaledVector(offset.normalize(), this.camDist);
    this.camera.quaternion.copy(q);
    const s = raid.shake;
    if (s > 0) {
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }
  }
}
