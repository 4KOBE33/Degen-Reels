// The Training Floor: a guided first raid. One thing at a time, with a big card saying what to do
// and a bouncing marker showing where. Nothing you bring is at stake, and you can't go down.
import * as THREE from 'three';
import { keyName } from './keys.js';
import { save } from './save.js';
import { sfx } from './audio.js';
import { makeGun, makeItem } from './items.js';

const $ = (id) => document.getElementById(id);
const k = (a) => `<b class="key">${keyName(a)}</b>`;
const FIRST_REWARD = 500;

const dummies = (raid, spots, hp = 70) => spots.map(([x, z]) => {
  const m = raid.spawnMachine('slotbot', x, z);
  m.dummy = true;
  m.hp = hp;
  m.maxHp = hp;
  m.target = null;
  m.yaw = 0;
  return m;
});

const STEPS = [
  {
    id: 'move', title: 'Welcome to Beat the House!', at: [0, 32],
    text: () => `You're a bean with a gun and big dreams. Walk to the marker: ${k('forward')}${k('left')}${k('back')}${k('right')} to move, the mouse to look around.`,
    done: (r, t) => t.near(r, 0, 32, 3),
  },
  {
    id: 'jump', title: 'Hop it', at: [0, 21],
    text: () => `Jump the barrier with ${k('jump')}. Tip: hold ${k('sprint')} to sprint.`,
    done: (r) => r.player.pos.z < 23,
  },
  {
    id: 'search', title: 'Search the crate', at: [0, 15],
    text: () => `Crates, lockers, registers and safes are full of loot. Stand next to the crate and <b>hold</b> ${k('use')} to search it.`,
    done: (r) => r.run.containers > 0,
  },
  {
    id: 'grab', title: 'Grab your loot', at: [0, 13],
    text: () => `It spilled out! Walk up to each item and press ${k('use')} to pick it up. Grab the gun and the supplies.`,
    done: (r) => r.player.weapons.some(Boolean) && r.player.backpack.length >= 2,
  },
  {
    id: 'bag', title: 'Check your backpack', at: null,
    text: () => `Press ${k('bag')} to open your backpack and see what you're carrying. Press ${k('bag')} again to close it.`,
    done: (r, t) => t.saw.bag && t.overlay === 'none',
  },
  {
    id: 'shoot', title: 'Target practice', at: [0, 1],
    enter: (r, t) => { t.targets = dummies(r, [[-5, 1.5], [0, 0], [5, 1.5]]); },
    text: () => `Bust the three practice targets. ${k('fire')} to shoot, hold ${k('aim')} to aim down your sights. Hitting the screen on their face is a critical hit.`,
    done: (r, t) => t.targets && t.targets.every((m) => !m.alive),
  },
  {
    id: 'reload', title: 'Reload', at: null,
    text: () => `Running low? Press ${k('reload')} to reload. (Out in a raid, Ammo Boxes refill your reserve.)`,
    done: (r, t) => t.sawReload,
  },
  {
    id: 'heal', title: 'Patch yourself up', at: [0, -6],
    enter: (r) => {
      const p = r.player;
      r.fx.explosion(p.pos.clone().setY(0.5), 2.2);
      sfx.boom(p.pos, r.listener);
      p.hp = Math.min(p.hp, 40);
      p.armor = 0;
      r.hud.toast('⚡ ZAP! A shock trap. That hurt.', 'big');
    },
    text: () => `You're hurt (look at the health bar, bottom left). Press ${k('heal')} to use a bandage. It takes a second, so heal behind cover in a real fight.`,
    done: (r) => r.player.hp >= 70,
  },
  {
    id: 'armor', title: 'Armor up', at: null,
    text: () => `Press ${k('armor')} to strap on a Chip Plate. Armor soaks up most of each hit before your health does.`,
    done: (r) => r.player.armor > 0,
  },
  {
    id: 'throw', title: 'Fire in the hole', at: [0, -12],
    enter: (r, t) => { t.cluster = dummies(r, [[-1.6, -19], [1.6, -19], [0, -21]], 40); },
    text: () => `Three targets are hiding behind that wall. <b>Hold</b> ${k('throw')} to aim your grenade (the arc shows where it lands), then let go to throw it over.`,
    done: (r, t) => r.run.throws > 0 && (t.cluster.every((m) => !m.alive) || t.since > 5),
  },
  {
    id: 'fight', title: 'This one fights back', at: [0, -28],
    enter: (r, t) => {
      for (const m of t.cluster || []) if (m.alive) { m.alive = false; m.hp = 0; }
      const m = r.spawnMachine('slotbot', 0, -34);
      m.hp = 160;
      m.maxHp = 160;
      m.target = r.player;
      m.windup = 1.5;
      t.boss = m;
    },
    text: () => `A real Slot Bot! Duck behind the crates, keep moving, and bust it. Keep an eye on your health.`,
    done: (r, t) => t.boss && !t.boss.alive,
  },
  {
    id: 'chips', title: 'Scoop the chips', at: null,
    text: () => 'Busted machines drop chips. Walk over them and they fly into your pocket. Chips you get out with go to your bank.',
    done: (r) => r.player.chips > 0,
  },
  {
    id: 'map', title: 'Find the exit', at: null,
    text: () => `Press ${k('map')} for the map. The green beams are exits that are open this raid. Close it again with ${k('map')}.`,
    done: (r, t) => t.saw.map && t.overlay === 'none',
  },
  {
    id: 'extract', title: 'Get out alive', at: [0, -42],
    text: () => 'Stand in the green EXIT circle to call your ride, and stay in it until it lands. In a real raid that takes 25 seconds and every machine nearby comes running. Die before that and you lose everything you brought.',
    done: (r) => r.result && r.result.success,
  },
];

export class Training {
  constructor() {
    this.on = false;
    this.onComplete = null;
  }

  start(raid) {
    this.on = !!raid.tutorialMode;
    $('training').hidden = !this.on;
    if (!this.on) return;
    this.raid = raid;
    this.i = -1;
    this.saw = {};
    this.overlay = 'none';
    this.sawReload = false;
    this.targets = null;
    this.cluster = null;
    this.boss = null;
    this.since = 0;
    this.finished = false;
    // Fill the crate with exactly what the lesson needs.
    const crate = raid.containers.reduce((best, c) => (!best || Math.hypot(c.spot.x, c.spot.z - 15) < Math.hypot(best.spot.x, best.spot.z - 15) ? c : best), null);
    if (crate) crate.fixedLoot = [{ ...makeGun('smg', 0), ammo: 30 }, makeItem('bandage', 2), makeItem('plate', 1), makeItem('grenade', 2), makeItem('ammo', 1)];
    // The marker: a bouncing arrow over where to go next.
    const g = new THREE.Group();
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.1, 4), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
    arrow.rotation.x = Math.PI;
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.75, 32), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -2.9;
    g.add(arrow, ring);
    this.marker = g;
    raid.scene.add(g);
    this.next();
  }

  stop() {
    this.on = false;
    $('training').hidden = true;
    if (this.marker && this.raid) this.raid.scene.remove(this.marker);
    this.marker = null;
  }

  near(r, x, z, d) { return Math.hypot(r.player.pos.x - x, r.player.pos.z - z) < d; }

  // Overlays the main loop tells us about (backpack, map).
  note(what) {
    if (!this.on) return;
    this.overlay = what;
    if (what !== 'none') this.saw[what] = true;
  }

  next() {
    this.i++;
    this.since = 0;
    const s = STEPS[this.i];
    if (!s) return;
    if (s.enter) s.enter(this.raid, this);
    if (this.i > 0) sfx.pickup();
    this.render();
  }

  update(raid, dt) {
    if (!this.on) return;
    if (!raid.active && !raid.result) { this.stop(); return; }
    const p = raid.player;
    const s = STEPS[this.i];
    this.since += dt;
    if (p && p.cdKind === 'reload' && p.cooldown > 0) this.sawReload = true;
    if (this.marker) {
      const at = s && s.at;
      this.marker.visible = !!at && raid.active;
      if (at) this.marker.position.set(at[0], 3 + Math.sin(performance.now() / 250) * 0.3, at[1]);
      this.marker.rotation.y += dt * 2;
    }
    if (s && s.done(raid, this)) {
      if (this.i === STEPS.length - 1) this.complete();
      else this.next();
    }
    if (!raid.active) this.stop();
  }

  complete() {
    if (this.finished) return;
    this.finished = true;
    const first = !save.get().tutorialDone;
    save.update((d) => {
      d.tutorialDone = true;
      if (first) d.stash.chips += FIRST_REWARD;
    });
    if (this.onComplete) this.onComplete(first ? FIRST_REWARD : 0);
  }

  render() {
    const s = STEPS[this.i];
    const el = $('training');
    if (!s) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `<div class="trhead"><span class="trstep">🎓 ${this.i + 1} / ${STEPS.length}</span><b>${s.title}</b></div>
      <p>${s.text()}</p>
      <div class="trdots">${STEPS.map((x, i) => `<i class="${i < this.i ? 'done' : i === this.i ? 'now' : ''}"></i>`).join('')}</div>
      <small class="trskip">Stuck? <b class="key">Esc</b> pauses, and you can leave the tutorial from there.</small>`;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }
}
