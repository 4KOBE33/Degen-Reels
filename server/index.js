const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const C = require('./config');
const { Room } = require('./room');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '..', 'public')));

const rooms = new Map();

function randomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

// The parts of the config the client needs to draw the game.
const clientConfig = {
  arena: C.ARENA,
  obstacles: C.OBSTACLES,
  playerRadius: C.PLAYER_RADIUS,
  weapons: C.WEAPONS,
  weaponTiers: C.WEAPON_TIERS,
  wagers: C.WAGERS,
  jackpot: C.JACKPOT,
  fillerSymbols: C.FILLER_SYMBOLS,
  phaseTimes: C.PHASE_TIMES,
};

io.on('connection', (socket) => {
  let room = null;

  socket.on('join', (data, ack) => {
    if (room || typeof ack !== 'function') return;
    const name = String((data && data.name) || '').trim().slice(0, 16)
      || `Gambler${Math.floor(Math.random() * 1000)}`;
    let code = String((data && data.room) || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (!code) code = randomCode();

    let target = rooms.get(code);
    if (!target) {
      target = new Room(code, io, (r) => rooms.delete(r.code));
      rooms.set(code, target);
    }
    if (target.isFull) {
      ack({ error: `Room ${code} is full.` });
      return;
    }
    room = target;
    const player = room.addHuman(socket, name);
    ack({ id: player.id, room: code, config: clientConfig });
  });

  socket.on('input', (input) => room && room.setInput(socket.id, input));
  socket.on('wager', (idx) => room && room.setWager(socket.id, idx));
  socket.on('disconnect', () => room && room.removePlayer(socket.id));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Degen Reels is open for business on http://localhost:${PORT}`);
});
