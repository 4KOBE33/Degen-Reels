// Talking to the party server. Handles connecting, parties (create / join / leave), and passing
// messages between players. The raid-level sync lives in multi.js.

// Where the party server lives: the same site when the game is served from it,
// otherwise the public deployment (e.g. when playing from the artifact link).
const PUBLIC_SERVER = 'wss://beat-the-house.onrender.com/ws';

function serverUrl() {
  const { protocol, host } = window.location;
  if ((protocol === 'http:' || protocol === 'https:') && host && !/claude\.ai|claudeusercontent|anthropic/.test(host)) {
    return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/ws`;
  }
  return PUBLIC_SERVER;
}

// How long to keep trying to get back into the party after the connection drops.
const RESUME_FOR = 60000;
// No word from the server for this long means the connection is dead, even if the browser hasn't noticed.
const SILENT_FOR = 12000;
const PING_EVERY = 4000;
// Remembered for this tab, so a refresh (or crash) can get you back into your party.
const SEAT_KEY = 'bth-seat';
function loadSeat() {
  try { return JSON.parse(sessionStorage.getItem(SEAT_KEY) || 'null'); } catch (e) { return null; }
}
function storeSeat(seat) {
  try { if (seat) sessionStorage.setItem(SEAT_KEY, JSON.stringify(seat)); else sessionStorage.removeItem(SEAT_KEY); } catch (e) { /* blocked */ }
}

export class Net {
  constructor() {
    this.ws = null;
    this.id = null;
    this.token = null;
    this.room = null; // { code, host, ffa, inRaid, members: [{ id, name, look, away }] }
    this.status = 'offline'; // offline | connecting | online | reconnecting
    this.handlers = {};
    this.queue = [];
    this.resume = null; // { id, token, code, until } while getting back into a party
    this.retryTimer = null;
    this.seat = loadSeat(); // a party seat from before this page loaded
    this.heardAt = 0;
    this.pingMs = 0; // round trip to the server, for the UI
    // Heartbeat: ping the server, and if it goes quiet, drop the connection and get back in.
    setInterval(() => {
      if (!this.ws || this.ws.readyState !== 1) return;
      // (Hidden tabs only get a timer tick now and then, so don't judge them.)
      if (!document.hidden && performance.now() - this.heardAt > SILENT_FOR) {
        const ws = this.ws;
        this.ws = null;
        ws.onclose = null;
        try { ws.close(); } catch (e) { /* gone */ }
        this.dropped();
        return;
      }
      try { ws.send(JSON.stringify({ t: 'ping', at: performance.now() })); } catch (e) { /* closing */ }
    }, PING_EVERY);
    // Coming back to the tab or the network: reconnect right away instead of waiting.
    const poke = () => { if (!this.ws && (this.resume || this.wantOnline)) { clearTimeout(this.retryTimer); this.connect(); } };
    window.addEventListener('online', poke);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poke(); });
  }

  on(type, fn) { (this.handlers[type] ||= []).push(fn); }
  emit(type, data) { for (const fn of this.handlers[type] || []) fn(data); }

  get isHost() { return !!this.room && this.room.host === this.id; }
  get inParty() { return !!(this.room && this.room.code); }
  get partySize() { return this.room && this.room.members ? this.room.members.length : 1; }
  get buffered() { return this.ws ? this.ws.bufferedAmount : 0; }

  setStatus(s) {
    this.status = s;
    this.emit('status', s);
  }

  connect() {
    if (this.ws && (this.status === 'online' || this.status === 'connecting')) return;
    clearTimeout(this.retryTimer);
    // Just reloaded while in a party: try to take our seat back.
    if (!this.resume && this.seat) {
      this.resume = { ...this.seat, until: performance.now() + RESUME_FOR, tries: 0, reload: true };
      this.seat = null;
    }
    if (!this.resume) this.setStatus('connecting');
    let ws;
    try {
      ws = new WebSocket(serverUrl());
    } catch (e) {
      this.dropped();
      return;
    }
    this.ws = ws;
    this.wantOnline = true;
    ws.onopen = () => {
      this.heardAt = performance.now();
      this.tries = 0;
      if (this.resume) {
        ws.send(JSON.stringify({ t: 'resume', id: this.resume.id, token: this.resume.token, code: this.resume.code }));
        return; // the queue goes out once we're back in
      }
      this.setStatus('online');
      this.flush();
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.dropped();
    };
    ws.onerror = () => {};
    ws.onmessage = (ev) => {
      this.heardAt = performance.now();
      const str = ev.data;
      // Game data from another player: "<from|json".
      if (str.charCodeAt(0) === 60) {
        const bar = str.indexOf('|');
        let d;
        try { d = JSON.parse(str.slice(bar + 1)); } catch (e) { return; }
        this.emit('msg', { from: str.slice(1, bar), d });
        return;
      }
      let msg;
      try { msg = JSON.parse(str); } catch (e) { return; }
      switch (msg.t) {
        case 'hello':
          if (!this.resume) { this.id = msg.id; this.token = msg.token; }
          return;
        case 'resumed': {
          const reload = !!this.resume.reload;
          this.id = this.resume.id;
          this.token = this.resume.token;
          this.resume = null;
          this.setStatus('online');
          this.emit('resumed', { reload });
          this.flush();
          return;
        }
        case 'pong':
          if (msg.at) this.pingMs = Math.round(performance.now() - msg.at);
          return;
        case 'resumeFail':
          this.giveUp();
          return;
        case 'room':
          this.room = msg.code ? msg : null;
          storeSeat(this.room && this.id && this.token ? { id: this.id, token: this.token, code: this.room.code } : null);
          this.emit('room', this.room);
          return;
        default:
          this.emit(msg.t, msg);
      }
    };
  }

  flush() {
    for (const m of this.queue) this.ws.send(m);
    this.queue = [];
  }

  // The connection dropped. In a party: keep trying to get our seat back for a while.
  dropped() {
    const now = performance.now();
    if (this.room && this.room.code && this.id && this.token && !this.resume) {
      this.resume = { id: this.id, token: this.token, code: this.room.code, until: now + RESUME_FOR, tries: 0 };
      this.setStatus('reconnecting');
      this.emit('reconnecting');
    }
    if (this.resume) {
      if (now > this.resume.until) { this.giveUp(); return; }
      const wait = Math.min(4000, 300 * 2 ** this.resume.tries++);
      this.retryTimer = setTimeout(() => this.connect(), wait);
      return;
    }
    this.setStatus('offline');
    // Keep trying in the background (the free server may be waking up), backing off to 15s.
    this.tries = (this.tries || 0) + 1;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.connect(), Math.min(15000, 1000 * 2 ** Math.min(4, this.tries)));
  }

  // Couldn't get back in: we're out of the party.
  giveUp() {
    const had = this.room && this.room.code;
    this.resume = null;
    storeSeat(null);
    this.room = null;
    this.queue = [];
    if (this.ws) { this.ws.onclose = null; try { this.ws.close(); } catch (e) { /* closed */ } this.ws = null; }
    this.setStatus('offline');
    this.emit('room', null);
    if (had) this.emit('disconnected');
    // Stay connected for making or joining a new party.
    this.retryTimer = setTimeout(() => this.connect(), 1000);
  }

  raw(msg) {
    const s = JSON.stringify(msg);
    if (this.ws && this.status === 'online') this.ws.send(s);
    else { this.queue.push(s); this.connect(); }
  }

  create(name, look) { this.raw({ t: 'create', name, look }); }
  join(code, name, look) { this.raw({ t: 'join', code, name, look }); }
  leave() { this.raw({ t: 'leave' }); this.room = null; storeSeat(null); this.emit('room', null); }
  profile(name, look) { if (this.inParty) this.raw({ t: 'profile', name, look }); }
  setMode(mode) { this.raw({ t: 'mode', mode }); }
  setTeam(team) { this.raw({ t: 'team', team }); }
  start(info) { this.raw({ t: 'start', ...info }); }
  end() { this.raw({ t: 'end' }); }

  // Send game data to 'host', 'all', or a player id. Dropped while reconnecting (it's all live data).
  to(to, d) {
    if (this.ws && this.status === 'online') this.ws.send(`>${to}|${JSON.stringify(d)}`);
  }
}

export const net = new Net();
