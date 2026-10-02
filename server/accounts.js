// Cloud saves and the leaderboard. Accounts are a name + PIN; saves are stored as JSON on disk
// (DATA_DIR, or ./data). On Render, attach a persistent disk and point DATA_DIR at it, or saves
// are wiped whenever the server restarts.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'accounts.json');
const NAME_RE = /^[A-Za-z0-9 _-]{3,16}$/;
const PIN_RE = /^\d{4,8}$/;
const MAX_SAVE = 400 * 1024;

let accounts = {}; // lower-case name -> { name, salt, hash, tokens: [], save, updatedAt, chips, worth, level }
try {
  accounts = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch (e) { /* first run */ }

// Write to disk at most every couple of seconds.
let dirty = false;
function persist() { dirty = true; }
setInterval(() => {
  if (!dirty) return;
  dirty = false;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(accounts));
    fs.renameSync(`${FILE}.tmp`, FILE);
  } catch (e) { console.error('Could not write accounts:', e.message); dirty = true; }
}, 2000).unref();

const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');
const key = (name) => String(name || '').trim().toLowerCase();

// Item values come from the game's own item tables (ES modules, loaded once).
let itemInfo = null;
import('../src/items.js').then((m) => { itemInfo = m.itemInfo; }).catch((e) => console.error('Item values unavailable:', e.message));

function levelFor(xp = 0) {
  let level = 1;
  let left = xp;
  while (level < 50 && left >= 200 + (level - 1) * 120) { left -= 200 + (level - 1) * 120; level++; }
  return level;
}

// What a save is worth: chips plus everything in the stash at Fence prices.
function summarize(save) {
  const chips = Math.max(0, Math.floor(Number(save && save.stash && save.stash.chips) || 0));
  let items = 0;
  if (itemInfo) {
    for (const it of (save.stash && save.stash.items) || []) {
      try { items += itemInfo(it).value || 0; } catch (e) { /* unknown item */ }
    }
  }
  return { chips, worth: chips + Math.floor(items), level: levelFor(Number(save.xp) || 0) };
}

// Slow down PIN guessing: a few tries per name and per address each minute.
const attempts = new Map();
function tooMany(id) {
  const now = Date.now();
  const list = (attempts.get(id) || []).filter((t) => now - t < 60000);
  list.push(now);
  attempts.set(id, list);
  return list.length > 8;
}

function account(token) {
  if (!token) return null;
  for (const a of Object.values(accounts)) if (a.tokens && a.tokens.includes(token)) return a;
  return null;
}

const router = express.Router();
// The game can be played from other sites (like the artifact link), so allow cross-origin calls.
router.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});
router.use(express.json({ limit: MAX_SAVE + 1024 }));

// Create an account, or log in to one. Returns a token and the cloud save.
router.post('/account', (req, res) => {
  const { name, pin, mode, save } = req.body || {};
  if (!NAME_RE.test(String(name || ''))) { res.status(400).json({ error: 'Names are 3-16 letters, numbers, spaces, - or _.' }); return; }
  if (!PIN_RE.test(String(pin || ''))) { res.status(400).json({ error: 'Your PIN is 4-8 digits.' }); return; }
  const k = key(name);
  if (tooMany(`n:${k}`) || tooMany(`ip:${req.ip}`)) { res.status(429).json({ error: 'Too many tries. Wait a minute.' }); return; }
  let a = accounts[k];
  if (mode === 'register') {
    if (a) { res.status(409).json({ error: 'That name is taken. Log in instead, or pick another.' }); return; }
    const salt = crypto.randomBytes(16).toString('hex');
    a = accounts[k] = { name: String(name).trim(), salt, hash: hashPin(pin, salt), tokens: [], save: null, updatedAt: 0, chips: 0, worth: 0, level: 1 };
    if (save && JSON.stringify(save).length <= MAX_SAVE) {
      a.save = save;
      a.updatedAt = Date.now();
      Object.assign(a, summarize(save));
    }
  } else {
    if (!a || a.hash !== hashPin(pin, a.salt)) { res.status(401).json({ error: 'Wrong name or PIN.' }); return; }
  }
  const token = crypto.randomBytes(18).toString('hex');
  a.tokens = [...(a.tokens || []).slice(-4), token];
  persist();
  res.json({ name: a.name, token, save: a.save, updatedAt: a.updatedAt });
});

// Store the latest save.
router.post('/save', (req, res) => {
  const a = account(req.body && req.body.token);
  if (!a) { res.status(401).json({ error: 'Log in again.' }); return; }
  const save = req.body.save;
  if (!save || typeof save !== 'object' || !save.stash) { res.status(400).json({ error: 'Bad save.' }); return; }
  if (JSON.stringify(save).length > MAX_SAVE) { res.status(413).json({ error: 'Save too big.' }); return; }
  a.save = save;
  a.updatedAt = Date.now();
  Object.assign(a, summarize(save));
  persist();
  res.json({ ok: true, updatedAt: a.updatedAt });
});

// Fetch your cloud save (e.g. on another device).
router.post('/load', (req, res) => {
  const a = account(req.body && req.body.token);
  if (!a) { res.status(401).json({ error: 'Log in again.' }); return; }
  res.json({ name: a.name, save: a.save, updatedAt: a.updatedAt });
});

router.post('/logout', (req, res) => {
  const a = account(req.body && req.body.token);
  if (a) { a.tokens = a.tokens.filter((t) => t !== req.body.token); persist(); }
  res.json({ ok: true });
});

// Richest players.
router.get('/leaderboard', (req, res) => {
  const by = req.query.by === 'chips' ? 'chips' : 'worth';
  const rows = Object.values(accounts)
    .filter((a) => a.save)
    .sort((x, y) => y[by] - x[by])
    .slice(0, 100)
    .map((a) => ({ name: a.name, chips: a.chips, worth: a.worth, level: a.level }));
  res.json({ by, rows, players: Object.keys(accounts).length });
});

module.exports = { router };
