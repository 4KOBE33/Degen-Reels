// Seagulls on the Neon Boardwalk: a flock wheeling over the beach and the pier, and every so often
// one swoops down and makes off with chips somebody left lying on the sand. Purely local: every
// player's game has its own copy of the chips on the ground, so it has its own gulls too.
import * as THREE from 'three';
import { part } from './toon.js';
import { sfx } from './audio.js';

const FLOCK = 12;

function makeGull() {
  const g = new THREE.Group();
  const body = part(new THREE.SphereGeometry(0.35, 10, 8), 0xf8fafc, { ink: 0.02, shadow: false });
  body.scale.set(1, 0.7, 1.8);
  const head = part(new THREE.SphereGeometry(0.22, 8, 6), 0xf8fafc, { ink: 0.02, shadow: false });
  head.position.set(0, 0.15, 0.62);
  const beak = part(new THREE.ConeGeometry(0.07, 0.3, 6), 0xffb703, { ink: 0, shadow: false });
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.12, 0.9);
  g.add(body, head, beak);
  const wings = [-1, 1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.25, 0.1, 0);
    const wing = part(new THREE.BoxGeometry(1.3, 0.05, 0.5), 0xe2e8f0, { ink: 0.01, shadow: false });
    wing.position.x = side * 0.65;
    const tip = part(new THREE.BoxGeometry(0.35, 0.06, 0.4), 0x1f2937, { ink: 0, shadow: false });
    tip.position.x = side * 1.3;
    pivot.add(wing, tip);
    g.add(pivot);
    return pivot;
  });
  return { g, wings };
}

export class Gulls {
  constructor(raid) {
    this.raid = raid;
    this.birds = [];
    for (let i = 0; i < FLOCK; i++) {
      const { g, wings } = makeGull();
      // Each one circles its own spot over the beach or the pier.
      const cx = i < 4 ? (Math.random() - 0.5) * 30 : (Math.random() - 0.5) * 360;
      const cz = i < 4 ? 190 + Math.random() * 30 : 110 + Math.random() * 40;
      const b = { g, wings, cx, cz, r: 10 + Math.random() * 25, a: Math.random() * Math.PI * 2, speed: (0.25 + Math.random() * 0.2) * (Math.random() < 0.5 ? 1 : -1), y: 12 + Math.random() * 10, flap: Math.random() * 6, dive: null };
      raid.scene.add(g);
      this.birds.push(b);
    }
    this.thiefIn = 25;
  }

  update(dt) {
    const raid = this.raid;
    for (const b of this.birds) {
      b.flap += dt * (b.dive ? 14 : 7);
      const flap = Math.sin(b.flap) * 0.6;
      b.wings[0].rotation.z = flap;
      b.wings[1].rotation.z = -flap;
      if (b.dive) { this.updateDive(b, dt); continue; }
      b.a += dt * b.speed;
      const x = b.cx + Math.cos(b.a) * b.r;
      const z = b.cz + Math.sin(b.a) * b.r;
      const y = b.y + Math.sin(b.a * 3) * 0.8;
      b.g.position.set(x, y, z);
      // Face along the circle.
      b.g.rotation.set(0, Math.atan2(-Math.sin(b.a) * Math.sign(b.speed), Math.cos(b.a) * Math.sign(b.speed)), Math.sign(b.speed) * -0.3);
    }
    // Every so often, one goes for chips nobody's guarding on the beach or the boardwalk.
    this.thiefIn -= dt;
    if (this.thiefIn > 0 || !raid.active) return;
    this.thiefIn = 18 + Math.random() * 14;
    const people = raid.combatants.filter((c) => c.alive);
    const loose = raid.chips.list.filter((c) => {
      const p = c.mesh.position;
      return c.resting && !c.homing && c.age > 6 && p.z > 60 && people.every((h) => Math.hypot(h.pos.x - p.x, h.pos.z - p.z) > 9);
    });
    if (!loose.length) return;
    const bird = this.birds.find((x) => !x.dive);
    if (!bird) return;
    const target = loose[Math.floor(Math.random() * loose.length)].mesh.position.clone();
    bird.dive = { t: 0, from: bird.g.position.clone(), to: target, took: 0, away: new THREE.Vector3((Math.random() - 0.5) * 120, 30, 260) };
  }

  updateDive(b, dt) {
    const raid = this.raid;
    const d = b.dive;
    d.t += dt;
    const pos = b.g.position;
    if (d.t < 2.2) {
      // Down to the chips.
      const k = d.t / 2.2;
      pos.lerpVectors(d.from, d.to.clone().setY(d.to.y + 0.6), k * k * (3 - 2 * k));
    } else if (!d.grabbed) {
      d.grabbed = true;
      const list = raid.chips.list;
      for (let i = list.length - 1; i >= 0; i--) {
        const c = list[i];
        if (!c.homing && c.mesh.position.distanceTo(d.to) < 2.2) { d.took += c.value; raid.chips.remove(i); }
      }
      const p = raid.player;
      if (d.took && p && p.alive && Math.hypot(p.pos.x - d.to.x, p.pos.z - d.to.z) < 60) {
        raid.feed(`🐦 A seagull made off with 🪙 ${d.took} somebody left on the sand!`);
        sfx.deny();
      }
      d.from = pos.clone();
      d.t2 = 0;
    } else {
      // Off out to sea, then back to the flock.
      d.t2 += dt;
      pos.lerpVectors(d.from, d.away, Math.min(1, d.t2 / 6));
      if (d.t2 > 6) { b.dive = null; b.a = Math.random() * Math.PI * 2; }
    }
    const to = d.grabbed ? d.away : d.to;
    b.g.rotation.set(0, Math.atan2(to.x - pos.x, to.z - pos.z), 0);
  }

  dispose() {
    for (const b of this.birds) this.raid.scene.remove(b.g);
    this.birds = [];
  }
}
