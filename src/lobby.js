// The Royale lobby: you on a neon stage, and everyone in your party standing next to you.
// Like the Look preview, but with room for a whole squad, name tags and the party bus behind.
import * as THREE from 'three';
import { createCharacter } from './character.js';

const SPOTS = [0, -1.5, 1.5, -3, 3, -4.4, 4.4, -5.7];

function nameSprite(text, lead, you) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.font = "52px 'Luckiest Guy', 'Arial Black', sans-serif";
  ctx.lineWidth = 12;
  ctx.strokeStyle = '#1b0f2b';
  ctx.fillStyle = you ? '#ffd23f' : '#fff4e0';
  const label = `${lead ? '👑 ' : ''}${text}`;
  ctx.strokeText(label, 256, 70);
  ctx.fillText(label, 256, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  s.scale.set(1.9, 0.48, 1);
  s.position.y = 2.55;
  return s;
}

// A neon party bus with balloon wings: what you'll ride over Jackpot Island.
export function buildPartyBus() {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshBasicMaterial({ color: c });
  const body = new THREE.Mesh(new THREE.BoxGeometry(10, 3.2, 3.6), mat(0xff3fa4));
  const roof = new THREE.Mesh(new THREE.BoxGeometry(9.4, 0.5, 3.4), mat(0xffd23f));
  roof.position.y = 1.85;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(10.05, 0.5, 3.65), mat(0x2ee6d6));
  stripe.position.y = -0.4;
  g.add(body, roof, stripe);
  for (let i = -3; i <= 3; i++) {
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat(0xfff4b0));
      w.position.set(i * 1.3, 0.6, side * 1.81);
      if (side < 0) w.rotation.y = Math.PI;
      g.add(w);
    }
  }
  // Balloons holding it up: a big gold one and a bunch of colorful ones.
  const colors = [0xffd23f, 0xc77dff, 0x2ee6d6, 0xff7b39, 0x5ee27a];
  for (let i = 0; i < 7; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(i ? 1.5 : 3, 14, 10), mat(colors[i % colors.length]));
    const a = (i / 6) * Math.PI * 2;
    b.position.set(i ? Math.cos(a) * 3.6 : 0, i ? 6.5 + (i % 2) : 7.5, i ? Math.sin(a) * 2.2 : 0);
    b.scale.y = 1.15;
    g.add(b);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, b.position.y - 2), mat(0xffffff));
    rope.position.set(b.position.x / 2, (b.position.y + 2) / 2, b.position.z / 2);
    rope.lookAt(b.position.x, b.position.y + 50, b.position.z);
    rope.rotation.x += Math.PI / 2;
    g.add(rope);
  }
  // A big sign on the side.
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1b0f2b';
  ctx.fillRect(0, 0, 512, 128);
  ctx.font = "70px 'Luckiest Guy', 'Arial Black', sans-serif";
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd23f';
  ctx.fillText('HIGH ROLLER', 256, 92);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  for (const side of [-1, 1]) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), new THREE.MeshBasicMaterial({ map: tex }));
    sign.position.set(0, -0.9, side * 1.83);
    if (side < 0) sign.rotation.y = Math.PI;
    g.add(sign);
  }
  return g;
}

export class LobbyStage {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'lobbycanvas';
    this.ok = true;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
    } catch (e) { this.ok = false; return; }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    const scene = (this.scene = new THREE.Scene());
    scene.add(new THREE.HemisphereLight(0xfff1e0, 0x5b3a7a, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(2, 4, -3);
    scene.add(sun);
    // The stage: a round podium with a glowing rim, and light beams behind.
    const stage = new THREE.Mesh(new THREE.CylinderGeometry(6.4, 6.8, 0.5, 48), new THREE.MeshLambertMaterial({ color: 0x2a1748 }));
    stage.position.y = -0.25;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(6.6, 0.08, 8, 64), new THREE.MeshBasicMaterial({ color: 0xff3fa4 }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.01;
    scene.add(stage, rim);
    this.beams = [];
    for (let i = 0; i < 6; i++) {
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.9, 14, 12, 1, true), new THREE.MeshBasicMaterial({ color: [0xff3fa4, 0xffd23f, 0x2ee6d6][i % 3], transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
      beam.position.set(-7.5 + i * 3, 7, 6);
      this.beams.push(beam);
      scene.add(beam);
    }
    this.bus = buildPartyBus();
    this.bus.scale.setScalar(0.55);
    this.bus.position.set(0, 5.6, 18);
    this.bus.rotation.y = Math.PI;
    scene.add(this.bus);
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 80);
    this.chars = [];
    this.key = '';
    this.t = 0;
    this.running = false;
  }

  // members: [{ id, name, look, lead, you }]. You always stand in the middle.
  setMembers(members) {
    if (!this.ok) return;
    const key = JSON.stringify(members.map((m) => [m.id, m.name, m.look, m.lead, m.you]));
    if (key === this.key) return;
    this.key = key;
    for (const c of this.chars) {
      this.scene.remove(c.root);
      c.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    const list = [...members].sort((a, b) => (b.you ? 1 : 0) - (a.you ? 1 : 0)).slice(0, SPOTS.length);
    this.chars = list.map((m, i) => {
      const ch = createCharacter(m.look || {});
      ch.root.position.set(-SPOTS[i], 0, Math.abs(SPOTS[i]) * 0.25);
      ch.root.add(nameSprite(m.name, m.lead, m.you));
      ch.phase = i * 1.7;
      ch.hop = 0;
      this.scene.add(ch.root);
      return ch;
    });
    // Frame the whole squad.
    const n = this.chars.length;
    const wide = n <= 1 ? 0 : Math.max(...SPOTS.slice(0, n).map(Math.abs));
    this.camera.position.set(0, 2.3, -8.4 - wide * 1.3);
    this.camera.lookAt(0, 1.55, 0);
  }

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
      this.t += dt;
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      const pr = this.renderer.getPixelRatio();
      if (w && h && (this.canvas.width !== Math.round(w * pr) || this.canvas.height !== Math.round(h * pr))) {
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
      }
      for (const ch of this.chars) {
        // Shift around, look about, and every so often a happy little hop.
        const p = this.t + ch.phase;
        ch.root.rotation.y = Math.sin(p * 0.6) * 0.35;
        if (ch.hop <= 0 && Math.random() < dt * 0.15) ch.hop = 1;
        ch.hop = Math.max(0, ch.hop - dt * 2.2);
        const hopY = Math.sin(ch.hop * Math.PI) * 0.45;
        ch.animate(dt, { speed: 0, forward: 0, side: 0, onGround: hopY < 0.01, pitch: 0, dead: false, showTag: false });
        ch.root.position.y = hopY;
      }
      for (let i = 0; i < this.beams.length; i++) this.beams[i].rotation.z = Math.sin(this.t * 0.7 + i) * 0.35;
      this.bus.position.x = Math.sin(this.t * 0.25) * 9;
      this.bus.position.y = 5.6 + Math.sin(this.t * 0.8) * 0.4;
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}
