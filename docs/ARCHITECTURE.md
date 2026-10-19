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
| `packages/rules` | Rules and economy generated from the spreadsheet (with `RULES_HASH`), calculations (`calc.ts`), dependencies (`deps.ts`) and the hand-written capabilities table (`capabilities.ts`) | Server side. The browser may import `@gravity-harvest/rules/deps` (code only) and `@gravity-harvest/rules/public` (names, costs, prerequisites, capabilities: what the UI shows) |
| `packages/sim` | The match simulation: map, pathing, ore, harvesting, combat, construction, production, power, fog, saves and their migrations, the command queue, view feeds, replays | Server side. The browser may import `@gravity-harvest/sim/layout` (roster, footprints, placement check, `facing`) |
| `packages/ai` | The computer opponent: plays one side from that side's view, by giving orders (below) | Server side (and the simulator) |
| `packages/shared` | The contracts: save API, player id (`player.ts`) and match protocol (`match.ts`) | Everyone |
| `apps/server` | NestJS: match WebSocket (`/api/match`), saves, scenario list | — |
| `apps/game` | Phaser renderer, HUD, menus | — |
| `tools/simulator` | Headless AI-against-AI matches and their report (`npm run simulate`) | — |

`apps/game` runs `scripts/check-bundle.mjs` after every build: it fails if rules data (weapon IDs, damage classes,
AI values, unreleased entities) shows up in the browser bundle. The dev pages (`apps/game/dev/`, `src/dev/`) import
the full `@gravity-harvest/rules` and `@gravity-harvest/sim` (the building traffic preview runs a real `Sim`); that is
only acceptable because they are served by the dev server and never built: the build's only entry is `index.html`.
Anything the game itself loads may only use the entry points in the table above.

**CI** (`.github/workflows/check.yml`) runs on every pull request and push to `main`: `npm run assets:pull`,
`npm run check`, then the server's API e2e tests. The game's browser tests (Playwright, ~6 min) aren't in CI for now;
run them locally before big changes.

## Principles

- **The server is the authority.** Credits, HP, damage, build times, fog: all decided in `packages/sim`, and the
  server runs the only real copy of a match. The browser can't change the match except by sending orders, and every
  order is checked (`apps/server/src/match/protocol.ts` for shape, the sim's `orders` system for legality).
- **Each player only gets what they may know** (`Sim.view`, through a `TeamFeed`): their own state, enemy units in
  sight, enemy buildings they have discovered, their fog. Never the enemy's credits, cargo or positions under fog.
- **The simulation is deterministic.** Fixed 50 ms tick, a seeded RNG in the match state, no timers or `Math.random`.
  The same start and orders give the same match (tested). That is what saves, replays and tests rely on. It is not
  used to run the same match in several browsers: multiplayer stays server-authoritative (DECISIONS.md).
- **Numbers come from the spreadsheet.** Nothing hand-copies a value; engine constants the sheet doesn't cover (tick,
  footprints, harvest speed, unit cap) are in `packages/sim/src/layout.ts`. Behaviours an entity has beyond its
  numbers (harvester, refinery, turret, hover...) are capabilities (`packages/rules/src/capabilities.ts`): the sim,
  placement, the AI and the browser ask by role, never by ID.
- **The HUD only talks through `HudBridge`** (`apps/game/src/ui/HudBridge.ts`), implemented by `GameScene` from the
  latest view.

## Seats

The two sides are seats, `TeamId = 'a' | 'b'` (`packages/shared/src/match.ts`, with `TEAMS`, `opponentOf` and
`perTeam`): `a` starts in the scenario's first base, `b` in the second. Neither is "the player". A scenario marks which
seats are human and gives each seat its own camera start; `StartMatch.seat` picks the human's seat (the protocol and
server support either; the New Game screen doesn't offer the choice yet). The hello says which seat a connection plays
(`you`) and each seat's faction (`factions`). In the browser, `data/teams.ts` keeps that (`setSeats`) and everything on
screen goes by mine or theirs (`isMine`, `colourOf`, `factionOfTeam`), never by seat: your colours are yours whichever
side you sit on.

## A match, end to end

1. The browser opens `ws://…/api/match?player=<id>` (Vite proxies it in dev) and sends `start` (a scenario, or a save
   ID).
2. A `SeatConnection` (`apps/server/src/match/seat-connection.ts`, one per socket) asks the `MatchRooms` registry for
   a new `MatchRoom` (`match-room.ts`, one per match). The room creates or restores the `Sim`, makes a
   `ComputerPlayer` for each computer seat, and owns the tick loop, the `CommandQueue`, autosaves and `record()`. The
   connection attaches to its seat and gets `hello` (its seat and the factions, map size, camera, ore, and the
   **match catalog**: names, costs, build times and prerequisites of the enabled roster only).
3. **Orders.** Every order, from people and computer players alike, waits in the room's `CommandQueue`
   (`packages/sim/src/commands.ts`) and is applied at the start of the next step, sorted by the tick it arrived in,
   then seat (`a` before `b`), then arrival, so when a message happens to arrive between ticks never changes the match.
   Each applied order is logged as `{ tick, team, cmd }`. Debug commands are applied at once (even while paused) and
   logged the same way.
4. **Views.** After each step the room takes each seat's events from the sim (`Sim.takeEvents(team)`, the only way
   events leave it) and pushes them into that seat's `TeamFeed` (`packages/sim/src/feed.ts`). `Sim.view` is pure:
   looking never changes the match. Every 2 ticks (100 ms) each connected seat gets a `view` from its feed: units,
   buildings, credits, power, production queue, stats, the events since its last view (shots, deaths, doors, unloads,
   toasts) and its fog, only when it changed. Computer players get a view from their own feed every
   `AI_VIEW_EVERY_TICKS` (500 ms) and queue their orders like anyone else.
5. **The browser** (`GameScene`) keeps a sprite per entity ID and glides units from where they're drawn to the newest
   position over one view interval. `scenes/EventPresenter.ts` turns events into effects, sounds and toasts (each
   toast carries a code from the sim; `data/toasts.ts` maps codes to sounds). Every order goes out through
   `input/Orders.ts` as a `cmd` message; markers and the placement preview are local, so orders feel instant.
6. Pause, save (`save` → the room snapshots the sim, adds each computer player's seed and memory, and stores it), and
   `end` (leaving on purpose). When a side is out, the server sends `gameOver` and clears that map's autosave.

**Dropped connections.** When a socket closes mid-match the room autosaves (if the client asked for it in `start`,
`autosaveOnLeave`), pauses, and waits `RECONNECT_GRACE_MS` (default 60 s; sent to the client as
`MatchHello.reconnectMs`). The same player id can come back on a new socket with `{ t: 'rejoin' }` and gets a fresh
hello and full view. `net/MatchClient.ts` does this by itself: it retries with backoff for that long and shows a toast
when it loses and regains the connection. After the grace period the room closes.

**Replays.** `room.record()` returns a `MatchRecord` (`packages/sim/src/replay.ts`): the rules hash, how the match
began (scenario, seed and options, or the snapshot it was loaded from), the command log and the end tick.
`replay(record)` plays it again from `startMatch(start)` and the log, with no computer player running, and gives the
same match tick for tick under the same rules. There is no replay viewer yet.

## The computer opponent

`packages/ai` (`ComputerPlayer`) is pure TypeScript: no Node or browser APIs, no timers, its own seeded RNG, so the
same views and seed give the same orders (tested, and pinned by `regression.test.ts`, which hashes the order stream
of whole matches). It plays fair at every difficulty:

- **It sees what a player on its side sees:** its `hello` (map, ore, scenery, its catalog) and each `TeamView` (its own
  units, buildings, credits, power, queue; enemies in sight; enemy buildings it has discovered, as last seen; its fog; events). It
  remembers what it has seen (`world.ts`): enemy units for a while after they leave sight, which of its things were
  shot at and from where. It reads the rules (`@gravity-harvest/rules`) for numbers (weapons, armor, costs), as a
  player reads the build cards, but never the Sim.
- **It acts only through `Command`s,** queued and applied exactly as a player's are (`MatchRoom.playComputers`).
- **How it is built:** `computer.ts` is the coordinator: each think it runs its managers in order, all sharing one
  `Brain` (`brain.ts`, with the `Manager` base class) and one plain state (`state.ts`):
  - `economy.ts`: idle harvesters back to work (or out of a fight), harvesters per refinery, expansion with an
    Assembler once its own ore runs low;
  - `base.ts`: a building plan from the catalog's prerequisites (power first, keeping
    `ECONOMY.aiDesiredPowerSurplus`, then refineries, whatever makes harvesters and its best units, defences, a Service
    Bay for its vehicles), placed where the server will accept it with lanes kept open (`placement.ts`); repairs;
  - `production.ts`: a mix of armed units scored by damage × health per credit against what it has seen of the
    enemy (`tech.ts`);
  - `army.ts`: gather in front of the base, defend when the base is attacked, and attack in waves paced by
    `aiFirstAttackMinutes` / `aiAttackIntervalMinutes`, when its force is big enough for what it knows of the enemy,
    pushing building to building and pulling back hurt units;
  - `scouting.ts`: looking for the enemy.
- **Its memory is saveable.** `AiState` is plain JSON (no Sets, Maps or classes; `version: 1`). `getState()` and
  `ComputerPlayer.fromState()` round-trip it, so a save carries each computer's seed and memory and a loaded match
  plays on as it would have (`continuation.test.ts`). A memory of another version is dropped and it starts afresh.
- **No unit is named.** It picks by role and stats from whatever its side's catalog lists, so a new roster needs no AI
  change. The few roles it needs (`ENGINE_IDS` in `tech.ts`: refinery, harvester, Service Bay, Assembly Yard,
  Assembler) are looked up by capability.
- **Difficulty** (Easy, Normal, Hard; chosen on the New Game screen, sent in `start`, kept in saves, shown on the pause
  and end screens) is one profile of mistake rates per level (`profiles.ts`): how often it thinks, its reaction delay
  and orders per minute, how often it forgets production, buildings, power, harvesters or repairs, careless placement,
  unit choice, attacking too small or blind, focus fire, retreats, defending late, scouting. Same code, same rules and
  income for all.

## The simulation's structure

`Sim` (`packages/sim/src/sim.ts`) is a small facade (about 220 lines): `create`, `restore`, `snapshot`, `command`,
`step`, `view`, `takeEvents`, `hello`, `debug` and read-only accessors. `step` is the schedule: the order the systems
run in each tick. Behind it:

- `state.ts`: `SimState`, everything the match is (map, ore, fog, players, units, buildings, clocks, RNG).
- `entities.ts`: buildings, units (harvesters and fighters) and players as plain data. A fighter is made of one part
  per mechanic (`FighterOrders`, `Armament`, `ServiceVisit`, `Cabin`, `Boarding`, `SupportWork`), each a plain
  interface whose fields sit flat on the unit.
- `catalog.ts`: the roster as a match knows it, and production lanes.
- `spatial.ts`: a grid of units by cell and an index of buildings by team, so "who is near" doesn't scan everything.
  Answers come in the same order a full scan would give, so results are identical (tested).
- `systems/`: plain functions over the state, one file per mechanic: `collisions`, `harvesting`, `combat`,
  `construction`, `orders`, `fighters`, `movement`, `service`, `transport`, `save`, `views`, `support`, `lifecycle`,
  `setup`, `debug`, `events`, `power`, `visibility`.

`Sim.create` also accepts a scenario object instead of an ID (the dev traffic page builds its own little map); such a
match can't be restored.

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
- **Facing**: `facing(dgx, dgy, 8 | 16)`, defined once in the sim and exported to the browser from
  `@gravity-harvest/sim/layout`. Direction 0 = world +X, counter-clockwise from above, which is how the Blender sprite
  sheets are rendered.
- **Depth**: isometric y. Buildings register on nearby tiles (`GameMap.addOccluder`) so units and ore next to them
  sort in front or behind correctly (`GameMap.depthAt`).

## Browser app flow

`main.ts` creates the Phaser game and `app/GameFlow`, which owns everything around a match:

- **Scenes:** `BootScene` loads assets → `MenuScene` (animated backdrop) → `GameScene` (draws a match, with
  `EventPresenter` for events and `input/Orders` for every order it sends).
- **Screens** (`ui/screens/`): title, new game (list from `GET /api/scenarios`), load, save, pause, settings,
  victory / defeat. Plain DOM; they call `ScreenActions` (implemented by `GameFlow`).
- **Saving** (`save/SaveService`): asks the server over the match socket, adding a thumbnail of the battlefield.
  One autosave slot per player and map, on game time (setting), on quit, when the tab is hidden, and (server side)
  when the connection drops. Saves are listed, read and deleted over HTTP; they can't be uploaded.
- **Player id** (`net/playerId.ts`): an anonymous id made once with `crypto.randomUUID` and kept in localStorage, sent
  as the `x-player-id` header on saves requests and as `?player=` on the match socket. The server scopes saves to it
  and only lets that id rejoin its match. It is not a login (`apps/server/README.md`).
- **Art tables** (`data/registry.ts`): one registry entry per building and unit; the atlases the game loads,
  `BUILDING_ART`, `UNIT_ART` and the dev pages all derive from it, with atlas and card names by convention. A content
  test checks the registry against the roster and each building's footprint against its stage config in
  `tools/blender/construction/`; `footprint()` throws for a building that has none.
- **Shots** (`data/shots.ts`): one entry per projectile or `fire` key: its look (`render/shots/`, the older looks in
  `render/shots/classic.ts`), its sounds, whether it strikes the ground, and so on.

## Rendering

- **Static objects** (ground texture copies, ore, scenery, decals: some 5,000 per match) are culled off screen
  (`world/StaticObjects.ts`): only those near the view are drawn, re-checked as the camera nears the edge of the kept
  area.
- **What lies flat on the ground** goes into one layer at `DEPTH.ground`, under everything that stands, so it never
  takes part in the depth sort.
- **Depth sorting** (`render/depthSort.ts`): a stable insertion sort over the display list, which is nearly sorted
  from frame to frame; an object's depth is only set when it changes.
- **The minimap** caches its map and fog canvases and redraws them only when the view's `fogVersion` or `oreVersion`
  (or the buildings) change.
- **Performance check:** `npm run perf -w @gravity-harvest/game` (`apps/game/perf`, Playwright) measures frame times
  with a big army, on its own ports (game 5175, server 4312).

## Assets

Sprites, previews, terrain, effects, UI art, sounds and music are not in git. They live in the public S3 bucket
`gravity-harvest-assets`, one folder per version (a hash of the files). `apps/game/assets.json` records the bucket,
region and version a build uses; `npm run assets:pull` / `assets:push` / `assets:status` (`tools/assets/assets.mjs`)
sync it with `apps/game/public/assets`, where the art tools write.

- `vite.config.ts` picks the base: a build always uses the recorded S3 version (and copies no assets into `dist/`);
  the dev server uses the local folder, or S3 when it's missing. `GH_ASSETS=local|remote` forces one. The base reaches
  the code as `VITE_ASSET_BASE`.
- `src/assets/url.ts` exports it (`ASSET_BASE`, `assetUrl`). Phaser's loader gets it as its `baseURL` with
  `crossOrigin: 'anonymous'` (`main.ts`), so atlases load from S3 with CORS; files loaded outside Phaser (images,
  music) go through `assetUrl`, and `index.html` uses `%VITE_ASSET_BASE%`.

## Saves

`Sim.snapshot()` is plain JSON (`SimSnapshot`, `SNAPSHOT_VERSION` 11, `packages/sim/src/snapshot.ts`) holding the
whole match: credits, each side's faction and difficulty, queues, buildings and units with everything they are doing
(orders, paths, timers, attack-moves, harvester trips, hatches, service visits, boarding, passengers), ore and gravity
vents, scenery, the full fog and each side's memory of enemy buildings, power, the sim's clocks and the RNG. Restoring
it and playing on with the same orders gives the same match, tick for tick (tested). It also records `rulesHash`
(`RULES_HASH`, written into `packages/rules/src/generated/balance.ts` by the rules importer) and `scenarioHash`; the
server adds each computer side's seed and memory (`computers`). What a type gets from the rules (health, armor, speed,
weapons) isn't saved, and the map is rebuilt from the scenario's code. The server stores the snapshot as the save's
`state` and never sends it to the browser.

**Old saves** are migrated before restoring: `migrateSnapshot` (`packages/sim/src/migrations.ts`) runs
`MIGRATIONS[n]` (version `n` → `n + 1`) one step at a time up to the current version. Version 1 (from when the browser
ran the game) can't be loaded; saves from before version 11 load with every unit idle. A save made under other rules
or on an earlier version of its map loads with a warning (`saveWarnings`), not a refusal. Each format has a fixture in
`packages/sim/test/fixtures` (v2, v5, v8, v9, v10, v11) that must keep loading, and `packages/ai/src/continuation.test.ts`
checks that a saved and restored match, computer players included, plays on exactly like the original.

**Database:** the server's schema is owned by TypeORM migrations (`apps/server/src/database/migrations`), run on every
start; `synchronize` is off in production. See `apps/server/README.md`.

## Adding things

See [ADDING_CONTENT.md](ADDING_CONTENT.md): new units and buildings (art → roster), maps, and rules changes.

## Next steps

- **Multiplayer:** a second human connection per match (the room already runs any number of human seats, takes orders
  and builds a view per seat, and lets a player rejoin), lobbies and matchmaking, accounts. The server stays the only
  place the match runs.
- **Replays and spectating:** a viewer for `MatchRecord`s (recording and replaying already work).
- **The AI with the new roster:** flying units and anti-air (the AI already scores units by what their weapons can
  hit, `tech.ts`), and abilities as they arrive (the Watcher, Shroud and Seeder are never built: they do nothing yet).
  Use `npm run simulate -- --quick` after rules changes; its report is the balance to-do list.
- **The rest of the roster** as art arrives (factions, abilities).
- Rare ore deposits.
- Flow-field pathfinding for large groups (collisions and formations are in: see DECISIONS.md).
