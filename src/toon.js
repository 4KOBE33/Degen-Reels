// Cartoon look: 3-step toon shading plus thick ink outlines.
import * as THREE from 'three';

export const INK = 0x1b0f2b;

const gradient = new THREE.DataTexture(new Uint8Array([110, 185, 255]), 3, 1, THREE.RedFormat);
gradient.minFilter = THREE.NearestFilter;
gradient.magFilter = THREE.NearestFilter;
gradient.needsUpdate = true;

const shared = new Map();

// Shared toon material per color. Pass `unique: true` for one you'll mutate (e.g. hit flashes).
export function toon(color, { unique = false, ...extra } = {}) {
  const key = Object.keys(extra).length ? null : color;
  if (!unique && key !== null && shared.has(key)) return shared.get(key);
  const m = new THREE.MeshToonMaterial({ color, gradientMap: gradient, ...extra });
  if (!unique && key !== null) shared.set(key, m);
  return m;
}

const outlineMat = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });

// Inverted-hull outline: a slightly bigger black copy rendered from the inside.
export function outline(mesh, thickness = 0.035) {
  const g = mesh.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  const size = new THREE.Vector3();
  g.boundingBox.getSize(size);
  const hull = new THREE.Mesh(g, outlineMat);
  hull.scale.set(
    1 + (2 * thickness) / Math.max(size.x, 1e-3),
    1 + (2 * thickness) / Math.max(size.y, 1e-3),
    1 + (2 * thickness) / Math.max(size.z, 1e-3),
  );
  hull.raycast = () => {};
  mesh.add(hull);
  return mesh;
}

// A toon mesh with an outline and shadows, in one call.
export function part(geometry, color, { ink = 0.035, shadow = true } = {}) {
  const material = color && color.isMaterial ? color : toon(color);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  if (ink) outline(mesh, ink);
  return mesh;
}

export function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  draw(ctx, width, height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.userData = { canvas, ctx };
  return tex;
}
