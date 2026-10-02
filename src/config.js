// Every tunable number in the game lives here.

export const PLAYER = {
  radius: 0.5,
  // Dodge roll.
  rollCost: 22, rollCooldown: 1.1, rollTime: 0.45, rollSpeed: 13, rollDodge: 0.3,
  walk: 6.5,
  sprint: 10,
  jump: 8.5,
  gravity: 24,
  headHeight: 1.45,
  maxHp: 100,
  maxArmor: 100,
  // Sprinting burns stamina; jumping takes a chunk. Run dry and you're winded until it refills a bit.
  maxStamina: 100,
  sprintDrain: 20,
  jumpCost: 14,
  staminaRegen: 22,
  staminaDelay: 0.8,
  windedUntil: 30,
  // Cold maps: warmth drains outdoors, refills by fires and indoors. At zero you freeze.
  maxWarmth: 100,
  coldDrain: 0.9,
  warmGain: 9,
  freezeDamage: 3,
  fireRadius: 6,
  // Getting downed: you go down instead of dying, crawl, and bleed out unless someone revives you.
  downHp: 80,
  bleedTime: 45,
  reviveTime: 4,
  selfReviveTime: 3,
  reviveHp: 35,
  giveUpTime: 2,
};

// Lost Vegas: the raid map. Half-size in meters.
export const MAP = { half: 175, wallH: 6 };
export const RAID_TIME = 18 * 60;
// Calling an extraction: the ride takes this long to arrive, and the whole map hears about it.
export const EXTRACT_TIME = 25;
export const EXTRACT_RADIUS = 5;
export const EXTRACT_COOLDOWN = 40;
// The Pit Boss shows up this many seconds into a raid.
export const BOSS_TIME = 4 * 60;
export const BACKPACK_SLOTS = 12;
// Permanent backpack upgrades, bought in the hub. Each adds slots.
export const BAG_UPGRADES = [
  { name: 'Fanny Pack', icon: '👝', slots: 3, cost: 2500 },
  { name: 'Duffel Bag', icon: '👜', slots: 3, cost: 7500 },
  { name: 'Hiking Pack', icon: '🎒', slots: 3, cost: 20000 },
  { name: 'High Roller Briefcase', icon: '💼', slots: 3, cost: 50000 },
];
export const bagBonus = (level = 0) => BAG_UPGRADES.slice(0, level).reduce((n, u) => n + u.slots, 0);
export const CHIP_VALUE = 5;

export const WEAPONS = {
  fists: { name: 'Fists', icon: '👊', melee: true, auto: true, damage: 12, rate: 0.45, range: 2.0, ammo: Infinity },
  spoon: { name: 'Lucky Spoon', icon: '🥄', melee: true, auto: true, damage: 26, rate: 0.4, range: 2.4, ammo: Infinity, value: 40 },
  bat: { name: 'Pit Boss Bat', icon: '🏏', melee: true, auto: true, damage: 44, rate: 0.75, range: 2.8, ammo: Infinity, value: 220 },
  pistol: { name: 'Pea Shooter', icon: '🔫', damage: 16, rate: 0.28, spread: 0.012, pellets: 1, range: 70, ammo: 60, value: 120 },
  revolver: { name: 'Snake Eyes', icon: '🤠', damage: 34, rate: 0.5, spread: 0.006, pellets: 1, range: 85, ammo: 36, value: 420 },
  smg: { name: 'Bullet Hose', icon: '⚡', auto: true, damage: 8, rate: 0.08, spread: 0.035, pellets: 1, range: 50, ammo: 180, value: 300 },
  shotgun: { name: 'Boomstick', icon: '💥', damage: 10, rate: 0.85, spread: 0.09, pellets: 8, range: 22, ammo: 24, value: 320 },
  dbarrel: { name: 'Double Down', icon: '🎲', damage: 12, rate: 1.15, spread: 0.12, pellets: 12, range: 15, ammo: 20, value: 480 },
  ar: { name: 'Card Counter', icon: '🃏', auto: true, damage: 12, rate: 0.1, spread: 0.018, pellets: 1, range: 85, ammo: 150, value: 650 },
  rifle: { name: 'High Roller', icon: '🎯', damage: 45, rate: 0.9, spread: 0.002, pellets: 1, range: 140, ammo: 30, value: 500, zoom: true },
  sniper: { name: 'Ace in the Hole', icon: '♠️', damage: 110, rate: 1.7, spread: 0.0008, pellets: 1, range: 220, ammo: 15, value: 1600, zoom: true },
  minigun: { name: 'The Whale', icon: '🐋', auto: true, damage: 7, rate: 0.045, spread: 0.055, pellets: 1, range: 55, ammo: 450, value: 1400, moveMul: 0.72 },
  rocket: { name: 'Jackpot Launcher', icon: '🚀', damage: 90, rate: 1.3, projectile: true, speed: 30, splash: 4.5, ammo: 8, value: 900 },
};
// Gun pools by tier for loot rolls.
export const GUN_TIERS = [
  ['spoon', 'pistol', 'bat'],
  ['pistol', 'smg', 'shotgun', 'revolver', 'bat'],
  ['smg', 'shotgun', 'rifle', 'revolver', 'ar', 'dbarrel'],
  ['rifle', 'rocket', 'ar', 'sniper', 'minigun', 'dbarrel'],
];

export const RARITIES = [
  { name: 'Common', color: null, css: '#e5e7eb', damage: 1, ammo: 1, value: 1 },
  { name: 'Rare', color: 0x3b82f6, css: '#60a5fa', damage: 1.15, ammo: 1.25, value: 2.5 },
  { name: 'Epic', color: 0xa855f7, css: '#c084fc', damage: 1.3, ammo: 1.5, value: 6 },
  { name: 'Legendary', color: 0xffc83d, css: '#ffc83d', damage: 1.5, ammo: 2, value: 20 },
];
// Rarity odds [Common, Rare, Epic, Legendary] by danger tier. Legendaries simply don't exist
// out in the desert: you have to go where it's dangerous to even have a chance.
export const RARITY_BY_TIER = {
  1: [80, 18, 2, 0],
  2: [66, 26, 7.5, 0.5],
  3: [55, 30, 13, 2],
  4: [38, 32, 23, 7],
};

// Everything that isn't a gun.
export const ITEMS = {
  bandage: { name: 'Lucky Bandage', icon: '🩹', desc: 'Heals 35 health. Takes a moment to apply.', kind: 'heal', heal: 35, useTime: 1.4, value: 60, stack: 5 },
  soda: { name: 'Jackpot Soda', icon: '🥤', desc: 'Heals 80 health. Fizzy and slow to chug.', kind: 'heal', heal: 80, useTime: 2.4, value: 160, stack: 3 },
  plate: { name: 'Chip Plate', icon: '🛡️', desc: 'Adds 50 armor. Armor soaks most of each hit.', kind: 'armor', armor: 50, useTime: 2, value: 140, stack: 3 },
  ammo: { name: 'Ammo Box', icon: '📦', desc: 'Refills half of the gun in your hands. Press R (or just keep shooting when you run dry) and one box gets used up.', kind: 'ammo', value: 50, stack: 5 },
  // Throwables: hold the throw key to aim, let go to throw. The cycle key picks which one.
  grenade: { name: 'Cherry Bomb', icon: '💣', desc: 'A classic. Bounces around, then blows up 2 seconds later. Hurts you too.', kind: 'throw', effect: 'frag', damage: 95, splash: 5.5, fuse: 2, ring: 0xff5d5d, value: 110, stack: 4 },
  dice: { name: 'Loaded Dice', icon: '🎲', desc: 'Tumbles, lands on a number, then blows up. The higher the roll, the bigger the boom. A 6 is a jackpot blast. Snake eyes fizzles.', kind: 'throw', effect: 'dice', splash: 5, fuse: 2.4, ring: 0xffd23f, value: 140, stack: 5 },
  flash: { name: 'Flash Chip', icon: '✨', desc: 'Pops with a blinding flash. Machines and raiders who see it are stunned for a few seconds. Don\'t look at it yourself.', kind: 'throw', effect: 'flash', splash: 11, stun: 3.5, fuse: 1.2, ring: 0xffffff, value: 120, stack: 4 },
  sauce: { name: 'Ghost Pepper Sauce', icon: '🌶️', desc: 'Smashes on impact into a pool of fire that burns anything standing in it for 6 seconds. Also great for warming up.', kind: 'throw', effect: 'fire', splash: 4.2, burn: 18, burnTime: 6, fuse: 3, ring: 0xff9f43, value: 130, stack: 3 },
  sticky: { name: 'Taffy Bomb', icon: '🍬', desc: 'Sticks to the first thing it touches, people included, then blows 1.5 seconds later. Nowhere to run.', kind: 'throw', effect: 'sticky', damage: 110, splash: 4.5, fuse: 1.5, ring: 0xff7eb6, value: 160, stack: 3 },
  cluster: { name: 'Jackpot Cluster', icon: '🎆', desc: 'Pops open and scatters six little bomblets that each go off on their own. Clears a whole room.', kind: 'throw', effect: 'cluster', damage: 45, splash: 3.2, fuse: 1.4, ring: 0xffd23f, value: 220, stack: 2 },
  smoke: { name: 'Cigar Smoke', icon: '💨', desc: 'A thick cloud nobody can see through for 14 seconds. Machines and raiders lose track of you. Great for escaping or reviving.', kind: 'throw', effect: 'smoke', splash: 7, duration: 14, fuse: 1.3, ring: 0xd1d5db, value: 90, stack: 4 },
  emp: { name: 'Short Circuit', icon: '🔌', desc: 'An EMP. Fries every machine nearby for 6 seconds and zaps them for 35 damage. Does nothing to people.', kind: 'throw', effect: 'emp', damage: 35, splash: 13, stun: 6, fuse: 1.3, ring: 0x4dabff, value: 170, stack: 3 },
  fuel: { name: 'Rocket Fuel Energy', icon: '🧃', desc: 'Chug it: for 15 seconds you run 25% faster and sprinting costs no stamina.', kind: 'boost', duration: 15, useTime: 0.9, value: 100, stack: 3 },
  cards: { name: 'Marked Deck', icon: '🃏', desc: 'Sell it to the Fence.', kind: 'valuable', value: 90, stack: 5 },
  hat: { name: 'Silk Top Hat', icon: '🎩', desc: 'Sell it to the Fence.', kind: 'valuable', value: 260 },
  watch: { name: 'Gold Watch', icon: '⌚', desc: 'Sell it to the Fence.', kind: 'valuable', value: 450 },
  ring: { name: 'Diamond Ring', icon: '💍', desc: 'Worth a lot to the Fence.', kind: 'valuable', value: 900 },
  trophy: { name: 'Jackpot Trophy', icon: '🏆', desc: 'Worth a fortune to the Fence.', kind: 'valuable', value: 1800 },
  cocoa: { name: 'Hot Cocoa', icon: '☕', desc: 'Warms you right up (+70 warmth) and heals 10. Lifesaver in the snow.', kind: 'warm', warmth: 70, heal: 10, useTime: 1.6, value: 80, stack: 3 },
  tooth: { name: 'Gator Tooth', icon: '🦷', desc: 'Pulled from a bayou gator. The Fence loves these.', kind: 'valuable', value: 220, stack: 5 },
  token: { name: 'Second Chance Token', icon: '🎟️', desc: 'When you go down, hold the use key to pick yourself back up. Used up on the spot. The House hates these.', kind: 'revive', value: 650, stack: 2 },
  keycard: { name: 'Vault Keycard', icon: '💳', desc: 'Opens the casino vault. Used up on swipe.', kind: 'key', value: 700 },
  clover: { name: 'Four-Leaf Clover', icon: '🍀', desc: 'Legendary. Almost nobody finds one.', kind: 'valuable', value: 6000, legendary: true },
  crown: { name: "The House's Crown", icon: '👑', desc: 'Legendary. Taken from the Pit Boss himself.', kind: 'valuable', value: 25000, legendary: true },
};

// Loot tables by danger tier (1 outskirts, 2 the strip, 3 the casino, 4 the vault and the boss).
// Each entry is [weight, what]. 'gun' rolls a gun from GUN_TIERS with a rarity boost.
export const LOOT = {
  1: [[30, 'chips'], [18, 'bandage'], [14, 'ammo'], [16, 'cards'], [10, 'dice'], [8, 'gun'], [4, 'plate'], [6, 'cocoa'], [6, 'grenade'], [4, 'flash'], [4, 'sauce'], [5, 'fuel'], [4, 'smoke'], [3, 'sticky']],
  2: [[22, 'chips'], [12, 'bandage'], [8, 'soda'], [12, 'ammo'], [10, 'dice'], [10, 'hat'], [6, 'watch'], [12, 'gun'], [8, 'plate'], [5, 'cocoa'], [8, 'grenade'], [6, 'flash'], [6, 'sauce'], [6, 'fuel'], [1.5, 'token'], [5, 'smoke'], [5, 'sticky'], [4, 'emp'], [3, 'cluster']],
  3: [[18, 'chips'], [8, 'soda'], [10, 'ammo'], [10, 'watch'], [8, 'ring'], [2, 'trophy'], [3, 'keycard'], [18, 'gun'], [10, 'plate'], [8, 'grenade'], [8, 'dice'], [6, 'flash'], [6, 'sauce'], [5, 'fuel'], [3, 'token'], [5, 'sticky'], [5, 'emp'], [5, 'cluster'], [3, 'smoke'], [0.5, 'clover']],
  4: [[14, 'chips'], [10, 'ring'], [8, 'trophy'], [24, 'gun'], [10, 'soda'], [10, 'plate'], [6, 'grenade'], [8, 'dice'], [5, 'sauce'], [5, 'token'], [6, 'cluster'], [4, 'emp'], [2, 'clover']],
};
export const CHIPS_BY_TIER = { 1: [15, 40], 2: [30, 80], 3: [60, 160], 4: [150, 400] };

// The machines that run Lost Vegas. Damage is per bullet.
export const ENEMIES = {
  slotbot: { name: 'Slotbot', hp: 140, speed: 2.6, damage: 6, burst: 3, burstGap: 0.12, rate: 2.2, range: 26, aggro: 24, accuracy: 0.11, chips: [20, 50], loot: 0.5 },
  dicer: { name: 'Dicer', hp: 55, speed: 6.5, damage: 4, burst: 1, burstGap: 0, rate: 1.4, range: 22, aggro: 26, accuracy: 0.13, chips: [8, 20], loot: 0.25 },
  shark: { name: 'Card Shark', hp: 80, speed: 7.5, damage: 16, melee: true, rate: 1.4, range: 2.2, aggro: 18, chips: [10, 30], loot: 0.35 },
  // Bayou wildlife: lurks underwater in ponds and lunges at anyone who wanders close.
  gator: { name: 'Gator', hp: 130, speed: 8.5, damage: 18, melee: true, rate: 1.6, range: 2.6, aggro: 10, chips: [0, 15], loot: 0.6 },
  // A hulking bruiser in a suit. Slow, tanky, and it hits like a truck.
  bouncer: { name: 'Bouncer', hp: 340, speed: 3.6, damage: 30, melee: true, rate: 1.9, range: 2.9, aggro: 22, chips: [45, 100], loot: 0.85, head: 3.0, radius: 1.1, bar: 4.2, charge: 1.7 },
  // A runaway roulette wheel that rolls at you and rams.
  roller: { name: 'Roulette Roller', hp: 75, speed: 10.5, damage: 14, melee: true, rate: 1.1, range: 2.1, aggro: 30, chips: [12, 30], loot: 0.3, head: 1.3, radius: 0.85, bar: 2.8 },
  // Bolted down on rooftops and monuments: slow, heavy, very long-range shots.
  turret: { name: 'Jackpot Turret', hp: 170, speed: 0, damage: 24, burst: 1, burstGap: 0, rate: 2.7, range: 55, aggro: 52, accuracy: 0.045, chips: [35, 80], loot: 0.6, head: 1.6, radius: 0.9, bar: 2.8, fixed: true },
  boss: { name: 'The Pit Boss', hp: 3200, speed: 2.2, damage: 4, burst: 10, burstGap: 0.08, rate: 3.4, range: 40, aggro: 45, accuracy: 0.12, chips: [600, 900], loot: 1 },
};

// Raider bots: other players looting the same map. Neutral unless provoked.
export const RAIDERS = { count: 6, hostileChance: 0.25, accuracy: 0.1, reaction: 0.9 };

export const SETTINGS_DEFAULT = { sensitivity: 1, fov: 72, volume: 0.6, music: 0.45, firstPerson: false, quality: 'auto' };

// Graphics levels. 'auto' starts on high and steps down if the game can't keep up.
export const QUALITY = {
  low: { label: 'Low', pixelRatio: 0.75, shadows: 0, drawDist: 70 },
  medium: { label: 'Medium', pixelRatio: 1, shadows: 1024, drawDist: 95 },
  high: { label: 'High', pixelRatio: 2, shadows: 2048, drawDist: 115 },
};

// Back Room slot machines in the hub: pay chips, roll a prize.
export const HUB_SLOTS = [
  { name: 'Bronze Reels', cost: 150, tier: 1, boost: 0 },
  { name: 'Silver Reels', cost: 300, tier: 2, boost: 1 },
  { name: 'Gold Reels', cost: 700, tier: 3, boost: 2.5 },
];

// In-raid loot slots: pay with chips you found, the prize pops out of the machine.
export const RAID_SLOT_COST = { 1: 40, 2: 80, 3: 150 };

export const START_STASH = { chips: 400, items: [{ id: 'gun', kind: 'pistol', rarity: 0, ammo: 60 }, { id: 'bandage', qty: 3 }, { id: 'grenade', qty: 2 }] };

export const COLORS = [0xff5d5d, 0x4dabff, 0xffd23f, 0x5ee27a, 0xc77dff, 0xff9f43, 0x2ee6d6, 0xff7eb6];
export const HATS = ['top', 'party', 'cowboy', 'visor', 'crown'];
// Hats unlock permanently.
export const HAT_UNLOCKS = {
  top: null,
  party: null,
  cowboy: { extracts: 1, text: 'Extract once' },
  visor: { extracts: 10, text: 'Extract 10 times' },
  crown: { boss: 1, text: 'Take down the Pit Boss' },
};
export const RAIDER_NAMES = [
  'Lucky Lou', 'Big Stack Betty', 'Slots McGee', 'Snake Eyes', 'Pit Boss Pete', 'High Roller Hal',
  'Double Down Dot', 'Whale Wendell', 'Loaded Lola', 'Busted Bob', 'Martingale Mo', 'Chip Chipperson',
];
