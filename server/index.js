// The web server: serves the game, and runs the party relay for multiplayer.
// The party leader's browser runs the raid; this server just passes messages between players.
const fs = require('fs');
const http = require('http');
const path = require('path');
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
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/health', (req, res) => res.json({ ok: true, rooms: rooms.size }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 512 * 1024 });

// ---------- parties ----------
// room: { code, host, members: Map(id -> { ws, name, look }), ffa, inRaid }
const rooms = new Map();
let nextId = 1;
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_MEMBERS = 6;

function makeCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function roster(room) {
  return {
    t: 'room',
    code: room.code,
    host: room.host,
    ffa: room.ffa,
    inRaid: room.inRaid,
    members: [...room.members].map(([id, m]) => ({ id, name: m.name, look: m.look })),
  };
}

function broadcast(room, msg, except = null) {
  for (const [id, m] of room.members) if (id !== except) send(m.ws, msg);
}

function leave(ws) {
  const room = ws.room && rooms.get(ws.room);
  ws.room = null;
  if (!room) return;
  room.members.delete(ws.id);
  if (!room.members.size) { rooms.delete(room.code); return; }
  if (room.host === ws.id) {
    // The leader left: if a raid was running it's over for everyone; otherwise hand the party over.
    if (room.inRaid) broadcast(room, { t: 'hostLeft' });
    room.inRaid = false;
    room.host = room.members.keys().next().value;
  } else if (room.inRaid) send(room.members.get(room.host).ws, { t: 'left', id: ws.id });
  broadcast(room, roster(room));
}

wss.on('connection', (ws) => {
  ws.id = String(nextId++);
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  send(ws, { t: 'hello', id: ws.id });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    const room = ws.room && rooms.get(ws.room);
    switch (msg.t) {
      case 'create': {
        leave(ws);
        const code = makeCode();
        const r = { code, host: ws.id, members: new Map(), ffa: false, inRaid: false };
        r.members.set(ws.id, { ws, name: String(msg.name || 'Raider').slice(0, 16), look: msg.look || null });
        rooms.set(code, r);
        ws.room = code;
        send(ws, roster(r));
        break;
      }
      case 'join': {
        const r = rooms.get(String(msg.code || '').toUpperCase().trim());
        if (!r) { send(ws, { t: 'error', text: 'No party with that code.' }); break; }
        if (r.members.size >= MAX_MEMBERS) { send(ws, { t: 'error', text: 'That party is full.' }); break; }
        if (r.inRaid) { send(ws, { t: 'error', text: 'That party is already in a raid. Wait for them to finish.' }); break; }
        leave(ws);
        r.members.set(ws.id, { ws, name: String(msg.name || 'Raider').slice(0, 16), look: msg.look || null });
        ws.room = r.code;
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
      case 'ffa':
        if (room && room.host === ws.id) { room.ffa = !!msg.on; broadcast(room, roster(room)); }
        break;
      case 'start':
        // The leader starts a raid: everyone in the party drops in together.
        if (room && room.host === ws.id && !room.inRaid) {
          room.inRaid = true;
          broadcast(room, { t: 'start', ...msg, host: room.host, ffa: room.ffa, members: roster(room).members });
        }
        break;
      case 'end':
        if (room && room.host === ws.id) { room.inRaid = false; broadcast(room, roster(room)); }
        break;
      case 'to': {
        // Relay: to a player id, to the leader, or to everyone else.
        if (!room) break;
        const out = JSON.stringify({ t: 'msg', from: ws.id, d: msg.d });
        if (msg.to === 'all') {
          for (const [id, m] of room.members) if (id !== ws.id && m.ws.readyState === m.ws.OPEN) m.ws.send(out);
        } else {
          const target = room.members.get(msg.to === 'host' ? room.host : String(msg.to));
          if (target && target.ws.readyState === target.ws.OPEN) target.ws.send(out);
        }
        break;
      }
      case 'ping': send(ws, { t: 'pong', at: msg.at }); break;
      default:
    }
  });
  ws.on('close', () => leave(ws));
});

// Drop dead connections.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 20000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Beat the House is open for business on http://localhost:${PORT}`);
});
