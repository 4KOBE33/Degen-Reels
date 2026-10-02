// A turntable preview of your bean for the Look tab. Drag to spin it.
import * as THREE from 'three';
import { createCharacter } from './character.js';
import { RARITIES } from './config.js';

export class LookPreview {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'lookcanvas';
    this.ok = true;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
    } catch (e) { this.ok = false; return; }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xfff1e0, 0x5b3a7a, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(2, 4, -3);
    this.scene.add(sun);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.1, 32), new THREE.MeshBasicMaterial({ color: 0x1b0f2b, transparent: true, opacity: 0.45 }));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    this.camera.position.set(0, 1.45, -5.2);
    this.camera.lookAt(0, 1.05, 0);
    this.char = null;
    this.spin = 0.35;
    this.drag = null;
    this.running = false;
    this.canvas.addEventListener('pointerdown', (e) => { this.drag = e.clientX; this.canvas.setPointerCapture(e.pointerId); });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.drag === null) return;
      this.spin += (e.clientX - this.drag) * 0.012;
      this.drag = e.clientX;
    });
    this.canvas.addEventListener('pointerup', () => { this.drag = null; });
  }

  // Rebuild the character when the look changes. `gun` is the item to hold, if any.
  setLook(look, gun = null) {
    if (!this.ok) return;
    const key = JSON.stringify([look, gun && gun.kind, gun && gun.rarity]);
    if (key === this.key) return;
    this.key = key;
    if (this.char) {
      this.scene.remove(this.char.root);
      this.char.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    this.char = createCharacter(look);
    if (gun) this.char.setWeapon(gun.kind, RARITIES[gun.rarity || 0].color);
    this.scene.add(this.char.root);
  }

  // Put the canvas in `slot` and keep it animating while it's on screen.
  mount(slot) {
    if (!this.ok || !slot) return;
    slot.appendChild(this.canvas);
    if (this.running) return;
    this.running = true;
    let last = performance.now();
    const tick = (now) => {
      if (!this.canvas.isConnected || this.canvas.offsetParent === null) { this.running = false; return; }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      if (w && h && (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio()) || this.canvas.height !== Math.round(h * this.renderer.getPixelRatio()))) {
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
      }
      if (this.drag === null) this.spin += dt * 0.5;
      if (this.char) {
        this.char.root.rotation.y = this.spin;
        this.char.animate(dt, { speed: 0, forward: 0, side: 0, onGround: true, pitch: 0, dead: false, showTag: false });
      }
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}
