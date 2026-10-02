// Your keyboard/mouse controls and the over-the-shoulder camera.
// Which key or button does what lives in keys.js, and players can rebind all of it.
import * as THREE from 'three';
import { WEAPONS, ITEMS } from './config.js';
import { actionsFor, capturing } from './keys.js';

const BASE_SENSITIVITY = 0.0016;
const AUTO = new Set(['smg', 'fists', 'spoon']);
const CAM_OFFSET = new THREE.Vector3(1.15, 0.6, 4.3);
const AIM_OFFSET = new THREE.Vector3(0.9, 0.45, 2.4);

export class PlayerController {
  constructor(raid, camera, canvas) {
    this.raid = raid;
    this.camera = camera;
    this.canvas = canvas;
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

    // Every input goes through the bindings in keys.js, so keys and mouse buttons are interchangeable.
    this.held = new Set();
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || capturing()) return;
      if (e.code === 'Tab' || e.code === 'Space' || (this.locked && actionsFor(e.code).length)) e.preventDefault();
      if (e.repeat) return;
      this.press(e.code);
    });
    window.addEventListener('keyup', (e) => this.release(e.code));
    window.addEventListener('blur', () => this.releaseAll());
    window.addEventListener('mousedown', (e) => {
      if (capturing()) return;
      if (e.button >= 3) e.preventDefault();
      if (!this.locked) {
        // Click the game to grab the mouse; extra buttons can still open and close the bag or map.
        if (e.target === canvas) { this.lock(); return; }
        if (e.button >= 1 && this.raid.active) this.press(`Mouse${e.button}`, ['bag', 'map']);
        return;
      }
      this.press(`Mouse${e.button}`);
    });
    window.addEventListener('mouseup', (e) => {
      // Side buttons would otherwise make the browser go back a page.
      if (e.button >= 3) e.preventDefault();
      this.release(`Mouse${e.button}`);
    });
    window.addEventListener('auxclick', (e) => { if (e.button >= 3) e.preventDefault(); });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => {
      if (!this.locked || capturing() || Math.abs(e.deltaY) < 1) return;
      const code = e.deltaY < 0 ? 'WheelUp' : 'WheelDown';
      this.press(code);
      this.release(code);
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
      if (!this.locked) this.releaseAll();
      this.onLockChange(this.locked);
    });
  }

  // A bound key or button went down. `only` limits which actions may fire (used while the mouse is free).
  press(code, only = null) {
    for (const a of actionsFor(code)) {
      if (only && !only.includes(a)) continue;
      if (this.held.has(a)) continue;
      this.held.add(a);
      this.action(a, true);
    }
  }

  release(code) {
    for (const a of actionsFor(code)) {
      if (!this.held.has(a)) continue;
      this.held.delete(a);
      this.action(a, false);
    }
  }

  releaseAll() {
    for (const a of [...this.held]) { this.held.delete(a); this.action(a, false); }
    this.firing = false;
    this.aimHeld = false;
    this.throwHeld = false;
  }

  action(a, down) {
    const c = this.c;
    if (a === 'fire') { this.firing = down; return; }
    if (a === 'aim') { this.aimHeld = down; return; }
    if (!c || !c.alive || !this.raid.active) { if (!down) this.throwHeld = false; return; }
    if (a === 'throw') {
      // Hold to see where it lands, let go to throw.
      if (down) {
        if (c.currentThrowable()) this.throwHeld = true;
        else this.say('Nothing to throw. Find 💣 🎲 ✨ 🌶️ in crates and slots.', null);
      } else if (this.throwHeld) {
        this.throwHeld = false;
        this.say(c.throwGrenade(c.head(new THREE.Vector3()), this.aimRay().dir), null);
      }
      return;
    }
    if (!down) return;
    if (a === 'use') this.pressE = true;
    if (a === 'weapon1') c.switchTo(0);
    if (a === 'weapon2') c.switchTo(1);
    if (a === 'swap') c.switchTo(c.active ? 0 : 1);
    if (a === 'reload') this.say(c.reload(), 'Reloading…');
    if (a === 'heal') this.say(c.startUsing(c.count('bandage') ? 'bandage' : 'soda'), null);
    if (a === 'armor') this.say(c.startUsing('plate'), null);
    if (a === 'cocoa') this.say(c.startUsing('cocoa'), null);
    if (a === 'boost') this.say(c.startUsing('fuel'), null);
    if (a === 'cycleThrow') {
      const id = c.cycleThrowable();
      this.say(null, id ? `Throwing: ${ITEMS[id].icon} ${ITEMS[id].name} ×${c.count(id)}` : 'Nothing to throw');
    }
    if (a === 'bag') this.onToggle('bag');
    if (a === 'map') this.onToggle('map');
    if (a === 'pov') this.togglePov();
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
    const h = this.held;
    const f = (h.has('forward') ? 1 : 0) - (h.has('back') ? 1 : 0);
    const r = (h.has('right') ? 1 : 0) - (h.has('left') ? 1 : 0);
    const fx = -Math.sin(c.yaw);
    const fz = -Math.cos(c.yaw);
    let mx = f * fx + r * -fz;
    let mz = f * fz + r * fx;
    const len = Math.hypot(mx, mz);
    if (len > 0) { mx /= len; mz /= len; }
    c.move.set(mx, mz);
    c.sprint = h.has('sprint');
    c.aiming = this.aimHeld && c.alive;
    if (h.has('jump')) c.wantJump = true;

    // E: tap to use, hold to search containers.
    const it = c.alive && raid.active ? raid.nearbyInteractable(c) : null;
    if (this.search) {
      const still = this.search.target === it && h.has('use') && c.alive;
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
    const throwing = this.throwHeld && c.alive && raid.active ? c.currentThrowable() : null;
    if (throwing) raid.showArc(raid.grenadeArc(c, c.head(new THREE.Vector3()), this.aimRay().dir, throwing), throwing);
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
