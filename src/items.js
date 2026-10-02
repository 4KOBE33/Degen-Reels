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
export function addToList(list, item, capacity = Infinity) {
  const info = itemInfo(item);
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
    while (left > 0 && list.length < capacity) {
      const n = Math.min(info.stack, left);
      list.push(makeItem(item.id, n));
      left -= n;
    }
    item.qty = left;
    return left === 0;
  }
  if (list.length >= capacity) return false;
  list.push(item);
  return true;
}

// For merging stash items with no stack limit.
export function addToStash(list, item) {
  if (!isGun(item)) {
    const same = list.find((o) => o.id === item.id);
    if (same) { same.qty += item.qty; return; }
  }
  list.push({ ...item });
}

export function itemTitle(item) {
  const info = itemInfo(item);
  const qty = !isGun(item) && item.qty > 1 ? ` ×${item.qty}` : '';
  return `${info.icon} ${info.name}${qty}`;
}
