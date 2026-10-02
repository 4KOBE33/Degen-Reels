// The soundtrack, synthesized live like everything else (no audio files).
//   lounge – smooth casino jazz for the hub and the High Roller Lounge
//   raid   – a tense groove that brings in the drums when machines are on you
//   boss   – a driving Pit Boss theme
// plus stings for getting out (a fanfare) and getting busted (a sad trombone).
import { audioOut } from './audio.js';

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const LOOKAHEAD = 0.15;

class Music {
  constructor() {
    this.volume = 0.45;
    this.tracks = {};
    this.current = null;
    this.intensity = 0;
    this.timer = null;
  }

  setVolume(v) {
    this.volume = v;
    if (this.bus) this.bus.gain.setTargetAtTime(v * 0.55, this.ctx.currentTime, 0.1);
  }

  // Lazily hook into the audio context once sound is running.
  ready() {
    if (this.ctx) return true;
    const out = audioOut();
    if (!out) return false;
    this.ctx = out.ctx;
    this.bus = this.ctx.createGain();
    this.bus.gain.value = this.volume * 0.55;
    // A touch of room on everything.
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    this.bus.connect(comp).connect(out.master);
    this.noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    for (const name of ['lounge', 'raid', 'boss']) {
      const g = this.ctx.createGain();
      g.gain.value = 0;
      g.connect(this.bus);
      this.tracks[name] = { name, gain: g, step: 0, next: 0, on: false };
    }
    this.timer = setInterval(() => this.tick(), 25);
    return true;
  }

  // Which music should be playing (null for silence), and how intense (0..1).
  set(name, intensity = 0) {
    // Ease toward the new intensity over about a second, however fast frames come.
    const now = performance.now();
    const k = Math.min(1, (now - (this.lastSet || now)) / 900);
    this.lastSet = now;
    this.intensity += (intensity - this.intensity) * k;
    if (name === this.current || !this.ready()) return;
    const t = this.ctx.currentTime;
    if (this.current) {
      const old = this.tracks[this.current];
      old.gain.gain.setTargetAtTime(0, t, 0.6);
      old.stopAt = t + 2.5;
    }
    this.current = name;
    if (name) {
      const tr = this.tracks[name];
      tr.gain.gain.setTargetAtTime(1, t, 0.8);
      if (!tr.on) { tr.on = true; tr.step = 0; tr.next = t + 0.05; }
      tr.stopAt = null;
    }
  }

  tick() {
    const t = this.ctx.currentTime;
    for (const tr of Object.values(this.tracks)) {
      if (!tr.on) continue;
      if (tr.stopAt && t > tr.stopAt) { tr.on = false; continue; }
      const song = SONGS[tr.name];
      const sixteenth = 60 / song.bpm / 4;
      while (tr.next < t + LOOKAHEAD) {
        // Swing: push every other 8th note late.
        const swung = song.swing && tr.step % 4 === 2 ? sixteenth * song.swing : 0;
        song.play(this, tr, tr.step, tr.next + swung, sixteenth);
        tr.step++;
        tr.next += sixteenth;
      }
    }
  }

  // ---------- instruments ----------

  env(out, t, peak, attack, dur) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(out);
    return g;
  }

  osc(type, freq, t, dur, dest) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  bass(tr, note, t, dur, { type = 'triangle', vol = 0.35, cutoff = 600 } = {}) {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    f.connect(this.env(tr.gain, t, vol, 0.01, dur));
    this.osc(type, mtof(note), t, dur, f);
  }

  keys(tr, notes, t, dur, vol = 0.07) {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2400;
    const g = this.env(tr.gain, t, vol, 0.008, dur);
    f.connect(g);
    for (const n of notes) {
      this.osc('sine', mtof(n), t, dur, f);
      this.osc('triangle', mtof(n) * 1.003, t, dur, f);
    }
  }

  brass(tr, notes, t, dur, vol = 0.06) {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(2600, t + 0.06);
    f.frequency.exponentialRampToValueAtTime(900, t + dur);
    f.connect(this.env(tr.gain, t, vol, 0.02, dur));
    for (const n of notes) this.osc('sawtooth', mtof(n), t, dur, f);
  }

  lead(tr, note, t, dur, vol = 0.045) {
    this.osc('square', mtof(note), t, dur, this.env(tr.gain, t, vol, 0.005, dur));
  }

  noise(tr, t, dur, vol, { type = 'highpass', freq = 7000 } = {}) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    src.connect(f).connect(this.env(tr.gain, t, vol, 0.002, dur));
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  kick(tr, t, vol = 0.5) {
    const g = this.env(tr.gain, t, vol, 0.002, 0.28);
    const o = this.osc('sine', 130, t, 0.3, g);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
  }

  snare(tr, t, vol = 0.18) {
    this.noise(tr, t, 0.16, vol, { type: 'bandpass', freq: 1900 });
    this.osc('triangle', 190, t, 0.08, this.env(tr.gain, t, vol * 0.6, 0.002, 0.08));
  }

  // ---------- stings ----------

  sting(kind) {
    if (!this.ready()) return;
    const t = this.ctx.currentTime + 0.05;
    const tr = { gain: this.bus };
    if (kind === 'extract') {
      // A little "you made it" fanfare.
      [[60, 0], [64, 0.12], [67, 0.24], [72, 0.36]].forEach(([n, d]) => this.brass(tr, [n, n + 12], t + d, 0.3, 0.08));
      this.brass(tr, [72, 76, 79], t + 0.5, 1.2, 0.08);
    } else if (kind === 'busted') {
      // Wah, wah, wah, waaaah.
      [[63, 0, 0.35], [62, 0.4, 0.35], [61, 0.8, 0.35], [60, 1.2, 1.1]].forEach(([n, d, len]) => {
        const g = this.env(this.bus, t + d, 0.09, 0.03, len);
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(500, t + d);
        f.frequency.linearRampToValueAtTime(1400, t + d + len * 0.5);
        f.frequency.linearRampToValueAtTime(500, t + d + len);
        f.connect(g);
        const o = this.osc('sawtooth', mtof(n - 12), t + d, len, f);
        if (len > 1) o.frequency.linearRampToValueAtTime(mtof(n - 13), t + d + len);
      });
    }
  }
}

// ---------- the songs ----------
// Each gets called once per 16th note: play(music, track, step, time, sixteenth).

const LOUNGE_CHORDS = [
  { root: 43, notes: [55, 58, 62, 65] }, // Gm7
  { root: 36, notes: [52, 55, 58, 60] }, // C7
  { root: 41, notes: [53, 57, 60, 64] }, // Fmaj7
  { root: 38, notes: [53, 57, 60, 62] }, // Dm7
];
const RAID_BASS = [45, 45, 48, 45, 43, 45, 40, 43];
const RAID_MOTIF = [69, 72, 76, 74, 72, 69, 67, 69];
const BOSS_CHORDS = [[50, 53, 57], [46, 50, 53], [48, 52, 55], [45, 49, 52]]; // Dm Bb C A
const BOSS_BASS = [38, 38, 41, 38, 36, 38, 45, 36];

const SONGS = {
  lounge: {
    bpm: 96,
    swing: 0.35,
    play(m, tr, step, t, s) {
      const bar = Math.floor(step / 16) % 4;
      const beat = step % 16;
      const ch = LOUNGE_CHORDS[bar];
      // Walking bass, one note per beat.
      if (beat % 4 === 0) {
        const walk = [0, 7, 12, 10][beat / 4];
        m.bass(tr, ch.root + walk, t, s * 3.6, { vol: 0.32, cutoff: 700 });
      }
      // Comping chords, a bit late and lazy.
      if (beat === 4 || beat === 10) m.keys(tr, ch.notes, t, s * 3, 0.055);
      // Ride cymbal: ding, ding-a ding.
      if (beat % 4 === 0 || beat % 8 === 6) m.noise(tr, t, 0.12, beat % 4 === 0 ? 0.035 : 0.022, { freq: 8000 });
      // Brushes on 2 and 4.
      if (beat === 4 || beat === 12) m.noise(tr, t, 0.2, 0.025, { type: 'bandpass', freq: 3000 });
      // Every other bar, a little vibes melody.
      if (bar % 2 === 1 && beat % 4 === 2 && Math.random() < 0.6) m.keys(tr, [ch.notes[Math.floor(Math.random() * 4)] + 12], t, s * 2, 0.04);
    },
  },
  raid: {
    bpm: 104,
    play(m, tr, step, t, s) {
      const beat = step % 16;
      const bar = Math.floor(step / 16) % 8;
      const hot = m.intensity;
      // A low ostinato: the house is watching.
      if (step % 2 === 0) m.bass(tr, RAID_BASS[(step / 2) % 8], t, s * 1.8, { type: 'sawtooth', vol: 0.16 + hot * 0.08, cutoff: 420 + hot * 600 });
      // Clock-tick hats.
      m.noise(tr, t, 0.04, beat % 4 === 2 ? 0.03 : 0.012, { freq: 9000 });
      // The casino motif every few bars.
      if (bar % 4 === 3 && beat % 2 === 0) m.keys(tr, [RAID_MOTIF[beat / 2]], t, s * 1.6, 0.035);
      // Machines on you: the drums come in.
      if (hot > 0.3) {
        if (beat === 0 || beat === 8 || beat === 10) m.kick(tr, t, 0.42 * hot);
        if (beat === 4 || beat === 12) m.snare(tr, t, 0.16 * hot);
        if (beat === 0 && bar % 2 === 0) m.brass(tr, [57, 60, 64], t, s * 3, 0.05 * hot);
      }
    },
  },
  boss: {
    bpm: 140,
    play(m, tr, step, t, s) {
      const beat = step % 16;
      const bar = Math.floor(step / 16) % 4;
      if (beat % 4 === 0) m.kick(tr, t, 0.5);
      if (beat === 4 || beat === 12) m.snare(tr, t, 0.2);
      m.noise(tr, t, 0.03, beat % 2 ? 0.015 : 0.03, { freq: 9000 });
      if (step % 2 === 0) m.bass(tr, BOSS_BASS[(step / 2) % 8], t, s * 1.7, { type: 'sawtooth', vol: 0.2, cutoff: 900 });
      if (beat === 0) m.brass(tr, BOSS_CHORDS[bar], t, s * 6, 0.07);
      if (beat === 10) m.brass(tr, BOSS_CHORDS[bar], t, s * 2, 0.05);
      // A frantic arpeggio over the top.
      const ch = BOSS_CHORDS[bar];
      m.lead(tr, ch[step % 3] + 24, t, s * 0.8, 0.03);
    },
  },
};

export const music = new Music();
