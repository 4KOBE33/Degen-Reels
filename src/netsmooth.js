// Smooth movement for anything driven over the network (friends, and everything on a client's
// screen). Updates arrive 12-15 times a second and never evenly, so instead of chasing the newest
// position we draw each actor a fixed moment in the past and glide between the updates on either
// side of it. Each update is stamped with the sender's own clock, so a late packet doesn't make
// anyone stutter. If updates stop coming we keep them moving for a moment, then hold still.
import * as THREE from 'three';

export const DELAY = 120; // ms behind the newest update we draw people
const MAX_EXTRAPOLATE = 180; // ms we'll guess ahead when updates are late
const KEEP = 12; // samples kept per actor
const SNAP_DIST = 12; // further than this from where we're drawing them: just put them there

// Per-sender clock offset (local time minus their time), tracked from the quickest packets.
const clocks = new Map();
export function localTime(from, t) {
  const now = performance.now();
  if (!Number.isFinite(t)) return now;
  const off = now - t;
  const prev = clocks.get(from);
  // Take the fastest packet we've seen as the true offset, drifting slowly so clock skew and
  // route changes don't leave us stuck.
  const next = prev === undefined || off < prev ? off : prev + (off - prev) * 0.01;
  clocks.set(from, next);
  return t + next;
}
export function forgetClock(from) { clocks.delete(from); }

// Add an update (time in local ms).
export function pushSample(actor, t, x, y, z, yaw) {
  const buf = (actor.netBuf ||= []);
  const last = buf[buf.length - 1];
  if (last && t <= last.t) {
    // Out of order or a duplicate: replace if it's the same moment, otherwise ignore.
    if (t === last.t) Object.assign(last, { x, y, z, yaw });
    return;
  }
  // They stood still for a while (we only hear about still actors now and then): start the
  // move from where they were just before this update, not from that old update.
  if (last && t - last.t > 300) buf.push({ t: t - 85, x: last.x, y: last.y, z: last.z, yaw: last.yaw });
  buf.push({ t, x, y, z, yaw });
  if (buf.length > KEEP) buf.splice(0, buf.length - KEEP);
}

const lerpAngle = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

// Where to draw them right now. Writes into `out` (a Vector3) and returns the yaw, or null if we
// have nothing yet.
export function sampleAt(actor, now, out) {
  const buf = actor.netBuf;
  if (!buf || !buf.length) return null;
  const rt = now - DELAY;
  const first = buf[0];
  if (rt <= first.t || buf.length === 1) { out.set(first.x, first.y, first.z); return first.yaw; }
  for (let i = buf.length - 1; i > 0; i--) {
    const a = buf[i - 1];
    const b = buf[i];
    if (rt >= a.t && rt <= b.t) {
      const k = (rt - a.t) / Math.max(1, b.t - a.t);
      out.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
      return lerpAngle(a.yaw, b.yaw, k);
    }
  }
  // Past the newest update: keep them going the way they were heading, briefly.
  const b = buf[buf.length - 1];
  const a = buf[buf.length - 2];
  const ahead = Math.min(MAX_EXTRAPOLATE, rt - b.t);
  const span = Math.max(1, b.t - a.t);
  const k = ahead / span;
  out.set(b.x + (b.x - a.x) * k, b.y + Math.max(0, (b.y - a.y) * k), b.z + (b.z - a.z) * k);
  return b.yaw;
}

// Move a puppet's drawn position toward the sample. Returns the yaw to use (or undefined).
const tmp = new THREE.Vector3();
export function smoothMove(actor, dt) {
  const yaw = sampleAt(actor, performance.now(), tmp);
  if (yaw === null) return undefined;
  if (actor.pos.distanceToSquared(tmp) > SNAP_DIST * SNAP_DIST) actor.pos.copy(tmp);
  // A touch of easing hides the small jumps when a late update corrects a guess.
  else actor.pos.lerp(tmp, Math.min(1, dt * 30));
  return yaw;
}
