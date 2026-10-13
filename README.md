# Gravity Harvest

A classic isometric real-time strategy game for the browser. Pre-rendered isometric sprites (made from
3D models in Blender), Phaser 3, TypeScript, Vite. Matches run on the game server (NestJS + SQLite, `apps/server`):
the browser sends orders over a WebSocket and draws what the server sends, so the rules never reach players.

## Run it

A monorepo: npm workspaces + [Turborepo](https://turborepo.com).

```bash
npm install          # everything, once
npm run dev          # game on http://localhost:5173 + game server on http://localhost:4310/api
```

| Command | What it does |
|---|---|
| `npm run dev` | Starts every app (game, server, and the packages in watch mode). The game needs the server running |
| `npm run build` | Builds everything in dependency order (cached) |
| `npm run typecheck` | Type-checks every package |
| `npm test` | Unit tests in every package |
| `npm run test:e2e` | Server API e2e tests + game browser tests (Playwright, needs `npx playwright install chromium` once) |
| `npm run check` | typecheck + test + build |

Run a single package with `npx turbo run <task> --filter=@gravity-harvest/game` (or `server`, `sim`, `rules`, `shared`).

## Controls

| | |
|---|---|
| Left-click / drag a box | Select your units (shift adds) |
| Left-click with units selected | Harvesters: ore = harvest, your refinery = unload. Riflemen: enemy = attack. Ground = move |
| Right-click | Deselect / cancel placement |
| Right-drag, WASD, arrows | Pan |
| + / − (hold), 0 | Zoom in / out, reset |
| ` or the gear button | Shortcuts and debug panel |
| Build panel | Pick a building, then left-click to place (green = OK, red = blocked), Esc / right-click cancels |
| Esc / save icon (top right) | Pause menu: resume, save, load, settings, quit |
| Right-click a unit card | Cancel one from the production queue |
| F / G / P | Debug: fog of war off (needs the server's debug commands, on in dev) / tile grid / performance |

The game opens on a title screen (New Game, Continue, Load Game, Settings). It autosaves every 2 minutes of game
time by default (one slot per map, also when you quit to the menu, hide the tab or close it); Continue resumes the
newest save.
Victory or defeat opens an end screen with match stats.

Goal of the skirmish: find the enemy base in the far corner (hidden by fog of war) and destroy every enemy building.

## Layout

```
apps/
  game/               @gravity-harvest/game: Phaser 3 + Vite browser game
    src/              config, core, data, assets, scenes, scenarios, world, entities, players,
                      systems, ai, input, render, save, ui (see docs/ARCHITECTURE.md)
    public/assets/    sprites, terrain, card art
    e2e/              Playwright browser tests
  server/             @gravity-harvest/server: NestJS game server: runs matches (WebSocket), saves (see apps/server/README.md)
packages/
  shared/             @gravity-harvest/shared: contracts used by both: save API and the match protocol
  rules/              @gravity-harvest/rules: rules and economy generated from design/balance.xlsx, plus calculations
                      and dependencies (server side; the browser may import only /deps, code without data)
  sim/                @gravity-harvest/sim: the match simulation (fixed tick, deterministic), scenarios, the roster
                      (server side; the browser may import only /layout)
design/               balance.xlsx, the source of truth for rules and economy
art/                  original art: 3D models, concept sheets, source textures (not in git, see art/README.md)
tools/blender/        the scripts that render sprites from 3D models (buildings, units, ore)
tools/sprites/        image tools: make_scenery.py (cut-out scenery images -> scenery atlas, shadows in code) and
                      split_shadows.py (moves rendered buildings' shadows into the shared shadow layer)
docs/                 architecture notes, decisions, generated rules reference (docs/rules)
turbo.json            task pipeline (build / dev / test / typecheck / test:e2e)
```

## Rules and economy

`design/balance.xlsx` is the source of truth. After editing it, run `npm run import --workspace @gravity-harvest/rules`
to regenerate the typed rules (`packages/rules`) and the reference docs (`docs/rules/`).

## Original art

All source art is kept in **`art/`**: the Meshy 3D models (`.blend`), our edited working models, the concept sheets
and the source textures. It's about 2 GB, so it is **gitignored** (only `art/README.md` is tracked) and needs its own
backup. See [art/README.md](art/README.md) for what each file is and which sprite it produces.

## Tests

- **shared**: contract validation.
- **rules**: the import is up to date with the spreadsheet, every reference is valid, and the calculations and
  dependency helpers give the spreadsheet's numbers.
- **sim**: the economy loop, placement, production queues, power, combat with the damage matrix, fog filtering
  (what each player is told), victory / defeat, save round trips, determinism, pathfinding, legal maps.
- **game** (Vitest): geometry, event bus, depth sorting, and content checks (everything in the roster has art).
  `npm run build` also checks that no rules data reached the browser bundle.
- **game** (Playwright): the real game against a throwaway game server: start position, fog of war, harvesting,
  building placement, prerequisites and the production queue, combat, the menus, saving, loading, autosave and
  Continue, victory and defeat.
- **server** (Vitest + supertest + ws): saves API, and matches played over the socket (orders, malformed messages,
  pause, save and resume, autosave on disconnect, game over, origin checks, debug commands off).

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit, [docs/ADDING_CONTENT.md](docs/ADDING_CONTENT.md)
for adding units, buildings and maps, and [docs/DECISIONS.md](docs/DECISIONS.md) for why things are the way they are.
