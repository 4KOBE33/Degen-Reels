// Short-lived visual effects: tracers, puffs, explosions, confetti and damage numbers.
import * as THREE from 'three';
import { toon, INK } from './toon.js';

const tracerGeo = new THREE.BoxGeometry(0.06, 0.06, 1);
tracerGeo.translate(0, 0, 0.5);
const sphereGeo = new THREE.SphereGeometry(1, 12, 8);
const ringGeo = new THREE.TorusGeometry(1, 0.08, 6, 32);
const confettiGeo = new THREE.PlaneGeometry(0.16, 0.1);
const CONFETTI = [0xffd23f, 0xff5d5d, 0x4dabff, 0x5ee27a, 0xff7eb6, 0xc77dff];

export class Fx {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
  }

  add(obj, life, update) {
    this.scene.add(obj);
    this.items.push({ obj, life, max: life, update });
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life -= dt;
      const t = 1 - it.life / it.max;
      if (it.life <= 0) {
        this.scene.remove(it.obj);
        if (it.obj.material && it.obj.material.userData.disposable) {
          if (it.obj.material.map) it.obj.material.map.dispose();
          it.obj.material.dispose();
        }
        this.items.splice(i, 1);
        continue;
      }
      if (it.update) it.update(it.obj, t, dt);
    }
  }

  fadeMaterial(color) {
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false });
    m.userData.disposable = true;
    return m;
  }

  tracer(from, to, color = 0xffe066) {
    const len = from.distanceTo(to);
    if (len < 0.1) return;
    const mesh = new THREE.Mesh(tracerGeo, this.fadeMaterial(color));
    mesh.position.copy(from);
    mesh.lookAt(to);
    mesh.scale.set(1, 1, len);
    this.add(mesh, 0.09, (o, t) => { o.material.opacity = 1 - t; o.scale.x = o.scale.y = 1 - t * 0.7; });
  }

  puff(pos, color = 0xfff6e0, size = 0.18) {
    const mesh = new THREE.Mesh(sphereGeo, this.fadeMaterial(color));
    mesh.position.copy(pos);
    this.add(mesh, 0.25, (o, t) => { o.scale.setScalar(size * (0.5 + t * 1.5)); o.material.opacity = 1 - t; });
  }

  muzzleFlash(pos) {
    const mesh = new THREE.Mesh(sphereGeo, this.fadeMaterial(0xffd23f));
    mesh.position.copy(pos);
    mesh.scale.setScalar(0.22);
    this.add(mesh, 0.06, (o, t) => { o.material.opacity = 1 - t; });
  }

  explosion(pos, radius) {
    const ball = new THREE.Mesh(sphereGeo, toon(0xff9f43, { unique: true, transparent: true, emissive: 0xff6a00, emissiveIntensity: 0.6 }));
    ball.material.userData.disposable = true;
    ball.position.copy(pos);
    this.add(ball, 0.45, (o, t) => { o.scale.setScalar(radius * (0.3 + Math.sqrt(t) * 0.8)); o.material.opacity = 1 - t * t; });
    const core = new THREE.Mesh(sphereGeo, this.fadeMaterial(0xfff1b8));
    core.position.copy(pos);
    this.add(core, 0.25, (o, t) => { o.scale.setScalar(radius * 0.5 * (1 - t)); });
    const ring = new THREE.Mesh(ringGeo, this.fadeMaterial(INK));
    ring.position.copy(pos);
    ring.rotation.x = Math.PI / 2;
    this.add(ring, 0.4, (o, t) => { o.scale.setScalar(radius * (0.4 + t)); o.material.opacity = 1 - t; });
    for (let i = 0; i < 8; i++) {
      const smoke = new THREE.Mesh(sphereGeo, this.fadeMaterial(0x6b6b7b));
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize();
      smoke.position.copy(pos);
      this.add(smoke, 0.8 + Math.random() * 0.4, (o, t, dt) => {
        o.position.addScaledVector(dir, dt * radius * 1.2 * (1 - t));
        o.scale.setScalar(0.4 + t * 0.9);
        o.material.opacity = 0.7 * (1 - t);
      });
    }
  }

  confetti(pos, count = 60) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.MeshBasicMaterial({ color: CONFETTI[i % CONFETTI.length], side: THREE.DoubleSide });
      m.userData.disposable = true;
      const piece = new THREE.Mesh(confettiGeo, m);
      piece.position.copy(pos);
      const vel = new THREE.Vector3((Math.random() - 0.5) * 7, 4 + Math.random() * 6, (Math.random() - 0.2) * 7);
      const spin = new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10);
      this.add(piece, 2.5 + Math.random(), (o, t, dt) => {
        vel.y -= 9 * dt;
        vel.multiplyScalar(1 - dt * 1.5);
        o.position.addScaledVector(vel, dt);
        if (o.position.y < 0.02) { o.position.y = 0.02; vel.set(0, 0, 0); }
        o.rotation.x += spin.x * dt;
        o.rotation.y += spin.y * dt;
      });
    }
  }

  // Floating "-14" style numbers.
  number(pos, text, color = '#ff5d5d', size = 1) {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 160;
    const c = canvas.getContext('2d');
    c.scale(2, 2); // 2x for sharp text
    c.font = "56px 'Luckiest Guy', 'Arial Black', sans-serif";
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineJoin = 'round';
    c.lineWidth = 10;
    c.strokeStyle = '#1b0f2b';
    c.fillStyle = color;
    c.strokeText(text, 80, 42);
    c.fillText(text, 80, 42);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    mat.userData.disposable = true;
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 20;
    sprite.position.copy(pos);
    sprite.position.x += (Math.random() - 0.5) * 0.4;
    const base = sprite.position.y;
    this.add(sprite, 0.8, (o, t) => {
      o.position.y = base + t * 1.2;
      const pop = t < 0.15 ? 0.6 + (t / 0.15) * 0.6 : 1.2 - (t - 0.15) * 0.4;
      o.scale.set(1.2 * pop * size, 0.6 * pop * size, 1);
      o.material.opacity = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
    });
  }
}
