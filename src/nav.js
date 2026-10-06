// Pathfinding for bots: a 2m walkability grid built lazily from the map's colliders,
// A* over it, then the path is pulled tight so bots run straight lines instead of zigzags.
import * as THREE from 'three';

const CELL = 2;
const MAX_EXPANSIONS = 7000;
const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];

// A tiny binary heap keyed on f.
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(n) {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

export class NavGrid {
  constructor(map) {
    this.map = map;
    this.cache = new Map();
  }

  key(cx, cz) { return cx * 100003 + cz; }
  toCell(v) { return Math.round(v / CELL); }

  walkable(cx, cz) {
    const k = this.key(cx, cz);
    let w = this.cache.get(k);
    if (w === undefined) {
      w = this.map.isFree(cx * CELL, cz * CELL, 0.75);
      this.cache.set(k, w);
    }
    return w;
  }

  // The closest walkable cell to a point (goals are often right next to a crate or wall).
  nearestWalkable(cx, cz) {
    if (this.walkable(cx, cz)) return [cx, cz];
    for (let r = 1; r <= 4; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) === r && this.walkable(cx + dx, cz + dz)) return [cx + dx, cz + dz];
        }
      }
    }
    return null;
  }

  // Straight walkable line between two cells? Checked on the grid first (quick), then along the
  // actual line with room for a body, so pulled-tight paths don't clip wall corners.
  clear(ax, az, bx, bz) {
    const n = Math.max(Math.abs(bx - ax), Math.abs(bz - az)) * 2;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (!this.walkable(Math.round(ax + (bx - ax) * t), Math.round(az + (bz - az) * t))) return false;
    }
    const x0 = ax * CELL;
    const z0 = az * CELL;
    const x1 = bx * CELL;
    const z1 = bz * CELL;
    const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.6);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (!this.map.isFree(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, 0.6)) return false;
    }
    return true;
  }

  // World-space waypoints from `from` to `to`, or null if there's no way there.
  find(from, to) {
    const s = this.nearestWalkable(this.toCell(from.x), this.toCell(from.z));
    const g = this.nearestWalkable(this.toCell(to.x), this.toCell(to.z));
    if (!s || !g) return null;
    const [sx, sz] = s;
    const [gx, gz] = g;
    if (this.clear(sx, sz, gx, gz)) return [new THREE.Vector3(to.x, 0, to.z)];
    const open = new Heap();
    const came = new Map();
    const cost = new Map();
    const h = (x, z) => Math.hypot(gx - x, gz - z);
    const sk = this.key(sx, sz);
    cost.set(sk, 0);
    open.push({ x: sx, z: sz, f: h(sx, sz) });
    let found = null;
    let best = { x: sx, z: sz, h: h(sx, sz) };
    let n = 0;
    while (open.size && n < MAX_EXPANSIONS) {
      const cur = open.pop();
      n++;
      if (cur.x === gx && cur.z === gz) { found = cur; break; }
      const cc = cost.get(this.key(cur.x, cur.z));
      const ch = h(cur.x, cur.z);
      if (ch < best.h) best = { x: cur.x, z: cur.z, h: ch };
      for (const [dx, dz, w] of DIRS) {
        const nx = cur.x + dx;
        const nz = cur.z + dz;
        if (!this.walkable(nx, nz)) continue;
        // No cutting corners through walls.
        if (dx && dz && (!this.walkable(cur.x + dx, cur.z) || !this.walkable(cur.x, cur.z + dz))) continue;
        const nk = this.key(nx, nz);
        const nc = cc + w;
        if (cost.has(nk) && cost.get(nk) <= nc) continue;
        cost.set(nk, nc);
        came.set(nk, [cur.x, cur.z]);
        open.push({ x: nx, z: nz, f: nc + h(nx, nz) * 1.15 });
      }
    }
    // Didn't reach it: head for the closest point we did reach.
    const end = found || best;
    const cells = [];
    let cx = end.x;
    let cz = end.z;
    while (!(cx === sx && cz === sz)) {
      cells.push([cx, cz]);
      const prev = came.get(this.key(cx, cz));
      if (!prev) break;
      [cx, cz] = prev;
    }
    cells.reverse();
    if (!cells.length) return null;
    // Pull the path tight: skip every waypoint we can see past.
    const out = [];
    let ax = sx;
    let az = sz;
    let i = 0;
    while (i < cells.length) {
      let j = cells.length - 1;
      while (j > i && !this.clear(ax, az, cells[j][0], cells[j][1])) j--;
      out.push(new THREE.Vector3(cells[j][0] * CELL, 0, cells[j][1] * CELL));
      [ax, az] = cells[j];
      i = j + 1;
    }
    if (found) out[out.length - 1] = new THREE.Vector3(to.x, 0, to.z);
    // Only got partway (it's behind a locked door, say): whoever asked should pick somewhere else.
    out.partial = !found;
    return out;
  }
}
