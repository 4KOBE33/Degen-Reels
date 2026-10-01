# 🎰 Degen Reels

A cartoony multiplayer casino shooter. **Gamble for your gun, shoot for their chips.**

## How a round works

1. **Place your bet** (8s): Bet 0, 15, or 30 chips. Bigger bets give better odds on a good gun. A random **house rule** is dealt each round, such as *Double or Nothing* or *Chip Rain*.
2. **Spin** (4s): A slot machine picks your weapon. Two matching reels give you that gun. **Three of a kind is a JACKPOT**, which pays chips and gives you armor.
3. **Fight** (up to 75s): Top-down shootout. **Your chips are your health.** When you get hit, your chips spill on the floor and anyone can grab them. Hit 0 and you're **BUST**. The last player standing wins, or the biggest stack if time runs out.
4. **Results**: The winner gets a bonus. If you went broke, the house tops you back up to 40 chips for the next round.

| Weapon | Reel | Vibe |
|---|---|---|
| Lucky Spoon | 🥄 | Melee. Good luck. |
| Pea Shooter | 🔫 | Reliable pistol |
| Bullet Hose | ⚡ | Fast SMG, sprays |
| Boomstick | 💥 | Shotgun, brutal up close |
| Jackpot Launcher | 🚀 | Rockets with splash damage (it can hit you too) |

Bots (🤖) fill the table until there are at least 3 players, so you can play solo. As friends join, the bots leave.

**Controls:** WASD or arrow keys to move · mouse to aim · click or Space to shoot · 1/2/3 to bet

## Play with friends (one click)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/4kobe33/degen-reels)

Click the button, sign in to Render with GitHub, and click **Deploy**. You get a link like `https://degen-reels.onrender.com` that anyone can open. The free plan goes to sleep after about 15 minutes with nobody playing, so the first visit after that takes up to a minute to load.

## Run it on your computer

```bash
npm install
npm start
```

Then open http://localhost:3000. Click **Copy invite link** to share your room. Anyone with the link joins the same table, with up to 8 humans per room.

- **Friends on the same Wi‑Fi:** Have them open `http://<your-computer's-IP>:3000/?room=CODE`.
- **Friends anywhere:** Deploy to a Node host such as Render, Railway, or Fly.io. Use `npm install` as the build command and `npm start` as the start command. The server respects `PORT`.

## Code map

- `server/config.js`: Every tunable number, including weapons, betting odds, house rules, the arena layout, and timers.
- `server/room.js`: The authoritative game simulation: phases, movement, bullets, chips, and bots.
- `server/index.js`: Express and Socket.io server, plus room codes.
- `public/client.js`: Input, networking, canvas rendering, HUD, and the slot machine.
- `scripts/build-solo.js`: Packs everything into one HTML page that runs solo against bots with no server (`npm run build:solo`).

## Ideas for next versions

- Side bets for busted players on who wins, paid out as a respawn token
- More house rules and arenas (roulette-wheel floor, card-table maze)
- Mid-fight gamble stations where you pay chips to reroll your gun
- Character skins and emotes
- A shrinking "house edge" ring to force fights
