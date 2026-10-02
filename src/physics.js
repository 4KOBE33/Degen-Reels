// Tiny character physics: gravity, solid boxes/cylinders you can bump into or stand on.
const STEP = 0.3;

// Colliders are { type: 'box', minX, maxX, minZ, maxZ, top } or { type: 'circle', x, z, r, top }.
export function resolve(pos, vel, radius, map) {
  let ground = 0;
  for (const c of map.near(pos.x, pos.z)) {
    if (c.rayOnly || c.disabled) continue;
    if (c.type === 'box') {
      const inside = pos.x > c.minX && pos.x < c.maxX && pos.z > c.minZ && pos.z < c.maxZ;
      const nx = Math.max(c.minX, Math.min(pos.x, c.maxX));
      const nz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
      const dx = pos.x - nx;
      const dz = pos.z - nz;
      const d2 = dx * dx + dz * dz;
      if (!inside && d2 >= radius * radius) continue;
      if (pos.y >= c.top - STEP) {
        if (inside || d2 < radius * radius * 0.36) ground = Math.max(ground, c.top);
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
