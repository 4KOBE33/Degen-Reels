// Your permanent profile: stash, settings, look, stats and unlocked hats.
import { HAT_UNLOCKS, START_STASH, SETTINGS_DEFAULT } from './config.js';

const KEY = 'degen-reels-raid-v1';

function fresh() {
  return {
    stash: JSON.parse(JSON.stringify(START_STASH)),
    settings: { ...SETTINGS_DEFAULT },
    look: { name: '', color: null, hat: 'top' },
    stats: { raids: 0, extracts: 0, deaths: 0, bossKills: 0, bestHaul: 0 },
  };
}

let data = fresh();
try {
  const stored = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (stored) {
    data = { ...fresh(), ...stored };
    data.settings = { ...SETTINGS_DEFAULT, ...stored.settings };
    data.stats = { ...fresh().stats, ...stored.stats };
  }
} catch (e) { /* storage blocked: progress lasts for this visit only */ }

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* storage blocked */ }
}

export const save = {
  get: () => data,

  hatUnlocked(hat) {
    const rule = HAT_UNLOCKS[hat];
    if (!rule) return true;
    if (rule.extracts) return data.stats.extracts >= rule.extracts;
    if (rule.boss) return data.stats.bossKills >= rule.boss;
    return false;
  },

  // Applies a change, saves, and returns the names of any hats it unlocked.
  update(change) {
    const before = Object.keys(HAT_UNLOCKS).filter((h) => save.hatUnlocked(h));
    change(data);
    persist();
    return Object.keys(HAT_UNLOCKS).filter((h) => save.hatUnlocked(h) && !before.includes(h));
  },

  reset() {
    data = fresh();
    persist();
  },
};
