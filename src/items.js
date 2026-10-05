// Items: guns, consumables and valuables. Plain objects so they save to the stash easily.
//   { id: 'gun', kind: 'smg', rarity: 2, ammo: 210 }
//   { id: 'bandage', qty: 3 }
import {
  ITEMS, WEAPONS, RARITIES, RARITY_BY_TIER, LOOT, GUN_TIERS, CHIPS_BY_TIER,
} from './config.js';

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

export function weightedIndex(weights) {
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

export function rollRarity(tier) {
  return weightedIndex(RARITY_BY_TIER[Math.max(1, Math.min(4, tier))]);
}

export function fullAmmo(kind, rarity) {
  const base = WEAPONS[kind].ammo;
  return Number.isFinite(base) ? Math.round(base * RARITIES[rarity].ammo) : base;
}

export function makeGun(kind, rarity = 0, ammo = null) {
  return { id: 'gun', kind, rarity, ammo: ammo === null ? fullAmmo(kind, rarity) : ammo };
}

export function makeItem(id, qty = 1) {
  return { id, qty };
}

export function isGun(item) {
  return item && item.id === 'gun';
}

export function itemInfo(item) {
  if (isGun(item)) {
    const w = WEAPONS[item.kind];
    const r = RARITIES[item.rarity];
    return {
      name: item.rarity ? `${r.name} ${w.name}` : w.name,
      icon: w.icon,
      css: r.css,
      rarity: item.rarity,
      value: Math.round((w.value || 20) * r.value),
      stack: 1,
    };
  }
  const def = ITEMS[item.id];
  return {
    name: def.name,
    icon: def.icon,
    css: def.legendary ? RARITIES[3].css : def.kind === 'valuable' && def.value >= 800 ? RARITIES[2].css : '#e5e7eb',
    rarity: def.legendary ? 3 : def.value >= 800 ? 2 : def.value >= 250 ? 1 : 0,
    value: def.value * (item.qty || 1),
    stack: def.stack || 1,
    def,
  };
}

// Rolls one thing from a container or enemy. Returns an item, or { chips: n }.
export function rollLoot(tier) {
  const table = LOOT[tier];
  const what = table[weightedIndex(table.map(([w]) => w))][1];
  if (what === 'chips') {
    const [a, b] = CHIPS_BY_TIER[tier];
    return { chips: Math.max(5, Math.round(randInt(a, b) / 5) * 5) };
  }
  if (what === 'gun') return makeGun(pick(GUN_TIERS[tier - 1]), rollRarity(tier));
  return makeItem(what, 1);
}

// Adds an item to a list, stacking where possible. Returns false if there's no room.
// Consumables (heals, plates, throwables, ammo, cocoa, fuel, tokens) ride on your belt, which has
// its own slots, so they don't eat the backpack space you want for loot. When the belt is full,
// extra consumables can go in the backpack (marked `inPack`); loot and guns never go on the belt.
const BELT_KINDS = new Set(['heal', 'armor', 'throw', 'ammo', 'warm', 'boost', 'revive']);
export function isConsumable(item) {
  return !!item && !isGun(item) && !!ITEMS[item.id] && BELT_KINDS.has(ITEMS[item.id].kind);
}
// Is this entry sitting on the belt (rather than in the backpack)?
export function isBelt(item) {
  return isConsumable(item) && !item.inPack;
}
// How many slots of one kind (belt or backpack) a list is using.
export function slotsUsed(list, belt) {
  let n = 0;
  for (const it of list) if (isBelt(it) === belt) n++;
  return n;
}

// Some things you can only carry one of at a time (a second self-revive isn't fair).
export const HOLD_LIMIT = { token: 1 };
// How many more of this item a list can hold before hitting its carry limit (Infinity if none).
export function holdRoom(list, item) {
  const limit = HOLD_LIMIT[item.id];
  if (!limit) return Infinity;
  return Math.max(0, limit - list.filter((x) => x && x.id === item.id).reduce((n, x) => n + (x.qty || 1), 0));
}
export const holdLimitText = (item) => `You can only carry ${HOLD_LIMIT[item.id] === 1 ? 'one' : HOLD_LIMIT[item.id]} ${ITEMS[item.id] ? ITEMS[item.id].name : 'of those'}.`;

// `capacity` is a number (one shared limit) or { pack, belt } (separate limits).
export function addToList(list, item, capacity = Infinity) {
  const info = itemInfo(item);
  // Carry limits: take what fits, leave the rest in `item`.
  const room = holdRoom(list, item);
  if (room <= 0) return false;
  if (room < (item.qty || 1)) {
    const part = { ...item, qty: room };
    const ok = addToList(list, part, capacity);
    item.qty -= room - (part.qty || 0);
    return ok && item.qty <= 0;
  }
  const split = typeof capacity === 'object';
  const consumable = isConsumable(item);
  // Where a new stack/slot can go: the belt first for consumables, then the backpack.
  const place = () => {
    if (!split) return list.length < capacity ? 'any' : null;
    if (consumable && slotsUsed(list, true) < capacity.belt) return 'belt';
    if (slotsUsed(list, false) < capacity.pack) return 'pack';
    return null;
  };
  const put = (entry, where) => {
    const e = { ...entry };
    delete e.inPack;
    if (where === 'pack' && consumable) e.inPack = true;
    list.push(e);
  };
  if (!isGun(item) && info.stack > 1) {
    let left = item.qty;
    for (const other of list) {
      // Free-loadout items never mix with ones you own.
      if (other.id !== item.id || !!other.free !== !!item.free) continue;
      const room = info.stack - other.qty;
      const n = Math.min(room, left);
      other.qty += n;
      left -= n;
      if (!left) return true;
    }
    for (let where = place(); left > 0 && where; where = place()) {
      const n = Math.min(info.stack, left);
      put({ ...makeItem(item.id, n), ...(item.free ? { free: true } : {}) }, where);
      left -= n;
    }
    item.qty = left;
    return left === 0;
  }
  const where = place();
  if (!where) return false;
  if (split) put(item, where); else list.push(item);
  return true;
}

// Into the stash: same stack limits as everywhere else (3 Chip Plates to a stack, 5 bandages...),
// topping up existing stacks first, then starting new ones.
export function addToStash(list, item) {
  if (isGun(item)) { list.push({ ...item }); return; }
  const def = ITEMS[item.id];
  const cap = Math.max(1, (def && def.stack) || 1);
  let left = Math.max(1, item.qty || 1);
  for (const o of list) {
    if (left <= 0) break;
    if (o.id !== item.id || isGun(o) || !!o.free !== !!item.free) continue;
    const n = Math.min(cap - (o.qty || 1), left);
    if (n > 0) { o.qty = (o.qty || 1) + n; left -= n; }
  }
  while (left > 0) {
    const n = Math.min(cap, left);
    list.push({ ...item, qty: n });
    left -= n;
  }
}

// Re-split a list into proper stacks (older saves kept everything in one pile).
export function restack(list) {
  const out = [];
  for (const it of list || []) addToStash(out, it);
  return out;
}

export function itemTitle(item) {
  const info = itemInfo(item);
  const qty = !isGun(item) && item.qty > 1 ? ` ×${item.qty}` : '';
  return `${info.icon} ${info.name}${qty}`;
}
