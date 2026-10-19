# Architecture

Matches run on the server. The browser sends orders and draws what it is sent.

```
design/balance.xlsx ──import──► packages/rules ──► packages/sim ──► apps/server ══WebSocket══► apps/game
   (source of truth)            typed data,        the match:        runs matches,             draws views,
                                calc.ts, deps.ts    fixed tick,       saves, scenarios          sends orders
                                                    deterministic
```

| Package | What it is | Who may import it |
|---|---|---|
| `packages/rules` | Rules and economy generated from the spreadsheet, plus calculations (`calc.ts`) and dependencies (`deps.ts`) | Server side. The browser may import `@gravity-harvest/rules/deps` (code only, no data) |
| `packages/sim` | The match simulation: map, pathing, ore, harvesting, combat, construction, production, power, fog, saves | Server side. The browser may import `@gravity-harvest/sim/layout` (roster, footprints, placement check) |
| `packages/ai` | The computer opponent: plays one side from that side's view, by giving orders (below) | Server side (and the simulator) |
| `packages/shared` | The contracts: save API and match protocol (`match.ts`) | Everyone |
| `apps/server` | NestJS: match WebSocket (`/api/match`), saves, scenario list | — |
| `apps/game` | Phaser renderer, HUD, menus | — |
| `tools/simulator` | Headless AI-against-AI matches and their report (`npm run simulate`) | — |

`apps/game` runs `scripts/check-bundle.mjs` after every build: it fails if rules data (weapon IDs, damage classes,
AI values, unreleased entities) shows up in the browser bundle.

## Principles

- **The server is the authority.** Credits, HP, damage, build times, fog: all decided in `packages/sim`. The browser
  can't change the match except by sending orders, and every order is checked (`apps/server/src/match/protocol.ts`
  for shape, `Sim.command` for legality).
- **Each player only gets what they may know** (`Sim.view`): their own state, enemy units in sight, enemy buildings
  they have discovered, their fog. Never the enemy's credits, cargo or positions under fog.
- **The simulation is deterministic.** Fixed 50 ms tick, a seeded RNG in the match state, no timers or `Math.random`.
  The same start and orders give the same match (tested), which is what replays and lockstep need later.
- **Numbers come from the spreadsheet.** Nothing hand-copies a value; engine constants the sheet doesn't cover (tick,
  footprints, harvest speed, unit cap) are in `packages/sim/src/layout.ts`.
- **The HUD only talks through `HudBridge`** (`apps/game/src/ui/HudBridge.ts`), implemented by `GameScene` from the
  latest view.

## A match, end to end

1. The browser opens `ws://…/api/match` (Vite proxies it in dev) and sends `start` (a scenario, or a save ID).
2. The server (`MatchSession`) creates or restores a `Sim`, sends `hello` (map size, camera, ore, and the **match
   catalog**: names, costs, build times and prerequisites of the enabled roster only), then starts the tick.
3. Every tick the sim steps; every 2 ticks (100 ms) the player gets a `view` with units, buildings, credits, power,
   production queue, stats, fog (only when it changed) and **events** (shots, deaths, doors, unloads, toasts).
4. The browser (`GameScene`) keeps a sprite per entity ID, glides units from where they're drawn to the newest
   position over one view interval, and turns events into effects. Clicks become `cmd` messages; markers and the
   placement preview are local, so orders feel instant.
5. Pause, save (`save` → the server snapshots the sim and stores it), and `end` (leaving on purpose). A dropped
   connection autosaves mid-match. When a side is out, the server sends `gameOver` and clears that map's autosave.

## The computer opponent

`packages/ai` (`ComputerPlayer`) is pure TypeScript: no Node or browser APIs, no timers, its own seeded RNG, so the
same views and seed give the same orders (tested). It plays fair at every difficulty:

- **It sees what a player on its side sees:** its `hello` (map, ore, scenery, its catalog) and each `TeamView` (its own
  units, buildings, credits, power, queue; enemies in sight; enemy buildings it has discovered, as last seen; its fog; events). It
  remembers what it has seen (`world.ts`): enemy units for a while after they leave sight, which of its things were
  shot at and from where. It reads the rules (`@gravity-harvest/rules`) for numbers (weapons, armor, costs), as a
  player reads the build cards, but never the Sim.
- **It acts only through `Command`s,** given to `Sim.command` exactly as a player's are. The server feeds each
  computer side (`human: false`) a view every `AI_VIEW_EVERY_TICKS` (500 ms) in `MatchSession.playComputers`.
- **What it does each think** (`computer.ts`): idle harvesters back to work (or out of a fight); a building plan from
  the catalog's prerequisites (power first, keeping `ECONOMY.aiDesiredPowerSurplus`, then refineries, whatever makes
  harvesters and its best units, defences, a Service Bay for its vehicles), placed where the server will accept it
  with lanes kept open (`placement.ts`); repairs; production (harvesters per refinery, then a mix of armed units scored
  by damage × health per credit against what it has seen of the enemy, `tech.ts`); expansion with an Assembler once
  its own ore runs low; and its army: gather in front of the base, defend when the base is attacked, scout, and attack
  in waves paced by `aiFirstAttackMinutes` / `aiAttackIntervalMinutes`, when its force is big enough for what it
  knows of the enemy, pushing building to building and pulling back hurt units.
- **No unit is named.** It picks by role and stats from whatever its side's catalog lists, so a new roster needs no AI
  change. The only IDs it knows are the ones the sim gives behaviours to (`ENGINE_IDS`: refinery, harvester, Service
  Bay, Assembly Yard, Assembler).
- **Difficulty** (Easy, Normal, Hard; chosen on the New Game screen, sent in `start`, kept in saves, shown on the pause
  and end screens) is one profile of mistake rates per level (`profiles.ts`): how often it thinks, its reaction delay
  and orders per minute, how often it forgets production, buildings, power, harvesters or repairs, careless placement,
  unit choice, attacking too small or blind, focus fire, retreats, defending late, scouting. Same code, same rules and
  income for all.

## The simulator

`npm run simulate -- [--quick] [--matches 20] [--a ordan:hard --b sable:normal] [--scenario skirmish|all] [--seed 1]
[--max-minutes 40] [--workers N]` plays computer-against-computer matches with no rendering, as fast as the CPU
allows, across worker threads (`tools/simulator`). Without `--a/--b` it plays the standard suite (each faction against
the other at each level, each level against the one below in both factions, mirror matches); sides swap start
positions every other match, and match *n* of a pairing uses seed `--seed + n`, so a run repeats exactly. `--quick`
is 20 matches per pairing on every map, for a check after any rules or AI change.

It prints verdicts (OK or a warning with the reasons) on time, fairness, fun, tech progress, build speed and ore, and
one per map (does it work, can it be won, does it take too long, worst first), with the tables behind them: pacing
milestones, win rates with confidence intervals, lead changes and comebacks, engagements, unit variety and
effectiveness, what holds each side back per phase, arrival times against the rules, base and army over time, ore,
income and harvester trips. Everything also goes to `tools/simulator/out/` as JSON (gitignored). What "good" means
is one editable file: `tools/simulator/src/targets.ts`. The AIs only get views and give orders; the harness itself
reads the Sim to measure.

## Coordinates (browser)

- **Grid** (`gx`, `gy`, floats in tiles) everywhere in the protocol. Tile `(tx, ty)` spans `(tx, ty)..(tx+1, ty+1)`.
- **World pixels** for rendering: `iso(gx, gy)` / `toGrid(x, y)` in `core/geometry.ts`. One tile is 128 × 64 world
  px; art is rendered at that 2× scale. The camera starts at zoom 0.67 (about 85 × 43 on screen) and goes from 0.25
  to 0.75; the art is pixel for pixel at 0.5 on a Retina screen, so closer than that it's stretched a little.
- **Facing**: `facing(dgx, dgy, 8 | 16)` (in the sim). Direction 0 = world +X, counter-clockwise from above, which is
  how the Blender sprite sheets are rendered.
- **Depth**: isometric y. Buildings register on nearby tiles (`GameMap.addOccluder`) so units and ore next to them
  sort in front or behind correctly (`GameMap.depthAt`).

## Browser app flow

`main.ts` creates the Phaser game and `app/GameFlow`, which owns everything around a match:

- **Scenes:** `BootScene` loads assets → `MenuScene` (animated backdrop) → `GameScene` (draws a match).
- **Screens** (`ui/screens/`): title, new game (list from `GET /api/scenarios`), load, save, pause, settings,
  victory / defeat. Plain DOM; they call `ScreenActions` (implemented by `GameFlow`).
- **Saving** (`save/SaveService`): asks the server over the match socket, adding a thumbnail of the battlefield.
  One autosave slot per scenario, on game time (setting), on quit, when the tab is hidden, and (server side) when the
  connection drops. Saves are listed, read and deleted over HTTP; they can't be uploaded.

## Saves

`Sim.snapshot()` is plain JSON (`SimSnapshot`, see `SNAPSHOT_VERSION`): credits, each side's faction and the computer's difficulty, queues, buildings, units, ore and gravity vents, explored fog,
RNG state. `Sim.restore()` rebuilds it; transient state (paths, timers, targets) isn't saved and units resume their
default behaviour. The server stores it as the save's `state` and never sends it to the browser. Version-1 saves
(from when the browser ran the game) can't be loaded. A format change bumps `SNAPSHOT_VERSION`.

## Adding things

See [ADDING_CONTENT.md](ADDING_CONTENT.md): new units and buildings (art → roster), maps, and rules changes.

## Next steps

- **Multiplayer:** a second human connection per match (`Sim` already takes orders per team and builds a view per
  team), lobbies, accounts, reconnecting to a running match.
- **The AI with the new roster:** flying units and anti-air (the AI already scores units by what their weapons can
  hit, `tech.ts`), and abilities as they arrive (the Watcher, Shroud and Seeder are never built: they do nothing yet).
  Use `npm run simulate -- --quick` after rules changes; its report is the balance to-do list.
- **The rest of the roster** as art arrives (Assembly Yard, Motor Works, factions, abilities).
- Rare ore deposits, repair, selling from the HUD (the sim supports selling already).
- Flow-field pathfinding for large groups (collisions and formations are in: see DECISIONS.md). Music (sound effects and voices are in). Replays (orders are already a stream).
