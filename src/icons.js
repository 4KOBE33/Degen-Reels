// Hand-drawn cartoon pictures of every gun: chunky shapes, thick ink outlines, a shine on top,
// and the rarity color on the body. Epic and Legendary guns sparkle.
import { RARITIES } from './config.js';
import { isGun, itemInfo } from './items.js';

const W = 200;
const H = 100;
const INK = '#1b0f2b';
const cache = new Map();

const DEFAULT_BODY = {
  spoon: '#d9dde3', pistol: '#4dabff', smg: '#2ee6d6', shotgun: '#6b7280', rifle: '#7b2cbf', rocket: '#5ee27a',
  bat: '#c08a3e', revolver: '#9ca3af', dbarrel: '#4b5563', ar: '#1f8a4c', sniper: '#2b2d42', minigun: '#2563eb',
};
const RARITY_BODY = [null, '#3b82f6', '#a855f7', '#ffc83d'];

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c + (amt > 0 ? (255 - c) * amt : c * amt))));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map(f).map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function rr(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function poly(c, pts) {
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) c.lineTo(x, y);
  c.closePath();
}

// Fill a path with a drop shadow, a shine across the top, and a thick ink outline.
function piece(c, path, color, { shine = true, ink = 5 } = {}) {
  c.save();
  c.translate(3, 4);
  path();
  c.fillStyle = 'rgba(27,15,43,0.35)';
  c.fill();
  c.restore();
  path();
  c.fillStyle = color;
  c.fill();
  if (shine) {
    c.save();
    path();
    c.clip();
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(255,255,255,0.45)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.08)');
    g.addColorStop(0.6, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.22)');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    c.restore();
  }
  path();
  c.lineJoin = 'round';
  c.lineWidth = ink;
  c.strokeStyle = INK;
  c.stroke();
}

function sparkle(c, x, y, s, color = '#fffbe6') {
  c.save();
  c.translate(x, y);
  c.beginPath();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 ? s * 0.28 : s;
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  c.closePath();
  c.fillStyle = color;
  c.strokeStyle = INK;
  c.lineWidth = 2;
  c.fill();
  c.stroke();
  c.restore();
}

const DARK = '#374151';
const WOOD = '#9c6b3c';

const DRAW = {
  pistol(c, body) {
    piece(c, () => poly(c, [[66, 50], [94, 50], [86, 90], [56, 90]]), DARK);
    c.lineWidth = 5; c.strokeStyle = INK;
    c.beginPath(); c.arc(100, 58, 11, 0.1 * Math.PI, 0.95 * Math.PI); c.stroke();
    piece(c, () => rr(c, 36, 24, 118, 34, 12), body);
    piece(c, () => rr(c, 60, 14, 56, 14, 6), shade(body, 0.35));
    piece(c, () => rr(c, 148, 28, 28, 26, 8), '#ff9f43');
    c.fillStyle = INK; c.beginPath(); c.arc(170, 41, 5, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.8)'; rr(c, 46, 32, 30, 6, 3); c.fill();
  },
  smg(c, body) {
    piece(c, () => rr(c, 8, 36, 30, 20, 5), DARK);
    piece(c, () => poly(c, [[52, 56], [74, 56], [68, 88], [46, 88]]), DARK);
    piece(c, () => poly(c, [[96, 56], [116, 56], [124, 94], [104, 94]]), shade(DARK, -0.3));
    piece(c, () => rr(c, 30, 28, 124, 32, 9), body);
    piece(c, () => rr(c, 150, 36, 40, 14, 5), DARK);
    for (let i = 0; i < 4; i++) { c.fillStyle = shade(body, -0.45); rr(c, 104 + i * 10, 36, 5, 16, 2); c.fill(); }
    piece(c, () => rr(c, 70, 20, 30, 10, 4), shade(body, 0.4), { shine: false, ink: 4 });
  },
  shotgun(c, body) {
    piece(c, () => poly(c, [[4, 48], [62, 34], [70, 60], [12, 76]]), WOOD);
    piece(c, () => rr(c, 92, 26, 102, 13, 5), shade(body, -0.15));
    piece(c, () => rr(c, 92, 40, 102, 13, 5), shade(body, -0.3));
    piece(c, () => rr(c, 54, 28, 46, 30, 8), body);
    piece(c, () => rr(c, 108, 50, 52, 18, 8), '#c08a3e');
    for (let i = 0; i < 3; i++) { c.strokeStyle = shade('#c08a3e', -0.45); c.lineWidth = 3; c.beginPath(); c.moveTo(118 + i * 12, 53); c.lineTo(118 + i * 12, 65); c.stroke(); }
    c.fillStyle = INK; for (const y of [32, 46]) { c.beginPath(); c.arc(191, y + 0.5, 3.5, 0, Math.PI * 2); c.fill(); }
  },
  rifle(c, body) {
    piece(c, () => poly(c, [[2, 50], [48, 40], [54, 62], [8, 72]]), WOOD);
    piece(c, () => poly(c, [[74, 58], [90, 58], [84, 88], [66, 88]]), DARK);
    piece(c, () => rr(c, 120, 44, 76, 11, 4), DARK);
    piece(c, () => rr(c, 44, 38, 84, 24, 7), body);
    piece(c, () => rr(c, 72, 30, 6, 10, 2), DARK, { shine: false, ink: 3 });
    piece(c, () => rr(c, 104, 30, 6, 10, 2), DARK, { shine: false, ink: 3 });
    piece(c, () => rr(c, 60, 14, 64, 18, 9), '#e0b23c');
    c.fillStyle = '#7dd3fc'; c.strokeStyle = INK; c.lineWidth = 3;
    c.beginPath(); c.ellipse(122, 23, 4, 7, 0, 0, Math.PI * 2); c.fill(); c.stroke();
    c.fillStyle = INK; c.beginPath(); c.arc(98, 66, 5, 0, Math.PI * 2); c.fill();
  },
  rocket(c, body) {
    piece(c, () => poly(c, [[74, 58], [92, 58], [88, 90], [70, 90]]), DARK);
    piece(c, () => rr(c, 20, 28, 148, 36, 16), body);
    piece(c, () => rr(c, 8, 22, 20, 48, 6), DARK);
    piece(c, () => rr(c, 116, 24, 16, 44, 4), '#ffd23f');
    piece(c, () => poly(c, [[166, 32], [198, 46], [166, 60]]), '#e63946');
    piece(c, () => rr(c, 50, 16, 26, 14, 4), shade(body, -0.3), { ink: 4 });
    sparkle(c, 88, 46, 9, '#ffd23f');
  },
  bat(c, body) {
    c.save();
    c.translate(100, 52);
    c.rotate(-0.25);
    piece(c, () => rr(c, -90, -6, 50, 12, 6), '#3f2e1f');
    piece(c, () => { c.beginPath(); c.moveTo(-44, -7); c.lineTo(70, -17); c.arcTo(92, -17, 92, 0, 16); c.arcTo(92, 17, 70, 17, 16); c.lineTo(-44, 7); c.closePath(); }, body);
    piece(c, () => rr(c, 40, -16, 9, 32, 3), '#ffd23f', { shine: false, ink: 4 });
    piece(c, () => rr(c, -96, -9, 8, 18, 4), '#3f2e1f', { shine: false, ink: 4 });
    c.restore();
  },
  revolver(c, body) {
    piece(c, () => poly(c, [[56, 50], [80, 50], [72, 88], [44, 92], [42, 84]]), '#8b5a2b');
    c.lineWidth = 5; c.strokeStyle = INK;
    c.beginPath(); c.arc(90, 60, 10, 0.1 * Math.PI, 0.95 * Math.PI); c.stroke();
    piece(c, () => rr(c, 100, 32, 88, 16, 6), body);
    piece(c, () => rr(c, 66, 26, 44, 34, 10), shade(body, -0.2));
    c.fillStyle = INK; for (const y of [36, 46]) { c.beginPath(); c.arc(88, y, 3.5, 0, Math.PI * 2); c.fill(); }
    piece(c, () => rr(c, 180, 26, 8, 10, 2), body, { shine: false, ink: 3 });
    piece(c, () => poly(c, [[60, 26], [70, 18], [76, 26]]), DARK, { shine: false, ink: 3 });
  },
  dbarrel(c, body) {
    piece(c, () => poly(c, [[14, 58], [60, 40], [66, 62], [30, 86]]), WOOD);
    piece(c, () => rr(c, 58, 32, 34, 28, 7), DARK);
    piece(c, () => rr(c, 88, 28, 86, 14, 6), shade(body, -0.1));
    piece(c, () => rr(c, 88, 44, 86, 14, 6), shade(body, -0.3));
    c.fillStyle = INK; for (const y of [35, 51]) { c.beginPath(); c.arc(171, y, 4, 0, Math.PI * 2); c.fill(); }
    sparkle(c, 128, 20, 7, '#ffd23f');
  },
  ar(c, body) {
    piece(c, () => poly(c, [[6, 40], [42, 36], [42, 60], [10, 66]]), DARK);
    piece(c, () => poly(c, [[60, 56], [78, 56], [74, 88], [56, 88]]), DARK);
    piece(c, () => poly(c, [[94, 56], [112, 56], [120, 92], [100, 94]]), shade(DARK, -0.3));
    piece(c, () => rr(c, 38, 30, 110, 30, 8), body);
    piece(c, () => rr(c, 146, 38, 46, 11, 4), DARK);
    piece(c, () => rr(c, 76, 18, 30, 14, 5), '#e63946', { ink: 4 });
    c.fillStyle = '#fff6e0'; c.font = 'bold 18px sans-serif'; c.textAlign = 'center'; c.fillText('♠', 64, 52);
  },
  sniper(c, body) {
    piece(c, () => poly(c, [[2, 50], [40, 42], [44, 64], [6, 72]]), DARK);
    piece(c, () => rr(c, 104, 44, 94, 9, 3), DARK);
    piece(c, () => rr(c, 38, 40, 70, 22, 6), body);
    piece(c, () => poly(c, [[64, 60], [78, 60], [72, 86], [56, 86]]), DARK);
    c.strokeStyle = INK; c.lineWidth = 4;
    c.beginPath(); c.moveTo(160, 52); c.lineTo(150, 78); c.moveTo(168, 52); c.lineTo(178, 78); c.stroke();
    piece(c, () => rr(c, 46, 16, 72, 18, 9), '#ffd23f');
    c.fillStyle = '#7dd3fc'; c.strokeStyle = INK; c.lineWidth = 3;
    c.beginPath(); c.ellipse(116, 25, 4, 8, 0, 0, Math.PI * 2); c.fill(); c.stroke();
    c.fillStyle = '#fff6e0'; c.font = 'bold 16px sans-serif'; c.textAlign = 'center'; c.fillText('♠', 64, 57);
  },
  minigun(c, body) {
    piece(c, () => rr(c, 102, 26, 92, 10, 4), DARK);
    piece(c, () => rr(c, 102, 38, 92, 10, 4), shade(DARK, 0.2));
    piece(c, () => rr(c, 102, 50, 92, 10, 4), DARK);
    piece(c, () => rr(c, 150, 22, 12, 42, 4), '#ffd23f', { ink: 4 });
    piece(c, () => rr(c, 20, 20, 88, 50, 12), body);
    piece(c, () => rr(c, 40, 8, 40, 14, 5), DARK, { ink: 4 });
    piece(c, () => poly(c, [[34, 68], [56, 68], [52, 92], [30, 92]]), DARK);
    c.fillStyle = '#fff6e0'; c.font = 'bold 22px sans-serif'; c.textAlign = 'center'; c.fillText('🐋', 64, 52);
  },
  spoon(c, body) {
    c.save();
    c.translate(100, 52);
    c.rotate(-0.28);
    piece(c, () => rr(c, -88, -7, 110, 14, 7), shade(body, -0.1));
    piece(c, () => { c.beginPath(); c.ellipse(46, 0, 40, 25, 0, 0, Math.PI * 2); }, body);
    c.fillStyle = 'rgba(255,255,255,0.7)';
    c.beginPath(); c.ellipse(36, -9, 16, 6, -0.2, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#5ee27a'; c.strokeStyle = INK; c.lineWidth = 3;
    c.beginPath(); c.arc(-70, 0, 5, 0, Math.PI * 2); c.fill(); c.stroke();
    c.restore();
  },
};

// A data URL for this gun kind and rarity.
export function gunIcon(kind, rarity = 0) {
  const key = `${kind}:${rarity}`;
  if (cache.has(key)) return cache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d');
  if (!c || !DRAW[kind]) { cache.set(key, null); return null; }
  let body = RARITY_BODY[rarity] || DEFAULT_BODY[kind];
  if (kind === 'spoon' && rarity === 0) body = DEFAULT_BODY.spoon;
  // Legendary guns get a soft gold glow behind them.
  if (rarity >= 2) {
    const g = c.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, W / 2);
    g.addColorStop(0, rarity === 3 ? 'rgba(255,200,61,0.45)' : 'rgba(168,85,247,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
  }
  DRAW[kind](c, body);
  if (rarity >= 2) {
    sparkle(c, 30, 18, rarity === 3 ? 9 : 7);
    sparkle(c, 182, 82, rarity === 3 ? 7 : 5);
    if (rarity === 3) sparkle(c, 150, 12, 6, '#ffd23f');
  }
  const url = canvas.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

// The icon for any item as HTML: a picture for guns, the emoji for everything else.
export function iconHtml(item, cls = 'gicon') {
  const info = itemInfo(item);
  if (isGun(item) && item.kind !== 'fists') {
    const url = gunIcon(item.kind, item.rarity || 0);
    if (url) return `<img class="${cls}" src="${url}" alt="${info.name}" draggable="false">`;
  }
  return info.icon;
}

export { RARITIES };
