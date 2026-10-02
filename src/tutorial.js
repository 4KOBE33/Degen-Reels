// The tutorial: a checklist of the basics during your first few raids. Each step ticks off on
// its own as you do it, so it never gets in the way.
import { keyName } from './keys.js';
import { save } from './save.js';
import { sfx } from './audio.js';

const $ = (id) => document.getElementById(id);
const k = (a) => `<b class="key">${keyName(a)}</b>`;

const STEPS = [
  { id: 'move', text: () => `Move with ${k('forward')}${k('left')}${k('back')}${k('right')}, look with the mouse`, done: (r, t) => t.moved > 12 },
  { id: 'search', text: () => `Search a crate, locker or register: hold ${k('use')} next to it`, done: (r) => r.run.containers > 0 },
  { id: 'bag', text: () => `Open your backpack with ${k('bag')} to see your loot`, done: (r, t) => t.saw.bag },
  { id: 'fight', text: () => `Bust a machine: ${k('fire')} to shoot, ${k('aim')} to aim. Headshots hit harder`, done: (r) => r.run.machines > 0 },
  { id: 'throw', text: () => `Hold ${k('throw')} to aim a throwable, let go to throw it`, done: (r) => r.run.throws > 0 },
  { id: 'map', text: () => `Check the map with ${k('map')}: green beams are open exits`, done: (r, t) => t.saw.map },
  { id: 'extract', text: () => 'Stand in a green exit circle to call your ride, then survive until it lands', done: (r) => r.extracts.some((e) => e.call) || (r.result && r.result.success) },
];

export class Tutorial {
  constructor() {
    this.on = false;
    this.saw = {};
  }

  // Tips are on for your first three raids, or whenever you switch them on.
  get wanted() {
    const d = save.get();
    const s = d.settings.tutorial || 'auto';
    return s === 'on' || (s === 'auto' && (d.stats.raids || 0) < 3);
  }

  start(raid) {
    this.on = this.wanted && !raid.map.safe;
    this.moved = 0;
    this.last = raid.player ? raid.player.pos.clone() : null;
    this.done = new Set();
    this.saw = {};
    this.render();
  }

  stop() {
    this.on = false;
    $('tutorial').hidden = true;
  }

  // The game tells us about things it can't see in raid stats (opening the bag or map).
  note(what) { if (this.on) this.saw[what] = true; }

  update(raid) {
    if (!this.on) return;
    if (!raid.active) { this.stop(); return; }
    const p = raid.player;
    if (p && this.last) { this.moved += Math.hypot(p.pos.x - this.last.x, p.pos.z - this.last.z); this.last.copy(p.pos); }
    let changed = false;
    for (const s of STEPS) {
      if (!this.done.has(s.id) && s.done(raid, this)) { this.done.add(s.id); changed = true; }
    }
    if (changed) {
      sfx.pickup();
      this.render();
    }
  }

  render() {
    const el = $('tutorial');
    if (!this.on) { el.hidden = true; return; }
    const next = STEPS.find((s) => !this.done.has(s.id));
    if (!next) {
      el.hidden = false;
      el.innerHTML = '<div class="tuthead">🎓 You know the basics!</div><small>Get out alive with your loot, sell it at the Fence, and come back richer. (Tips can be turned off in Settings.)</small>';
      setTimeout(() => this.stop(), 8000);
      return;
    }
    el.hidden = false;
    el.innerHTML = `<div class="tuthead">🎓 How to raid <small>${this.done.size}/${STEPS.length}</small></div>
      ${STEPS.map((s) => `<div class="tutstep ${this.done.has(s.id) ? 'done' : s === next ? 'now' : ''}">${this.done.has(s.id) ? '✅' : s === next ? '👉' : '▫️'} ${s.text()}</div>`).join('')}`;
  }
}
