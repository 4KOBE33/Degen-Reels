// Boots the renderer, runs the menu (with rivals brawling in the background), and the main loop.
import * as THREE from 'three';
import { Game } from './game.js';
import { Hud } from './hud.js';
import { PlayerController } from './player.js';
import { initAudio } from './audio.js';
import { COLORS, HATS, HAT_UNLOCKS, FLOORS } from './config.js';
import { save } from './save.js';

const $ = (id) => document.getElementById(id);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('app').appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 250);
const hud = new Hud();
const game = new Game(hud);
// Handy for poking at the game from the browser console.
window.degen = game;
game.renderer = renderer;
game.camera = camera;

let controller = null;
let paused = false;

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- menu ----------

const HAT_ICONS = { top: '🎩', cowboy: '🤠', visor: '🃏', party: '🥳', crown: '👑' };
let pickedColor = COLORS[Math.floor(Math.random() * COLORS.length)];
let pickedHat = 'top';

function renderMenu() {
  if (!save.hatUnlocked(pickedHat)) pickedHat = 'top';
  $('colors').innerHTML = COLORS.map((c) => `<button class="swatch ${c === pickedColor ? 'on' : ''}" data-c="${c}" style="background:#${c.toString(16).padStart(6, '0')}" aria-label="Color"></button>`).join('');
  $('hats').innerHTML = HATS.map((h) => {
    const open = save.hatUnlocked(h);
    const tip = open ? `${h} hat` : `Locked: ${HAT_UNLOCKS[h].text}`;
    return `<button class="hat ${h === pickedHat ? 'on' : ''} ${open ? '' : 'locked'}" data-h="${h}" title="${tip}" aria-label="${tip}">${open ? HAT_ICONS[h] : '🔒'}</button>`;
  }).join('');
  const s = save.get();
  $('record').innerHTML = s.runs
    ? `Best: <b>Floor ${s.bestFloor}</b> of ${FLOORS.length} · Runs: <b>${s.runs}</b> · Cashed out: <b>${s.wins}</b>`
    : `Climb ${FLOORS.length} floors. Bust once and you start over.`;
}
$('colors').addEventListener('click', (e) => {
  const b = e.target.closest('[data-c]');
  if (b) { pickedColor = Number(b.dataset.c); renderMenu(); }
});
$('hats').addEventListener('click', (e) => {
  const b = e.target.closest('[data-h]');
  if (!b) return;
  if (!save.hatUnlocked(b.dataset.h)) {
    $('hatHint').textContent = `🔒 ${HAT_UNLOCKS[b.dataset.h].text} to unlock this hat.`;
    return;
  }
  pickedHat = b.dataset.h;
  $('hatHint').textContent = '';
  renderMenu();
});
renderMenu();
try { $('name').value = localStorage.getItem('degen-name') || ''; } catch (e) { /* storage blocked */ }

function playerName() {
  return $('name').value.trim().slice(0, 14) || 'High Roller';
}

function beginRun() {
  initAudio();
  game.startRun(playerName(), pickedColor, pickedHat);
  if (!controller) {
    controller = new PlayerController(game, game.player, camera, renderer.domElement);
    controller.onLockChange = (locked) => {
      paused = !locked;
      $('paused').hidden = locked || !game.run || game.run.over;
    };
  }
  controller.c = game.player;
  hud.hideRunOver();
  $('menu').hidden = true;
  $('hud').hidden = false;
  controller.lock();
  paused = true;
  $('paused').hidden = false;
  hud.toast('Gamble, fight, and make enough to ride the elevator up!', 'big');
}

function start() {
  try { localStorage.setItem('degen-name', playerName()); } catch (e) { /* storage blocked */ }
  beginRun();
}
$('play').addEventListener('click', start);
$('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });
$('paused').addEventListener('click', () => {
  initAudio();
  if (controller) controller.lock();
});

hud.onNewRun = beginRun;
hud.onMenu = () => {
  hud.hideRunOver();
  $('hud').hidden = true;
  $('menu').hidden = false;
  renderMenu();
};

// When a run ends, let go of the mouse so you can click the buttons.
let wasOver = false;
function watchRunEnd() {
  const over = !!(game.run && game.run.over);
  if (over && !wasOver) {
    renderMenu();
    setTimeout(() => { if (document.pointerLockElement) document.exitPointerLock(); }, 1200);
  }
  wasOver = over;
}

// ---------- loop ----------

let last = performance.now();
let orbit = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const running = game.run && !game.run.over;

  // The casino keeps going behind menus and run-over screens; it only pauses mid-run.
  if (!running || !paused) {
    if (controller && running) controller.update();
    game.update(dt);
  }
  watchRunEnd();

  if (controller && game.player && $('menu').hidden) {
    controller.updateCamera(dt);
  } else {
    // Slow fly-around of the casino behind the menu.
    orbit += dt * 0.06;
    const { halfW, halfD } = game.world;
    camera.position.set(Math.sin(orbit) * halfW * 0.7, 14, Math.cos(orbit) * halfD * 0.75);
    camera.lookAt(0, 1.5, 0);
  }

  hud.update(dt, game);
  renderer.render(game.scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
