// Cloud saves and the leaderboard: talks to /api on the game server (server/accounts.js).
import { save } from './save.js';

const PUBLIC_SERVER = 'https://beat-the-house.onrender.com';
const KEY = 'bth-cloud';

function base() {
  const { protocol, host } = window.location;
  if ((protocol === 'http:' || protocol === 'https:') && host && !/claude\.ai|claudeusercontent|anthropic/.test(host)) return '';
  return PUBLIC_SERVER;
}

async function call(path, body) {
  const res = await fetch(`${base()}/api${path}`, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : undefined);
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
    // Upload a few seconds after anything changes.
    save.onChange(() => { if (this.user && !this.applying) this.queue(); });
    if (this.user) this.queue(500);
  }

  onUpdate(fn) { this.handlers.push(fn); }
  changed() { for (const fn of this.handlers) fn(); }

  remember() {
    try { localStorage.setItem(KEY, JSON.stringify(this.user)); } catch (e) { /* blocked */ }
  }

  queue(wait = 3000) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.push(), wait);
  }

  async push() {
    if (!this.user) return;
    try {
      await call('/save', { token: this.user.token, save: save.get() });
      this.syncedAt = Date.now();
      this.status = 'saved';
    } catch (e) {
      this.status = `not saved: ${e.message}`;
      if (/log in/i.test(e.message)) { this.user = null; this.remember(); }
      else this.queue(20000);
    }
    this.changed();
  }

  // Make an account from this device's progress.
  async register(name, pin) {
    const out = await call('/account', { name, pin, mode: 'register', save: save.get() });
    this.user = { name: out.name, token: out.token };
    this.remember();
    this.syncedAt = Date.now();
    this.status = 'saved';
    this.changed();
  }

  // Log in: the cloud save replaces what's on this device.
  async login(name, pin) {
    const out = await call('/account', { name, pin, mode: 'login' });
    this.user = { name: out.name, token: out.token };
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
