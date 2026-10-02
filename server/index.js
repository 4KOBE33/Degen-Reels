// The web server: serves the game, and runs the party relay for multiplayer.
// The party leader's browser runs the raid; this server just passes messages between players.
const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const express = require('express');
const { WebSocketServer } = require('ws');

// Build the game bundle if it isn't there yet (so any host settings work).
const bundle = path.join(__dirname, '..', 'public', 'game.js');
if (!fs.existsSync(bundle)) {
  console.log('No game.js yet, building it…');
  execSync('npm run build', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
}

const app = express();
app.set('trust proxy', 1);
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/api', require('./accounts').router);
app.get('/health', (req, res) => res.json({ ok: true, rooms: rooms.size }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 512 * 1024, perMessageDeflate: false });

// ---------- parties ----------
// room: { code, host, members: Map(id -> { ws, token, name, look, team, dropTimer }), mode, inRaid }
// mode: 'coop' (no friendly fire), 'ffa' (everyone for themselves) or 'teams' (red vs blue)
const rooms = new Map();
let nextId = 1;
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_MEMBERS = 6;
// A dropped connection keeps its place in the party this long, so a blip doesn't kick you out.
const GRACE_MS = 30000;
// Game data for a player who's this far behind gets dropped instead of piling up.
const MAX_BUFFER = 1024 * 1024;

function makeCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}

const open = (ws) => ws && ws.readyState === ws.OPEN;

function send(ws, msg) {
  if (open(ws)) ws.send(JSON.stringify(msg));
}

function roster(room) {
  return {
    t: 'room',
    code: room.code,
    host: room.host,
    mode: room.mode,
    ffa: room.mode === 'ffa',
    inRaid: room.inRaid,
    members: [...room.members].map(([id, m]) => ({ id, name: m.name, look: m.look, team: m.team || 0, away: !open(m.ws) })),
  };
}

function broadcast(room, msg, except = null) {
  const s = JSON.stringify(msg);
  for (const [id, m] of room.members) if (id !== except && open(m.ws)) m.ws.send(s);
}

function addMember(room, ws, msg) {
  // In team games, newcomers join the smaller team.
  let reds = 0;
  for (const m of room.members.values()) if (!m.team) reds++;
  const team = room.mode === 'teams' && reds > room.members.size - reds ? 1 : 0;
  room.members.set(ws.id, { ws, token: ws.token, name: String(msg.name || 'Raider').slice(0, 16), look: msg.look || null, team, dropTimer: null });
  ws.room = room.code;
}

// Someone is out of the party for good (left, or didn't come back in time).
function removeMember(room, id) {
  const m = room.members.get(id);
  if (!m) return;
  clearTimeout(m.dropTimer);
  room.members.delete(id);
  if (!room.members.size) { rooms.delete(room.code); return; }
  if (room.host === id) {
    // The leader left: if a raid was running it's over for everyone; otherwise hand the party over.
    if (room.inRaid) broadcast(room, { t: 'hostLeft' });
    room.inRaid = false;
    room.host = room.members.keys().next().value;
  } else if (room.inRaid) {
    const host = room.members.get(room.host);
    if (host) send(host.ws, { t: 'left', id });
  }
  broadcast(room, roster(room));
}

function leave(ws) {
  const room = ws.room && rooms.get(ws.room);
  ws.room = null;
  if (room) removeMember(room, ws.id);
}

// Pass game data along without unpacking it: ">to|payload" in, "<from|payload" out.
function relay(ws, str) {
  const room = ws.room && rooms.get(ws.room);
  if (!room) return;
  const bar = str.indexOf('|');
  if (bar < 0) return;
  const to = str.slice(1, bar);
  const out = `<${ws.id}${str.slice(bar)}`;
  const deliver = (m) => { if (open(m.ws) && m.ws.bufferedAmount < MAX_BUFFER) m.ws.send(out); };
  if (to === 'all') {
    for (const [id, m] of room.members) if (id !== ws.id) deliver(m);
  } else {
    const target = room.members.get(to === 'host' ? room.host : to);
    if (target) deliver(target);
  }
}

wss.on('connection', (ws) => {
  ws.id = String(nextId++);
  ws.token = crypto.randomBytes(12).toString('hex');
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  send(ws, { t: 'hello', id: ws.id, token: ws.token });

  ws.on('message', (raw) => {
    const str = raw.toString();
    if (str.charCodeAt(0) === 62) { relay(ws, str); return; } // '>'
    let msg;
    try { msg = JSON.parse(str); } catch (e) { return; }
    const room = ws.room && rooms.get(ws.room);
    switch (msg.t) {
      case 'resume': {
        // Coming back after a dropped connection: take your old place in the party.
        const r = rooms.get(msg.code);
        const m = r && r.members.get(String(msg.id));
        if (!m || m.token !== msg.token) { send(ws, { t: 'resumeFail' }); break; }
        clearTimeout(m.dropTimer);
        m.dropTimer = null;
        if (m.ws && m.ws !== ws) { m.ws.room = null; try { m.ws.terminate(); } catch (e) { /* already gone */ } }
        ws.id = String(msg.id);
        ws.token = m.token;
        ws.room = r.code;
        m.ws = ws;
        send(ws, { t: 'hello', id: ws.id, token: ws.token });
        send(ws, { t: 'resumed' });
        broadcast(r, roster(r));
        break;
      }
      case 'create': {
        leave(ws);
        const code = makeCode();
        const r = { code, host: ws.id, members: new Map(), mode: 'coop', inRaid: false };
        rooms.set(code, r);
        addMember(r, ws, msg);
        send(ws, roster(r));
        break;
      }
      case 'join': {
        const r = rooms.get(String(msg.code || '').toUpperCase().trim());
        if (!r) { send(ws, { t: 'error', text: 'No party with that code.' }); break; }
        if (r.members.size >= MAX_MEMBERS) { send(ws, { t: 'error', text: 'That party is full.' }); break; }
        leave(ws);
        addMember(r, ws, msg);
        broadcast(r, roster(r));
        break;
      }
      case 'leave': leave(ws); send(ws, { t: 'room', code: null }); break;
      case 'profile':
        if (room && room.members.has(ws.id)) {
          Object.assign(room.members.get(ws.id), { name: String(msg.name || 'Raider').slice(0, 16), look: msg.look || null });
          broadcast(room, roster(room));
        }
        break;
      case 'mode':
        if (room && room.host === ws.id && !room.inRaid && ['coop', 'ffa', 'teams'].includes(msg.mode)) {
          room.mode = msg.mode;
          // Starting team play: split the party evenly.
          if (msg.mode === 'teams') [...room.members.values()].forEach((m, i) => { m.team = i % 2; });
          broadcast(room, roster(room));
        }
        break;
      case 'team':
        if (room && !room.inRaid && room.members.has(ws.id)) {
          room.members.get(ws.id).team = msg.team ? 1 : 0;
          broadcast(room, roster(room));
        }
        break;
      case 'start':
        // The leader starts a raid: everyone in the party drops in together.
        if (room && room.host === ws.id && !room.inRaid) {
          room.inRaid = true;
          broadcast(room, { t: 'start', ...msg, host: room.host, mode: room.mode, ffa: room.mode === 'ffa', members: roster(room).members });
        }
        break;
      case 'end':
        if (room && room.host === ws.id) { room.inRaid = false; broadcast(room, roster(room)); }
        break;
      case 'ping': send(ws, { t: 'pong', at: msg.at }); break;
      default:
    }
  });

  ws.on('close', () => {
    const room = ws.room && rooms.get(ws.room);
    const m = room && room.members.get(ws.id);
    if (!m || m.ws !== ws) return;
    // Hold their spot for a bit in case they're just reconnecting.
    m.dropTimer = setTimeout(() => removeMember(room, ws.id), GRACE_MS);
    broadcast(room, roster(room));
  });
});

// Drop dead connections.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 15000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Beat the House is open for business on http://localhost:${PORT}`);
});
