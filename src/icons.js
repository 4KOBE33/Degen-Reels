// Little pictures of every gun, rendered once from the same 3D models you hold in a raid.
import * as THREE from 'three';
import { buildGun } from './character.js';
import { RARITIES } from './config.js';
import { isGun, itemInfo } from './items.js';

const W = 160;
const H = 80;
const cache = new Map();
let rig = null;

function setup() {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  let renderer = null;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  } catch (e) { return null; }
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8070a0, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(2, 3, 2);
  scene.add(sun);
  const camera = new THREE.OrthographicCamera(-1, 1, 0.5, -0.5, 0.1, 20);
  return { renderer, scene, camera };
}

// A data URL for this gun kind and rarity, or null if WebGL isn't available.
export function gunIcon(kind, rarity = 0) {
  const key = `${kind}:${rarity}`;
  if (cache.has(key)) return cache.get(key);
  if (rig === null) rig = setup() || false;
  if (!rig) { cache.set(key, null); return null; }
  const { renderer, scene, camera } = rig;
  const gun = buildGun(kind, RARITIES[rarity] ? RARITIES[rarity].color : null);
  // Side-on, muzzle pointing right, tilted a touch so it doesn't look flat.
  gun.rotation.set(0.12, -Math.PI / 2, 0);
  gun.rotateX(-0.08);
  scene.add(gun);
  gun.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(gun);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x / (W / H), size.y, 0.3) * 0.6;
  camera.left = -span * (W / H);
  camera.right = span * (W / H);
  camera.top = span;
  camera.bottom = -span;
  camera.position.set(center.x, center.y + 0.05, center.z + 5);
  camera.lookAt(center.x, center.y, center.z);
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(gun);
  gun.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  cache.set(key, url);
  return url;
}

// The icon for any item as HTML: a picture for guns, the emoji for everything else.
export function iconHtml(item, cls = 'gicon') {
  const info = itemInfo(item);
  if (isGun(item) && item.kind !== 'fists') {
    const url = gunIcon(item.kind, item.rarity || 0);
    if (url) return `<img class="${cls}" src="${url}" alt="${info.name}">`;
  }
  return info.icon;
}
