# 🎰 Degen Reels

A 3D cartoon **extraction shooter** set in a casino town gone wrong. Gear up, raid **Lost Vegas**, grab what you can, and get out alive. If you die, you lose everything you carried.

## The loop

1. **The Hub.** Pack a loadout from your stash: two guns plus up to 8 items. Gamble stash chips in the **Back Room** (Loot Reels, Blackjack, Roulette, Crash), sell loot to **the Fence**, and pick your look. Broke? Grab a free kit.
2. **Deploy.** You spawn at the edge of a huge desert map with a 15-minute clock. Two of the four exits are open each raid.
3. **Loot.** Hold **E** to search registers, crates, lockers and safes. Pull **loot slots** with chips you found. You're free to walk away and fight while the reels spin, and the prize pops out of the tray.
4. **Fight.** The town is run by machines:
   - **Slotbots:** walking slot machines that fire bursts.
   - **Dicers:** flying dice that circle you.
   - **Card Sharks:** playing cards that rush you with a blade.
   - Four **rival raiders** are out there too. Most leave you alone unless you shoot them.
5. **Extract.** Stand in an open exit's green circle for 8 seconds, and everything you're carrying goes to your stash.

## Risk and reward

| Zone | Danger | Best drops |
|---|---|---|
| The Desert | Safe-ish | No Legendaries at all |
| The Strip, Motel, Gas Station, Diner, Warehouses | Risky | Legendary 0.5% |
| Lucky Dump Grand Casino | Deadly | Legendary 2%, Four-Leaf Clover 0.5%, Vault Keycards |
| The Vault (needs a Keycard) | Vault | Legendary 7% |

At **4 minutes** in, **The Pit Boss** (a giant golden slot mech) hits the casino floor. It sprays bullets, fires rockets, rolls out Dicers and slams the ground. Take it down for a guaranteed Epic+ gun, a Keycard, and a 1% shot at **The House's Crown** (🪙 25,000).

Gun rarities: **Common**, **Rare**, **Epic** and **Legendary**, each with more damage and ammo. Rare drops shoot a colored beam into the sky.

Unlockable hats: cowboy (extract once), dealer visor (extract 10 times), crown (beat the Pit Boss).

## Controls

WASD move · Space jump · Shift sprint · Mouse aim · Left click shoot · **Right click aim down sights** · E use (**hold** to search) · 1/2/Q swap guns · R reload (uses an Ammo Box) · H heal · F armor plate · Tab backpack · M map · Esc pause and settings (**mouse sensitivity**, FOV, volume)

## Run it

```bash
npm install
npm start
```

Then open http://localhost:3000. `npm run build:artifact` packs the whole game into a single HTML file at `dist/degen-reels.html`.

## How it's built

- **three.js** for 3D, bundled with **esbuild**. No image or model files: every building, character, machine and sound is generated in code.
- **Cartoon look:** toon shading and ink outlines (`src/toon.js`), plus procedural animation (`src/character.js`).
- **A big map that still runs well:** static scenery is merged per 60m chunk (`map.bake()`), colliders live in a spatial grid, the sun's shadow follows you, and far-away machines sleep and stop drawing.

| File | What's in it |
|---|---|
| `src/config.js` | Every tunable number: weapons, items, loot tables, rarity odds, enemies, timers |
| `src/map.js` | Lost Vegas: buildings, props, zones, extracts, collision grid, minimap |
| `src/raid.js` | The raid: deploy, combat, loot, the vault, the boss event, extraction |
| `src/enemies.js` | Slotbot, Dicer, Card Shark and Pit Boss models and AI |
| `src/bots.js` | Rival raider AI |
| `src/combatant.js` | Health, armor, weapon slots, backpack |
| `src/items.js` / `src/pickups.js` | Item data, loot rolls, items lying in the world |
| `src/containers.js` / `src/slots.js` | Searchable containers and in-raid loot slots |
| `src/hub.js` | Stash, loadout, Back Room gambling, Fence, look, settings |
| `src/hud.js` / `src/player.js` | HUD, minimap, bag and map screens; controls and camera |
| `src/save.js` | Stash, settings, stats and unlocks (saved in the browser) |

## Roadmap

- **Online co-op:** squad up with friends and raid together, with other squads on the same map
- More bosses and raid events (Jackpot Storm, armored cash truck)
- Crafting and hub upgrades bought with loot
- More maps: the Hoover Dam heist and the Underground Poker Bunker
