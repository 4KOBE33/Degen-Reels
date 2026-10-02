// Everything you can change about your bean. Some options unlock with levels or achievements.
import { registerLooks, lookUnlocked, ACHIEVEMENTS } from './progress.js';
import { LOOK_DEFAULT } from './save.js';

export const LOOKS = {
  color: [
    { id: 0xff5d5d, name: 'Cherry' }, { id: 0x4dabff, name: 'Sky' }, { id: 0xffd23f, name: 'Lemon' }, { id: 0x5ee27a, name: 'Lime' },
    { id: 0xc77dff, name: 'Grape' }, { id: 0xff9f43, name: 'Tangerine' }, { id: 0x2ee6d6, name: 'Aqua' }, { id: 0xff7eb6, name: 'Bubblegum' },
    { id: 0xf1e3c8, name: 'Vanilla' }, { id: 0x8d6e63, name: 'Cocoa' }, { id: 0x6b7280, name: 'Slate', unlock: { level: 3 } },
    { id: 0x2b2140, name: 'Midnight', unlock: { level: 8 } }, { id: 0xe5e7eb, name: 'Chrome', unlock: { level: 12 } },
    { id: 0x16a34a, name: 'Felt Green', unlock: { ach: 'blackjack' } }, { id: 0x7b2cbf, name: 'Epic Purple', unlock: { ach: 'epic' } },
    { id: 0xffc83d, name: 'Jackpot Gold', unlock: { ach: 'legendary' } },
    { id: 0x9cff00, name: 'Toxic', unlock: { buy: 8000, lvl: 6 } }, { id: 0x111111, name: 'Obsidian', unlock: { buy: 15000, lvl: 10 } },
    { id: 0xe8a598, name: 'Rose Gold', unlock: { buy: 20000, lvl: 15 } }, { id: 0xb9f2ff, name: 'Diamond', unlock: { buy: 40000, lvl: 20 } },
  ],
  hat: [
    { id: 'none', name: 'Nothing', icon: '🚫' }, { id: 'top', name: 'Top hat', icon: '🎩' }, { id: 'party', name: 'Party hat', icon: '🥳' },
    { id: 'beanie', name: 'Beanie', icon: '🧶' }, { id: 'cap', name: 'Ball cap', icon: '🧢', unlock: { level: 2 } },
    { id: 'cowboy', name: 'Cowboy hat', icon: '🤠', unlock: { ach: 'extract1' } }, { id: 'propeller', name: 'Propeller cap', icon: '🌀', unlock: { level: 5 } },
    { id: 'chef', name: "Chef's hat", icon: '👨‍🍳', unlock: { ach: 'containers100' } }, { id: 'visor', name: "Dealer's visor", icon: '🃏', unlock: { ach: 'extract10' } },
    { id: 'viking', name: 'Viking helmet', icon: '🪖', unlock: { ach: 'gators10' } }, { id: 'halo', name: 'Halo', icon: '😇', unlock: { level: 20 } },
    { id: 'crown', name: 'Crown', icon: '👑', unlock: { ach: 'boss1' } },
    { id: 'fez', name: 'Fez', icon: '🔴', unlock: { buy: 6000, lvl: 4 } }, { id: 'horns', name: 'Devil horns', icon: '😈', unlock: { buy: 12000, lvl: 8 } },
    { id: 'sombrero', name: 'Sombrero', icon: '👒', unlock: { buy: 15000, lvl: 12 } }, { id: 'goldtop', name: 'Gold top hat', icon: '🎩', unlock: { buy: 75000, lvl: 25, boss: true } },
  ],
  eyes: [
    { id: 'normal', name: 'Classic', icon: '👀' }, { id: 'sleepy', name: 'Sleepy', icon: '😪' }, { id: 'angry', name: 'Angry', icon: '😠' },
    { id: 'happy', name: 'Happy', icon: '😊', unlock: { level: 2 } }, { id: 'big', name: 'Big pupils', icon: '🥺', unlock: { level: 4 } },
    { id: 'stars', name: 'Starstruck', icon: '🤩', unlock: { ach: 'crits100' } }, { id: 'dollar', name: 'Dollar signs', icon: '🤑', unlock: { ach: 'haul5k' } },
  ],
  mouth: [
    { id: 'smile', name: 'Smile', icon: '🙂' }, { id: 'grin', name: 'Big grin', icon: '😁' }, { id: 'o', name: 'Surprised', icon: '😮' },
    { id: 'flat', name: 'Unimpressed', icon: '😐' }, { id: 'tongue', name: 'Tongue out', icon: '😛', unlock: { level: 3 } },
    { id: 'mustache', name: 'Mustache', icon: '🥸', unlock: { level: 6 } }, { id: 'goldtooth', name: 'Gold tooth', icon: '🦷', unlock: { ach: 'bigwin' } },
  ],
  glasses: [
    { id: 'none', name: 'None', icon: '🚫' }, { id: 'shades', name: 'Shades', icon: '🕶️', unlock: { level: 2 } },
    { id: 'nerd', name: 'Nerd glasses', icon: '🤓', unlock: { level: 4 } }, { id: 'monocle', name: 'Monocle', icon: '🧐', unlock: { level: 10 } },
    { id: 'star', name: 'Star shades', icon: '⭐', unlock: { ach: 'worldtour' } }, { id: 'eyepatch', name: 'Eyepatch', icon: '🏴‍☠️', unlock: { ach: 'raiders10' } },
  ],
  neck: [
    { id: 'none', name: 'None', icon: '🚫' }, { id: 'bowtie', name: 'Bow tie', icon: '🎀' }, { id: 'scarf', name: 'Scarf', icon: '🧣', unlock: { level: 3 } },
    { id: 'chain', name: 'Gold chain', icon: '📿', unlock: { level: 7 } }, { id: 'cape', name: 'Cape', icon: '🦸', unlock: { level: 15 } },
    { id: 'medal', name: 'Boss medal', icon: '🏅', unlock: { ach: 'boss5' } },
  ],
  shoes: [
    { id: 0x2b2140, name: 'Ink' }, { id: 0xffffff, name: 'White' }, { id: 0xe63946, name: 'Red' }, { id: 0x2563eb, name: 'Blue' },
    { id: 0x8b5a2b, name: 'Leather', unlock: { level: 3 } }, { id: 0xffd23f, name: 'Gold', unlock: { level: 25 } },
  ],
};
registerLooks(LOOKS);

export const LOOK_PARTS = [
  ['color', 'Color'], ['hat', 'Hat'], ['eyes', 'Eyes'], ['mouth', 'Mouth'], ['glasses', 'Glasses'], ['neck', 'Neck'], ['shoes', 'Shoes'],
];

export function unlockText(opt) {
  if (!opt.unlock) return '';
  if (opt.unlock.level) return `Reach level ${opt.unlock.level}`;
  if (opt.unlock.buy) return `Shop: level ${opt.unlock.lvl || 1}${opt.unlock.boss ? ' + beat the Pit Boss' : ''}, then 🪙 ${opt.unlock.buy.toLocaleString('en-US')}`;
  const a = ACHIEVEMENTS.find((x) => x.id === opt.unlock.ach);
  return a ? `Achievement: ${a.name} (${a.desc.charAt(0).toLowerCase()}${a.desc.slice(1)})` : 'Achievement';
}

// Your saved look, with anything locked (or missing) swapped for the default.
export function wornLook(look) {
  const out = { ...LOOK_DEFAULT, ...look };
  for (const [part] of LOOK_PARTS) {
    const opt = LOOKS[part].find((o) => o.id === out[part]);
    if (!opt || !lookUnlocked(opt)) out[part] = part === 'color' ? LOOKS.color[0].id : LOOK_DEFAULT[part];
  }
  return out;
}

// A random look for rival raiders (never the shop exclusives).
export function randomLook() {
  const pick = (a) => { const free = a.filter((o) => !(o.unlock && o.unlock.buy)); return free[Math.floor(Math.random() * free.length)].id; };
  return {
    color: pick(LOOKS.color), hat: pick(LOOKS.hat), eyes: pick(LOOKS.eyes), mouth: pick(LOOKS.mouth),
    glasses: Math.random() < 0.35 ? pick(LOOKS.glasses) : 'none', neck: Math.random() < 0.4 ? pick(LOOKS.neck) : 'none', shoes: pick(LOOKS.shoes),
  };
}
