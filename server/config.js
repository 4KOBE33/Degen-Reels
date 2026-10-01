// All the tunable numbers for the game live here.

const WEAPONS = {
  spoon: {
    name: 'Lucky Spoon', symbol: '🥄', tier: 0,
    damage: 20, cooldown: 0.4, speed: 700, life: 0.11, pellets: 1, spread: 0, bulletRadius: 16,
  },
  pistol: {
    name: 'Pea Shooter', symbol: '🔫', tier: 1,
    damage: 14, cooldown: 0.3, speed: 900, life: 0.8, pellets: 1, spread: 0.04, bulletRadius: 5,
  },
  smg: {
    name: 'Bullet Hose', symbol: '⚡', tier: 2,
    damage: 7, cooldown: 0.09, speed: 950, life: 0.6, pellets: 1, spread: 0.14, bulletRadius: 4,
  },
  shotgun: {
    name: 'Boomstick', symbol: '💥', tier: 2,
    damage: 9, cooldown: 0.8, speed: 820, life: 0.38, pellets: 6, spread: 0.45, bulletRadius: 4,
  },
  rocket: {
    name: 'Jackpot Launcher', symbol: '🚀', tier: 3,
    damage: 45, cooldown: 1.2, speed: 520, life: 1.5, pellets: 1, spread: 0, bulletRadius: 9, splash: 95,
  },
};

// Weapons grouped by tier. The wager you place decides the odds of each tier.
const WEAPON_TIERS = [['spoon'], ['pistol'], ['smg', 'shotgun'], ['rocket']];

const WAGERS = [
  { cost: 0, name: 'Cheap Seat', odds: [35, 35, 22, 8], jackpot: 0.08 },
  { cost: 15, name: 'High Roller', odds: [15, 35, 35, 15], jackpot: 0.14 },
  { cost: 30, name: 'Whale', odds: [5, 25, 40, 30], jackpot: 0.22 },
];

// Hitting three of a kind gives armor plus a payout.
const JACKPOT = { armor: 40, flatBonus: 20, wagerMultiplier: 3 };

// One "house rule" is dealt each round.
const MODIFIERS = [
  { id: 'normal', name: 'House Rules', icon: '🃏', desc: 'No funny business. Probably.', damageMult: 1, speedMult: 1, chipRain: false },
  { id: 'double', name: 'Double or Nothing', icon: '🎲', desc: 'All damage is doubled.', damageMult: 2, speedMult: 1, chipRain: false },
  { id: 'rush', name: 'Caffeine Rush', icon: '☕', desc: 'Everyone moves 50% faster.', damageMult: 1, speedMult: 1.5, chipRain: false },
  { id: 'rain', name: 'Chip Rain', icon: '🌧️', desc: 'Free chips fall from the ceiling.', damageMult: 1, speedMult: 1, chipRain: true },
  { id: 'lowroller', name: 'Low Roller', icon: '🐢', desc: 'Damage is halved. Long, sweaty fights.', damageMult: 0.5, speedMult: 1, chipRain: false },
];

// Filler symbols for the slot reels that don't match a weapon.
const FILLER_SYMBOLS = ['🍒', '💎', '🍋', '🔔'];

const ARENA = { w: 1800, h: 1200 };

const OBSTACLES = [
  { x: 300, y: 250, w: 220, h: 120, kind: 'table' },
  { x: 1280, y: 250, w: 220, h: 120, kind: 'table' },
  { x: 300, y: 830, w: 220, h: 120, kind: 'table' },
  { x: 1280, y: 830, w: 220, h: 120, kind: 'table' },
  { x: 810, y: 530, w: 180, h: 140, kind: 'table' },
  { x: 820, y: 120, w: 160, h: 60, kind: 'slots' },
  { x: 820, y: 1020, w: 160, h: 60, kind: 'slots' },
  { x: 100, y: 560, w: 60, h: 80, kind: 'slots' },
  { x: 1640, y: 560, w: 60, h: 80, kind: 'slots' },
];

const config = {
  TICK_RATE: 30,
  ARENA,
  OBSTACLES,
  PLAYER_RADIUS: 22,
  PLAYER_SPEED: 230,
  START_CHIPS: 100,
  // Anyone starting a round below this gets topped up by "the house".
  MIN_CHIPS: 40,
  WINNER_BONUS: 25,
  MAX_HUMANS_PER_ROOM: 8,
  // Bots fill the table until there are at least this many players.
  MIN_COMBATANTS: 3,
  PHASE_TIMES: { betting: 8, spin: 4, fight: 75, results: 6 },
  // Dropped chips can't be re-grabbed by their old owner for this long (ms).
  CHIP_OWNER_LOCK_MS: 1200,
  CHIP_RAIN_INTERVAL: 1.5,
  WEAPONS,
  WEAPON_TIERS,
  WAGERS,
  JACKPOT,
  MODIFIERS,
  FILLER_SYMBOLS,
};

// The parts of the config the client needs to draw the game.
config.clientConfig = {
  arena: ARENA,
  obstacles: OBSTACLES,
  playerRadius: config.PLAYER_RADIUS,
  weapons: WEAPONS,
  weaponTiers: WEAPON_TIERS,
  wagers: WAGERS,
  jackpot: JACKPOT,
  fillerSymbols: FILLER_SYMBOLS,
  phaseTimes: config.PHASE_TIMES,
};

module.exports = config;
