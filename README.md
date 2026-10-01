# 🎰 Degen Reels

A 3D cartoon casino shooter. **Gamble for your gun. Shoot for their chips.**

Chunky bean-shaped characters brawl inside the *Lucky Dump Casino*. Everyone starts with fists and 100 chips.

## How a run works

You start on **Floor 1** with 100 chips and your fists. Each floor has an **elevator fee** and a **closing time**. Pay the fee at the elevator before the clock runs out to ride up, and your chips, gun and armor come with you. Bust, or get caught at closing time, and the run is over: back to Floor 1.

| Floor | Size | Fee | Time | Rivals | Bets |
|---|---|---|---|---|---|
| 1 · The Lucky Dump | 64×44 | 🪙 250 | 4:00 | 4, unarmed | 10–100 |
| 2 · The Golden Goose | 80×56 | 🪙 600 | 4:30 | 6, some armed | 25–250 |
| 3 · Diamond Penthouse | 96×64 | 🪙 1200 | 5:00 | 7, armed and armored | 50–500 |

Pay the elevator on Floor 3 to **cash out and win the run**.

- **Chips are your health.** Getting hit sprays your chips across the floor as real 3D poker chips, and anyone can grab them. Busted rivals drop their gun.
- **🎰 Slots** give you a random gun. Pricier machines and higher floors roll better guns and rarer versions: **Common, Rare, Epic or Legendary**, each with more damage and ammo.
- **🎡 Roulette:** red or black pays 2x, green pays 14x.
- **🃏 Blackjack:** hit, stand or double down against the dealer. Blackjack pays 2.5x.
- **🚀 Crash:** buy in, watch the multiplier climb, and cash out before it crashes.
- **💰 Cashier:** buy armor and ammo refills.
- Winnings spray out of the table as chips. Grab them before a rival does.
- **Unlocks you keep forever:** the cowboy hat (reach Floor 2), the dealer visor (hit a slot jackpot) and the crown (win a run). Your best floor is saved too.

**Controls:** WASD to move · mouse to aim · click to shoot · Space to jump · Shift to sprint · E to use or leave · Esc to pause · at tables: 1 2 3 to play, and scroll or Z/X to change your bet

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
| `src/config.js` | Every tunable number: floors, weapons, rarities, slot odds, prices |
| `src/game.js` | The run, floors, shooting, damage, rockets, rivals, loot |
| `src/world.js` | Generates each floor's layout, lighting and collision |
| `src/slots.js` | Walk-up slot machines with spinning reels and rarity rolls |
| `src/tables.js` | Roulette and blackjack tables with seats and a dealer |
| `src/crash.js` | The Crash billboard game |
| `src/services.js` | The cashier, the elevator, and guns lying on the floor |
| `src/save.js` | Permanent unlocks and records |
| `src/character.js` | Bean characters, hats, guns, animation |
| `src/bots.js` | Bot AI: gamble, loot, fight |
| `src/player.js` | Your controls and the over-the-shoulder camera |
| `src/chips.js` | Physical poker chips that spray and get collected |
| `src/fx.js` / `src/audio.js` | Explosions, tracers, confetti; synthesized sound effects |

## Roadmap

- **Online multiplayer:** Friends in the same casino, gambling and fighting each other
- Squads: team up with friends and climb together, while other squads compete for the same elevator
- More floors, rare loot (vault keys, golden guns), and more games (poker, dice, a wheel of fortune)
