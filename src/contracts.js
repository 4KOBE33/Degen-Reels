// Daily Contracts: three goals a day (one easy, one medium, one hard) that pay chips and XP.
// Everyone gets the same three on the same day. Progress counts from when the day's contracts
// were handed out, using the stats the game already keeps. One free reroll a day.
import { save } from './save.js';
import { progress } from './progress.js';
import { MAPS } from './map.js';

const fmt = (n) => Math.round(n).toLocaleString('en-US');

// Each kind: the stat it counts, how to word it, and [goal, chips, xp] for easy / medium / hard.
const KINDS = {
  extract: { icon: '🚁', stat: 'extracts', text: (n) => `Extract ${n} time${n > 1 ? 's' : ''}`, tiers: [[1, 400, 100], [2, 900, 160], [4, 2000, 260]] },
  machines: { icon: '🤖', stat: 'machines', text: (n) => `Bust ${n} machines`, tiers: [[12, 350, 90], [25, 800, 150], [45, 1600, 240]] },
  raiders: { icon: '🎯', stat: 'raiders', text: (n) => `Take out ${n} rival raider${n > 1 ? 's' : ''}`, tiers: [[1, 400, 100], [3, 1000, 170], [6, 2200, 270]] },
  containers: { icon: '📦', stat: 'containers', text: (n) => `Search ${n} containers`, tiers: [[12, 300, 80], [25, 700, 140], [45, 1500, 230]] },
  haul: { icon: '💰', stat: 'totalHaul', text: (n) => `Extract 🪙 ${fmt(n)} worth of loot`, tiers: [[1500, 400, 100], [4000, 900, 160], [10000, 2200, 270]] },
  crits: { icon: '💥', stat: 'crits', text: (n) => `Land ${n} critical hits`, tiers: [[15, 350, 90], [35, 800, 150], [70, 1700, 240]] },
  throws: { icon: '💣', stat: 'throws', text: (n) => `Throw ${n} throwables`, tiers: [[2, 300, 80], [5, 700, 140], [10, 1500, 230]] },
  wager: { icon: '🎰', stat: 'wagered', text: (n) => `Bet 🪙 ${fmt(n)} in the Back Room or Lounge`, tiers: [[500, 300, 80], [2500, 800, 150], [10000, 2000, 250]] },
  reels: { icon: '🎰', stat: 'reelsPulled', text: (n) => `Spin the Loot Reels ${n} times`, tiers: [[3, 300, 80], [8, 700, 140], [15, 1400, 220]] },
  slots: { icon: '🍒', stat: 'slotPulls', text: (n) => `Pull ${n} slot machine${n > 1 ? 's' : ''} during raids`, tiers: [[2, 350, 90], [4, 800, 150], [8, 1600, 240]] },
  blackjack: { icon: '🃏', stat: 'blackjacks', text: (n) => `Hit ${n} blackjack${n > 1 ? 's' : ''}`, tiers: [[1, 450, 100], [2, 1000, 170], [4, 2200, 260]] },
  bounty: { icon: '💰', stat: 'bounties', text: () => 'Claim a bounty on a WANTED raider', tiers: [[1, 1200, 180], [1, 1200, 180], [1, 1200, 180]], hardOnly: true },
  drops: { icon: '🪂', stat: 'supplyDrops', text: (n) => `Crack open ${n} supply drop${n > 1 ? 's' : ''}`, tiers: [[1, 600, 120], [1, 600, 120], [2, 1500, 220]] },
  boss: { icon: '👑', stat: 'bossKills', text: () => 'Bust a casino boss', tiers: [[1, 3500, 350], [1, 3500, 350], [1, 3500, 350]], hardOnly: true },
  map: { icon: '🗺️', stat: 'map', text: (n, m) => `Extract from ${MAPS[m] ? MAPS[m].name : m}`, tiers: [[1, 600, 120], [1, 600, 120], [1, 600, 120]] },
};
const RAID_MAPS = Object.keys(MAPS).filter((id) => !MAPS[id].safe && !MAPS[id].tutorial);

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// A little seeded random, so the day's contracts are the same for everyone.
function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function statOf(d, c) {
  if (c.kind === 'map') return (d.stats.extractsByMap || {})[c.map] || 0;
  return d.stats[KINDS[c.kind].stat] || 0;
}

function make(d, kind, tier, rnd) {
  const k = KINDS[kind];
  const [goal, chips, xp] = k.tiers[tier];
  const c = { kind, tier, goal, chips, xp, claimed: false };
  if (kind === 'map') c.map = RAID_MAPS[Math.floor(rnd() * RAID_MAPS.length)];
  c.base = statOf(d, c);
  return c;
}

function pickKind(rnd, tier, taken) {
  const pool = Object.keys(KINDS).filter((k) => !taken.includes(k) && (!KINDS[k].hardOnly || tier === 2));
  return pool[Math.floor(rnd() * pool.length)];
}

// Today's contracts, handing out fresh ones if it's a new day.
export function contracts() {
  const d = save.get();
  const day = today();
  if (!d.contracts || d.contracts.day !== day) {
    save.update((x) => {
      const rnd = seeded(day);
      const list = [];
      for (let tier = 0; tier < 3; tier++) list.push(make(x, pickKind(rnd, tier, list.map((c) => c.kind)), tier, rnd));
      x.contracts = { day, list, rerolled: false, seen: 0 };
    });
  }
  return save.get().contracts;
}

export function contractView(c, d = save.get()) {
  const k = KINDS[c.kind];
  const cur = Math.max(0, Math.min(c.goal, statOf(d, c) - c.base));
  return { icon: k.icon, text: k.text(c.goal, c.map), cur, goal: c.goal, done: cur >= c.goal, claimed: c.claimed, chips: c.chips, xp: c.xp, tier: c.tier };
}

// How many are finished but not claimed (for a nudge on the main page).
export function readyCount() {
  const d = save.get();
  const cs = contracts();
  return cs.list.filter((c) => !c.claimed && contractView(c, d).done).length;
}

export function claim(i) {
  const cs = contracts();
  const c = cs.list[i];
  if (!c || c.claimed || !contractView(c).done) return null;
  const out = progress((d) => {
    d.contracts.list[i].claimed = true;
    d.stash.chips += c.chips;
    d.xp += c.xp;
  });
  return { ...out, chips: c.chips, xp: c.xp };
}

// Swap one unfinished contract for a different one (once a day).
export function reroll(i) {
  const cs = contracts();
  const c = cs.list[i];
  if (!c || cs.rerolled || c.claimed || contractView(c).done) return false;
  save.update((d) => {
    const rnd = seeded(`${cs.day}:${i}:reroll:${Date.now()}`);
    const taken = d.contracts.list.map((x) => x.kind);
    d.contracts.list[i] = make(d, pickKind(rnd, c.tier, taken), c.tier, rnd);
    d.contracts.rerolled = true;
  });
  return true;
}

// Hours and minutes until tomorrow's contracts.
export function resetsIn() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const m = Math.max(0, Math.round((next - now) / 60000));
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
