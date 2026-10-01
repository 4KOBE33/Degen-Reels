// Every tunable number in the game lives here.

export const WALL_H = 8;

export const PLAYER = {
  radius: 0.5,
  walk: 6.5,
  sprint: 10,
  jump: 8.5,
  gravity: 24,
  headHeight: 1.45,
};

export const START_CHIPS = 100;
// Each physical chip on the floor is worth this much.
export const CHIP_VALUE = 5;
// How often a fresh rival walks in (seconds), up to the floor's rival count.
export const RIVAL_ARRIVAL = 35;

// A run climbs these floors. Pay the elevator fee before closing time to go up.
export const FLOORS = [
  {
    name: 'The Lucky Dump',
    halfW: 32, halfD: 22,
    fee: 250, time: 240,
    bets: [10, 25, 50, 100],
    rivals: 4, rivalChips: 100, rivalGuns: [], rivalArmor: 0,
    roulette: 1, blackjack: 2, crash: 1, slots: 9,
    rarityBoost: 0,
    theme: { carpet: '#8e1b2c', carpet2: '#a8263a', accent: '#d4a63a', wall: 0x3a1d5c, wallLow: 0x24103d, trim: 0xd4a63a, felt: 0x1f8a4c, neon: '#ff3fa4', fog: 0x1a0f2e },
  },
  {
    name: 'The Golden Goose',
    halfW: 40, halfD: 28,
    fee: 600, time: 270,
    bets: [25, 50, 100, 250],
    rivals: 6, rivalChips: 180, rivalGuns: ['pistol', 'smg', 'shotgun'], rivalArmor: 0,
    roulette: 2, blackjack: 3, crash: 1, slots: 12,
    rarityBoost: 1,
    theme: { carpet: '#14532d', carpet2: '#166534', accent: '#facc15', wall: 0x3b2a12, wallLow: 0x1f1608, trim: 0xfacc15, felt: 0x7f1d1d, neon: '#facc15', fog: 0x16120a },
  },
  {
    name: 'Diamond Penthouse',
    halfW: 48, halfD: 32,
    fee: 1200, time: 300,
    bets: [50, 100, 250, 500],
    rivals: 7, rivalChips: 300, rivalGuns: ['smg', 'shotgun', 'rocket', 'pistol'], rivalArmor: 40,
    roulette: 3, blackjack: 4, crash: 2, slots: 15,
    rarityBoost: 2,
    theme: { carpet: '#1e1b4b', carpet2: '#312e81', accent: '#7dd3fc', wall: 0x0f172a, wallLow: 0x020617, trim: 0x7dd3fc, felt: 0x1e3a8a, neon: '#7dd3fc', fog: 0x0b1020 },
  },
];

export const WEAPONS = {
  fists: { name: 'Fists', icon: '👊', melee: true, damage: 8, rate: 0.45, range: 2.0, ammo: Infinity },
  spoon: { name: 'Lucky Spoon', icon: '🥄', melee: true, damage: 18, rate: 0.4, range: 2.4, ammo: Infinity },
  pistol: { name: 'Pea Shooter', icon: '🔫', damage: 14, rate: 0.28, spread: 0.012, pellets: 1, range: 70, ammo: 24 },
  smg: { name: 'Bullet Hose', icon: '⚡', damage: 6, rate: 0.08, spread: 0.035, pellets: 1, range: 50, ammo: 80 },
  shotgun: { name: 'Boomstick', icon: '💥', damage: 8, rate: 0.85, spread: 0.09, pellets: 8, range: 22, ammo: 10 },
  rocket: { name: 'Jackpot Launcher', icon: '🚀', damage: 55, rate: 1.3, projectile: true, speed: 30, splash: 4.5, ammo: 5 },
};

// Slot results are rolled by tier; pricier machines favor higher tiers.
export const WEAPON_TIERS = [['spoon'], ['pistol'], ['smg', 'shotgun'], ['rocket']];

export const RARITIES = [
  { name: 'Common', color: null, css: '#e5e7eb', damage: 1, ammo: 1 },
  { name: 'Rare', color: 0x3b82f6, css: '#60a5fa', damage: 1.15, ammo: 1.25 },
  { name: 'Epic', color: 0xa855f7, css: '#c084fc', damage: 1.3, ammo: 1.5 },
  { name: 'Legendary', color: 0xffc83d, css: '#ffc83d', damage: 1.5, ammo: 2 },
];
// Base rarity odds; each floor and machine tier shifts them up.
export const RARITY_ODDS = [70, 22, 7, 1];

// Slot machine tiers. Price scales with the floor's base bet.
export const MACHINES = [
  { name: 'PENNY SLOTS', costMult: 1, color: 0x2a9d8f, odds: [35, 35, 22, 8], jackpot: 0.06 },
  { name: 'LUCKY 7s', costMult: 2.5, color: 0xe63946, odds: [15, 35, 35, 15], jackpot: 0.12 },
  { name: 'WHALE', costMult: 5, color: 0x7b2cbf, odds: [5, 25, 40, 30], jackpot: 0.2 },
];

// Three of a kind: armor plus a chip payout that sprays out of the machine.
export const JACKPOT = { armor: 40, flat: 20, multiplier: 3 };

export const FILLER_SYMBOLS = ['🍒', '💎', '🔔'];

// The cashier, priced in multiples of the floor's base bet.
export const SHOP = {
  armor: { amount: 50, costMult: 4 },
  ammo: { costMult: 3 },
};

export const COLORS = [0xff5d5d, 0x4dabff, 0xffd23f, 0x5ee27a, 0xc77dff, 0xff9f43, 0x2ee6d6, 0xff7eb6];
export const HATS = ['top', 'party', 'cowboy', 'visor', 'crown'];
// Hats unlock permanently; you keep them even when a run ends.
export const HAT_UNLOCKS = {
  top: null,
  party: null,
  cowboy: { floor: 2, text: 'Reach Floor 2' },
  visor: { jackpots: 1, text: 'Hit a slot jackpot' },
  crown: { wins: 1, text: 'Cash out at the top' },
};
export const BOT_NAMES = [
  'Dealer Dan', 'Lucky Lou', 'Big Stack Betty', 'Slots McGee', 'Card Shark', 'Snake Eyes', 'Pit Boss Pete',
  'High Roller Hal', 'Double Down Dot', 'Whale Wendell', 'Chip Chipperson', 'Loaded Lola', 'Busted Bob', 'Martingale Mo',
];
