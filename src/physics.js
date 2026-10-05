// Tiny character physics: gravity, solid boxes/cylinders you can bump into or stand on.
const STEP = 0.3;

// Colliders are { type: 'box', minX, maxX, minZ, maxZ, top } or { type: 'circle', x, z, r, top }.
// An optional `bottom` lifts one off the ground (an upstairs floor or wall): you walk under it.
// A box with `ramp` has a sloped top (stairs): you glide up and down it instead of hopping steps.

// How high the top of a collider is at (x, z).
export function topAt(c, x, z) {
  const r = c.ramp;
  if (!r) return c.top;
  const t = Math.max(0, Math.min(1, (z - r.z0) / (r.z1 - r.z0)));
  return Math.max(r.y0, Math.min(r.y1, r.y0 + r.rise * (t * r.steps + 0.5)));
}
export function resolve(pos, vel, radius, map) {
  let ground = 0;
  for (const c of map.near(pos.x, pos.z)) {
    if (c.rayOnly || c.disabled) continue;
    // Something overhead (an upper floor): only matters once your feet are up there.
    if (c.bottom && pos.y < c.bottom - 0.05) continue;
    if (c.type === 'box') {
      const inside = pos.x > c.minX && pos.x < c.maxX && pos.z > c.minZ && pos.z < c.maxZ;
      const nx = Math.max(c.minX, Math.min(pos.x, c.maxX));
      const nz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
      const dx = pos.x - nx;
      const dz = pos.z - nz;
      const d2 = dx * dx + dz * dz;
      if (!inside && d2 >= radius * radius) continue;
      const top = c.ramp ? topAt(c, nx, nz) : c.top;
      // Under this part of a stair flight that hangs in the air: walk on under it.
      if (c.ramp && c.ramp.floating && pos.y < top - 0.65) continue;
      if (pos.y >= top - STEP) {
        if (inside || d2 < radius * radius * 0.36) ground = Math.max(ground, top);
        continue;
      }
      if (inside) {
        const left = pos.x - c.minX;
        const right = c.maxX - pos.x;
        const back = pos.z - c.minZ;
        const front = c.maxZ - pos.z;
        const m = Math.min(left, right, back, front);
        if (m === left) pos.x = c.minX - radius;
        else if (m === right) pos.x = c.maxX + radius;
        else if (m === back) pos.z = c.minZ - radius;
        else pos.z = c.maxZ + radius;
      } else {
        const d = Math.sqrt(d2);
        pos.x = nx + (dx / d) * radius;
        pos.z = nz + (dz / d) * radius;
      }
    } else {
      const dx = pos.x - c.x;
      const dz = pos.z - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + radius;
      if (d >= min) continue;
      if (pos.y >= c.top - STEP) {
        if (d < c.r + radius * 0.6) ground = Math.max(ground, c.top);
        continue;
      }
      const nx = d > 1e-4 ? dx / d : 1;
      const nz = d > 1e-4 ? dz / d : 0;
      pos.x = c.x + nx * min;
      pos.z = c.z + nz * min;
    }
  }

  const maxX = map.half - 1 - radius;
  const maxZ = map.half - 1 - radius;
  pos.x = Math.max(-maxX, Math.min(maxX, pos.x));
  pos.z = Math.max(-maxZ, Math.min(maxZ, pos.z));

  let landed = 0;
  let onGround = false;
  if (pos.y <= ground) {
    pos.y = ground;
    if (vel.y < 0) {
      landed = -vel.y;
      vel.y = 0;
    }
    onGround = true;
  }
  return { onGround, landed };
}
