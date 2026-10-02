// Boots the renderer and ties the Hub, the raid and the HUD together.
import * as THREE from 'three';
import { Raid } from './raid.js';
import { Hud } from './hud.js';
import { Hub } from './hub.js';
import { PlayerController } from './player.js';
import { initAudio, setVolume } from './audio.js';
import { save } from './save.js';

const $ = (id) => document.getElementById(id);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('app').appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 900);
const hud = new Hud();
let raid = new Raid(hud, save.get().selectedMap || 'vegas');
const controller = new PlayerController(raid, camera, renderer.domElement);
// Handy for poking at the game from the browser console.
window.degen = raid;
raid.renderer = renderer;
raid.camera = camera;

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function povLabel() {
  const b = document.getElementById('povBtn');
  if (b) b.textContent = controller.firstPerson ? '🎥 Switch to third person (V)' : '👁️ Switch to first person (V)';
}

function applySettings() {
  const s = save.get().settings;
  controller.sensitivity = s.sensitivity;
  controller.fov = s.fov;
  controller.firstPerson = !!s.firstPerson;
  povLabel();
  setVolume(s.volume);
}
applySettings();

// ---------- screens ----------

let overlay = null; // 'bag' | 'map' | null

function setOverlay(name) {
  overlay = name;
  $('bag').hidden = name !== 'bag';
  $('bigmap').hidden = name !== 'map';
  if (name === 'map') hud.drawBigMap(raid);
  if (name && document.pointerLockElement) document.exitPointerLock();
  if (!name) controller.lock();
}

controller.onToggle = (name) => setOverlay(overlay === name ? null : name);
controller.onLockChange = (locked) => {
  const inRaid = raid.active;
  $('paused').hidden = locked || !inRaid || !!overlay;
  if (locked && overlay) setOverlay(null);
};
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && overlay) {
    overlay = null;
    $('bag').hidden = true;
    $('bigmap').hidden = true;
    if (raid.active) $('paused').hidden = false;
  }
});
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => setOverlay(null)));

controller.onPov = (first) => {
  save.update((d) => { d.settings.firstPerson = first; });
  povLabel();
  hud.toast(first ? 'First person' : 'Third person');
};
$('povBtn').addEventListener('click', () => controller.togglePov());

hud.onDrop = (where, i) => raid.dropFromInventory(raid.player, where, i);
hud.onEquip = (i) => { const r = raid.equipFromPack(raid.player, i); if (r) hud.toast(r); };
hud.onUnequip = (i) => { const r = raid.unequipToPack(raid.player, i); if (r) hud.toast(r); };
hud.onReload = () => {
  if (!raid.player.gun) { hud.toast('Switch to a gun first (1 or 2)'); return; }
  const refusal = raid.player.reload();
  hud.toast(refusal || 'Reloaded. One 📦 Ammo Box used.');
};
hud.onUse = (id) => {
  const refusal = raid.player.startUsing(id);
  if (refusal) hud.toast(refusal);
  else setOverlay(null);
};

// Build a different map. Takes a second or two, so it only happens when you pick a new one.
function switchMap(id) {
  if (raid.mapId === id || raid.active) return;
  raid.dispose();
  raid = new Raid(hud, id);
  raid.renderer = renderer;
  raid.camera = camera;
  controller.raid = raid;
  window.degen = raid;
}

const hub = new Hub({
  onMapChange(id) {
    $('loading').hidden = false;
    // Let the "Loading" note paint before the heavy build.
    setTimeout(() => { switchMap(id); $('loading').hidden = true; }, 30);
  },
  onDeploy(opts) {
    applySettings();
    switchMap(opts.mapId);
    raid.deploy(opts);
    controller.c = raid.player;
    hub.hide();
    $('hud').hidden = false;
    $('results').hidden = true;
    $('paused').hidden = false;
    controller.lock();
  },
});

hud.onLeave = () => {
  $('results').hidden = true;
  $('hud').hidden = true;
  hub.show();
};

$('paused').addEventListener('click', (e) => {
  if (e.target.closest('input, label, button')) return;
  initAudio();
  controller.lock();
});
$('resume').addEventListener('click', () => { initAudio(); controller.lock(); });
$('openBag').addEventListener('click', () => {
  if (!raid.active) return;
  $('paused').hidden = true;
  overlay = 'bag';
  $('bag').hidden = false;
});
$('abandon').addEventListener('click', () => {
  if (!raid.active) return;
  raid.player.alive = false;
  raid.fail('abandon');
  $('paused').hidden = true;
});

// Settings sliders on the pause screen.
function syncPauseSliders() {
  const s = save.get().settings;
  $('psens').value = s.sensitivity;
  $('pfov').value = s.fov;
  $('pvol').value = s.volume;
  $('psensVal').textContent = `${s.sensitivity.toFixed(2)}x`;
  $('pfovVal').textContent = `${s.fov}°`;
  $('pvolVal').textContent = `${Math.round(s.volume * 100)}%`;
}
for (const [id, key] of [['psens', 'sensitivity'], ['pfov', 'fov'], ['pvol', 'volume']]) {
  $(id).addEventListener('input', (e) => {
    save.update((d) => { d.settings[key] = Number(e.target.value); });
    applySettings();
    syncPauseSliders();
  });
}
syncPauseSliders();

// When a raid ends, let go of the mouse so you can click through the results.
let wasActive = false;

// ---------- loop ----------

let last = performance.now();
let orbit = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const inRaid = raid.active;
  const paused = inRaid && (!controller.locked || !!overlay);

  if (!paused) {
    if (inRaid) controller.update(dt);
    raid.update(dt);
  }
  if (wasActive && !raid.active) {
    syncPauseSliders();
    setTimeout(() => { if (document.pointerLockElement) document.exitPointerLock(); }, 900);
    overlay = null;
    $('bag').hidden = true;
    $('bigmap').hidden = true;
  }
  wasActive = raid.active;

  if (raid.player && $('hub').hidden) {
    controller.updateCamera(dt);
    hud.update(dt, raid);
  } else {
    // A slow fly-by of the Grand Casino behind the Hub.
    orbit += dt * 0.04;
    raid.focus.set(Math.sin(orbit) * 40, 0, -10 + Math.cos(orbit) * 30);
    camera.position.set(Math.sin(orbit) * 75, 32, 25 + Math.cos(orbit) * 55);
    camera.lookAt(0, 6, -40);
    if (camera.fov !== 60) { camera.fov = 60; camera.updateProjectionMatrix(); }
  }

  renderer.render(raid.scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
