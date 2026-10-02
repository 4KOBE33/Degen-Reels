// Long-term progress: lifetime stats, the collection log (everything you've ever extracted),
// XP and levels, and achievements. Finding the best loot is the goal; this is the scoreboard.
import { save, STAT_DEFAULTS } from './save.js';

export { STAT_DEFAULTS };
import { WEAPONS, ITEMS, RARITIES, RARITY_BY_TIER } from './config.js';
import { isGun } from './items.js';

export const GUN_KINDS = ['spoon', 'pistol', 'smg', 'shotgun', 'rifle', 'rocket'];
export const MAX_LEVEL = 50;


// ---------- the collection log ----------

export function itemKey(item) {
  return isGun(item) ? `gun:${item.kind}:${item.rarity || 0}` : `item:${item.id}`;
}

// Every collectible in the game, rarest last within each group.
export function collectionEntries() {
  const guns = [];
  for (const kind of GUN_KINDS) {
    for (let r = 0; r < RARITIES.length; r++) {
      guns.push({ key: `gun:${kind}:${r}`, group: 'Guns', kind, rarity: r, name: `${r ? `${RARITIES[r].name} ` : ''}${WEAPONS[kind].name}`, css: RARITIES[r].css, hint: gunHint(kind, r) });
    }
  }
  const items = Object.entries(ITEMS).map(([id, def]) => ({
    key: `item:${id}`, group: def.kind === 'valuable' || def.kind === 'key' ? 'Valuables' : 'Gear', id, name: def.name, icon: def.icon,
    rarity: def.legendary ? 3 : def.value >= 800 ? 2 : def.value >= 250 ? 1 : 0,
    css: def.legendary ? RARITIES[3].css : def.value >= 800 ? RARITIES[2].css : '#e5e7eb', hint: itemHint(id),
  }));
  return [...guns, ...items];
}

function gunHint(kind, r) {
  const where = kind === 'rocket' ? 'the casino, the vault or the Pit Boss' : kind === 'rifle' ? 'the casino and deadly zones' : kind === 'spoon' ? 'the outskirts' : 'anywhere';
  const best = RARITY_BY_TIER[4][r];
  if (r === 3) return `Legendary · only in deadly zones (up to ${best}% of gun drops in the vault) · try ${where}`;
  if (r === 2) return `Epic · casino and deadly zones are your best bet · ${where}`;
  return `${RARITIES[r].name} · ${where}`;
}

function itemHint(id) {
  return {
    clover: 'Legendary · 0.5% from casino loot, 2% in the vault, 20% from the Pit Boss',
    crown: "Legendary · a 1% drop from the Pit Boss. The rarest thing in the game",
    trophy: 'Casino and vault loot', ring: 'Casino and vault loot', keycard: 'Casino loot and the Pit Boss',
    tooth: 'Gators in Bayou Royale', cocoa: 'Common in the snow', watch: 'The Strip and the casino',
  }[id] || 'Crates, lockers and loot slots';
}

export function collectionProgress(d = save.get()) {
  const all = collectionEntries();
  const found = all.filter((e) => d.collection[e.key]).length;
  return { found, total: all.length };
}

// ---------- levels ----------

// XP needed to go from `level` to the next one.
export function xpToNext(level) { return 200 + (level - 1) * 120; }

export function levelInfo(xp = save.get().xp) {
  let level = 1;
  let left = xp;
  while (level < MAX_LEVEL && left >= xpToNext(level)) { left -= xpToNext(level); level++; }
  const need = level >= MAX_LEVEL ? 1 : xpToNext(level);
  return { level, into: level >= MAX_LEVEL ? 1 : left, need, frac: level >= MAX_LEVEL ? 1 : left / need };
}

// ---------- achievements ----------
// tier: 0 Common, 1 Rare, 2 Epic, 3 Legendary. `prog` returns [current, goal].

const S = (d) => d.stats;
const has = (d, key) => (d.collection[key] || 0) > 0;
const legendaryGuns = (d) => GUN_KINDS.filter((k) => has(d, `gun:${k}:3`)).length;
const anyGun = (d, r) => GUN_KINDS.some((k) => has(d, `gun:${k}:${r}`));

export const ACHIEVEMENTS = [
  // Getting out alive
  { id: 'extract1', group: 'Survival', icon: '🚪', tier: 0, name: 'Made It Out', desc: 'Extract from a raid', prog: (d) => [S(d).extracts, 1] },
  { id: 'extract10', group: 'Survival', icon: '🧳', tier: 1, name: 'Regular', desc: 'Extract 10 times', prog: (d) => [S(d).extracts, 10] },
  { id: 'extract50', group: 'Survival', icon: '🏃', tier: 2, name: 'Ghost of the Strip', desc: 'Extract 50 times', prog: (d) => [S(d).extracts, 50] },
  { id: 'worldtour', group: 'Survival', icon: '🗺️', tier: 1, name: 'World Tour', desc: 'Extract from every map', prog: (d) => [['vegas', 'frost', 'bayou', 'tequila', 'bunker'].filter((m) => (S(d).extractsByMap[m] || 0) > 0).length, 5] },
  { id: 'haul5k', group: 'Survival', icon: '💰', tier: 1, name: 'Nice Haul', desc: 'Extract with 🪙 5,000 worth in one raid', prog: (d) => [Math.min(S(d).bestHaul, 5000), 5000] },
  { id: 'haul25k', group: 'Survival', icon: '🤑', tier: 3, name: 'Robbed the House', desc: 'Extract with 🪙 25,000 worth in one raid', prog: (d) => [Math.min(S(d).bestHaul, 25000), 25000] },
  // Fighting
  { id: 'machines25', group: 'Combat', icon: '🔧', tier: 0, name: 'Scrap Collector', desc: 'Bust 25 machines', prog: (d) => [S(d).machines, 25] },
  { id: 'machines250', group: 'Combat', icon: '⚙️', tier: 2, name: 'Machine Breaker', desc: 'Bust 250 machines', prog: (d) => [S(d).machines, 250] },
  { id: 'crits100', group: 'Combat', icon: '🎯', tier: 1, name: 'Sharpshooter', desc: 'Land 100 critical hits', prog: (d) => [S(d).crits, 100] },
  { id: 'raiders10', group: 'Combat', icon: '🤠', tier: 1, name: 'Bounty Hunter', desc: 'Bust 10 rival raiders', prog: (d) => [S(d).raiders, 10] },
  { id: 'gators10', group: 'Combat', icon: '🐊', tier: 1, name: 'Gator Wrangler', desc: 'Take down 10 gators', prog: (d) => [S(d).gators, 10] },
  { id: 'boss1', group: 'Combat', icon: '👑', tier: 2, name: 'Pit Stop', desc: 'Take down the Pit Boss', prog: (d) => [S(d).bossKills, 1] },
  { id: 'boss5', group: 'Combat', icon: '🏆', tier: 3, name: 'The House Always Loses', desc: 'Take down the Pit Boss 5 times', prog: (d) => [S(d).bossKills, 5] },
  { id: 'revive3', group: 'Combat', icon: '🤝', tier: 1, name: 'Good Samaritan', desc: 'Revive 3 downed raiders', prog: (d) => [S(d).revives, 3] },
  { id: 'selfrez', group: 'Combat', icon: '🎟️', tier: 1, name: 'Second Chance', desc: 'Pick yourself up with a Second Chance Token', prog: (d) => [S(d).selfRevives, 1] },
  { id: 'dice6', group: 'Combat', icon: '🎲', tier: 1, name: 'Loaded', desc: 'Roll a 6 with a thrown Loaded Dice', prog: (d) => [S(d).diceSixes, 1] },
  { id: 'stun4', group: 'Combat', icon: '✨', tier: 1, name: 'Lights Out', desc: 'Stun 4 enemies with one Flash Chip', prog: (d) => [Math.min(S(d).bestStun, 4), 4] },
  // Finding the good stuff
  { id: 'rare', group: 'Loot', icon: '🔵', tier: 0, name: 'Feeling Lucky', desc: 'Extract with a Rare gun', prog: (d) => [anyGun(d, 1) ? 1 : 0, 1] },
  { id: 'epic', group: 'Loot', icon: '🟣', tier: 1, name: 'Hot Streak', desc: 'Extract with an Epic gun', prog: (d) => [anyGun(d, 2) ? 1 : 0, 1] },
  { id: 'legendary', group: 'Loot', icon: '🌟', tier: 2, name: 'Jackpot', desc: 'Extract with a Legendary gun', prog: (d) => [anyGun(d, 3) ? 1 : 0, 1] },
  { id: 'fullhouse', group: 'Loot', icon: '🃏', tier: 3, name: 'Full House', desc: 'Extract with every Legendary gun', prog: (d) => [legendaryGuns(d), GUN_KINDS.length] },
  { id: 'clover', group: 'Loot', icon: '🍀', tier: 3, name: 'Luck of the Draw', desc: 'Extract with a Four-Leaf Clover', prog: (d) => [has(d, 'item:clover') ? 1 : 0, 1] },
  { id: 'crown', group: 'Loot', icon: '👑', tier: 3, name: "The House's Crown", desc: "Extract with The House's Crown. The rarest thing in the game", prog: (d) => [has(d, 'item:crown') ? 1 : 0, 1] },
  { id: 'collect50', group: 'Loot', icon: '📖', tier: 2, name: 'Collector', desc: 'Fill half the collection log', prog: (d) => { const c = collectionProgress(d); return [c.found, Math.ceil(c.total / 2)]; } },
  { id: 'collectall', group: 'Loot', icon: '📚', tier: 3, name: 'Completionist', desc: 'Fill the whole collection log', prog: (d) => { const c = collectionProgress(d); return [c.found, c.total]; } },
  { id: 'containers100', group: 'Loot', icon: '📦', tier: 1, name: 'Rummager', desc: 'Search 100 containers', prog: (d) => [S(d).containers, 100] },
  // The Back Room
  { id: 'blackjack', group: 'Gambling', icon: '🂡', tier: 0, name: 'Twenty-One', desc: 'Hit a natural blackjack', prog: (d) => [S(d).blackjacks, 1] },
  { id: 'green', group: 'Gambling', icon: '🟢', tier: 1, name: 'Going Green', desc: 'Win on green in Roulette', prog: (d) => [S(d).rouletteGreens, 1] },
  { id: 'crash10', group: 'Gambling', icon: '🚀', tier: 2, name: 'To the Moon', desc: 'Cash out at 10x or more in Crash', prog: (d) => [Math.min(S(d).crashBest, 10), 10] },
  { id: 'bigwin', group: 'Gambling', icon: '💸', tier: 2, name: 'High Roller', desc: 'Win 🪙 5,000 on a single bet', prog: (d) => [Math.min(S(d).biggestWin, 5000), 5000] },
  { id: 'mines10', group: 'Gambling', icon: '💎', tier: 2, name: 'Minesweeper', desc: 'Cash out of Mines after finding 10 gems', prog: (d) => [Math.min(S(d).minesBest, 10), 10] },
  { id: 'plinko24', group: 'Gambling', icon: '🔴', tier: 2, name: 'Edge Lord', desc: 'Land a 24x or better in Plinko', prog: (d) => [Math.min(S(d).plinkoBest, 24), 24] },
  { id: 'reels50', group: 'Gambling', icon: '🎰', tier: 1, name: 'Reel Regular', desc: 'Pull the Loot Reels 50 times', prog: (d) => [S(d).reelsPulled, 50] },
  // Levels
  { id: 'level5', group: 'Levels', icon: '⭐', tier: 0, name: 'Getting Started', desc: 'Reach level 5', prog: (d) => [Math.min(levelInfo(d.xp).level, 5), 5] },
  { id: 'level15', group: 'Levels', icon: '🌟', tier: 1, name: 'Seasoned', desc: 'Reach level 15', prog: (d) => [Math.min(levelInfo(d.xp).level, 15), 15] },
  { id: 'level30', group: 'Levels', icon: '💫', tier: 2, name: 'Veteran', desc: 'Reach level 30', prog: (d) => [Math.min(levelInfo(d.xp).level, 30), 30] },
  { id: 'level50', group: 'Levels', icon: '🏅', tier: 3, name: 'Legend of Lost Vegas', desc: 'Reach level 50', prog: (d) => [Math.min(levelInfo(d.xp).level, 50), 50] },
];
const TIER_XP = [50, 150, 400, 1000];
export const TIER_NAMES = ['Common', 'Rare', 'Epic', 'Legendary'];

// Unlock anything newly earned. Call inside or after a save.update. Returns the new ones.
function checkInto(d) {
  const fresh = [];
  // Achievements can grant XP, which can unlock level achievements, so loop until it settles.
  for (let pass = 0; pass < 4; pass++) {
    let any = false;
    for (const a of ACHIEVEMENTS) {
      if (d.achievements[a.id]) continue;
      const [cur, goal] = a.prog(d);
      if (cur >= goal) {
        d.achievements[a.id] = Date.now();
        d.xp += TIER_XP[a.tier];
        fresh.push(a);
        any = true;
      }
    }
    if (!any) break;
  }
  return fresh;
}

// Apply a change to the profile, then report anything it unlocked: achievements, levels, looks.
export function progress(change) {
  const before = levelInfo().level;
  const lookBefore = unlockedLookSet();
  let fresh = [];
  save.update((d) => {
    change(d);
    fresh = checkInto(d);
  });
  const after = levelInfo().level;
  const looks = [...unlockedLookSet()].filter((k) => !lookBefore.has(k));
  return { achievements: fresh, levelUp: after > before ? after : 0, looks };
}

// Looks unlocked by level or achievement. Filled in by looks.js to avoid an import loop.
let lookCatalog = null;
export function registerLooks(catalog) { lookCatalog = catalog; }
export function lookUnlocked(opt, d = save.get()) {
  const u = opt.unlock;
  if (!u) return true;
  if (u.level) return levelInfo(d.xp).level >= u.level;
  if (u.ach) return !!d.achievements[u.ach];
  return false;
}
function unlockedLookSet() {
  const set = new Set();
  if (!lookCatalog) return set;
  for (const [part, opts] of Object.entries(lookCatalog)) for (const o of opts) if (o.unlock && lookUnlocked(o)) set.add(`${part}:${o.id}`);
  return set;
}
export function lookName(key) {
  const [part, id] = key.split(':');
  const opt = lookCatalog && lookCatalog[part] && lookCatalog[part].find((o) => String(o.id) === id);
  return opt ? `${opt.name} (${part})` : key;
}

// ---------- recording a raid ----------

// XP for a raid: getting out pays most, bigger hauls pay more, dying still teaches you something.
export function raidXp(result) {
  const run = result.run;
  let xp = 20 + run.machines * 8 + run.raiders * 25 + (run.boss ? 300 : 0);
  if (result.success) xp += 100 + Math.round(Math.sqrt(result.value) * 3);
  return xp;
}

export function recordRaid(result, mapId) {
  const run = result.run;
  const xp = raidXp(result);
  const out = progress((d) => {
    const s = d.stats;
    s.machines += run.machines;
    s.raiders += run.raiders;
    s.gators += run.gators || 0;
    s.crits += run.crits || 0;
    s.throws += run.throws || 0;
    s.containers += run.containers || 0;
    s.slotPulls += run.slotPulls || 0;
    s.diceSixes += run.diceSixes || 0;
    s.bestStun = Math.max(s.bestStun, run.bestStun || 0);
    s.revives += run.revives || 0;
    s.selfRevives += run.selfRevives || 0;
    s.timePlayed += Math.round(result.time || 0);
    if (result.success) {
      s.extracts++;
      s.extractsByMap[mapId] = (s.extractsByMap[mapId] || 0) + 1;
      s.bestHaul = Math.max(s.bestHaul, result.value);
      s.totalHaul += result.value;
      s.chipsExtracted += result.chips;
      for (const it of result.items) {
        const k = itemKey(it);
        if (!d.collection[k]) result.newFinds.push(it);
        d.collection[k] = (d.collection[k] || 0) + (it.qty || 1);
      }
    } else s.deaths++;
    d.xp += xp;
  });
  return { ...out, xp };
}

// Something won in the Back Room counts as found, too.
export function recordFind(item) {
  return progress((d) => { const k = itemKey(item); d.collection[k] = (d.collection[k] || 0) + (item.qty || 1); });
}
