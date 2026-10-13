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
| `packages/sim` | The match simulation: map, pathing, ore, harvesting, combat, construction, production, power, fog, AI, saves | Server side. The browser may import `@gravity-harvest/sim/layout` (roster, footprints, placement check) |
| `packages/shared` | The contracts: save API and match protocol (`match.ts`) | Everyone |
| `apps/server` | NestJS: match WebSocket (`/api/match`), saves, scenario list | — |
| `apps/game` | Phaser renderer, HUD, menus | — |

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

## Coordinates (browser)

- **Grid** (`gx`, `gy`, floats in tiles) everywhere in the protocol. Tile `(tx, ty)` spans `(tx, ty)..(tx+1, ty+1)`.
- **World pixels** for rendering: `iso(gx, gy)` / `toGrid(x, y)` in `core/geometry.ts`. One tile is 128 × 64 world
  px; art is rendered at that 2× scale and shown at zoom 0.5 (64 × 32 on screen).
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

`Sim.snapshot()` is plain JSON (`SimSnapshot`, version 2): credits, queues, buildings, units, ore, explored fog,
RNG state. `Sim.restore()` rebuilds it; transient state (paths, timers, targets) isn't saved and units resume their
default behaviour. The server stores it as the save's `state` and never sends it to the browser. Version-1 saves
(from when the browser ran the game) can't be loaded. A format change bumps `SNAPSHOT_VERSION`.

## Adding things

See [ADDING_CONTENT.md](ADDING_CONTENT.md): new units and buildings (art → roster), maps, and rules changes.

## Next steps

- **Multiplayer:** a second human connection per match (`Sim` already takes orders per team and builds a view per
  team), lobbies, accounts, reconnecting to a running match.
- **AI that harvests, builds and attacks**, paced by the spreadsheet's AI targets (raids exist but are off).
- **The rest of the roster** as art arrives (Assembly Yard, Motor Works, factions, abilities).
- Rare ore deposits, repair, selling from the HUD (the sim supports selling already).
- Unit collision / formations; flow-field pathfinding for large groups. Audio. Replays (orders are already a stream).
