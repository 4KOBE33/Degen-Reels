// Your permanent profile: stash, settings, look, stats, XP, collection log and achievements.
import { START_STASH, SETTINGS_DEFAULT } from './config.js';

const KEY = 'degen-reels-raid-v1';

export const STAT_DEFAULTS = {
  raids: 0, extracts: 0, deaths: 0, bossKills: 0, bestHaul: 0, totalHaul: 0, chipsExtracted: 0,
  machines: 0, raiders: 0, gators: 0, crits: 0, throws: 0, containers: 0, slotPulls: 0, diceSixes: 0, bestStun: 0,
  timePlayed: 0, revives: 0, selfRevives: 0, wagered: 0, gambleWon: 0, blackjacks: 0, crashBest: 0, rouletteGreens: 0, reelsPulled: 0, biggestWin: 0,
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

let data = fresh();
try {
  const stored = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (stored) {
    data = { ...fresh(), ...stored };
    data.settings = { ...SETTINGS_DEFAULT, ...stored.settings };
    data.look = { ...LOOK_DEFAULT, ...stored.look };
    data.stats = { ...JSON.parse(JSON.stringify(STAT_DEFAULTS)), ...stored.stats };
    data.stats.extractsByMap = { ...(stored.stats && stored.stats.extractsByMap) };
    data.collection = { ...stored.collection };
    data.achievements = { ...stored.achievements };
    data.xp = stored.xp || 0;
  }
} catch (e) { /* storage blocked: progress lasts for this visit only */ }

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* storage blocked */ }
}

export const save = {
  get: () => data,

  // Applies a change and saves it.
  update(change) {
    change(data);
    persist();
  },

  reset() {
    data = fresh();
    persist();
  },
};
