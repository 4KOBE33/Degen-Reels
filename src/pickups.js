// Items lying in the world. Rare ones shoot a colored beam into the sky so you can spot them.
import * as THREE from 'three';
import { buildGun } from './character.js';
import { RARITIES } from './config.js';
import { itemInfo, itemTitle, isGun } from './items.js';

const iconCache = new Map();
function iconTexture(icon) {
  if (iconCache.has(icon)) return iconCache.get(icon);
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const c = canvas.getContext('2d');
  c.fillStyle = '#fff6e0';
  c.strokeStyle = '#1b0f2b';
  c.lineWidth = 8;
  c.beginPath();
  c.arc(64, 64, 52, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  c.font = '64px sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(icon, 64, 70);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  iconCache.set(icon, tex);
  return tex;
}

const ringGeo = new THREE.RingGeometry(0.5, 0.7, 24);
const beamGeo = new THREE.CylinderGeometry(0.12, 0.3, 14, 8, 1, true);
beamGeo.translate(0, 7, 0);

export class ItemPickup {
  constructor(raid, pos, item, launchFrom = null) {
    this.raid = raid;
    this.item = item;
    this.spot = new THREE.Vector3(pos.x, pos.y || 0, pos.z);
    this.range = 2.2;
    this.age = 0;
    const info = itemInfo(item);
    const color = new THREE.Color(info.css);

    this.group = new THREE.Group();
    this.group.position.copy(this.spot);
    if (isGun(item)) {
      this.model = buildGun(item.kind, RARITIES[item.rarity].color);
      this.model.scale.setScalar(1.5);
    } else {
      this.model = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTexture(info.icon) }));
      this.model.scale.setScalar(0.7);
    }
    this.model.position.y = 0.8;
    this.group.add(this.model);

    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    this.group.add(ring);
    if (info.rarity >= 2) {
      const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      this.group.add(beam);
    }
    raid.scene.add(this.group);
    // Pop out of the machine/crate in a little arc instead of appearing in place.
    this.launch = launchFrom ? { from: new THREE.Vector3(launchFrom.x, 1.0, launchFrom.z), t: 0 } : null;
    if (this.launch) this.group.position.copy(this.launch.from);
  }

  prompt() {
    return `<b>E</b> Take <span style="color:${itemInfo(this.item).css}">${itemTitle(this.item)}</span>`;
  }

  use(c) {
    return this.raid.takeItem(c, this);
  }

  update(dt) {
    this.age += dt;
    if (this.launch) {
      const L = this.launch;
      L.t = Math.min(1, L.t + dt / 0.45);
      this.group.position.lerpVectors(L.from, this.spot, L.t);
      this.group.position.y = THREE.MathUtils.lerp(L.from.y, this.spot.y, L.t) + Math.sin(L.t * Math.PI) * 1.4;
      if (L.t >= 1) { this.group.position.copy(this.spot); this.launch = null; }
    }
    this.model.position.y = 0.8 + Math.sin(this.age * 3) * 0.12;
    if (isGun(this.item)) this.model.rotation.y += dt * 1.5;
  }

  remove() {
    this.raid.scene.remove(this.group);
  }
}
