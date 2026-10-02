// Rebindable controls. Every action has two slots; each holds a keyboard code ('KeyE'),
// a mouse button ('Mouse0'-'Mouse4') or a wheel direction ('WheelUp' / 'WheelDown').
import { save } from './save.js';

export const ACTIONS = [
  ['Movement', [
    ['forward', 'Move forward'], ['back', 'Move back'], ['left', 'Move left'], ['right', 'Move right'],
    ['jump', 'Jump'], ['sprint', 'Sprint'], ['roll', 'Dodge roll'],
  ]],
  ['Combat', [
    ['fire', 'Shoot'], ['aim', 'Aim down sights'], ['reload', 'Reload (uses an Ammo Box)'],
    ['weapon1', 'Weapon 1'], ['weapon2', 'Weapon 2'], ['swap', 'Swap weapons'],
    ['throw', 'Throw (hold to aim)'], ['cycleThrow', 'Throwable wheel (hold) / next (tap)'],
  ]],
  ['Items', [
    ['use', 'Use / pick up (hold to search)'], ['heal', 'Heal'], ['armor', 'Armor plate'],
    ['cocoa', 'Hot cocoa'], ['boost', 'Rocket Fuel drink'],
  ]],
  ['Screens', [
    ['bag', 'Backpack'], ['map', 'Map'], ['pov', 'First / third person'],
  ]],
  ['Party', [
    ['talk', 'Push to talk (voice chat)'],
  ]],
];

export const DEFAULT_BINDS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space', null],
  sprint: ['ShiftLeft', 'ShiftRight'],
  roll: ['KeyC', null],
  fire: ['Mouse0', null],
  aim: ['Mouse2', null],
  reload: ['KeyR', null],
  weapon1: ['Digit1', null],
  weapon2: ['Digit2', null],
  swap: ['WheelDown', 'WheelUp'],
  throw: ['KeyT', null],
  cycleThrow: ['KeyX', null],
  use: ['KeyE', null],
  heal: ['KeyH', null],
  armor: ['KeyF', null],
  cocoa: ['KeyG', null],
  boost: ['KeyZ', null],
  bag: ['KeyQ', 'Tab'],
  map: ['KeyM', null],
  pov: ['KeyV', null],
  talk: ['KeyB', null],
};

// Current bindings, with defaults filled in for anything a saved profile is missing.
export function binds() {
  const saved = save.get().settings.binds || {};
  const out = {};
  for (const [action, def] of Object.entries(DEFAULT_BINDS)) {
    out[action] = Array.isArray(saved[action]) ? [saved[action][0] ?? null, saved[action][1] ?? null] : [...def];
  }
  return out;
}

// Which actions a code triggers.
export function actionsFor(code) {
  const b = binds();
  return Object.keys(b).filter((a) => b[a].includes(code));
}

// Bind `code` to slot `slot` of `action`. Takes it off anything else first.
// Returns the names of actions that lost it.
export function setBind(action, slot, code) {
  const took = [];
  save.update((d) => {
    const b = binds();
    if (code) {
      for (const [a, codes] of Object.entries(b)) {
        codes.forEach((c, i) => { if (c === code && !(a === action && i === slot)) { codes[i] = null; took.push(a); } });
      }
    }
    b[action][slot] = code;
    d.settings.binds = b;
  });
  return took;
}

export function resetBinds() {
  save.update((d) => { delete d.settings.binds; });
}

const NAMES = {
  Mouse0: 'Left click', Mouse1: 'Middle click', Mouse2: 'Right click', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5',
  WheelUp: 'Wheel up', WheelDown: 'Wheel down', Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'R Shift',
  ControlLeft: 'Ctrl', ControlRight: 'R Ctrl', AltLeft: 'Alt', AltRight: 'R Alt', Tab: 'Tab', CapsLock: 'Caps',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backquote: '`', Minus: '-', Equal: '=',
  BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  Enter: 'Enter', Backspace: 'Backspace',
};

export function codeName(code) {
  if (!code) return '—';
  if (NAMES[code]) return NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  if (code.startsWith('Mouse')) return `Mouse ${Number(code.slice(5)) + 1}`;
  return code;
}

// Short label for an action's main binding, for HUD hints ("R", "Mouse 4").
export function keyName(action) {
  const [a, b] = binds()[action] || [];
  return codeName(a || b);
}

// ---------- the rebinding panel (used in Settings and the pause menu) ----------

let capture = null; // { action, slot, el, done }

export function renderBinds() {
  const b = binds();
  const rows = ACTIONS.map(([group, list]) => `<div class="bindgroup"><h4>${group}</h4>${list.map(([a, label]) => `
    <div class="bindrow"><span>${label}</span>${[0, 1].map((slot) => `<button class="bindkey ${b[a][slot] ? '' : 'none'}" data-bind="${a}" data-slot="${slot}">${codeName(b[a][slot])}</button>`).join('')}</div>`).join('')}</div>`).join('');
  return `<div class="binds">${rows}</div>
    <p class="hint">Click a box, then press a key or a mouse button (side buttons work). Esc cancels, Backspace clears it.</p>
    <button class="btn ghost" data-bindreset>Reset controls</button>`;
}

// Hook up a container that holds renderBinds() output. `rerender` redraws it; `toast` shows messages.
export function wireBinds(container, rerender, toast = () => {}) {
  container.addEventListener('click', (e) => {
    if (e.target.closest('[data-bindreset]')) { resetBinds(); rerender(); toast('Controls reset'); return; }
    const el = e.target.closest('[data-bind]');
    if (!el || capture) return;
    capture = { action: el.dataset.bind, slot: Number(el.dataset.slot), el };
    el.classList.add('listening');
    el.textContent = 'Press…';
    const block = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
    const finish = (code) => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
      window.removeEventListener('wheel', onWheel, true);
      const c = capture;
      capture = null;
      if (code !== undefined) {
        const took = setBind(c.action, c.slot, code);
        if (took.length && code) toast(`${codeName(code)} moved off: ${took.map(actionLabel).join(', ')}`);
      }
      rerender();
    };
    // After binding a mouse button, swallow the rest of that click so it doesn't also do something.
    const swallowClick = () => {
      const off = () => {
        window.removeEventListener('mouseup', onUp, true);
        window.removeEventListener('click', block, true);
        window.removeEventListener('auxclick', block, true);
        window.removeEventListener('contextmenu', block, true);
      };
      const onUp = (ev) => { block(ev); setTimeout(off, 50); };
      window.addEventListener('mouseup', onUp, true);
      window.addEventListener('click', block, true);
      window.addEventListener('auxclick', block, true);
      window.addEventListener('contextmenu', block, true);
    };
    const onKey = (ev) => {
      block(ev);
      if (ev.code === 'Escape') finish(undefined);
      else if (ev.code === 'Backspace' || ev.code === 'Delete') finish(null);
      else finish(ev.code);
    };
    const onMouse = (ev) => { block(ev); swallowClick(); finish(`Mouse${ev.button}`); };
    const onWheel = (ev) => { block(ev); if (Math.abs(ev.deltaY) > 0) finish(ev.deltaY < 0 ? 'WheelUp' : 'WheelDown'); };
    // Wait a beat so the click that opened this doesn't bind Left click.
    setTimeout(() => {
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('mousedown', onMouse, true);
      window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    }, 0);
  });
}

export function capturing() { return !!capture; }

function actionLabel(a) {
  for (const [, list] of ACTIONS) for (const [id, label] of list) if (id === a) return label;
  return a;
}
