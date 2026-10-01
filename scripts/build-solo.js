// Bundles the game into one self-contained HTML page that runs the server
// simulation in the browser, so it can be played solo vs bots with no server.
//   node scripts/build-solo.js [output-path]

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const out = process.argv[2] || path.join(root, 'dist', 'degen-reels-solo.html');

const html = read('public/index.html');
const fontsLink = html.match(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]+>/)[0];
const body = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('<script'));

// A stand-in for socket.io that talks to a Room running in the same page.
const shim = `
window.DEGEN_SOLO = true;
(function () {
  var defs = {
    './config': function (module, exports, require) {\n${read('server/config.js')}\n},
    './room': function (module, exports, require) {\n${read('server/room.js')}\n},
  };
  var cache = {};
  function req(name) {
    if (!cache[name]) {
      cache[name] = { exports: {} };
      defs[name](cache[name], cache[name].exports, req);
    }
    return cache[name].exports;
  }
  var C = req('./config');
  var Room = req('./room').Room;

  window.io = function () {
    var handlers = {};
    var room = null;
    var fakeIo = {
      to: function () {
        return {
          emit: function (event, data) {
            (handlers[event] || []).forEach(function (fn) { fn(data); });
          },
        };
      },
    };
    var socket = {
      id: 'you',
      connected: false,
      on: function (event, fn) { (handlers[event] = handlers[event] || []).push(fn); },
      connect: function () { this.connected = true; },
      disconnect: function () { this.connected = false; },
      join: function () {},
      emit: function (event, data, ack) {
        if (event === 'join' && !room) {
          room = new Room('SOLO', fakeIo, function () {});
          var name = String((data && data.name) || '').trim().slice(0, 16) || 'You';
          var player = room.addHuman(socket, name);
          ack({ id: player.id, room: 'SOLO', config: C.clientConfig });
        } else if (event === 'input' && room) {
          room.setInput(socket.id, data);
        } else if (event === 'wager' && room) {
          room.setWager(socket.id, data);
        }
      },
    };
    return socket;
  };
})();
`;

const page = `<title>Degen Reels</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
${fontsLink}
<style>
${read('public/style.css')}
</style>
${body.trim()}
<script>${shim}</script>
<script>
${read('public/client.js')}
</script>
`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log(`Wrote ${out} (${Math.round(page.length / 1024)} KB)`);
