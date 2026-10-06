// Your permanent profile: stash, settings, look, stats, XP, collection log and achievements.
import { START_STASH, SETTINGS_DEFAULT } from './config.js';
import { restack } from './items.js';
import { seal } from './seal.js';

const KEY = 'degen-reels-raid-v1';

export const STAT_DEFAULTS = {
  raids: 0, extracts: 0, deaths: 0, bossKills: 0, bestHaul: 0, totalHaul: 0, chipsExtracted: 0,
  machines: 0, raiders: 0, gators: 0, crits: 0, throws: 0, containers: 0, slotPulls: 0, diceSixes: 0, bestStun: 0,
  timePlayed: 0, revives: 0, selfRevives: 0, wagered: 0, gambleWon: 0, blackjacks: 0, crashBest: 0, rouletteGreens: 0, reelsPulled: 0, biggestWin: 0, minesBest: 0, plinkoBest: 0,
  extractsByMap: {},
};

export const LOOK_DEFAULT = { name: '', color: null, hat: 'top', eyes: 'normal', mouth: 'smile', glasses: 'none', neck: 'none', shoes: 0x2b2140 };

function fresh() {
  return {
    stash: JSON.parse(JSON.stringify(START_STASH)),
    settings: { ...SETTINGS_DEFAULT },
    look: { ...LOOK_DEFAULT },
    stats: JSON.parse(JSON.stringify(STAT_DEFAULTS)),
    xp: 0,
    collection: {},
    achievements: {},
  };
}

// Fill in anything an older (or cloud) save is missing.
function normalize(stored) {
  const d = { ...fresh(), ...stored };
  d.settings = { ...SETTINGS_DEFAULT, ...stored.settings };
  d.look = { ...LOOK_DEFAULT, ...stored.look };
  d.stats = { ...JSON.parse(JSON.stringify(STAT_DEFAULTS)), ...stored.stats };
  d.stats.extractsByMap = { ...(stored.stats && stored.stats.extractsByMap) };
  d.collection = { ...stored.collection };
  d.achievements = { ...stored.achievements };
  d.xp = stored.xp || 0;
  // Stacks over the limit (from before stash stacks were capped) get split up.
  d.stash = { ...d.stash, items: restack(d.stash.items) };
  return d;
}

// Saves are stored sealed ({ v: 2, s: fingerprint, d: save }). One that's been edited by hand
// doesn't match its fingerprint: the stash, XP and stats go back to a fresh start (your look and
// settings stay), and a logged-in player gets their cloud save back instead.
const SEALED = 'degen-reels-sealed';
let data = fresh();
let tampered = false;
try {
  const stored = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (stored && stored.v === 2) {
    if (stored.d && seal(JSON.stringify(stored.d)) === stored.s) data = normalize(stored.d);
    else tampered = true;
  } else if (stored) {
    // A save from before sealing: fine once. After that, an unsealed save means someone wrote it.
    if (localStorage.getItem(SEALED)) tampered = true;
    else data = normalize(stored);
  }
  if (tampered && stored) {
    const old = stored.v === 2 ? stored.d || {} : stored;
    data = fresh();
    if (old.look) data.look = { ...LOOK_DEFAULT, ...old.look };
    if (old.settings) data.settings = { ...SETTINGS_DEFAULT, ...old.settings };
    if (old.tutorialDone) data.tutorialDone = true;
  }
} catch (e) { /* storage blocked: progress lasts for this visit only */ }

const listeners = [];
function persist() {
  try {
    const json = JSON.stringify(data);
    localStorage.setItem(KEY, `{"v":2,"s":"${seal(json)}","d":${json}}`);
    localStorage.setItem(SEALED, '1');
  } catch (e) { /* storage blocked */ }
  for (const fn of listeners) fn(data);
}

export const save = {
  get: () => data,
  // The save on this device had been edited, so it was reset (see above).
  get tampered() { return tampered; },
  clearTampered() { tampered = false; },
  // The fingerprint the server checks before it takes a cloud save.
  sealOf: (d) => seal(JSON.stringify(d)),

  // Applies a change and saves it.
  update(change) {
    change(data);
    persist();
  },

  reset() {
    data = fresh();
    persist();
  },

  // Swap in a whole save (e.g. one loaded from the cloud).
  replace(stored) {
    data = normalize(stored);
    persist();
  },

  // Called after every change.
  onChange(fn) { listeners.push(fn); },
};

// A reset save gets sealed right away.
if (tampered) persist();
