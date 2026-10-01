// Every tunable number in the game lives here.

export const WORLD = { halfW: 32, halfD: 22, wallH: 8 };

export const PLAYER = {
  radius: 0.5,
  walk: 6.5,
  sprint: 10,
  jump: 8.5,
  gravity: 24,
  headHeight: 1.45,
};

export const START_CHIPS = 100;
// If you go bust, the house spots you this many chips when you respawn.
export const LOAN_CHIPS = 40;
// First to this many chips cashes out and wins the round.
export const WIN_CHIPS = 500;
export const RESPAWN_TIME = 4;
export const BOT_COUNT = 5;
// Each physical chip on the floor is worth this much.
export const CHIP_VALUE = 5;

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

export const MACHINES = [
  { name: 'PENNY SLOTS', cost: 10, color: 0x2a9d8f, odds: [35, 35, 22, 8], jackpot: 0.06 },
  { name: 'LUCKY 7s', cost: 25, color: 0xe63946, odds: [15, 35, 35, 15], jackpot: 0.12 },
  { name: 'WHALE', cost: 50, color: 0x7b2cbf, odds: [5, 25, 40, 30], jackpot: 0.2 },
];

// Three of a kind: armor plus a chip payout that sprays out of the machine.
export const JACKPOT = { armor: 40, flat: 20, multiplier: 3 };

export const FILLER_SYMBOLS = ['🍒', '💎', '🔔'];

export const COLORS = [0xff5d5d, 0x4dabff, 0xffd23f, 0x5ee27a, 0xc77dff, 0xff9f43, 0x2ee6d6, 0xff7eb6];
export const HATS = ['top', 'cowboy', 'visor', 'party', 'crown'];
export const BOT_NAMES = ['Dealer Dan', 'Lucky Lou', 'Big Stack Betty', 'Slots McGee', 'Card Shark', 'Snake Eyes', 'Pit Boss Pete'];
