# 🎰 Degen Reels

A 3D cartoon **extraction shooter** set in a casino town gone wrong. Gear up, raid **Lost Vegas**, grab what you can, and get out alive. If you die, you lose everything you carried.

## Maps

| Map | Size | Danger | Vibe |
|---|---|---|---|
| 🌵 Lost Vegas | Huge (480m) | Medium | Desert strip, motel, gas station and junkyard around the Lucky Dump Grand. Out past them: the Neon Boneyard, **Area 52 Test Range**, Starlite Drive-In, bowling alley, Pharaoh's Folly, a ranch and a freight yard |
| 🏔️ Frostbite Peaks | Huge (400m) | Hard (machines have 30% more health and damage) | Snowed-in ski town, frozen lake, gondola and the Alpine Ace Lodge. Out past them: the **Summit Observatory**, Frosty's Ice Hotel, the ski jump, Avalanche Row, a ranger station and an old mine |
| 🐊 Bayou Royale | Large (370m) | Medium | Swamp boardwalks, stilt shacks and the Riverboat Royale paddle-steamer casino. Out past them: **Madame Marie's Mansion**, the Gator Farm, a shipwreck, a fishing camp, the Sunken Chapel and Swamp Gas |

Each map has one **deadly outer area** (in bold) with tier-3 loot and heavy guards, so the casino isn't the only place worth risking it.

Every map has a casino with a vault, a Pit Boss event, and four exits (two open per raid). Each also has its own hazard:

- **Lost Vegas: traffic.** Cars cruise the strip and the cross street, and getting hit hurts. They honk if you're standing in the lane.
- **Frostbite Peaks: cold.** Your warmth drains outdoors. Stand by a burning barrel 🔥 or get indoors to warm up, or drink ☕ Hot Cocoa (G). At zero warmth you freeze, and frostbite goes straight through armor.
- **Bayou Royale: gators.** They lurk in every pond with just their eyes showing and lunge at anyone who wanders close. They drop 🦷 Gator Teeth.

## Critical hits

Every enemy has a small weak spot that takes extra damage. A crit pops a yellow number with a "!" and a sharper sound.

| Target | Weak spot | Damage |
|---|---|---|
| Slotbot | Lever knob on its side | ×2.5 |
| Dicer | Rotor hub on top | ×3 |
| Card Shark | Eye band | ×2 |
| Gator | Between the eyes | ×2 |
| Pit Boss | Jackpot screen | ×2.5 |
| Raiders | Head | ×1.75 |

## The loop

1. **The Hub.** Pack a loadout from your stash: two guns plus up to 8 items. Gamble stash chips in the **Back Room** (Loot Reels, Blackjack, Roulette, Crash), sell loot to **the Fence**, and pick your look. Broke? Grab a free kit.
2. **Deploy.** You spawn at the edge of the map with an 18-minute clock. Two of the four exits are open each raid.
3. **Loot.** Hold **E** to search registers, crates, lockers and safes. Pull **loot slots** with chips you found. You're free to walk away and fight while the reels spin, and the prize pops out of the tray.
4. **Fight.** The town is run by machines:
   - **Slotbots:** walking slot machines that fire bursts.
   - **Dicers:** flying dice that circle you.
   - **Card Sharks:** playing cards that rush you with a blade.
   - Six **rival raiders** are out there too. Most leave you alone unless you shoot them, but some carry Cherry Bombs.
   - **Throwables:** hold **T** to see a dotted arc and a ring showing where it lands and how far it reaches, then let go to throw. **X** switches which one you're holding, or pick one in the backpack.

     | Throwable | What it does |
     |---|---|
     | 💣 Cherry Bomb | Bounces, then blows up 2 seconds later |
     | 🎲 Loaded Dice | Tumbles and lands on a number. The higher the roll, the bigger the boom: a 6 is a jackpot blast, snake eyes fizzles |
     | ✨ Flash Chip | Stuns every machine and raider who sees it. Don't look at it yourself |
     | 🌶️ Ghost Pepper Sauce | Smashes on impact into a pool of fire that burns for 6 seconds (and warms you up in the snow) |

     Explosions and fire hurt you too. You start with 2 Cherry Bombs, and all of them drop from crates, slots and raiders. Some raiders throw them at you.
   - **🧃 Rocket Fuel Energy (Z):** 15 seconds of running 25% faster, and sprinting costs no stamina.
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

**Chips** come in colors: white $1, red $5, green $25, black $100.

## Controls

WASD move · Space jump · Shift sprint (uses stamina; jumping costs some too) · Mouse aim · Left click shoot · **Right click aim down sights** · E use (**hold** to search) · 1/2 or mouse wheel swap guns · R reload (uses an Ammo Box) · **T hold to aim a Cherry Bomb, let go to throw** · H heal · F armor plate · G hot cocoa · Q backpack (also Tab, I or B) · M map · **V first/third person** · Esc pause and settings (**mouse sensitivity**, FOV, volume)

**Ammo Boxes 📦** go straight into your backpack when you pick them up. Press **R** (or keep shooting when you run dry) and one box refills half of the gun in your hands. You can also open the backpack (Q), click the box and hit **Reload now**. When a gun gets low, its ammo count turns red and tells you whether you have boxes left.

Running, jumping and moving make your shots spray. The crosshair opens up to show it, and aiming down sights tightens it.

## Controls are rebindable

Settings (or **Esc → Controls** mid-raid) lists every action with two slots each. Click a slot, then press any key, **any mouse button (side buttons work)** or the scroll wheel. Esc cancels and Backspace clears it. Every on-screen hint updates to match your bindings.

## Run it

```bash
npm install
npm start
```

Then open http://localhost:3000. `npm run build:artifact` packs the whole game into a single HTML file at `dist/degen-reels.html`.

## How it's built

- **three.js** for 3D, bundled with **esbuild**. No image or model files: every building, character, machine and sound is generated in code.
- **Cartoon look:** toon shading and ink outlines (`src/toon.js`), plus procedural animation (`src/character.js`).
- **A big map that still runs well:** static scenery is merged per 85m chunk (`map.bake()`), colliders live in a spatial grid, the sun's shadow follows you, and far-away machines sleep and stop drawing.

| File | What's in it |
|---|---|
| `src/config.js` | Every tunable number: weapons, items, loot tables, rarity odds, enemies, timers |
| `src/map.js` | All maps: a shared kit (buildings, props, casino, collision grid, minimap) plus one layout builder per map |
| `src/raid.js` | The raid: deploy, combat, loot, the vault, the boss event, extraction |
| `src/enemies.js` | Slotbot, Dicer, Card Shark and Pit Boss models and AI |
| `src/bots.js` | Rival raider AI |
| `src/combatant.js` | Health, armor, weapon slots, backpack |
| `src/items.js` / `src/pickups.js` | Item data, loot rolls, items lying in the world |
| `src/containers.js` / `src/slots.js` | Searchable containers and in-raid loot slots |
| `src/hub.js` | Stash, loadout, Back Room gambling, Fence, look, settings |
| `src/hud.js` / `src/player.js` | HUD, minimap, bag and map screens; controls and camera |
| `src/keys.js` | Rebindable controls and the rebinding panel |
| `src/throwables.js` | Cherry Bombs, Loaded Dice, Flash Chips, Ghost Pepper Sauce |
| `src/icons.js` | Gun pictures rendered from the 3D models |
| `src/save.js` | Stash, settings, stats and unlocks (saved in the browser) |

## Roadmap

- **Online co-op:** squad up with friends and raid together, with other squads on the same map
- More bosses and raid events (Jackpot Storm, armored cash truck)
- Crafting and hub upgrades bought with loot
- More maps: the Hoover Dam heist and the Underground Poker Bunker
