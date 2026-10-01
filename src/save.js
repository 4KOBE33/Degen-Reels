// Your permanent profile: best floor, wins, and unlocked hats. Survives across runs.
import { HAT_UNLOCKS } from './config.js';

const KEY = 'degen-reels-save-v1';
const DEFAULT = { bestFloor: 1, runs: 0, wins: 0, jackpots: 0, busts: 0 };

let data = { ...DEFAULT };
try {
  data = { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
} catch (e) { /* storage blocked: progress lasts for this visit only */ }

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* storage blocked */ }
}

export const save = {
  get: () => data,

  hatUnlocked(hat) {
    const rule = HAT_UNLOCKS[hat];
    if (!rule) return true;
    if (rule.floor && data.bestFloor >= rule.floor) return true;
    if (rule.jackpots && data.jackpots >= rule.jackpots) return true;
    if (rule.wins && data.wins >= rule.wins) return true;
    return false;
  },

  // Applies a change and returns the names of any hats it unlocked.
  update(change) {
    const before = Object.keys(HAT_UNLOCKS).filter((h) => save.hatUnlocked(h));
    change(data);
    persist();
    return Object.keys(HAT_UNLOCKS).filter((h) => save.hatUnlocked(h) && !before.includes(h));
  },
};
