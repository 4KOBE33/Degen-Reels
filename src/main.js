// Boots the renderer, runs the menu (with bots brawling in the background), and the main loop.
import * as THREE from 'three';
import { Game } from './game.js';
import { Hud } from './hud.js';
import { PlayerController } from './player.js';
import { initAudio } from './audio.js';
import { COLORS, HATS } from './config.js';

const $ = (id) => document.getElementById(id);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a0f2e);
scene.fog = new THREE.Fog(0x1a0f2e, 40, 90);

const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 200);
const hud = new Hud();
const game = new Game(scene, hud);
game.addBots();
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
let pickedHat = HATS[Math.floor(Math.random() * HATS.length)];

function renderPickers() {
  $('colors').innerHTML = COLORS.map((c) => `<button class="swatch ${c === pickedColor ? 'on' : ''}" data-c="${c}" style="background:#${c.toString(16).padStart(6, '0')}" aria-label="Color"></button>`).join('');
  $('hats').innerHTML = HATS.map((h) => `<button class="hat ${h === pickedHat ? 'on' : ''}" data-h="${h}" aria-label="${h} hat">${HAT_ICONS[h]}</button>`).join('');
}
$('colors').addEventListener('click', (e) => {
  const b = e.target.closest('[data-c]');
  if (b) { pickedColor = Number(b.dataset.c); renderPickers(); }
});
$('hats').addEventListener('click', (e) => {
  const b = e.target.closest('[data-h]');
  if (b) { pickedHat = b.dataset.h; renderPickers(); }
});
renderPickers();
try { $('name').value = localStorage.getItem('degen-name') || ''; } catch (e) { /* storage blocked */ }

function start() {
  if (controller) return;
  initAudio();
  const name = $('name').value.trim().slice(0, 14) || 'High Roller';
  try { localStorage.setItem('degen-name', name); } catch (e) { /* storage blocked */ }
  const player = game.addPlayer(name, pickedColor, pickedHat);
  controller = new PlayerController(game, player, camera, renderer.domElement);
  controller.onLockChange = (locked) => {
    paused = !locked;
    $('paused').hidden = locked;
  };
  $('menu').hidden = true;
  $('hud').hidden = false;
  controller.lock();
  paused = true;
  $('paused').hidden = false;
  hud.toast('Walk up to a slot machine and press E to gamble for a gun!', 'big');
}
$('play').addEventListener('click', start);
$('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });
$('paused').addEventListener('click', () => {
  initAudio();
  if (controller) controller.lock();
});

// ---------- loop ----------

let last = performance.now();
let orbit = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (!paused) {
    if (controller) controller.update();
    game.update(dt);
  }

  if (controller) {
    controller.updateCamera(dt);
  } else {
    // Slow fly-around of the casino behind the menu.
    orbit += dt * 0.08;
    camera.position.set(Math.sin(orbit) * 24, 13, Math.cos(orbit) * 18 + 2);
    camera.lookAt(0, 1.5, 0);
  }

  hud.update(dt, game);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
