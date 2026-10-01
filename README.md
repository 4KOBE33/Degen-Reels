# 🎰 Degen Reels

A 3D cartoon casino shooter. **Gamble for your gun. Shoot for their chips.**

Chunky bean-shaped characters brawl inside the *Lucky Dump Casino*. Everyone starts with fists and 100 chips.

## How it plays

- **Gamble for a gun:** Walk up to a slot machine and press **E**. Each pull costs chips and gives you a random gun. Pricier machines have better odds. Three of a kind is a **JACKPOT**: armor, plus a stream of chips sprays out of the machine at you.
- **Chips are your health:** When you get hit, your chips spray out across the floor as real 3D poker chips, and anyone can grab them. Hit 0 and you're **BUST**. You fall over, then respawn with a 40-chip loan from the house.
- **Guns run dry:** When you're out of ammo you're back to fists, so it's back to the slots.
- **Win:** The first player to **500 chips** cashes out and wins the round.

| Machine | Cost | Best odds for |
|---|---|---|
| Penny Slots | 10 | Spoons and pistols |
| Lucky 7s | 25 | SMGs and shotguns |
| Whale | 50 | Rockets |

| Weapon | Vibe |
|---|---|
| 🥄 Lucky Spoon | Melee. Good luck. |
| 🔫 Pea Shooter | Reliable pistol, one shot per click |
| ⚡ Bullet Hose | SMG, hold to spray |
| 💥 Boomstick | Shotgun, brutal up close |
| 🚀 Jackpot Launcher | Rockets with splash damage. Rocket-jumping works. |

**Controls:** WASD to move · mouse to aim · click to shoot · Space to jump · Shift to sprint · E to pull the slots · Esc to pause

## Run it

```bash
npm install
npm start
```

Then open http://localhost:3000.

`npm run build:artifact` also packs the whole game into one standalone HTML file at `dist/degen-reels.html`.

## How it's built

- **three.js** for 3D, bundled with **esbuild**. There are no image or model files: every character, prop and sound is generated in code.
- **Cartoon look:** 3-step toon shading plus inverted-hull ink outlines (`src/toon.js`).
- **Animation:** Characters are animated procedurally with walk cycles, squash and stretch, leaning, recoil, and falling over when bust (`src/character.js`).
- **Performance:** All static casino furniture is merged into a few big meshes at startup (`world.bake()`). Bullets and line-of-sight checks hit simple invisible stand-in shapes rather than the detailed models.

| File | What's in it |
|---|---|
| `src/config.js` | Every tunable number: weapons, slot odds, chips, timers |
| `src/game.js` | Shooting, damage, rockets, respawns, rounds |
| `src/world.js` | The casino layout, lighting, collision |
| `src/slots.js` | Walk-up slot machines with spinning reels |
| `src/character.js` | Bean characters, hats, guns, animation |
| `src/bots.js` | Bot AI: gamble, loot, fight |
| `src/player.js` | Your controls and the over-the-shoulder camera |
| `src/chips.js` | Physical poker chips that spray and get collected |
| `src/fx.js` / `src/audio.js` | Explosions, tracers, confetti; synthesized sound effects |

## Roadmap

- **Online multiplayer:** Friends in the same casino, gambling and fighting each other
- **Modes:** A team mode (a casino heist where the robbers fight security) or a battle royale where the casino floor shrinks
- More casino games: roulette bets, blackjack side games, and a high-stakes vault
