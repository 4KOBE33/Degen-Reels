// The Training Floor: a guided first raid. One thing at a time, with a card saying what to do, a
// bouncing marker showing where, and Coach Lucky jogging ahead to each station to talk you through
// it and cheer when you get it. Nothing you bring is at stake, and you can't go down.
import * as THREE from 'three';
import { keyName } from './keys.js';
import { save } from './save.js';
import { sfx } from './audio.js';
import { makeGun, makeItem } from './items.js';
import { createCharacter } from './character.js';

const $ = (id) => document.getElementById(id);
const k = (a) => `<b class="key">${keyName(a)}</b>`;
const FIRST_REWARD = 500;
const CHEERS = ['NICE!', 'PERFECT!', 'LET\'S GO!', 'BIG MONEY!', 'SMOOTH!', 'JACKPOT!'];

// Practice targets: they stand there and take it (or slide along a rail).
function dummies(raid, spots, hp = 70) {
  return spots.map(([x, z, slide]) => {
    const m = raid.spawnMachine('slotbot', x, z);
    m.dummy = true;
    m.hp = hp;
    m.maxHp = hp;
    m.target = null;
    if (slide) { m.slideAmp = slide; m.slideX = x; }
    return m;
  });
}

const STEPS = [
  {
    id: 'move', title: 'Welcome to Beat the House!', at: [0, 32], coach: [-4, 30], say: 'Hey rookie! Over here!',
    text: () => `You're a bean with a gun and big dreams. Walk to the marker: ${k('forward')}${k('left')}${k('back')}${k('right')} to move, the mouse to look around.`,
    done: (r, t) => t.near(r, 0, 32, 3),
  },
  {
    id: 'jump', title: 'Hop it', at: [0, 21], coach: [-6, 21], say: 'Over the barrier!',
    text: () => `Jump the barrier with ${k('jump')}. Hold ${k('sprint')} to sprint.`,
    done: (r) => r.player.pos.z < 23,
  },
  {
    id: 'roll', title: 'Dodge roll', at: null, coach: [-6, 21], say: 'Now roll! Can\'t hit what\'s rolling!',
    text: () => `Run in any direction and press ${k('roll')} to do a dodge roll. Bullets go right through you mid-roll.`,
    done: (r, t) => t.rolled,
  },
  {
    id: 'search', title: 'Pick the right chest', at: [5, 15], coach: [-8, 17], say: 'Purple beats blue beats gray!',
    text: () => `The badge over a chest shows how good it is: <b style="color:#cbd5e1">gray</b>, <b style="color:#4ea8ff">blue</b>, <b style="color:#b56cff">purple</b>, <b style="color:#ffc83d">gold</b>. Stand at the <b style="color:#b56cff">purple</b> one and <b>hold</b> ${k('use')} to search it.`,
    done: (r, t) => t.purple && t.purple.opened,
  },
  {
    id: 'grab', title: 'Grab your loot', at: [5, 12.5], coach: [-8, 15], say: 'Grab it all!',
    text: () => `It spilled out! Walk up to each item and press ${k('use')} to pick it up. Get the gun and the supplies.`,
    done: (r) => r.player.weapons.some(Boolean) && r.player.backpack.length >= 2,
  },
  {
    id: 'bag', title: 'Check your backpack', at: null, coach: [-8, 15], say: 'Peek in your bag.',
    text: () => `Press ${k('bag')} to open your backpack and see what you're carrying. Press ${k('bag')} again to close it.`,
    done: (r, t) => t.saw.bag && t.overlay === 'none',
  },
  {
    id: 'shoot', title: 'Target practice', at: [0, 9], coach: [-9.5, 10], say: 'Light \'em up!',
    enter: (r, t) => { t.crits0 = r.run.crits || 0; t.wave = 1; t.targets = dummies(r, [[-4, 1], [4, 1]]); },
    text: (t) => `${t.wave === 1 ? 'Two targets up.' : 'Last one\'s on a rail. Lead your shots!'} ${k('fire')} to shoot, hold ${k('aim')} to aim. <b>Bonus ⭐</b> hit one on the screen (its face) for a critical hit.`,
    tick: (r, t) => {
      if (t.wave === 1 && t.targets.every((m) => !m.alive)) {
        t.wave = 2;
        t.targets = dummies(r, [[0, 0, 5]], 90);
        t.coachSay('Moving target! Lead it!');
        t.render();
      }
      if (!t.stars.crit && (r.run.crits || 0) > t.crits0) t.star('crit', 'Critical hit!');
    },
    done: (r, t) => t.wave === 2 && t.targets.every((m) => !m.alive),
  },
  {
    id: 'reload', title: 'Reload', at: null, coach: [-9.5, 10], say: 'Reload before you need to!',
    text: () => `Press ${k('reload')} to reload. Out in a raid, 📦 Ammo Boxes refill your reserve.`,
    done: (r, t) => t.sawReload,
  },
  {
    id: 'heal', title: 'Patch yourself up', at: [0, -6], coach: [-8, -4], say: 'Ouch! Patch up, quick!',
    enter: (r) => {
      const p = r.player;
      r.fx.explosion(p.pos.clone().setY(0.5), 2.2);
      sfx.boom(p.pos, r.listener);
      p.hp = Math.min(p.hp, 40);
      p.armor = 0;
      r.shake = Math.max(r.shake || 0, 0.5);
      r.hud.toast('⚡ ZAP! A shock trap. That hurt.', 'big');
    },
    text: () => `You're hurt (health bar, bottom left). Press ${k('heal')} to use a bandage. It takes a second, so heal behind cover in a real fight.`,
    done: (r) => r.player.hp >= 70,
  },
  {
    id: 'armor', title: 'Armor up', at: null, coach: [-8, -4], say: 'Plates on!',
    text: () => `Press ${k('armor')} to strap on a Chip Plate. Armor soaks up most of each hit before your health does.`,
    done: (r) => r.player.armor > 0,
  },
  {
    id: 'throw', title: 'Fire in the hole', at: [0, -11], coach: [-8, -10], say: 'Lob it over the wall!',
    enter: (r, t) => { t.cluster = dummies(r, [[-1.6, -19], [1.6, -19], [0, -21]], 40); },
    text: () => `Three targets are hiding behind that wall. <b>Hold</b> ${k('throw')} to aim your grenade (the arc shows where it lands), then let go. <b>Bonus ⭐</b> get all three with one throw.`,
    tick: (r, t) => {
      if (r.run.throws > 0 && !t.thrownAt) t.thrownAt = t.since;
      if (t.thrownAt && !t.stars.multi && t.cluster.every((m) => !m.alive) && t.since - t.thrownAt < 4) t.star('multi', 'Triple kill!');
    },
    done: (r, t) => r.run.throws > 0 && (t.cluster.every((m) => !m.alive) || t.since - (t.thrownAt || t.since) > 4),
  },
  {
    id: 'fight', title: 'This one fights back', at: [0, -24], coach: [-9.5, -20], say: 'It\'s real! Use the crates!',
    enter: (r, t) => {
      for (const m of t.cluster || []) if (m.alive) { m.alive = false; m.hp = 0; }
      const m = r.spawnMachine('slotbot', 0, -34);
      m.hp = 160;
      m.maxHp = 160;
      m.target = r.player;
      m.windup = 1.5;
      t.boss = m;
      t.lowest = r.player.hp;
    },
    text: () => 'A real Slot Bot! Duck behind the crates, keep moving, roll when it fires, and bust it. <b>Bonus ⭐</b> win without dropping under half health.',
    tick: (r, t) => { t.lowest = Math.min(t.lowest, r.player.hp); },
    done: (r, t) => t.boss && !t.boss.alive,
    after: (r, t) => { if (t.lowest >= r.player.maxHp / 2) t.star('clean', 'Flawless fight!'); },
  },
  {
    id: 'chips', title: 'Scoop the chips', at: null, coach: [-9.5, -20], say: 'Chips! Scoop \'em up!',
    text: () => 'Busted machines drop chips. Walk over them and they fly into your pocket. Chips you get out with go to your bank.',
    done: (r) => r.player.chips > 0,
  },
  {
    id: 'map', title: 'Find the exit', at: null, coach: [-9.5, -20], say: 'Find the green beam!',
    text: () => `Press ${k('map')} for the map. Green beams are the exits open this raid. Close it with ${k('map')}.`,
    done: (r, t) => t.saw.map && t.overlay === 'none',
  },
  {
    id: 'extract', title: 'Get out alive', at: [0, -42], coach: [-7, -38], say: 'Stay in the circle!',
    text: () => 'Stand in the green EXIT circle to call your ride, and stay in it until it lands. In a real raid that takes 25 seconds and every machine nearby comes running. Die first and you lose everything you brought.',
    done: (r) => r.result && r.result.success,
  },
];

// A speech bubble drawn on a canvas, as a sprite over the coach's head.
function bubbleTexture(text) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const g = c.getContext('2d');
  g.font = "bold 40px 'Luckiest Guy', 'Arial Black', sans-serif";
  const w = Math.min(496, g.measureText(text).width + 56);
  const x0 = (512 - w) / 2;
  g.fillStyle = '#1b0f2b';
  g.beginPath();
  g.roundRect(x0 - 5, 5, w + 10, 110, 30);
  g.fill();
  g.fillStyle = '#fff6e0';
  g.beginPath();
  g.roundRect(x0, 10, w, 100, 26);
  g.fill();
  g.beginPath();
  g.moveTo(236, 108);
  g.lineTo(276, 108);
  g.lineTo(256, 150);
  g.closePath();
  g.fillStyle = '#1b0f2b';
  g.fill();
  g.beginPath();
  g.moveTo(242, 104);
  g.lineTo(270, 104);
  g.lineTo(256, 138);
  g.closePath();
  g.fillStyle = '#fff6e0';
  g.fill();
  g.fillStyle = '#1b0f2b';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 62, 470);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Training {
  constructor() {
    this.on = false;
    this.onComplete = null;
  }

  start(raid) {
    this.on = !!raid.tutorialMode;
    $('training').hidden = !this.on;
    raid.tutorialStars = [];
    if (!this.on) return;
    this.raid = raid;
    this.i = -1;
    this.saw = {};
    this.overlay = 'none';
    this.sawReload = false;
    this.rolled = false;
    this.targets = null;
    this.cluster = null;
    this.boss = null;
    this.since = 0;
    this.finished = false;
    this.stars = {};
    // Three chests: the purple one has exactly what the lesson needs, the others a little extra.
    const byX = (x) => raid.containers.reduce((best, c) => (!best || Math.hypot(c.spot.x - x, c.spot.z - 15) < Math.hypot(best.spot.x - x, best.spot.z - 15) ? c : best), null);
    this.purple = byX(5);
    if (this.purple) this.purple.fixedLoot = [{ ...makeGun('smg', 0), ammo: 30 }, makeItem('bandage', 2), makeItem('plate', 1), makeItem('grenade', 2), makeItem('ammo', 1)];
    const gray = byX(-5);
    const blue = byX(0);
    if (gray && gray !== this.purple) gray.fixedLoot = [makeItem('bandage', 1)];
    if (blue && blue !== this.purple) blue.fixedLoot = [makeItem('soda', 1)];
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
    // Coach Lucky: green visor, big mustache, opinions.
    this.coach = createCharacter({ color: 0xffd23f, hat: 'visor', eyes: 'happy', mouth: 'mustache', glasses: 'none', neck: 'bowtie', shoes: 0x2b2140 });
    this.coach.showTag(false);
    this.coach.root.position.set(-4, 0, 34);
    raid.scene.add(this.coach.root);
    this.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTexture('...'), transparent: true, depthWrite: false }));
    this.bubble.scale.set(4.2, 1.3, 1);
    this.bubble.position.y = 3.3;
    this.bubble.renderOrder = 6;
    this.coach.root.add(this.bubble);
    this.coachGoal = new THREE.Vector3(-4, 0, 30);
    this.cheerT = 0;
    this.next();
  }

  stop() {
    this.on = false;
    $('training').hidden = true;
    if (this.raid) {
      if (this.marker) this.raid.scene.remove(this.marker);
      if (this.coach) this.raid.scene.remove(this.coach.root);
    }
    this.marker = null;
    this.coach = null;
  }

  near(r, x, z, d) { return Math.hypot(r.player.pos.x - x, r.player.pos.z - z) < d; }

  // Overlays the main loop tells us about (backpack, map).
  note(what) {
    if (!this.on) return;
    this.overlay = what;
    if (what !== 'none') this.saw[what] = true;
  }

  coachSay(text) {
    if (!this.bubble) return;
    const old = this.bubble.material.map;
    this.bubble.material.map = bubbleTexture(text);
    this.bubble.material.needsUpdate = true;
    if (old) old.dispose();
    this.bubble.scale.set(0.1, 0.1, 1);
    this.bubblePop = 0;
  }

  // A bonus star: a little fanfare and it's on the results screen.
  star(id, label) {
    if (this.stars[id]) return;
    this.stars[id] = label;
    this.raid.tutorialStars.push(label);
    sfx.jackpot();
    this.raid.hud.toast(`⭐ BONUS: ${label}`, 'big');
    this.render();
  }

  // Step done: confetti, a cheer from the coach, then the next one.
  celebrate() {
    const r = this.raid;
    const p = r.player;
    const at = p.pos.clone().setY(2.6);
    r.fx.confetti(at);
    r.fx.number(at, CHEERS[Math.floor(Math.random() * CHEERS.length)], '#ffd23f', 1.6);
    sfx.win();
    this.cheerT = 1.2;
    if (this.coach) this.coach.jump();
  }

  next() {
    const prev = STEPS[this.i];
    if (prev && prev.after) prev.after(this.raid, this);
    this.i++;
    this.since = 0;
    this.thrownAt = 0;
    const s = STEPS[this.i];
    if (!s) return;
    if (s.enter) s.enter(this.raid, this);
    if (s.coach) this.coachGoal.set(s.coach[0], 0, s.coach[1]);
    if (s.say) this.coachSay(s.say);
    this.render();
  }

  update(raid, dt) {
    if (!this.on) return;
    if (!raid.active && !raid.result) { this.stop(); return; }
    const p = raid.player;
    const s = STEPS[this.i];
    this.since += dt;
    if (p && p.cdKind === 'reload' && p.cooldown > 0) this.sawReload = true;
    if (p && p.rolling) this.rolled = true;
    if (this.marker) {
      const at = s && s.at;
      this.marker.visible = !!at && raid.active;
      if (at) this.marker.position.set(at[0], 3 + Math.sin(performance.now() / 250) * 0.3, at[1]);
      this.marker.rotation.y += dt * 2;
    }
    this.updateCoach(dt);
    if (s && s.tick) s.tick(raid, this);
    if (s && s.done(raid, this)) {
      this.celebrate();
      if (this.i === STEPS.length - 1) { if (s.after) s.after(raid, this); this.complete(); } else this.next();
    }
    if (!raid.active) this.stop();
  }

  // The coach jogs to his spot, turns to face you, and bounces when he's happy.
  updateCoach(dt) {
    const c = this.coach;
    const p = this.raid.player;
    if (!c || !p) return;
    const pos = c.root.position;
    const to = this.coachGoal.clone().sub(pos).setY(0);
    const d = to.length();
    const moving = d > 0.3;
    if (moving) pos.addScaledVector(to.normalize(), Math.min(d, dt * 7));
    const look = moving ? to : p.pos.clone().sub(pos).setY(0);
    const yaw = Math.atan2(-look.x, -look.z);
    c.root.rotation.y += Math.atan2(Math.sin(yaw - c.root.rotation.y), Math.cos(yaw - c.root.rotation.y)) * Math.min(1, dt * 8);
    this.cheerT = Math.max(0, this.cheerT - dt);
    if (this.cheerT > 0 && Math.floor(this.cheerT * 3) !== Math.floor((this.cheerT + dt) * 3)) c.jump();
    c.animate(dt, { speed: moving ? 6 : 0, forward: moving ? 1 : 0, side: 0, onGround: true, pitch: 0, dead: false, showTag: false });
    if (this.bubble) {
      this.bubblePop = Math.min(1, (this.bubblePop || 0) + dt * 6);
      const k = 1 - (1 - this.bubblePop) ** 3;
      this.bubble.scale.set(4.2 * k, 1.3 * k, 1);
      this.bubble.position.y = 3.3 + Math.sin(performance.now() / 400) * 0.06;
    }
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
    const stars = Object.values(this.stars);
    el.innerHTML = `<div class="trhead"><span class="trstep">🎓 ${this.i + 1} / ${STEPS.length}</span><b>${s.title}</b></div>
      <p>${s.text(this)}</p>
      <div class="trdots">${STEPS.map((x, i) => `<i class="${i < this.i ? 'done' : i === this.i ? 'now' : ''}"></i>`).join('')}</div>
      <small class="trskip">${stars.length ? `⭐ ${stars.length} bonus${stars.length > 1 ? 'es' : ''} · ` : ''}Stuck? <b class="key">Esc</b> pauses, and you can leave the tutorial from there.</small>`;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }
}
