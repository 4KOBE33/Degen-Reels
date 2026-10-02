// Kill cam replays. While you're alive, the raid keeps the last few seconds of everything near
// you: where everyone was, which way they faced, every shot and every hit on you. When you die,
// that tape plays back from over your killer's shoulder, slowing down for the shot that got you.
import * as THREE from 'three';
import { RARITIES } from './config.js';
import { sfx } from './audio.js';

const RATE = 1 / 30;
const KEEP = 7;
const RANGE = 95;
const BEFORE = 3.6; // seconds of tape shown before the death
const AFTER = 0.5;
const SLOW_FROM = 0.8; // the last this-many seconds play in slow motion
const SLOW = 0.3;

export class Recorder {
  constructor(raid) {
    this.raid = raid;
    this.reset();
  }

  reset() {
    this.frames = [];
    this.events = [];
    this.acc = 0;
  }

  get now() { return this.raid.elapsed; }

  near(pos) {
    const p = this.raid.player;
    return p && Math.abs(pos.x - p.pos.x) < RANGE && Math.abs(pos.z - p.pos.z) < RANGE;
  }

  record(dt) {
    this.acc += dt;
    if (this.acc < RATE) return;
    this.acc = 0;
    const raid = this.raid;
    const actors = [];
    for (const c of raid.combatants) {
      if (!c.alive && !c.isPlayer) continue;
      if (!this.near(c.pos)) continue;
      actors.push({ ref: c, x: c.pos.x, y: c.pos.y, z: c.pos.z, yaw: c.yaw, pitch: c.pitch, downed: !!c.downed, weapon: c.weapon, rarity: c.rarity || 0 });
    }
    for (const m of raid.machines) {
      if (!m.alive || !this.near(m.pos)) continue;
      actors.push({ ref: m, machine: true, x: m.pos.x, y: m.pos.y, z: m.pos.z, yaw: m.yaw });
    }
    this.frames.push({ t: this.now, actors });
    const cut = this.now - KEEP;
    while (this.frames.length && this.frames[0].t < cut) this.frames.shift();
    while (this.events.length && this.events[0].t < cut) this.events.shift();
  }

  shot(from, to, color, shooter, crit = false) {
    if (!this.near(from) && !this.near(to)) return;
    this.events.push({ t: this.now, kind: 'shot', from: from.clone(), to: to.clone(), color, shooter, crit });
  }

  boom(at, splash) {
    if (!this.near(at)) return;
    this.events.push({ t: this.now, kind: 'boom', at: at.clone(), splash });
  }

  hurt(amount, crit, at) {
    this.events.push({ t: this.now, kind: 'hurt', amount, crit, at: at ? at.clone() : null });
  }
}

// Plays the tape back. Takes over every recorded actor's position until it's done.
export class Replay {
  constructor(raid, recorder, victim, killer) {
    this.raid = raid;
    this.victim = victim;
    this.killer = killer;
    this.end = recorder.now;
    this.start = Math.max(recorder.frames.length ? recorder.frames[0].t : this.end, this.end - BEFORE);
    this.frames = recorder.frames.slice();
    this.events = recorder.events.filter((e) => e.t >= this.start - 0.05);
    this.t = this.start;
    this.cursor = 0;
    this.done = this.frames.length < 2;
  }

  // Real seconds the replay takes to watch.
  get length() {
    const normal = Math.max(0, this.end - SLOW_FROM - this.start);
    const slow = Math.min(SLOW_FROM, this.end - this.start) + AFTER;
    return normal + slow / SLOW;
  }

  get slowMo() { return this.t > this.end - SLOW_FROM; }

  // Where an actor was at tape time `t` (interpolated), or null if it wasn't on the tape.
  sample(ref, t) {
    const f = this.frames;
    let i = 0;
    while (i < f.length - 2 && f[i + 1].t <= t) i++;
    const a = f[i];
    const b = f[Math.min(i + 1, f.length - 1)];
    const ea = a.actors.find((x) => x.ref === ref);
    const eb = b.actors.find((x) => x.ref === ref) || ea;
    if (!ea) return eb || null;
    const k = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 0;
    const lerpAngle = (x, y) => x + Math.atan2(Math.sin(y - x), Math.cos(y - x)) * k;
    return {
      ...ea,
      x: ea.x + (eb.x - ea.x) * k,
      y: ea.y + (eb.y - ea.y) * k,
      z: ea.z + (eb.z - ea.z) * k,
      yaw: lerpAngle(ea.yaw || 0, eb.yaw || 0),
      pitch: (ea.pitch || 0) + ((eb.pitch || 0) - (ea.pitch || 0)) * k,
      speed: Math.hypot(eb.x - ea.x, eb.z - ea.z) / Math.max(0.001, b.t - a.t),
    };
  }

  update(dt) {
    if (this.done) return;
    const raid = this.raid;
    const step = dt * (this.slowMo ? SLOW : 1);
    const prev = this.t;
    this.t = Math.min(this.end + AFTER, this.t + step);
    // Put everyone where they were.
    const seen = new Set();
    for (const fr of [this.frameAt(this.t)]) {
      for (const e of fr.actors) {
        if (seen.has(e.ref)) continue;
        seen.add(e.ref);
        const s = this.sample(e.ref, this.t);
        if (!s) continue;
        const r = e.ref;
        r.pos.set(s.x, s.y, s.z);
        r.yaw = s.yaw;
        if (s.machine) {
          if (r.group) { r.group.position.copy(r.pos); r.group.rotation.y = r.yaw; r.group.visible = true; }
        } else {
          r.pitch = s.pitch;
          const dead = r === this.victim && this.t >= this.end;
          r.char.setWeapon(s.weapon, RARITIES[s.rarity] ? RARITIES[s.rarity].color : null);
          r.char.root.visible = true;
          r.char.root.position.copy(r.pos);
          r.char.root.rotation.y = r.yaw;
          r.char.animate(step, { speed: s.speed, forward: Math.min(1, s.speed / 6), side: 0, onGround: true, pitch: s.pitch, dead, downed: s.downed && !dead, showTag: !r.isPlayer });
        }
      }
    }
    // Replay what happened in this slice of tape.
    for (const ev of this.events) {
      if (ev.t <= prev || ev.t > this.t) continue;
      if (ev.kind === 'shot') {
        raid.fx.tracer(ev.from, ev.to, ev.color);
        raid.fx.muzzleFlash(ev.from);
        if (ev.shooter && ev.shooter.weapon) sfx.shoot(ev.shooter.weapon, ev.from, raid.listener);
        else sfx.zap(ev.from, raid.listener);
        if (ev.shooter && ev.shooter.char) ev.shooter.char.recoil(1);
      } else if (ev.kind === 'boom') {
        raid.fx.explosion(ev.at, ev.splash);
        sfx.boom(ev.at, raid.listener);
      } else if (ev.kind === 'hurt' && ev.at) {
        raid.fx.number(ev.at, ev.crit ? `${Math.round(ev.amount)}! HEADSHOT` : `${Math.round(ev.amount)}`, ev.crit ? '#ffd23f' : '#ff5d5d', ev.crit ? 1.8 : 1.2);
        if (ev.crit) sfx.crit();
        this.victim.char.hurt();
      }
    }
    if (this.t >= this.end + AFTER) this.done = true;
  }

  frameAt(t) {
    const f = this.frames;
    let i = 0;
    while (i < f.length - 1 && f[i + 1].t <= t) i++;
    return f[i];
  }

  // Over the killer's shoulder, looking at you. Falls back to a side angle on you.
  camera(camera, dt) {
    const v = this.sample(this.victim, this.t);
    const k = this.killer ? this.sample(this.killer, this.t) : null;
    if (!v) return false;
    const vc = new THREE.Vector3(v.x, v.y + (v.downed ? 0.5 : 1.1), v.z);
    let want;
    let look = vc;
    if (k) {
      const big = this.killer.isBoss;
      const head = new THREE.Vector3(k.x, k.y + (k.machine ? (big ? 6 : 2.4) : 1.5), k.z);
      const dir = vc.clone().sub(head).setY(0);
      const dist = dir.length();
      dir.normalize();
      const right = new THREE.Vector3(-dir.z, 0, dir.x);
      want = head.clone().addScaledVector(dir, -(big ? 7 : 2.8)).addScaledVector(right, big ? 2.5 : 0.9).add(new THREE.Vector3(0, big ? 2 : 0.55, 0));
      // Very close fights: pull back so both are in frame.
      if (dist < 3) want.addScaledVector(right, 1.5).y += 1;
      look = head.clone().lerp(vc, 0.75);
    } else {
      want = vc.clone().add(new THREE.Vector3(4, 2.2, 4));
    }
    if (!this.camInit) { camera.position.copy(want); this.camInit = true; } else camera.position.lerp(want, Math.min(1, dt * 8));
    camera.lookAt(look);
    const fov = this.slowMo ? 50 : 62;
    if (Math.abs(camera.fov - fov) > 0.1) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix(); }
    return true;
  }
}
