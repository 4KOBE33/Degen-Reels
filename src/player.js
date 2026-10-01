// Your keyboard/mouse controls and the over-the-shoulder camera.
import * as THREE from 'three';
const SENSITIVITY = 0.0022;
const AUTO = new Set(['smg', 'fists', 'spoon']);
const CAM_OFFSET = new THREE.Vector3(1.15, 0.6, 4.3);

export class PlayerController {
  constructor(game, c, camera, canvas) {
    this.game = game;
    this.c = c;
    this.camera = camera;
    this.canvas = canvas;
    this.keys = {};
    this.firing = false;
    this.locked = false;
    this.camDist = CAM_OFFSET.length();
    this.onLockChange = () => {};

    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      this.keys[k] = true;
      if (k === 'e' && !e.repeat) this.interactPressed = true;
      if (k === ' ') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.key.toLowerCase()] = false; });
    window.addEventListener('blur', () => { this.keys = {}; this.firing = false; });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) { this.lock(); return; }
      if (e.button === 0) this.firing = true;
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.firing = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.c.yaw -= e.movementX * SENSITIVITY;
      this.c.pitch = Math.max(-1.0, Math.min(0.9, this.c.pitch - e.movementY * SENSITIVITY));
    });
    // If the browser refuses pointer lock, play without it.
    document.addEventListener('pointerlockerror', () => {
      this.locked = true;
      this.onLockChange(true);
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) { this.firing = false; this.keys = {}; }
      this.onLockChange(this.locked);
    });
  }

  lock() {
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* pointer lock unavailable */ }
  }

  update() {
    const c = this.c;
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
    if (k[' ']) c.wantJump = true;

    if (this.interactPressed) {
      this.interactPressed = false;
      this.game.interact(c);
    }

    if (this.firing && c.alive) {
      const weapon = c.weapon;
      const { origin, dir } = this.aimRay();
      // Hold to keep firing the SMG or swinging; other guns fire once per click.
      if (this.game.fire(c, origin, dir) && !AUTO.has(weapon)) this.firing = false;
    }

    const m = this.game.nearbyMachine(c);
    this.game.hud.prompt(m && c.alive && !c.busy && !this.game.intermission
      ? (m.busy ? 'Machine in use' : `<b>E</b> Pull the lever · 🪙 ${m.tier.cost} · ${m.tier.name}`)
      : null);
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
    const head = c.head(new THREE.Vector3());
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(c.pitch, c.yaw, 0, 'YXZ'));
    const offset = CAM_OFFSET.clone().applyQuaternion(q);
    const want = offset.length();

    // Pull the camera in if a wall is in the way.
    const hit = this.game.raycast(head, offset.clone().normalize(), want + 0.3, c, { solidsOnly: true });
    const allowed = hit.hit ? Math.max(0.6, hit.distance - 0.3) : want;
    this.camDist += (allowed - this.camDist) * Math.min(1, dt * (allowed < this.camDist ? 30 : 6));

    this.camera.position.copy(head).addScaledVector(offset.normalize(), this.camDist);
    this.camera.quaternion.copy(q);
    const s = this.game.shake;
    if (s > 0) {
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }
  }
}
