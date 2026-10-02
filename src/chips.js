// Physical poker chips: the raid's currency. Enemies and containers spill them; walk over to grab.
import * as THREE from 'three';
import { toon, outline } from './toon.js';
import { sfx } from './audio.js';

// Casino denominations: the color tells you what it's worth.
export const DENOMINATIONS = [
  { value: 100, color: '#1b0f2b', edge: '#ffd23f', name: 'black' },
  { value: 25, color: '#1f9d55', edge: '#fff6e0', name: 'green' },
  { value: 5, color: '#e63946', edge: '#fff6e0', name: 'red' },
  { value: 1, color: '#f1f5f9', edge: '#4dabff', name: 'white' },
];

const chipGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.08, 18);

// Top/bottom face: colored disc, striped edge, and the value in the middle.
function faceTexture(d) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const c = canvas.getContext('2d');
  c.fillStyle = d.color;
  c.beginPath();
  c.arc(64, 64, 64, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = d.edge;
  c.lineWidth = 16;
  c.setLineDash([18, 14]);
  c.beginPath();
  c.arc(64, 64, 54, 0, Math.PI * 2);
  c.stroke();
  c.setLineDash([]);
  c.lineWidth = 4;
  c.beginPath();
  c.arc(64, 64, 36, 0, Math.PI * 2);
  c.stroke();
  c.fillStyle = d.edge;
  c.font = "bold 40px 'Luckiest Guy', 'Arial Black', sans-serif";
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(String(d.value), 64, 68);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const MATS = new Map();
function chipMaterials(d) {
  if (!MATS.has(d.value)) {
    const face = toon(0xffffff, { map: faceTexture(d) });
    MATS.set(d.value, [toon(new THREE.Color(d.color).getHex()), face, face]);
  }
  return MATS.get(d.value);
}

// Break an amount into the fewest chips: 100s, then 25s, then 5s, then 1s.
export function breakIntoChips(amount) {
  const out = [];
  let left = Math.round(amount);
  for (const d of DENOMINATIONS) {
    while (left >= d.value && out.length < 40) {
      out.push(d);
      left -= d.value;
    }
  }
  if (left > 0 && out.length) out[out.length - 1] = { ...out[out.length - 1], value: out[out.length - 1].value + left };
  return out;
}

const MAX_CHIPS = 400;

export class ChipSystem {
  constructor(raid) {
    this.raid = raid;
    this.list = [];
  }

  // Throws `amount` worth of chips out from `origin`. Owner can't re-grab them for a moment.
  spawnBurst(origin, amount, owner, { toward = null, speed = 4 } = {}) {
    if (amount <= 0) return;
    // Party: everyone gets their own copy of the chips to grab.
    if (this.raid.isHost) this.raid.net.ev({ k: 'ch', n: amount, sp: speed }, origin);
    for (const d of breakIntoChips(amount)) {
      const value = d.value;
      const mesh = new THREE.Mesh(chipGeo, chipMaterials(DENOMINATIONS.find((x) => x.name === d.name)));
      mesh.castShadow = true;
      outline(mesh, 0.02);
      mesh.position.copy(origin);
      this.raid.scene.add(mesh);
      const a = Math.random() * Math.PI * 2;
      const vel = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(speed * (0.5 + Math.random()));
      if (toward) {
        const dir = toward.clone().sub(origin).setY(0).normalize();
        vel.addScaledVector(dir, speed * 1.2);
      }
      vel.y = 4 + Math.random() * 4;
      this.list.push({
        mesh,
        vel,
        value,
        owner,
        lockUntil: 1.0,
        age: 0,
        spin: new THREE.Vector3(Math.random() * 12, Math.random() * 12, 0),
        resting: false,
      });
    }
    while (this.list.length > MAX_CHIPS) this.remove(0);
  }

  remove(i) {
    this.raid.scene.remove(this.list[i].mesh);
    this.list.splice(i, 1);
  }

  clear() {
    while (this.list.length) this.remove(0);
  }

  update(dt) {
    const map = this.raid.map;
    const people = this.raid.combatants;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const chip = this.list[i];
      const p = chip.mesh.position;
      chip.age += dt;

      // Magnet toward nearby players once it's been on the ground a moment.
      let collector = null;
      for (const c of people) {
        if (!c.alive) continue;
        if (c === chip.owner && chip.age < chip.lockUntil) continue;
        const dx = c.pos.x - p.x;
        const dy = c.pos.y + 0.6 - p.y;
        const dz = c.pos.z - p.z;
        const d = Math.hypot(dx, dy, dz);
        if (d < 0.9) { collector = c; break; }
        if (d < 3 && chip.age > 0.5) {
          chip.vel.x += (dx / d) * 40 * dt;
          chip.vel.z += (dz / d) * 40 * dt;
          chip.vel.y += (dy / d) * 40 * dt;
          chip.resting = false;
        }
      }
      if (collector) {
        collector.chips += chip.value;
        if (collector.isPlayer) {
          sfx.pickup(chip.value);
          if (chip.value >= 25) this.raid.fx.number(p.clone().setY(p.y + 1.2), `+${chip.value}`, chip.value >= 100 ? '#ffd23f' : '#5ee27a', 0.8);
        }
        this.remove(i);
        continue;
      }

      if (chip.age > 45) {
        this.remove(i);
        continue;
      }
      if (chip.resting) continue;

      chip.vel.y -= 20 * dt;
      p.addScaledVector(chip.vel, dt);
      chip.mesh.rotation.x += chip.spin.x * dt;
      chip.mesh.rotation.z += chip.spin.y * dt;

      const ground = map.groundAt(p.x, p.z, p.y) + 0.035;
      if (p.y <= ground) {
        p.y = ground;
        if (chip.vel.y < -2) {
          chip.vel.y *= -0.35;
          chip.vel.x *= 0.6;
          chip.vel.z *= 0.6;
          chip.spin.multiplyScalar(0.5);
        } else {
          chip.vel.set(0, 0, 0);
          chip.mesh.rotation.set(0, chip.mesh.rotation.y, 0);
          chip.resting = true;
        }
      }
      // Keep chips inside the room.
      p.x = Math.max(-map.half + 1, Math.min(map.half - 1, p.x));
      p.z = Math.max(-map.half + 1, Math.min(map.half - 1, p.z));
    }
  }
}
