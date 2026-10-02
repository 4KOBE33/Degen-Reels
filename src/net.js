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

export class Net {
  constructor() {
    this.ws = null;
    this.id = null;
    this.room = null; // { code, host, ffa, inRaid, members: [{ id, name, look }] }
    this.status = 'offline'; // offline | connecting | online
    this.handlers = {};
    this.queue = [];
    this.retry = 0;
  }

  on(type, fn) { (this.handlers[type] ||= []).push(fn); }
  emit(type, data) { for (const fn of this.handlers[type] || []) fn(data); }

  get isHost() { return !!this.room && this.room.host === this.id; }
  get inParty() { return !!(this.room && this.room.code); }
  get partySize() { return this.room && this.room.members ? this.room.members.length : 1; }

  connect() {
    if (this.ws && (this.status === 'online' || this.status === 'connecting')) return;
    this.status = 'connecting';
    this.emit('status', this.status);
    let ws;
    try {
      ws = new WebSocket(serverUrl());
    } catch (e) {
      this.status = 'offline';
      this.emit('status', this.status);
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.status = 'online';
      this.retry = 0;
      for (const m of this.queue) ws.send(m);
      this.queue = [];
      this.emit('status', this.status);
    };
    ws.onclose = () => {
      const wasRoom = this.room;
      this.status = 'offline';
      this.ws = null;
      this.room = null;
      this.emit('status', this.status);
      if (wasRoom && wasRoom.code) this.emit('disconnected');
    };
    ws.onerror = () => {};
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.t === 'hello') { this.id = msg.id; return; }
      if (msg.t === 'room') {
        this.room = msg.code ? msg : null;
        this.emit('room', this.room);
        return;
      }
      if (msg.t === 'msg') { this.emit('msg', { from: msg.from, d: msg.d }); return; }
      this.emit(msg.t, msg);
    };
  }

  raw(msg) {
    const s = JSON.stringify(msg);
    if (this.ws && this.status === 'online') this.ws.send(s);
    else { this.queue.push(s); this.connect(); }
  }

  create(name, look) { this.raw({ t: 'create', name, look }); }
  join(code, name, look) { this.raw({ t: 'join', code, name, look }); }
  leave() { this.raw({ t: 'leave' }); this.room = null; this.emit('room', null); }
  profile(name, look) { if (this.inParty) this.raw({ t: 'profile', name, look }); }
  setFfa(on) { this.raw({ t: 'ffa', on }); }
  start(info) { this.raw({ t: 'start', ...info }); }
  end() { this.raw({ t: 'end' }); }

  // Send game data to 'host', 'all', or a player id.
  to(to, d) {
    if (this.ws && this.status === 'online') this.ws.send(JSON.stringify({ t: 'to', to, d }));
  }
}

export const net = new Net();
