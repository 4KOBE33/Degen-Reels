// Sit-down table games: roulette and blackjack. You stand at a seat and play with the number keys
// while the fight goes on around you, so watch your back.
import * as THREE from 'three';
import { part, toon, canvasTexture } from './toon.js';
import { createCharacter } from './character.js';
import { sfx } from './audio.js';

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// One standing spot at a table. Holds whoever is playing there and their bet size.
export class Seat {
  constructor(game, table, x, z) {
    this.game = game;
    this.table = table;
    this.spot = new THREE.Vector3(x, 0, z);
    this.yaw = Math.atan2(-(table.x - x), -(table.z - z));
    this.user = null;
    this.betIndex = 0;
    this.state = 'bet';
    this.t = 0;
    this.message = '';
  }

  get bet() { return this.game.floor.bets[this.betIndex]; }

  prompt() {
    if (this.user) return null;
    return `<b>E</b> Play ${this.table.title} · bets from 🪙 ${this.game.floor.bets[0]}`;
  }

  use(c) {
    if (this.user) return 'Seat taken';
    this.user = c;
    c.busy = this;
    c.pos.copy(this.spot);
    c.vel.set(0, 0, 0);
    c.yaw = this.yaw;
    c.pitch = -0.2;
    this.state = 'bet';
    this.message = '';
    this.betIndex = 0;
    this.botTimer = 3 + Math.random() * 5;
    return null;
  }

  leave(c) {
    if (this.user !== c) return;
    this.table.forfeit(this);
    this.user = null;
    c.busy = null;
  }

  onKey(c, key) {
    if (key === 'betUp' || key === 'betDown') {
      if (this.state !== 'bet' && this.state !== 'result') return;
      const n = this.game.floor.bets.length;
      this.betIndex = (this.betIndex + (key === 'betUp' ? 1 : n - 1)) % n;
      sfx.tick();
      return;
    }
    this.table.onKey(this, key);
  }

  // Takes the bet from the player's stack. Your chips are your health, so you can't bet your last one.
  takeBet(amount) {
    const c = this.user;
    if (c.chips <= amount) {
      this.message = `You need more than 🪙 ${amount} to bet that.`;
      if (c.isPlayer) sfx.deny();
      return false;
    }
    c.chips -= amount;
    return true;
  }

  // Winnings spray out of the table toward you as real chips.
  pay(amount) {
    if (amount <= 0) return;
    const from = new THREE.Vector3(this.table.x, 1.6, this.table.z).lerp(this.spot, 0.65);
    from.y = 1.6;
    this.game.chips.spawnBurst(from, amount, null, { toward: this.spot, speed: 2.5 });
    if (this.user && this.user.isPlayer) sfx.win(this.spot, this.game.listener);
  }

  update(dt) {
    if (!this.user) return;
    if (!this.user.alive || this.user.busy !== this) {
      this.table.forfeit(this);
      if (this.user.busy === this) this.user.busy = null;
      this.user = null;
      return;
    }
    // Bots don't press keys: they play a quick simulated round and wander off.
    if (!this.user.isPlayer) {
      this.botTimer -= dt;
      if (this.botTimer <= 0) {
        const c = this.user;
        const bet = Math.min(this.game.floor.bets[Math.random() < 0.7 ? 0 : 1], Math.floor(c.chips / 3));
        if (bet > 0) {
          if (Math.random() < 0.46) {
            this.pay(bet * 2);
            c.chips -= bet;
            if (Math.random() < 0.3) this.game.feed(`${c.name} won 🪙${bet * 2} at ${this.table.title}`);
          } else {
            c.chips -= bet;
          }
        }
        this.leave(c);
      }
    }
  }

  panel() {
    return this.table.panel(this);
  }
}

// ---------- Roulette ----------

function rouletteTexture() {
  return canvasTexture(256, 256, (c, w) => {
    const n = 18;
    for (let i = 0; i < n; i++) {
      c.beginPath();
      c.moveTo(w / 2, w / 2);
      c.arc(w / 2, w / 2, w / 2, (i / n) * Math.PI * 2, ((i + 1) / n) * Math.PI * 2);
      c.fillStyle = i === 0 ? '#1f8a4c' : i % 2 ? '#e63946' : '#1b0f2b';
      c.fill();
    }
    c.fillStyle = '#d4a63a';
    c.beginPath();
    c.arc(w / 2, w / 2, w * 0.22, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#8b5a2b';
    c.beginPath();
    c.arc(w / 2, w / 2, w * 0.12, 0, Math.PI * 2);
    c.fill();
  });
}

const BET_KINDS = {
  1: { name: 'RED', pays: 2, wins: (n) => RED_NUMBERS.has(n) },
  2: { name: 'BLACK', pays: 2, wins: (n) => n !== 0 && !RED_NUMBERS.has(n) },
  3: { name: 'GREEN', pays: 14, wins: (n) => n === 0 },
};

export class RouletteTable {
  constructor(game, x, z) {
    this.game = game;
    this.x = x;
    this.z = z;
    this.title = 'Roulette';
    this.spinBoost = 0;
    const { world, scene, floor } = game;

    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const base = part(new THREE.CylinderGeometry(1.4, 1.8, 0.85, 20), 0x2b2140);
    base.position.y = 0.42;
    const rim = part(new THREE.CylinderGeometry(3.2, 3.2, 0.25, 40), 0x6b3a1e);
    rim.position.y = 0.95;
    const felt = part(new THREE.CylinderGeometry(3, 3, 0.06, 40), floor.theme.felt, { ink: 0 });
    felt.position.y = 1.09;
    const bowl = part(new THREE.CylinderGeometry(1.7, 1.5, 0.3, 36), 0x8b5a2b);
    bowl.position.y = 1.2;
    const spindle = part(new THREE.ConeGeometry(0.15, 0.4, 8), 0xd4a63a, { ink: 0.02 });
    spindle.position.y = 1.5;
    g.add(base, rim, felt, bowl, spindle);
    world.statics.add(g);

    const spinning = new THREE.Group();
    spinning.position.set(x, 0, z);
    const wheel = new THREE.Mesh(new THREE.CircleGeometry(1.45, 36), toon(0xffffff, { map: rouletteTexture() }));
    wheel.rotation.x = -Math.PI / 2;
    wheel.position.y = 1.36;
    const ball = part(new THREE.SphereGeometry(0.09, 10, 8), 0xffffff, { ink: 0.015 });
    spinning.add(wheel, ball);
    scene.add(spinning);
    world.addCollider({ type: 'circle', x, z, r: 3.2, top: 1.1 });

    let t = 0;
    let ballAngle = 0;
    world.animate((dt) => {
      t += dt;
      this.spinBoost = Math.max(0, this.spinBoost - dt);
      const fast = this.spinBoost > 0;
      wheel.rotation.z += dt * (fast ? 4 : 0.6);
      ballAngle -= dt * (fast ? 7 : 0.6);
      ball.position.set(Math.cos(ballAngle) * (fast ? 1.3 : 1.0), 1.42, Math.sin(ballAngle) * (fast ? 1.3 : 1.0));
    });

    this.seats = [45, 135, 225, 315].map((deg) => {
      const a = (deg * Math.PI) / 180;
      return new Seat(game, this, x + Math.cos(a) * 4.1, z + Math.sin(a) * 4.1);
    });
  }

  onKey(seat, key) {
    if (seat.state !== 'bet' && seat.state !== 'result') return;
    const kind = BET_KINDS[key];
    if (!kind) return;
    const bet = seat.bet;
    if (!seat.takeBet(bet)) return;
    seat.state = 'spin';
    seat.t = 3;
    seat.pick = kind;
    seat.stake = bet;
    seat.result = Math.floor(Math.random() * 37);
    seat.message = '';
    this.spinBoost = 3;
    sfx.lever(seat.spot, this.game.listener);
  }

  forfeit(seat) {
    seat.state = 'bet';
  }

  update(dt) {
    for (const seat of this.seats) {
      seat.update(dt);
      if (seat.state === 'spin') {
        seat.t -= dt;
        if (seat.t <= 0) {
          const n = seat.result;
          const color = n === 0 ? 'GREEN' : RED_NUMBERS.has(n) ? 'RED' : 'BLACK';
          const won = seat.pick.wins(n);
          seat.state = 'result';
          seat.lastColor = color;
          if (won) {
            const amount = seat.stake * seat.pick.pays;
            seat.pay(amount);
            seat.message = `Landed on <b class="${color.toLowerCase()}">${n} ${color}</b>. You win 🪙 ${amount}!`;
            if (seat.pick.pays > 2) this.game.feed(`🎡 ${seat.user.name} hit GREEN for 🪙${amount}!`);
          } else {
            seat.message = `Landed on <b class="${color.toLowerCase()}">${n} ${color}</b>. You lose 🪙 ${seat.stake}.`;
            if (seat.user.isPlayer) sfx.deny();
          }
          this.game.fx.number(new THREE.Vector3(this.x, 2.6, this.z), `${n}`, color === 'RED' ? '#ff5d5d' : color === 'GREEN' ? '#5ee27a' : '#fff6e0', 1.6);
        }
      }
    }
  }

  panel(seat) {
    const spinning = seat.state === 'spin';
    return `<h3>🎡 Roulette</h3>
      ${spinning
    ? `<p>Spinning… 🪙 ${seat.stake} on <b class="${seat.pick.name.toLowerCase()}">${seat.pick.name}</b></p>`
    : `<p class="bet">Bet <b>🪙 ${seat.bet}</b> <span class="hint">scroll or Z / X to change</span></p>
      <div class="choices"><span><kbd>1</kbd> <b class="red">RED</b> pays 2x</span><span><kbd>2</kbd> <b class="black">BLACK</b> pays 2x</span><span><kbd>3</kbd> <b class="green">GREEN</b> pays 14x</span></div>`}
      ${seat.message ? `<p class="msg">${seat.message}</p>` : ''}
      <p class="hint"><kbd>E</kbd> Leave the table</p>`;
  }
}

// ---------- Blackjack ----------

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function draw() {
  return { rank: RANKS[Math.floor(Math.random() * 13)], suit: SUITS[Math.floor(Math.random() * 4)] };
}

export function handValue(hand) {
  let total = 0;
  let aces = 0;
  for (const c of hand) {
    if (c.rank === 'A') { total += 11; aces++; } else if ('JQK'.includes(c.rank)) total += 10;
    else total += Number(c.rank);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function cardHtml(card, hidden = false) {
  if (hidden) return '<span class="pcard back"></span>';
  const red = card.suit === '♥' || card.suit === '♦';
  return `<span class="pcard ${red ? 'red' : ''}">${card.rank}${card.suit}</span>`;
}

export class BlackjackTable {
  constructor(game, x, z) {
    this.game = game;
    this.x = x;
    this.z = z;
    this.title = 'Blackjack';
    const { world, scene, floor } = game;

    // A half-moon table with the dealer standing behind it.
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const base = part(new THREE.BoxGeometry(2.4, 0.85, 1.2), 0x2b2140);
    base.position.y = 0.42;
    const rim = part(new THREE.CylinderGeometry(2.7, 2.7, 0.22, 40, 1, false, -Math.PI / 2, Math.PI), 0x6b3a1e);
    rim.position.y = 0.95;
    const back = part(new THREE.BoxGeometry(5.4, 0.22, 0.3), 0x6b3a1e);
    back.position.set(0, 0.95, -0.15);
    const felt = part(new THREE.CylinderGeometry(2.45, 2.45, 0.06, 40, 1, false, -Math.PI / 2, Math.PI), floor.theme.felt, { ink: 0 });
    felt.position.y = 1.07;
    const shoe = part(new THREE.BoxGeometry(0.5, 0.3, 0.7), 0x1b0f2b, { ink: 0.02 });
    shoe.position.set(1.4, 1.25, 0.3);
    g.add(base, rim, back, felt, shoe);
    for (let i = 0; i < 3; i++) {
      const a = Math.PI * (0.25 + i * 0.25);
      const card = part(new THREE.BoxGeometry(0.32, 0.02, 0.45), 0xfff6e0, { ink: 0.012, shadow: false });
      card.position.set(Math.cos(a) * 1.6, 1.11, Math.sin(a) * 1.6);
      card.rotation.y = -a + Math.PI / 2;
      g.add(card);
    }
    world.statics.add(g);
    world.addCollider({ type: 'box', minX: x - 2.7, maxX: x + 2.7, minZ: z - 0.3, maxZ: z + 2.0, top: 1.1 });
    world.addCollider({ type: 'circle', x, z: z + 1.2, r: 1.5, top: 1.1 });

    // The dealer just stands there and judges you.
    this.dealer = createCharacter({ color: 0xfff6e0, hat: 'visor' });
    this.dealer.root.position.set(x, 0, z - 1.0);
    this.dealer.root.rotation.y = Math.PI;
    this.dealer.setWeapon('fists');
    scene.add(this.dealer.root);
    world.addCollider({ type: 'circle', x, z: z - 1.0, r: 0.6, top: 2 });

    this.seats = [-50, 0, 50].map((deg) => {
      const a = ((90 + deg) * Math.PI) / 180;
      return new Seat(game, this, x + Math.cos(a) * 3.9, z + Math.sin(a) * 3.9);
    });
    this.seats.forEach((s) => { s.cardsFrom = this; });
  }

  onKey(seat, key) {
    if (seat.state === 'bet' || seat.state === 'result') {
      if (key !== '1') return;
      const bet = seat.bet;
      if (!seat.takeBet(bet)) return;
      seat.stake = bet;
      seat.hand = [draw(), draw()];
      seat.dealerHand = [draw(), draw()];
      seat.state = 'play';
      seat.message = '';
      sfx.reelStop(seat.spot, this.game.listener);
      if (handValue(seat.hand) === 21) this.finish(seat);
      return;
    }
    if (seat.state !== 'play') return;
    if (key === '1') {
      seat.hand.push(draw());
      sfx.reelStop(seat.spot, this.game.listener);
      if (handValue(seat.hand) > 21) this.finish(seat);
      else if (handValue(seat.hand) === 21) this.finish(seat);
    } else if (key === '2') {
      this.finish(seat);
    } else if (key === '3' && seat.hand.length === 2) {
      if (!seat.takeBet(seat.stake)) return;
      seat.stake *= 2;
      seat.hand.push(draw());
      this.finish(seat);
    }
  }

  // Dealer plays out their hand (hits below 17), then we settle up.
  finish(seat) {
    const player = handValue(seat.hand);
    const natural = player === 21 && seat.hand.length === 2;
    if (player <= 21) {
      while (handValue(seat.dealerHand) < 17) seat.dealerHand.push(draw());
    }
    const dealer = handValue(seat.dealerHand);
    let payout = 0;
    if (player > 21) seat.message = `Bust with ${player}. You lose 🪙 ${seat.stake}.`;
    else if (natural && !(dealer === 21 && seat.dealerHand.length === 2)) {
      payout = Math.floor(seat.stake * 2.5);
      seat.message = `BLACKJACK! You win 🪙 ${payout}!`;
    } else if (dealer > 21 || player > dealer) {
      payout = seat.stake * 2;
      seat.message = `${dealer > 21 ? `Dealer busts with ${dealer}` : `${player} beats ${dealer}`}. You win 🪙 ${payout}!`;
    } else if (player === dealer) {
      payout = seat.stake;
      seat.message = `Push at ${player}. You get your 🪙 ${seat.stake} back.`;
    } else seat.message = `Dealer has ${dealer}. You lose 🪙 ${seat.stake}.`;
    seat.pay(payout);
    if (!payout && seat.user && seat.user.isPlayer) sfx.deny();
    seat.state = 'result';
  }

  forfeit(seat) {
    seat.state = 'bet';
    seat.hand = null;
  }

  update(dt) {
    for (const seat of this.seats) seat.update(dt);
    const someone = this.seats.find((s) => s.user);
    this.dealer.animate(dt, { speed: 0, forward: 0, side: 0, onGround: true, pitch: someone ? -0.2 : 0, dead: false, showTag: false });
  }

  panel(seat) {
    const showHands = seat.hand && (seat.state === 'play' || seat.state === 'result');
    const hidden = seat.state === 'play';
    return `<h3>🃏 Blackjack</h3>
      ${showHands ? `<div class="hands">
        <div><span class="who">Dealer ${hidden ? '' : handValue(seat.dealerHand)}</span>${seat.dealerHand.map((c, i) => cardHtml(c, hidden && i === 1)).join('')}</div>
        <div><span class="who">You ${handValue(seat.hand)}</span>${seat.hand.map((c) => cardHtml(c)).join('')}</div>
      </div>` : ''}
      ${seat.state === 'play'
    ? `<div class="choices"><span><kbd>1</kbd> Hit</span><span><kbd>2</kbd> Stand</span>${seat.hand.length === 2 ? '<span><kbd>3</kbd> Double down</span>' : ''}</div>`
    : `<p class="bet">Bet <b>🪙 ${seat.bet}</b> <span class="hint">scroll or Z / X to change</span></p>
      <div class="choices"><span><kbd>1</kbd> Deal</span></div>`}
      ${seat.message ? `<p class="msg">${escapeHtml(seat.message).replace(/BLACKJACK!/, '<b>BLACKJACK!</b>')}</p>` : ''}
      <p class="hint"><kbd>E</kbd> Leave the table</p>`;
  }
}
