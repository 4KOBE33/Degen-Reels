// Boots the renderer and ties the Hub, the raid and the HUD together.
import * as THREE from 'three';
import { Raid } from './raid.js';
import { net } from './net.js';
import { Session } from './multi.js';
import { Hud } from './hud.js';
import { Hub } from './hub.js';
import { PlayerController } from './player.js';
import { initAudio, setVolume } from './audio.js';
import { save } from './save.js';
import { keyName, renderBinds, wireBinds } from './keys.js';
import { ITEMS, QUALITY } from './config.js';
import { BUILD } from './version.js';
import { wornLook } from './looks.js';
import { Tutorial } from './tutorial.js';
import { Voice } from './voice.js';
import { music } from './music.js';

const tutorial = new Tutorial();

const $ = (id) => document.getElementById(id);

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch (err) {
  // No 3D in this browser: say so instead of showing an empty screen.
  document.body.insertAdjacentHTML('beforeend', '<div style="position:fixed;inset:0;display:grid;place-items:center;background:#1b0f2b;color:#fff6e0;font:900 18px Nunito,sans-serif;text-align:center;padding:24px;z-index:999">Your browser couldn\'t start 3D graphics (WebGL).<br>Turn on "Use graphics acceleration" in your browser settings, then reload.</div>');
  throw err;
}
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
raid.setOverlay = (n) => setOverlay(n);
raid.openTable = (g) => openTable(g);

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function povLabel() {
  const b = document.getElementById('povBtn');
  if (b) b.textContent = controller.firstPerson ? `🎥 Switch to third person (${keyName('pov')})` : `👁️ Switch to first person (${keyName('pov')})`;
}

// Graphics: sharpness, shadows and how far away things get drawn.
let autoLevel = 'high'; // where 'auto' has settled
function applyQuality() {
  const want = save.get().settings.quality || 'auto';
  const q = QUALITY[want === 'auto' ? autoLevel : want] || QUALITY.high;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(q.pixelRatio >= 2 ? dpr : Math.min(dpr, 1) * q.pixelRatio);
  raid.drawDist = q.drawDist;
  const sun = raid.map.sun;
  if (sun) {
    sun.castShadow = q.shadows > 0;
    if (q.shadows && sun.shadow.mapSize.x !== q.shadows) {
      sun.shadow.mapSize.set(q.shadows, q.shadows);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
  }
}

// Auto: if frames are slow for a few seconds in a raid, drop a level.
let slowFor = 0;
function autoQuality(dt, rawDt) {
  if ((save.get().settings.quality || 'auto') !== 'auto' || !raid.active || document.hidden) { slowFor = 0; return; }
  slowFor = rawDt > 1 / 38 ? slowFor + dt : Math.max(0, slowFor - dt * 2);
  if (slowFor > 4 && autoLevel !== 'low') {
    autoLevel = autoLevel === 'high' ? 'medium' : 'low';
    slowFor = 0;
    applyQuality();
    hud.toast(`🖥️ Graphics lowered to ${QUALITY[autoLevel].label} to keep things smooth (Settings → Graphics).`);
  }
}

function applySettings() {
  applyQuality();
  const s = save.get().settings;
  music.setVolume(s.music ?? 0.45);
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
  if (name) tutorial.note(name);
  $('bag').hidden = name !== 'bag';
  $('bigmap').hidden = name !== 'map';
  $('duelPanel').hidden = name !== 'duel';
  $('betPanel').hidden = name !== 'bet';
  if (name === 'map') hud.drawBigMap(raid);
  if (name && document.pointerLockElement) document.exitPointerLock();
  if (!name && raid.active) controller.lock();
}

controller.onToggle = (name) => setOverlay(overlay === name ? null : name);
controller.onLockChange = (locked) => {
  const inRaid = raid.active;
  $('paused').hidden = locked || !inRaid || !!overlay;
  if (locked && overlay) setOverlay(null);
};
const kcLive = () => raid.killcam && !raid.killcam.over;
// Results screen: Space / Enter / Esc also take you back to the hub.
window.addEventListener('keydown', (e) => {
  if ($('results').hidden || !['Space', 'Enter', 'Escape'].includes(e.code)) return;
  if (kcLive()) return;
  e.preventDefault();
  $('resultsBack').click();
});
// Skip the kill cam.
window.addEventListener('keydown', (e) => { if (e.code === 'Space' || e.code === 'Escape' || e.code === 'Enter') raid.skipKillcam(); });
window.addEventListener('mousedown', () => raid.skipKillcam());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && overlay) {
    overlay = null;
    $('bag').hidden = true;
    $('bigmap').hidden = true;
    $('duelPanel').hidden = true;
    $('betPanel').hidden = true;
    if (document.body.classList.contains('tablemode')) { hub.closeTable(); return; }
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
hud.onMove = (from, to) => { const r = raid.moveItem(raid.player, from, to); if (r) hud.toast(r); };
hud.onPickThrowFrom = (from) => {
  const it = from.where === 'pack' ? raid.player.backpack[from.i] : null;
  if (!it || !ITEMS[it.id] || ITEMS[it.id].kind !== 'throw') { hud.toast('Only throwables go there'); return; }
  hud.onPickThrow(it.id);
};
// Double-click / right-click: the obvious thing for that item.
hud.onQuick = (slot) => {
  const p = raid.player;
  if (slot.where === 'weapon') { const r = raid.unequipToPack(p, slot.i); if (r) hud.toast(r); return; }
  if (slot.where === 'pocket') { const r = raid.moveItem(p, slot, { where: 'pack', i: p.backpack.length }); if (r) hud.toast(r); return; }
  const it = p.backpack[slot.i];
  if (!it) return;
  if (it.id === 'gun') { const r = raid.equipFromPack(p, slot.i); if (r) hud.toast(r); return; }
  const kind = ITEMS[it.id].kind;
  if (kind === 'throw') hud.onPickThrow(it.id);
  else if (kind === 'ammo') hud.onReload();
  else if (['heal', 'armor', 'warm', 'boost'].includes(kind)) hud.onUse(it.id);
  else hud.toast(`${ITEMS[it.id].name}: sell it to the Fence`);
};
hud.onReload = () => {
  if (!raid.player.gun) { hud.toast(`Switch to a gun first (${keyName('weapon1')} or ${keyName('weapon2')})`); return; }
  const refusal = raid.player.reload();
  hud.toast(refusal || 'Reloaded. One 📦 Ammo Box used.');
};
hud.onPickThrow = (id) => {
  raid.player.throwable = id;
  hud.toast(`Throwing: ${ITEMS[id].icon} ${ITEMS[id].name}. Hold ${keyName('throw')} to aim.`);
};
hud.onUse = (id) => {
  const refusal = raid.player.startUsing(id);
  if (refusal) hud.toast(refusal);
  else setOverlay(null);
};

// Build a different map. Takes a second or two, so it only happens when you pick a new one.
// seed: party raids rebuild the map from a shared seed so everyone's world matches.
function switchMap(id, seed = null) {
  if (seed === null && raid.mapId === id && raid.seed === null) return;
  if (raid.active) return;
  if (session) { session.dispose(); session = null; }
  raid.dispose();
  raid = new Raid(hud, id, seed);
  raid.renderer = renderer;
  raid.camera = camera;
  raid.setOverlay = setOverlay;
  raid.openTable = openTable;
  controller.raid = raid;
  if (typeof voice !== 'undefined') voice.raid = raid;
  applyQuality();
  window.degen = raid;
}

// ---------- multiplayer ----------
let session = null;
net.connect();
const voice = new Voice(net);
voice.raid = raid;
voice.onChange = (msg) => {
  if (msg) { hud.toast(msg); hub.toast(msg); }
  $('voiceInd').hidden = !voice.talking;
  if (!$('hub').hidden && hub.tab === 'loadout') hub.renderDeploy();
};
window.voice = voice;
window.music = music;
// The leader's start: everyone (leader included) launches from the server's echo.
net.on('start', (info) => {
  if (raid.active) return;
  hub.launch(info);
});
net.on('disconnected', () => {
  if (session && raid.active) hud.toast('🔌 Lost connection to the party. Couldn\'t get back in.', 'big');
  // A friend who can't reach the leader any more gets out with what they've got.
  if (session && session.client) session.hostLeft();
});
net.on('reconnecting', () => { if (session && raid.active) hud.toast('📶 Connection hiccup, reconnecting…'); });
let rejoinAfterReload = false;
net.on('resumed', ({ reload } = {}) => {
  if (session && raid.active) hud.toast('📶 Back online');
  if (reload) rejoinAfterReload = true;
});
net.on('room', (r) => {
  if (!rejoinAfterReload || !r) return;
  rejoinAfterReload = false;
  if (r.inRaid) askToJoin(false);
});

// ---------- dropping into a raid in progress ----------
// While you're in a party raid, what you carry is backed up every couple of seconds, so if the
// page reloads or crashes you can get back in with it.
const BACKUP_KEY = 'bth-raid-backup';
let backupAt = 0;
function backupRaid(force = false) {
  if (!session || !session.client || !raid.active || !net.room) return;
  if (!force && performance.now() - backupAt < 2000) return;
  backupAt = performance.now();
  const p = raid.player;
  if (!p || !p.alive) return;
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify({ code: net.room.code, seed: raid.seed, at: Date.now(), weapons: p.weapons, backpack: p.backpack, pocket: p.pocket, chips: p.chips, hp: p.hp, armor: p.armor }));
  } catch (e) { /* storage full or blocked */ }
}
window.addEventListener('pagehide', () => backupRaid(true));
function readBackup(code) {
  try {
    const b = JSON.parse(localStorage.getItem(BACKUP_KEY) || 'null');
    return b && b.code === code && Date.now() - b.at < 10 * 60 * 1000 ? b : null;
  } catch (e) { return null; }
}
function clearBackup() { try { localStorage.removeItem(BACKUP_KEY); } catch (e) { /* blocked */ } }

// Ask the leader to let us in (after a reload, or a new member joining late).
function askToJoin(late) {
  const r = net.room;
  if (!r || !r.inRaid || raid.active) return;
  if (net.isHost) {
    // We were leading and our page reloaded: the world we were running is gone.
    net.to('all', { k: 'hostgone' });
    net.end();
    hub.toast('Your page reloaded mid-raid, so the raid you were leading ended. Your squad got out with their gear.');
    return;
  }
  const d = save.get();
  const me = r.members.find((m) => m.id === net.id) || {};
  net.to('host', { k: 'rejoin', late, name: (d.look.name || '').trim() || 'High Roller', look: wornLook(d.look), team: me.team || 0 });
  hub.toast(late ? '🪂 Dropping in…' : '🪂 Getting you back into the raid…');
}
net.on('msg', ({ d }) => {
  if (!d || raid.active) return;
  if (d.k === 'joinInfo') {
    const restore = readBackup(net.room && net.room.code);
    hub.launch({ ...d.info, join: { pos: d.pos, time: d.time, el: d.el, opened: d.opened, vault: d.vault, pickups: d.pickups, restore } });
  } else if (d.k === 'nojoin') hub.toast(d.why);
});

const hub = new Hub({
  net,
  // Leader hit DEPLOY SQUAD: pick the shared seed, exits and drop point, and tell the party.
  onPartyStart() {
    const mapId = save.get().selectedMap;
    const seed = Math.floor(Math.random() * 2 ** 31);
    const exits = [0, 1, 2, 3].sort(() => Math.random() - 0.5).slice(0, 2);
    const spawns = raid.mapId === mapId ? raid.map.spawns : null;
    const spawn = spawns ? spawns[Math.floor(Math.random() * spawns.length)] : null;
    net.start({ mapId, seed, exits, spawn });
  },
  onSettings() { applySettings(); voice.apply(); },
  onJoinRaid() { askToJoin(true); },
  onMapChange(id) {
    $('loading').hidden = false;
    // Let the "Loading" note paint before the heavy build.
    setTimeout(() => { switchMap(id); $('loading').hidden = true; }, 30);
  },
  onDeploy(opts) {
    spectate(null);
    applySettings();
    pauseKeys();
    if (opts.party) {
      const info = opts.party;
      switchMap(info.mapId, info.seed);
      session = new Session(raid, net, info);
      session.info = { mapId: info.mapId, seed: info.seed, exits: info.exits, spawn: info.spawn };
      const red = info.spawn || raid.map.spawns[0];
      // Teams: blue drops in at the spawn farthest from red's.
      const blue = raid.map.spawns.reduce((best, s) => (Math.hypot(s[0] - red[0], s[1] - red[1]) > Math.hypot(best[0] - red[0], best[1] - red[1]) ? s : best), red);
      const me = info.members.find((m) => m.id === net.id) || {};
      const myTeam = session.mode === 'teams' ? me.team || 0 : 0;
      const mates = info.members.filter((m) => session.mode !== 'teams' || (m.team || 0) === myTeam);
      const slot = Math.max(0, mates.findIndex((m) => m.id === net.id));
      const spawn = myTeam ? blue : red;
      const join = info.join || null;
      raid.deploy({ ...opts, opts: { client: !session.host, exits: info.exits, spawn, slot, party: info.members.length, at: join && join.pos, restore: join && join.restore } });
      if (join) { session.applyJoin(join); clearBackup(); }
      if (session.host) session.addFriends(new THREE.Vector3(spawn[0], 0, spawn[1]));
      else session.register(raid.player, `p${net.id}`);
    } else {
      switchMap(opts.mapId);
      raid.deploy(opts);
    }
    controller.c = raid.player;
    tutorial.start(raid);
    hub.hide();
    $('hud').hidden = false;
    $('results').hidden = true;
    $('paused').hidden = false;
    controller.lock();
  },
});

window.hub = hub;

// Lounge tables: the Back Room game, right there on the casino floor.
function openTable(game) {
  setOverlay('table');
  hub.openTable(game);
}
hub.onTableClose = () => setOverlay(null);
$('buildTag').textContent = `Build ${BUILD}`;

hud.onLeave = () => {
  spectate(null);
  // Friends' games stop listening once they're out; the leader keeps the world going for the rest.
  if (session && session.client) { session.bye(); session.dispose(); session = null; }
  $('results').hidden = true;
  $('hud').hidden = true;
  hub.show();
};

$('paused').addEventListener('click', (e) => {
  if (e.target.closest('input, label, button, #pauseBinds')) return;
  initAudio();
  controller.lock();
});
$('resume').addEventListener('click', () => { initAudio(); controller.lock(); });
$('openBag').addEventListener('click', () => {
  if (!raid.active) return;
  $('paused').hidden = true;
  overlay = 'bag';
  tutorial.note('bag');
  $('bag').hidden = false;
});
$('abandon').addEventListener('click', () => {
  if (!raid.active) return;
  raid.player.alive = false;
  raid.fail('abandon');
  $('paused').hidden = true;
});

// The controls cheat sheet on the pause screen, built from your current bindings.
function pauseKeys() {
  const k = (a) => `<b>${keyName(a)}</b>`;
  $('pauseKeys').innerHTML = `${k('forward')}${k('left')}${k('back')}${k('right')} move · ${k('jump')} jump · ${k('sprint')} sprint · ${k('roll')} dodge roll · ${k('fire')} shoot · ${k('aim')} aim<br>
    ${k('use')} use (hold to search) · ${k('weapon1')} ${k('weapon2')} ${k('swap')} guns · ${k('reload')} reload (uses an 📦 Ammo Box)<br>
    ${k('throw')} hold to aim a throwable, let go to throw · ${k('cycleThrow')} next throwable<br>
    ${k('heal')} heal · ${k('armor')} armor · ${k('cocoa')} cocoa · ${k('boost')} Rocket Fuel · ${k('bag')} backpack · ${k('map')} map · ${k('pov')} camera`;
  povLabel();
}
pauseKeys();
const rerenderPauseBinds = () => { $('pauseBinds').innerHTML = renderBinds(); pauseKeys(); };
wireBinds($('pauseBinds'), rerenderPauseBinds, (t) => hud.toast(t));
$('openBinds').addEventListener('click', () => {
  const box = $('pauseBinds');
  box.hidden = !box.hidden;
  if (!box.hidden) rerenderPauseBinds();
  $('openBinds').textContent = box.hidden ? '⌨️ Controls' : '⌨️ Hide controls';
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

// ---------- spectating ----------
// Out of a party raid (dead or extracted) while friends are still in it: watch them.
let spectating = null;
const squad = () => (session ? session.squad() : []);

function spectate(target) {
  spectating = target;
  raid.spectating = target;
  if (session) session.watch(target);
  document.body.classList.toggle('spectating', !!target);
  $('spectate').hidden = !target;
  if (target) {
    $('results').hidden = true;
    camInit = false;
  }
}

function stopSpectating(note) {
  if (!spectating) return;
  spectate(null);
  $('results').hidden = false;
  if (note) hud.toast(note);
}

function nextSpectate(dir = 1) {
  const list = squad();
  if (!list.length) { stopSpectating('Nobody left to watch.'); return; }
  const i = list.indexOf(spectating);
  spectate(list[(i + dir + list.length) % list.length]);
}

$('resultsSpectate').addEventListener('click', (e) => { e.stopPropagation(); nextSpectate(1); });
window.addEventListener('keydown', (e) => {
  if (!spectating) return;
  if (e.code === 'Escape') { e.preventDefault(); stopSpectating(); return; }
  if (['Space', 'ArrowRight', 'KeyD', 'Enter'].includes(e.code)) { e.preventDefault(); nextSpectate(1); }
  if (['ArrowLeft', 'KeyA'].includes(e.code)) { e.preventDefault(); nextSpectate(-1); }
});
window.addEventListener('mousedown', (e) => { if (spectating && e.button === 0) nextSpectate(1); });

// Over the shoulder of whoever you're watching, looking where they look.
const SPEC_OFFSET = new THREE.Vector3(1.15, 0.7, 4.6);
let camInit = false;
function spectateView(dt) {
  const t = spectating;
  const head = t.head(new THREE.Vector3());
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(t.pitch || 0, t.yaw || 0, 0, 'YXZ'));
  const off = SPEC_OFFSET.clone().applyQuaternion(q);
  const hit = raid.raycast(head, off.clone().normalize(), off.length() + 0.3, t, { solidsOnly: true });
  const dist = hit.hit ? Math.max(0.6, hit.distance - 0.3) : off.length();
  const want = head.clone().addScaledVector(off.normalize(), dist);
  if (!camInit) { camera.position.copy(want); camInit = true; } else camera.position.lerp(want, Math.min(1, dt * 12));
  camera.quaternion.slerp(q, Math.min(1, dt * 14));
  const fov = save.get().settings.fov || 75;
  if (Math.abs(camera.fov - fov) > 0.1) { camera.fov = fov; camera.updateProjectionMatrix(); }
  $('spName').textContent = t.name;
  const hp = Math.max(0, t.hp / (t.maxHp || 100));
  $('spHp').style.width = `${(hp * 100).toFixed(0)}%`;
  $('spHp').style.background = t.downed ? '#ff5d5d' : hp < 0.35 ? '#ffd23f' : '#5ee27a';
  const n = squad().length;
  $('spInfo').textContent = `${t.downed ? '🩸 DOWNED · ' : ''}${t.weaponName || ''}${n > 1 ? ` · ${n} squadmates left` : ''}`;
}

// When a raid ends, let go of the mouse so you can click through the results.
let wasActive = false;

// ---------- music ----------
// Lounge jazz in the hub and the Lounge, a tense groove in raids (drums when things get hot),
// the boss theme near the Pit Boss, silence on the results screen.
function pickMusic() {
  const tableMode = document.body.classList.contains('tablemode');
  if (!$('hub').hidden && !tableMode) { music.set('lounge'); return; }
  if (!raid.active) { music.set(null); return; }
  if (raid.map.safe) { music.set('lounge'); return; }
  const p = raid.player;
  const b = raid.boss;
  if (p && b && b.alive && b.pos.distanceTo(p.pos) < 70 && (b.target || (raid.bossLock && raid.bossLock.on))) { music.set('boss', 1); return; }
  const now = performance.now();
  const hot = p && (raid.machines.some((m) => m.alive && m.target === p) || now - (p.hurtAt || 0) < 6000 || now - (p.firedAt || 0) < 4000);
  music.set('raid', hot ? 1 : 0);
}

// ---------- loop ----------

let last = performance.now();
let orbit = 0;

// If something breaks, say so instead of silently freezing, and keep the loop alive.
let crashShown = false;
function showCrash(kind, detail) {
  try { localStorage.setItem('degen-reels-last-error', `${new Date().toISOString()} ${kind}: ${detail}`); } catch (e) { /* storage blocked */ }
  if (crashShown) return;
  crashShown = true;
  const el = $('crash');
  el.hidden = false;
  $('crashWhat').textContent = kind;
  $('crashDetail').textContent = String(detail).slice(0, 300);
  if (document.pointerLockElement) document.exitPointerLock();
}
window.addEventListener('error', (e) => showCrash('Something broke', `${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`));
window.addEventListener('unhandledrejection', (e) => showCrash('Something broke', e.reason && e.reason.message ? e.reason.message : String(e.reason)));
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  showCrash('The graphics crashed', 'Your browser lost the 3D context (usually running out of video memory). Your stash is saved. Reload to keep playing.');
});
$('crashReload').addEventListener('click', () => location.reload());
$('crashDismiss').addEventListener('click', () => { $('crash').hidden = true; crashShown = false; });

function frame(now) {
  requestAnimationFrame(frame);
  try {
    step(now);
  } catch (err) {
    console.error(err);
    showCrash('Something broke', `${err.message} @ ${(err.stack || '').split('\n')[1] || ''}`);
  }
}

function step(now, draw = true) {
  const rawDt = (now - last) / 1000;
  const dt = Math.min(0.05, rawDt);
  if (draw) autoQuality(dt, rawDt);
  last = now;
  const inRaid = raid.active;
  const paused = inRaid && (!controller.locked || !!overlay);

  // Party raids never pause: the world is shared, so the pause menu only stops your controls.
  if (!paused && inRaid && !kcLive()) controller.update(dt);
  else if (inRaid && session && raid.player) { raid.player.move.set(0, 0); raid.player.aiming = false; }
  if (!paused || session) raid.update(dt);
  if (wasActive && !raid.active) {
    syncPauseSliders();
    setTimeout(() => { if (document.pointerLockElement) document.exitPointerLock(); }, 900);
    overlay = null;
    $('bag').hidden = true;
    $('bigmap').hidden = true;
  }
  if (wasActive && !raid.active) {
    clearBackup();
    if (raid.result && !raid.map.safe) music.sting(raid.result.success ? 'extract' : 'busted');
  }
  pickMusic();
  tutorial.update(raid);
  voice.update();
  wasActive = raid.active;
  backupRaid();
  // Never keep the mouse captured once you're out of the raid.
  if (!raid.active && document.pointerLockElement && wasActive === false && !kcLive()) document.exitPointerLock();

  const kc = raid.killcam && !raid.killcam.over ? raid.killcam : null;
  document.body.classList.toggle('killcam', !!kc);
  // Spectating: follow your squadmate until they're out too.
  if (spectating && (!spectating.alive || !raid.combatants.includes(spectating) || !session || session.ended)) {
    const left = squad();
    if (left.length) spectate(left[0]);
    else stopSpectating('Your squad is out. Raid over.');
  }
  // Offer it on the results screen while someone's still in there.
  if (!$('results').hidden) $('resultsSpectate').hidden = !squad().length;
  if (spectating && $('hub').hidden) {
    spectateView(dt);
  } else if (kc && $('hub').hidden) {
    raid.killcamView(dt, camera);
    if (raid.player) raid.player.char.firstPerson(false);
  } else if (raid.player && $('hub').hidden) {
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

  if (draw) renderer.render(raid.scene, camera);
}
requestAnimationFrame(frame);

// Browsers stop drawing frames in background tabs. In a party that would freeze the world for
// everyone (or freeze you for them), so a worker keeps the game ticking while the tab is hidden.
try {
  const src = 'setInterval(() => postMessage(0), 33);';
  const ticker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  ticker.onmessage = () => {
    if (!document.hidden || !session || session.ended) return;
    try { step(performance.now(), false); } catch (err) { console.error(err); }
  };
} catch (e) { /* workers blocked here: background tabs just pause */ }
