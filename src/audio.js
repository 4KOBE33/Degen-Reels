// All sounds are synthesized on the fly with WebAudio, so there are no files to load.
let ctx = null;
let master = null;

export function setVolume(v) {
  if (master) master.gain.value = v;
  pendingVolume = v;
}
let pendingVolume = 0.5;

export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = pendingVolume;
    master.connect(ctx.destination);
  } catch (e) {
    ctx = null;
  }
}

// Volume falloff for sounds that happen somewhere in the world.
function falloff(pos, listener) {
  if (!pos || !listener) return 1;
  const d = Math.hypot(pos.x - listener.x, pos.z - listener.z);
  return Math.max(0, 1 - d / 40);
}

function tone({ freq, to = freq, dur = 0.1, type = 'square', vol = 0.15, delay = 0 }) {
  if (!ctx || vol <= 0.001) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

let noiseBuffer = null;
function noise({ dur = 0.2, vol = 0.2, freq = 1200, to = freq, q = 1, delay = 0 }) {
  if (!ctx || vol <= 0.001) return;
  if (!noiseBuffer) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = q;
  filter.frequency.setValueAtTime(freq, t);
  filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + dur);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(gain).connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

export const sfx = {
  shoot(weapon, pos, listener) {
    const v = falloff(pos, listener);
    if (weapon === 'pistol') { tone({ freq: 900, to: 200, dur: 0.08, vol: 0.12 * v }); noise({ dur: 0.08, vol: 0.15 * v, freq: 3000, to: 500 }); }
    if (weapon === 'smg') { tone({ freq: 700, to: 250, dur: 0.05, vol: 0.08 * v }); noise({ dur: 0.05, vol: 0.12 * v, freq: 2500, to: 600 }); }
    if (weapon === 'shotgun') { noise({ dur: 0.3, vol: 0.4 * v, freq: 2000, to: 150 }); tone({ freq: 150, to: 50, dur: 0.2, type: 'sine', vol: 0.3 * v }); }
    if (weapon === 'rocket') { noise({ dur: 0.5, vol: 0.25 * v, freq: 800, to: 200 }); tone({ freq: 200, to: 600, dur: 0.3, type: 'sawtooth', vol: 0.06 * v }); }
  },
  swing(pos, listener) { noise({ dur: 0.15, vol: 0.12 * falloff(pos, listener), freq: 600, to: 2500, q: 4 }); },
  hit() { tone({ freq: 1400, to: 1800, dur: 0.05, type: 'triangle', vol: 0.12 }); },
  honk(pos, listener) {
    const v = Math.max(0.3, falloff(pos, listener));
    tone({ freq: 392, dur: 0.18, type: 'square', vol: 0.12 * v });
    tone({ freq: 494, dur: 0.18, type: 'square', vol: 0.1 * v });
    tone({ freq: 392, dur: 0.25, type: 'square', vol: 0.12 * v, delay: 0.24 });
    tone({ freq: 494, dur: 0.25, type: 'square', vol: 0.1 * v, delay: 0.24 });
  },
  crit() {
    tone({ freq: 2200, to: 2900, dur: 0.07, type: 'square', vol: 0.09 });
    tone({ freq: 1100, to: 1500, dur: 0.1, type: 'triangle', vol: 0.12, delay: 0.03 });
  },
  hurt() { tone({ freq: 300, to: 120, dur: 0.15, type: 'sawtooth', vol: 0.12 }); },
  bonk(pos, listener) { tone({ freq: 500, to: 200, dur: 0.1, type: 'triangle', vol: 0.15 * falloff(pos, listener) }); },
  // Bigger chips make a lower, chunkier clink.
  pickup(value = 5) {
    const f = value >= 100 ? 900 : value >= 25 ? 1300 : 1700;
    tone({ freq: f + Math.random() * 200, to: f * 1.5, dur: value >= 25 ? 0.1 : 0.06, type: 'triangle', vol: value >= 25 ? 0.1 : 0.06 });
  },
  boom(pos, listener) {
    const v = falloff(pos, listener) * 0.7 + 0.3;
    noise({ dur: 0.9, vol: 0.6 * v, freq: 1200, to: 60 });
    tone({ freq: 120, to: 30, dur: 0.6, type: 'sine', vol: 0.5 * v });
  },
  bust(pos, listener) {
    const v = falloff(pos, listener);
    [500, 400, 300, 200].forEach((f, i) => tone({ freq: f, to: f * 0.9, dur: 0.14, type: 'square', vol: 0.08 * v, delay: i * 0.12 }));
  },
  jump() { tone({ freq: 300, to: 600, dur: 0.12, type: 'sine', vol: 0.08 }); },
  lever(pos, listener) { noise({ dur: 0.2, vol: 0.15 * falloff(pos, listener), freq: 400, to: 1500, q: 6 }); },
  tick(pos, listener) { tone({ freq: 1200, dur: 0.02, type: 'square', vol: 0.025 * falloff(pos, listener) }); },
  reelStop(pos, listener) { tone({ freq: 250, to: 180, dur: 0.08, type: 'square', vol: 0.1 * falloff(pos, listener) }); },
  win(pos, listener) {
    const v = falloff(pos, listener);
    [660, 880].forEach((f, i) => tone({ freq: f, dur: 0.12, type: 'triangle', vol: 0.12 * v, delay: i * 0.1 }));
  },
  jackpot(pos, listener) {
    const v = Math.max(0.3, falloff(pos, listener));
    [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone({ freq: f, dur: 0.16, type: 'square', vol: 0.1 * v, delay: i * 0.09 }));
  },
  alert(pos, listener) {
    const v = falloff(pos, listener);
    [880, 660].forEach((f, i) => tone({ freq: f, dur: 0.09, type: 'square', vol: 0.06 * v, delay: i * 0.09 }));
  },
  zap(pos, listener) { tone({ freq: 1400, to: 300, dur: 0.08, type: 'sawtooth', vol: 0.06 * falloff(pos, listener) }); },
  heal() { [523, 784].forEach((f, i) => tone({ freq: f, dur: 0.12, type: 'sine', vol: 0.1, delay: i * 0.08 })); },
  open(pos, listener) { noise({ dur: 0.25, vol: 0.12 * falloff(pos, listener), freq: 900, to: 300, q: 3 }); },
  extract() { [392, 523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.2, type: 'triangle', vol: 0.12, delay: i * 0.1 })); },
  // The extraction siren: heard across the whole map.
  siren(near = 1) { [0, 0.45].forEach((d) => tone({ freq: 520, to: 880, dur: 0.42, type: 'sawtooth', vol: 0.05 * near + 0.025, delay: d })); },
  deny() { tone({ freq: 200, to: 150, dur: 0.18, type: 'square', vol: 0.1 }); },
  cashout() { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone({ freq: f, dur: 0.25, type: 'triangle', vol: 0.14, delay: i * 0.12 })); },
};
