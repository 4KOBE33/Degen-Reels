// Cloud saves and the leaderboard: talks to /api on the game server (server/accounts.js).
import { save } from './save.js';

const PUBLIC_SERVER = 'https://beat-the-house.onrender.com';
const KEY = 'bth-cloud';

function base() {
  const { protocol, host } = window.location;
  if ((protocol === 'http:' || protocol === 'https:') && host && !/claude\.ai|claudeusercontent|anthropic/.test(host)) return '';
  return PUBLIC_SERVER;
}

export const SITE = PUBLIC_SERVER.replace(/^https?:\/\//, '');
// Set while a request is slow, which almost always means the free server is waking up.
export const net = { waking: false, onWaking: () => {} };

async function call(path, body) {
  const ctrl = new AbortController();
  const giveUp = setTimeout(() => ctrl.abort(), 75000);
  const slow = setTimeout(() => { net.waking = true; net.onWaking(); }, 3500);
  let res;
  try {
    res = await fetch(`${base()}/api${path}`, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal }
      : { signal: ctrl.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('The server took too long to wake up. Give it a few seconds and try again.');
    throw new Error(base() ? `Can't reach the game server from here. Play at ${SITE} to use accounts and the leaderboard.` : 'Can\'t reach the game server. Check your connection and try again.');
  } finally {
    clearTimeout(giveUp);
    clearTimeout(slow);
    if (net.waking) { net.waking = false; net.onWaking(); }
  }
  let out = {};
  try { out = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) throw new Error(out.error || `Server said ${res.status}`);
  return out;
}

class Cloud {
  constructor() {
    this.user = null; // { name, token }
    this.status = ''; // what to show next to the account
    this.syncedAt = 0;
    this.timer = null;
    this.handlers = [];
    try { this.user = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { /* blocked */ }
    net.onWaking = () => this.changed();
    // Upload a few seconds after anything changes.
    save.onChange(() => { if (this.user && !this.applying && !save.tampered) this.queue(); });
    if (this.user && save.tampered) this.restore();
    else if (this.user) this.queue(500);
    // Does the server keep accounts in a database, or in a file a restart wipes?
    this.storage = '';
    call('/status').then((st) => { this.storage = st.storage || ''; this.changed(); }).catch(() => {});
  }

  onUpdate(fn) { this.handlers.push(fn); }
  changed() { for (const fn of this.handlers) fn(); }

  remember() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.user));
      if (this.user) localStorage.setItem(`${KEY}-name`, this.user.name);
    } catch (e) { /* blocked */ }
  }

  // This device's save was edited and got reset: put the account's cloud save back.
  async restore() {
    try {
      const out = await call('/load', { token: this.user.token });
      if (out.save) { this.applying = true; save.replace(out.save); this.applying = false; }
      save.clearTampered();
      this.syncedAt = Date.now();
      this.status = 'saved';
    } catch (e) {
      this.status = `not saved: ${e.message}`;
      if (/log in/i.test(e.message)) { this.user = null; this.remember(); }
      else setTimeout(() => this.restore(), 20000);
    }
    this.changed();
  }

  queue(wait = 3000) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.push(), wait);
  }

  async push() {
    if (!this.user || save.tampered) return;
    try {
      await call('/save', { token: this.user.token, save: save.get(), seal: save.sealOf(save.get()) });
      this.syncedAt = Date.now();
      this.status = 'saved';
    } catch (e) {
      this.status = `not saved: ${e.message}`;
      if (/log in/i.test(e.message)) {
        // The free server forgets accounts when it restarts (unless it has a database). We still
        // have your progress and PIN here, so put the account back instead of logging you out.
        if (!(await this.recover())) { this.user = null; this.remember(); }
      } else this.queue(20000);
    }
    this.changed();
  }

  // Re-make the account from this device (same name, same PIN, this device's progress).
  async recover() {
    const u = this.user;
    if (!u || !u.pin) return false;
    try {
      const out = await call('/account', { name: u.name, pin: u.pin, mode: 'register', save: save.get(), seal: save.sealOf(save.get()) });
      this.user = { name: out.name, token: out.token, pin: u.pin };
      this.remember();
      this.syncedAt = Date.now();
      this.status = 'saved';
      return true;
    } catch (e) {
      this.status = /taken/i.test(e.message) ? 'Someone else took your name while the server was asleep. Log in again or pick a new name.' : `not saved: ${e.message}`;
      return /taken/i.test(e.message) ? false : true; // offline: keep trying later
    }
  }

  // Make an account from this device's progress.
  async register(name, pin) {
    const out = await call('/account', { name, pin, mode: 'register', save: save.get(), seal: save.sealOf(save.get()) });
    // The PIN stays on this device so the account can be put back if the server forgets it.
    this.user = { name: out.name, token: out.token, pin: String(pin) };
    this.remember();
    this.syncedAt = Date.now();
    this.status = 'saved';
    this.changed();
  }

  // Log in: the cloud save replaces what's on this device. If the server has no such account
  // (it forgot everyone when it restarted) and this device was logged in as you, put it back.
  async login(name, pin) {
    const last = this.lastName();
    if (last && last.toLowerCase() === String(name).trim().toLowerCase()) {
      try { return await this.loginOnly(name, pin); } catch (e) {
        if (!/wrong name or pin/i.test(e.message)) throw e;
        return this.register(name, pin);
      }
    }
    return this.loginOnly(name, pin);
  }

  // The name this device was last logged in as (kept after logging out, to fill in the form).
  lastName() {
    try { return localStorage.getItem(`${KEY}-name`) || ''; } catch (e) { return ''; }
  }

  async loginOnly(name, pin) {
    const out = await call('/account', { name, pin, mode: 'login' });
    this.user = { name: out.name, token: out.token, pin: String(pin) };
    this.remember();
    if (out.save) {
      this.applying = true;
      save.replace(out.save);
      this.applying = false;
    } else this.queue(100);
    this.syncedAt = Date.now();
    this.status = 'saved';
    this.changed();
  }

  async logout() {
    const u = this.user;
    this.user = null;
    this.remember();
    clearTimeout(this.timer);
    this.changed();
    if (u) try { await call('/logout', { token: u.token }); } catch (e) { /* offline */ }
  }

  leaderboard(by = 'worth') { return call(`/leaderboard?by=${by}`); }
}

export const cloud = new Cloud();
