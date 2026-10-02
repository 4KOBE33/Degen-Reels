// Cloud saves and the leaderboard. Accounts are a name + PIN. They're stored in Postgres when
// DATABASE_URL is set, otherwise as JSON on disk (DATA_DIR, or ./data), which free hosts wipe.
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

// Where accounts live. With DATABASE_URL set (a free Postgres from Neon, Supabase, Render…) they
// survive restarts and redeploys. Without it they go in a JSON file, which free hosts wipe.
const DB_URL = process.env.DATABASE_URL;
let pool = null;
const changed = new Set(); // account keys waiting to be written

async function loadAccounts() {
  if (DB_URL) {
    const { Pool } = require('pg');
    const local = /@(localhost|127\.0\.0\.1)|host=\/|^postgres(ql)?:\/\/\/|\?host=/.test(DB_URL);
    pool = new Pool({ connectionString: DB_URL, ssl: local ? false : { rejectUnauthorized: false }, max: 3 });
    await pool.query('CREATE TABLE IF NOT EXISTS bth_accounts (k TEXT PRIMARY KEY, data JSONB NOT NULL, updated TIMESTAMPTZ DEFAULT now())');
    const { rows } = await pool.query('SELECT k, data FROM bth_accounts');
    for (const r of rows) accounts[r.k] = r.data;
    // Moving over from the file: bring those accounts along once.
    try {
      const old = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      for (const [k, a] of Object.entries(old)) if (!accounts[k]) { accounts[k] = a; changed.add(k); }
    } catch (e) { /* no file */ }
    console.log(`Accounts: ${rows.length} loaded from the database.`);
  } else {
    try { accounts = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { /* first run */ }
    console.log(`Accounts: ${Object.keys(accounts).length} loaded from ${FILE}. Set DATABASE_URL so they survive restarts.`);
  }
}
const ready = loadAccounts().catch((e) => { console.error('Could not load accounts:', e.message); });

// Write changes out every couple of seconds.
function persist(k) { changed.add(k); }
let writing = false;
async function flush() {
  if (writing || !changed.size) return;
  writing = true;
  const keys = [...changed];
  changed.clear();
  try {
    if (pool) {
      for (const k of keys) {
        if (accounts[k]) await pool.query('INSERT INTO bth_accounts (k, data, updated) VALUES ($1, $2, now()) ON CONFLICT (k) DO UPDATE SET data = EXCLUDED.data, updated = now()', [k, accounts[k]]);
      }
    } else {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(accounts));
      fs.renameSync(`${FILE}.tmp`, FILE);
    }
  } catch (e) {
    console.error('Could not write accounts:', e.message);
    for (const k of keys) changed.add(k);
  }
  writing = false;
}
setInterval(flush, 2000).unref();
// Don't lose the last few seconds when the host shuts us down.
for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => { flush().finally(() => process.exit(0)); });

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
router.use((req, res, next) => { ready.then(() => next()); });
router.get('/status', (req, res) => res.json({ ok: true, storage: pool ? 'database' : 'file', players: Object.keys(accounts).length }));

// Create an account, or log in to one. Returns a token and the cloud save.
router.post('/account', (req, res) => {
  const { name, pin, mode, save } = req.body || {};
  if (!NAME_RE.test(String(name || ''))) { res.status(400).json({ error: 'Names are 3-16 letters, numbers, spaces, - or _.' }); return; }
  if (!PIN_RE.test(String(pin || ''))) { res.status(400).json({ error: 'Your PIN is 4-8 digits.' }); return; }
  const k = key(name);
  if (tooMany(`n:${k}`) || tooMany(`ip:${req.ip}`)) { res.status(429).json({ error: 'Too many tries. Wait a minute.' }); return; }
  let a = accounts[k];
  if (mode === 'register') {
    // Same name and PIN again (say the first try timed out): that's fine, it's yours.
    if (a && a.hash !== hashPin(pin, a.salt)) { res.status(409).json({ error: 'That name is taken. Log in instead, or pick another.' }); return; }
    if (!a) {
      const salt = crypto.randomBytes(16).toString('hex');
      a = accounts[k] = { name: String(name).trim(), salt, hash: hashPin(pin, salt), tokens: [], save: null, updatedAt: 0, chips: 0, worth: 0, level: 1 };
    }
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
  persist(k);
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
  persist(key(a.name));
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
  if (a) { a.tokens = a.tokens.filter((t) => t !== req.body.token); persist(key(a.name)); }
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
