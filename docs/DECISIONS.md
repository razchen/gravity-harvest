# Decisions

Why things are the way they are. Add an entry when a choice is made that a newcomer (or future you) would
otherwise undo by accident. Newest first within each section.

## Game and look

- **Classic isometric RTS for the browser.** Fixed camera that never rotates; pre-rendered 2D sprites, not real-time 3D.
  *Why:* a fixed camera lets every model be rendered once at studio quality (lighting, shadows, smoke) and drawn
  as cheap sprites, so very heavy models (Meshy exports are 1–3 million faces) cost nothing at runtime and
  hundreds of units stay fast.
- **Engine: Phaser 3** (pinned 3.90.0). Mature 2D framework with sprites, animation, input, cameras, loading.
- **Projection: 2:1 isometric diamonds.** One tile is 64 × 32 px on screen at zoom 0.5.
  Art is rendered at 2× (128 × 64 per tile), so it's pixel for pixel at zoom 0.5 on a Retina screen.
- **Default zoom 0.67 (a tile about 85 × 43 on screen), closest 0.75.** At 0.5 soldiers were too small to tell
  apart; the sprites stretch a little past 0.5, which reads as slightly soft, not blocky. If that bothers, re-render
  the art larger rather than zoom back out.
- **Sprite camera: orthographic, 45° yaw, 30° down.** That angle produces exact 2:1 diamonds. Every sprite must
  use it, plus the same sun and world lighting, so everything matches.
- **Retina:** the canvas renders at the device pixel ratio (capped at 2) so full-resolution art is shown rather
  than upscaled.
- **Zoom:** starts at 64 × 32 tiles; the mouse wheel zooms between 0.25 and 1.5. A fixed-zoom version was tried and
  rejected: soldiers were too hard to see.
- **Infantry are drawn at 3× real size** (vehicles and buildings at true scale). Common RTS exaggeration; at true
  scale soldiers were unreadable. They're rendered at 1.5× resolution to keep the sheet within 4096 px.
- **Directions:** vehicles 16, infantry 8. Direction 0 = world +X, counter-clockwise seen from above.
- **Ground: one texture, Dry Earth, tiled flat on screen** (not rotated or squashed into the isometric view), one copy
  per 512 world px (4 tiles wide), using mipmapped images. *Why:* dirt seen from above has no direction, and
  skipping the isometric warp keeps it as sharp as the source file. Blending two textures (with Rocky Dirt) was
  tried and dropped; very large copies (24 tiles) were too blurry when zoomed in.
- **Smoke is white**, not black (refinery and power plant).
- **Team colours mean yours and theirs, not a seat:** your buildings and units keep their rendered colours, the other
  side's are the same models tinted red (`SIDES` in `apps/game/src/data/teams.ts`), whichever seat you play.

## Gameplay

- **The computer plays fair, at every difficulty** (`packages/ai`). It sees only its own side's fog-limited view and
  the events the sim already sends that side, and acts only by giving the same orders a player gives (place, train,
  move, attack, harvest, dock, service, repair, deploy...). No bonus income, no map reveal, no reading the Sim, no
  spawning units. *Why:* an opponent that cheats feels unfair once noticed, and a fair one can be measured against
  itself (the simulator). The old raids that spawned riflemen from nothing are gone.
- **Difficulties are Easy, Normal and Hard, and differ only in mistakes:** one profile of tunable rates per level
  (`packages/ai/src/profiles.ts`): how often it thinks, reaction delay, orders per minute, forgetting production,
  buildings, power or idle harvesters, slow rebuilds and repairs, careless placement, unit mix and counter-picking,
  attacking too small or blind, focus fire, retreats, defending late, scouting, and chances to skip a decision. Same
  code paths, rules and income for all; a seeded RNG keeps matches reproducible. Normal is the default. Tuned with the
  simulator so Hard beats Normal and Normal beats Easy most of the time in both factions.
- **The AI never names a unit.** It chooses its army from its side's catalog by role and stats (damage × health per
  credit against what it has seen of the enemy, what its weapons can hit), so the roster can change (infantry is being
  replaced by flying units) without touching it. It only knows the IDs the sim itself gives behaviours to.
- **A careful AI doesn't attack blind:** without a recent look at the enemy's army it assumes the enemy has kept up
  with it, so Hard waits for scouting (or a won defence) before sending a wave; Easy attacks on the timer with
  whatever it has.
- **What the simulator taught the AI:** production (one queue per side) is the limit, not money, so the careful
  levels add harvesters only when money will run short: when the ore it knows of can keep another busy, each one
  earns its price back within 3 minutes, and at full production its money would run out within its look-ahead
  (`economyLookaheadMin`: Easy 1, Normal 3, Hard 5 minutes). *Why not cash in hand:* the old rule (one more below
  $12,000 at Normal) fired whenever a side bought a factory, so Ordan, whose army comes from a $3,000 Motor Works,
  put a harvester in its queue at minute 2 and met the first wave with a smaller army; it lost three Normal matches
  in four to Sable and won at Hard, where the threshold was $5,000. Under attack or far behind (its army under half
  the enemy's it saw in the last minute), the army comes first (`armyFirst`): no harvesters, and one waiting in the
  queue is cancelled; lost harvesters are replaced once it's safe. Spare money goes into defences (one goes up beside
  the building under way). Out of ore and money, they sell what they can spare and attack with what they have, so matches end
  instead of stalling.
- **Skirmish layout:** 88 × 48 map (about the old 64 × 64's area), the bases in the top and right-hand corners along
  the same edge, mirror images left to right (tile tx ↔ 87 − tx), each with its own ore field next to its refinery
  (the second field is the first's mirror image, tile for tile and density for density), the landscape grown on the
  left half and mirrored onto the right (`mirrorX`), and a gravity vent on the mirror line between them. The yards are
  82 tiles apart and the vent 42 from each, as before. Both sides start alike: an Assembly Yard, a Power Plant, a
  Refinery with its harvester, two riflemen and the spreadsheet's starting credits. *Why this mirror:* the sprites
  face one way, so every refinery ramp and every building's exit faces +gy. Mirrored through the middle (top corner
  against bottom corner, as it was), the bottom base's ramps and exits faced the map edge: its harvesters drove 25%
  further to their ore and the vent, its units came out the back, it had less room, and its 5-minute income was 86%
  of the top's. Drawing the bottom base's buildings mirrored isn't possible: their light, shadows and the harvester's
  unload clip are rendered for one side. *Why 88 wide:* mirrored this way on 64 × 64 the bases were 58 tiles apart,
  and as they grew towards each other the armies' gathering points came within reach of each other's defences: they
  wore each other down in the middle instead of attacking, and Hard Ordan won 16% against Hard Sable. The computer
  guesses the enemy is by the ore field farthest from it, and scouts there first.
- **A headless simulator** (`npm run simulate`) plays AI against AI as fast as the CPU allows and answers: is the
  pacing right, is it fair (factions, start positions), is it fun (lead changes, comebacks, fights, variety), how far
  up the tech tree they get, what limits them, and whether the ore makes sense; plus a verdict per map. The targets
  are one editable file (`tools/simulator/src/targets.ts`). Who is ahead is army plus defences (cost × health
  share), not the whole base: base value was 70% of the old measure and hardly moves with the fights that decide
  matches. It's judged from the first real fight on, and the fun numbers (lead changes, comebacks, lock-in) come
  from same-level matches only, since a level against the one below is meant to be one-sided. A comeback is a win
  by the side behind just after the first big fight ($3,000 lost), not at a fixed minute 10.
- **Fog of war, three states:** black = unexplored, dimmed = explored, clear = in sight. Enemy units only show while in
  sight; enemy buildings stay on the map once discovered.
- **Power:** 500 base supply, +100 per power plant; other buildings draw power. Low power doubles refinery unload
  time and takes the radar offline.
- **Radar is required for the minimap.** **Storage:** 3,000 base, plus 2,000 per refinery and 3,000 per silo.
- **Rocks disappear quickly when mined** (kept fast on purpose for now, to see the loop working).

- **No soldiers: small hovering units instead.** Every unit that was a soldier is a hovering craft (render_vehicle.py
  `hover`; the `hover` capability). They keep the soldiers' rules and balance: they board transports, a Service Bay
  doesn't repair them, and their spreadsheet numbers are unchanged; only their bodies are bigger (`hoverRadius`). The
  units both sides share are built to each side's own design (`sides` in the game's art), buildings are not.
- **Medics heal, Engineers repair.** A Medic heals its side's damaged soldiers and hovering units nearby (its heal is
  the rules' negative-damage weapon), an Engineer repairs its side's damaged buildings from outside, for free; both look
  for work on their own and can be sent to it, and their arms work while they do (`work` in the view).

## Menus and saves

- **Menus are DOM screens over a live backdrop scene,** styled like the HUD (same panels, fonts, yellow accents).
- **Autosave:** one slot per player and map, overwritten, counted in game time so it doesn't fire while paused. Default every
  2 minutes; configurable (1 / 2 / 5 / 10 min or off). Also saves on quit to menu and when the tab is hidden. The
  autosave of a finished match is deleted so Continue never resumes a game that's over.
- **Saves are marked `manual` or `auto`** in the API (shared contract); manual saves can be overwritten from the Save screen.
- **Victory and defeat** open an end screen with stats and Play Again / Load Game / Main Menu, after a 2.5 s beat.

## Art pipeline

- **Factions look different, play the same (for now):** Ordan is pale ceramic with violet energy, precise and
  symmetrical; Sable is charcoal gunmetal with orange heat, heavy and angular; shared buildings keep off-white,
  yellow and electric blue. Blue = shared, violet = Ordan, orange = Sable, everywhere. Full brief and the emblems:
  [FACTIONS.md](FACTIONS.md).

- **3D models from Meshy, concept sheets from ChatGPT,** rendered to sprites by the scripts in `tools/blender`.
  Originals live in `art/` (gitignored, about 2 GB; see `art/README.md`).
- **Buildings are stacked transparent layers:** body (with baked ground shadow) + looping overlays (smoke, steam)
  + beacons placed from `meta.lights`. Each atlas JSON has a `meta.anchor` at the footprint's ground centre.
- **Animated parts are split out of the fused Meshy mesh** (harvester wheels, radar dish) by finding them with
  ray-cast scans, keeping their UVs.
- **Cycles on the Metal GPU, GPU only** (hybrid CPU + GPU was slower). Metal sometimes renders a black frame;
  the scripts detect and re-render those.

## Code and repo

- **TypeScript + Vite, monorepo with npm workspaces + Turborepo:** `packages/shared` (contracts), `packages/rules`,
  `packages/sim`, `packages/ai`, `apps/server`, `apps/game` and `tools/simulator`. The save API and match protocol
  are in `shared` so client and server can't drift.
- **Assets aren't in git (2026-10-18).** Sprites, sounds and music (about 200 MB, regenerated often) live in the
  public S3 bucket `gravity-harvest-assets`, one immutable folder per version; `apps/game/assets.json` names the
  version and is the only thing committed (`npm run assets:push` / `assets:pull` / `assets:status`). A build loads
  from S3 and ships no assets; the dev server uses the local folder. *Why:* hundreds of megabytes of regenerated binaries
  don't belong in git history, and a versioned folder never changes, so it can be cached forever.
- **CI on every pull request and push to `main`** (`.github/workflows/check.yml`): `npm run check`, then the e2e
  tests, after pulling the assets.
- **The command validator is typed over every command** (`COMMANDS` in `apps/server/src/match/protocol.ts`, keyed by
  `Command['c']`): a new command without a check is a compile error, not a hole.
- **The Sim is a facade over systems (2026-10-18).** `sim.ts` only schedules; the state is one `SimState` and each
  mechanic is a file of plain functions in `packages/sim/src/systems/`. A fighter's mechanics are separate parts
  (interfaces) whose fields sit flat on the unit, so saves stay plain JSON. Units are looked up by cell and buildings
  by team (`spatial.ts`), returning the same results in the same order as a full scan, so the match doesn't change.
  *Why:* a 2,300-line class was hard to change safely, and the scans made a tick with about 100 units a side three
  times slower (3.1 ms against 1.0 ms in a big fight).
- **The computer player is a coordinator and managers** (`packages/ai`: economy, base, production, army, scouting)
  sharing one `Brain` and one JSON-safe `AiState`, so it can be saved. `regression.test.ts` pins hashes of whole
  matches' order streams: a refactor that changes how it plays fails it.
- **One art registry per entity** (`apps/game/src/data/registry.ts`): the atlas list, the art tables and the dev pages
  derive from it, with atlas and card names by convention. *Why:* adding a unit took about seven hand edits spread
  over the manifest, the art tables and the dev pages, and a building with no footprint quietly became 3 × 3 (now
  `footprint()` throws, and a test checks each footprint against its stage config).
- **Everything on TypeScript 6** for now (the NestJS 12 toolchain doesn't support 7 yet).
- **Backend: NestJS + SQLite** (better-sqlite3 via TypeORM) for saves; port **4310** (3001 is taken by an SSH
  tunnel on the dev machine). Vitest instead of Jest (Nest 12 is ESM-only, and Jest can't load it on Node 22).
- **The HUD is plain DOM** talking to the game only through `HudBridge`; no UI framework yet.
- **Tests:** Vitest for logic and content integrity, Playwright for the real game in a browser (against a
  throwaway in-memory backend) and a smoke test of the dev pages, Vitest + supertest for the API.
- **Dev pages import the full rules and sim.** That's fine only because they're never built (the build's one entry
  is `index.html`); the game itself must not.

## Rules and protection

- **`design/balance.xlsx` is the source of truth** for rules and economy. `packages/rules` imports it into typed
  data plus generated docs (`docs/rules/`). Nobody hand-copies a number; the package's tests fail if the generated
  files are out of date with the spreadsheet, or if any reference (prerequisite, producer, weapon, damage class)
  is broken.
- **Calculations and dependencies live in one place:** `calc.ts` (damage after armor, DPS, refunds, repairs, power,
  loads, movement) and `deps.ts` (prerequisites, producers, unlocks, build order).
- **The match runs on the server** (authoritative simulation in `packages/sim`; the browser sends orders and draws
  what it is sent). Anything shipped to a browser can be read, so this is the only real protection for the rules,
  and it is also the foundation for multiplayer, anti-cheat, replays and spectating.
- **The browser gets no rules data at all.** With each match the server sends a catalog of the enabled roster
  (names, costs, build times, power, prerequisites: what the HUD shows anyway). The browser imports only code
  (`rules/deps`, `sim/layout`); a build check fails if rules data shows up in the bundle.
- **Behaviours are capabilities, not IDs (2026-10-18).** What an entity does beyond its numbers (harvester,
  refinery and what it `grants`, `repairsVehicles`, `constructs`, `radar`, `deploysInto`, `turret`, `hover`, `heals`,
  `fixes`) is one hand-written table, `packages/rules/src/capabilities.ts` (browser-safe, also in `rules/public`). The
  sim, placement, the AI (`ENGINE_IDS`) and the browser ask for a role; `TURRET_UNITS` and `HOVER_UNITS` are derived
  from it. *Why:* a second refinery or a faction's own harvester should need a table row, not a hunt through `if
  (type === ...)`. The spreadsheet holds numbers, not engine behaviour, so the table lives next to it.
- **The full roster is data, not content:** only entities with art are enabled (`ROSTER` in `sim/layout.ts`), with
  explicit stand-ins (`STAND_INS`) for missing tech-tree links, now empty: every base starts with a real Assembly Yard
  and harvesters come from the Motor Works. The rest stay in the spreadsheet and are never sent to players.
- **Every model goes into matches when it's rendered**, with whatever behaviour it needs, not only onto the dev pages.
- **Each shot uses the weapon that reaches the target** (`weaponFor` in `rules/calc.ts`): the first of the unit's
  or building's weapons whose rules targeting covers the target's layer (aircraft are in the air, everything else,
  buildings too, on the ground). A Lancer fires its anti-armour missile at vehicles and its anti-air one at aircraft;
  something with no weapon for a target doesn't pick it, and an order to attack it is dropped. Range is that
  weapon's. *Why:* before, the first weapon fired at anything, so anti-air missiles hit tanks. The qualifiers in the
  targeting text ("personnel", "armor", "light targets") don't restrict anything yet; only ground or air does.
- **Defences** shoot the nearest enemy unit in range with their rules weapon (those that need power hold fire when
  it's low) and turn their head to face it (16 directions, sent as `facing`). Shots (units' too) carry the weapon's
  projectile, so each looks different: bullets, a shell, a fireball, a discharge bolt. Shells and fireballs burst
  (`render/Impact.ts`) just in front of what they hit, which flashes white-hot for a moment; on open ground they kick
  up dust and leave a scorch mark that fades. The bursts are stylised rather than photoreal (Kenney's painted puffs
  and particles, CC0, packed by `tools/sprites/pack_impacts.py`); the looks are compared on `/dev/fx.html`.
- **You pick your side** on the New Game screen (remembered); the computer plays the other. A scenario's starting
  buildings that belong to the other faction become the owner's counterpart (`FACTION_COUNTERPART`). Saves keep each
  side's faction. The faction names come from the server's scenario list, so they stay out of the game's code.
- **Vehicles** are rendered whole in 16 directions (`render_vehicle.py`), so a tank turns its hull to aim. One with
  a rig (a `.blend` of its model with a `wheel_<n>` empty per axle and a `turret` empty, `rig` in `vehicles.json`)
  gets its wheels spun about their real axles, and its turret as a layer of its own (32 directions) over a hull
  rendered without it: the sim aims it at what the vehicle shoots (the `turret` capability, sent as `aim`) and the hull keeps
  its heading. The Jackal is the first. Units' sheets are trimmed and packed tightly (`tools/sprites/trim_pack.py`),
  which keeps 16 directions in the memory 8 used to take. Units turn through the in-between directions rather than
  snapping. Abilities so far: combat vehicles fight with their rules weapons, and the Assembler deploys (E) into an
  Assembly Yard anywhere it fits, and the Carrier carries infantry (below); the Watcher's radar disruption, the
  Shroud's concealment and the Seeder's mines aren't in yet.
- **Transports** (any unit with `passengers` in the rules; the Carrier holds 5): click (or right-click) your
  transport with soldiers selected and they walk to its nearer side door, following it if it drives off, and get in
  one at a time; when it's full the rest stop by it. Inside they're off the map (not drawn, seen, selected or
  targeted, and they don't see), kept with their health in the transport (and in saves, snapshot version 6), and
  count towards the unit cap. Unload (the HUD button that shows while one is selected, or E) stops it, opens its doors
  and lets them out one by one onto free tiles by the door on the camera's side (the other if there's no room). If it's
  destroyed they die with it, counted as losses and kills. The sim decides who goes in or out and when (`hatch`,
  `boarded`, `disembarked` events); the game plays its door clip (`v_carrier_door`) and draws each soldier running up
  the ramp into the doorway, fading out, or coming down it, fading in. The ramps' feet and doorways are read from the
  clip's shut and open frames per direction (`render/ramps.ts`, shared with the dev unit page).
- **Buildings animate from their own parts:** a construction config's `anims` name groups of parts that spin (whole
  turns per loop), swing, or (a `door`) slide or swing open. Motion that needs real joints is keyframed in Blender
  instead: with `rig` the model is loaded from its `.blend` (empties carrying the parts, as the Service Bay's roof
  arms), and an anim naming those empties samples that timeline. The finished building is rendered once without them, and
  each animation's parts alone per frame with the rest holding them out, so the frames are small and trimmed. An
  animation runs `always` (while powered), while `working` (the server sends `working`: producing, repairing a vehicle on its pad, or the
  Assembly Yard while its side builds), or is a `door` (opens on `unitOut`, when a unit comes out). Its `effects`
  (steam, flames, glows, blinking lights, sparks and dust while working) are points rendered from the model and drawn
  by the game (`render/BuildingFx.ts`). Which parts move was mapped per building from the models (only real separate
  parts: the Refinery's and Motor Works' bays have no door panel, so they'd need one in a future model).
- **Low power** halves construction, production and unloading, takes the radar offline and silences defences that
  need power; your buildings that use power blink a lightning bolt while it lasts.
- **Selling** gives back the spreadsheet's `refundFraction` (half); **cancelling** a building under construction or
  a unit in production gives back all of it (nothing was used yet).
- **Repairs** cost as they heal: a full repair costs `structureFullRepairFraction` (buildings) or
  `unitFullRepairFraction` (vehicles at a Service Bay) of the price, and stops when the money runs out. A building
  goes from nothing to full in `ENGINE.repairSecondsForFull`; the HUD's Sell and Repair buttons are modes, as in the
  classics: they stay on until right-click or Esc.
- **Service Bays** repair only the vehicle parked on their pad (`ENGINE.repairSharePerSec`: 4% of their health a
  second, paid as `unitFullRepairFraction` of the price for a full repair, the same rule as buildings). Clicking or
  right-clicking your bay with damaged vehicles selected (the cursor turns into the repair wrench) sends them onto its
  pad (`serviceBayPad` in `sim/layout.ts`), one at a time: it backs on nose out, as onto a refinery's ramp, is repaired
  to full (or until the money runs out) and drives straight off; the others wait by the bay, each on a tile of its own
  (not repaired while they wait), and take the pad in turn. Undamaged vehicles in the selection just
  drive to the bay. The spreadsheet says the bay doesn't need power to work (`requiresPower` is false) but it draws
  150, so on low power it repairs at half speed, as other buildings slow down. Harvesters can't be sent onto the pad yet, so
  they aren't repaired. The pad needs open ground in front.
- **Units keep apart and move in groups.** Units sent to one point get a tile each around it (`formation`, sim `systems/collisions.ts`): as
  compact as the ground allows, keeping their places in the group (a group spread wider than
  `ENGINE.formationSpread` × √size from its middle closes up), skipping blocked tiles, tiles cut off from the point and
  tiles others stand on or are heading to. The browser sends the clicked point for every unit; the server decides. A
  single unit still goes exactly where it's sent. Bodies are circles (`ENGINE.vehicleRadius` 0.45 tiles, about a tile
  across; soldiers 0.3): a unit driving into one that won't give way (on the move, at work, held in place) steers round
  it to its right, and keeps its distance behind one going the same way, so a group drives as a block; overlaps are
  eased apart, the idle unit giving way most, so a unit driving through nudges an idle one aside, and that one goes
  back to where it stopped once the spot is free. Units on a ramp or pad, unloading, or at a transport's door hold
  their place; soldiers boarding a transport pass through others, as before (infantry is on its way out). A unit that
  makes no headway for `ENGINE.stuckMs` paths round whoever is in its way (`ENGINE.detours` times), then settles on the
  nearest free tile, so a crowd in a choke point waits its turn instead of shoving. All of it is transient (nothing
  new in saves). Attack-move uses the same formation (see Controls).
- **The spreadsheet is committed** (private repo; the concern is players, not the repo). The reader is a small
  script on `fflate`, because the workbook's namespaced XML breaks common xlsx libraries.

## Server-run matches

- **Fixed 50 ms tick, views every 100 ms** over one WebSocket per match (`/api/match`, same server and port as the
  API). The browser glides units between views and shows order markers and the placement preview locally, so the
  round trip isn't felt. Fog is only resent when it changes.
- **No lockstep: multiplayer is server-authoritative (2026-10-18).** The server runs the only real copy of a match;
  each client sends commands and receives its own seat's fog-filtered view, as a single player does now. *Why:*
  lockstep (every browser running the same sim from the same orders) would need bit-identical results on every
  machine, and JavaScript doesn't guarantee identical floating-point results across browsers and engines; it would
  also send every client the whole match state, fog and all, so anyone could read the enemy's positions and credits.
  The server already has to run the match to protect the rules.
- **Deterministic simulation:** a seeded RNG in the match state, no timers or `Math.random`, so the same start
  and orders give the same match (tested). Used for saves that play on exactly, replays and tests, all on one machine;
  not for running a match in several browsers (above).
- **One match, one room; connections come and go (2026-10-18).** A `MatchRoom` (`apps/server/src/match/match-room.ts`)
  owns the Sim, the tick loop, the computer players, the command queue and autosaves; a `SeatConnection` per socket
  attaches to a seat and detaches again. *Why:* tying the match to a socket ended it on every network blip, and a
  second human seat needs the match to outlive any one connection.
- **Every order waits for the next step (2026-10-18).** Human and computer orders go into one `CommandQueue` and are
  applied at the start of the next step, sorted by arrival tick, then seat (`a` before `b`), then arrival, and logged
  as `{ tick, team, cmd }`. Debug commands apply at once and are logged too. *Why:* an order applied the moment it
  arrived landed mid-tick at a time that depended on the network, so the same orders didn't always give the same
  match, and nothing could be replayed. The start plus the log is a `MatchRecord` that `replay()` plays back exactly.
- **Looking never changes the match.** `Sim.view` is pure; events leave the sim only through `Sim.takeEvents(team)`,
  called by the room after each step, and a `TeamFeed` per viewer adds the events since its last view and the fog when
  it changed. *Why:* when building a view also emptied its events, how often a side was looked at decided who got
  which events, and a view couldn't be built just to look.
- **Seats, not player and enemy (2026-10-18).** The sides are `a` and `b`; the hello says which you play (`you`) and
  each side's faction. *Why:* naming one side "player" hard-wired the human to the first base and made a second human
  impossible. Older saves are migrated (`player` → `a`, `enemy` → `b`).
- **Saves are written only by the server's match.** `POST`/`PUT /api/saves` are gone (a client that can upload a
  state can give itself any credits) and `GET /api/saves/:id` returns the summary, never the state. The client asks
  over the socket and adds a thumbnail. Old browser-format saves (version 1) can't be loaded.
- **Autosave and reconnect on disconnect:** a dropped connection mid-match autosaves on the server (if autosave is
  on), pauses the match and keeps it for `RECONNECT_GRACE_MS` (60 s by default); the same player id can `rejoin`, and
  the client retries with backoff by itself. Leaving on purpose (quit, load, new game) sends `end` first, so it
  doesn't; quitting saves explicitly.
- **Saves carry on the match exactly (2026-10-18).** A save (snapshot version 11) holds everything the match is:
  every unit's orders, path, timers and trip, the full fog, each side's memory of enemy buildings, power, the RNG,
  plus each computer side's seed and memory. *Why:* a save used to keep only where things stood, and loading reset every
  unit's behaviour (and, before version 10, the computer's memory), so a loaded game was a different match and a
  replay from a save couldn't be trusted. Older formats load through a chain of migrations
  (`MIGRATIONS[n]`: version `n` → `n + 1`, `packages/sim/src/migrations.ts`), each tested against a stored fixture.
  A save made under other rules (`rulesHash`) or an earlier map (`scenarioHash`) loads with a warning rather than
  being refused: an old save that plays slightly differently is better than a lost one.
- **Saves belong to an anonymous player id (2026-10-18).** Each browser makes a random UUID once and sends it with
  every request; saves are listed, read, loaded and overwritten only by that id, and saves from before owners existed
  are hidden. *Why:* everyone on a server saw (and could delete) everyone's saves. It's not a login; accounts can
  replace it later.
- **The database schema is owned by migrations (2026-10-18)** (`apps/server/src/database/migrations`, run on every
  start). `synchronize` is off in production. *Why:* `synchronize` was on even in production, where it changes tables
  to fit the entities with no record and can lose data. The first migration uses `IF NOT EXISTS`, so databases made by
  the old `synchronize` adopt it and keep their saves.
- **Debug commands** (set credits, reveal, teleport, spawn, destroy a side, fast-forward, finish builds) exist for
  development and tests only: on unless `NODE_ENV=production`, forced with `DEBUG_COMMANDS`.
- **Spreadsheet numbers in play:** $15,000 start, full loads worth 1,050, no storage cap (the Silo is gone), real
  build times, a production queue, 50% refunds on cancel / sell (a queued unit that hasn't started yet gives all
  its money back: nothing of it was built), low power slows building and unloading and turns the
  radar off. Riflemen see 4 tiles and fire 3 (was 6 and 4). The enemy's guards are riflemen (the spreadsheet's Raider is a
  different, unarmed infiltrator).
- **Units pick their own fights**, but only with what their side can see (any of its units or buildings): idle units
  notice enemies within their weapon range + 3 tiles (or their sight, if larger; a rifleman reacts at 6, once
  something of its side sees the enemy) and move in. Units whose guns outrange their sight (the Spire, the Anchor)
  need a spotter. Defences fire only on what their side sees. A unit on a move order stops to fight anything that comes within
  weapon range, or that shoots it, then carries on to where it was sent. (A "force move" that ignores enemies, for
  retreating, can come later as a modifier key.)
- **Build slots and production lanes (2026-10-18).** Buildings go up from an Assembly Yard, one at a time, and one
  defence at a time beside it; with no yard, nothing new can be placed and what's going up stops until there is one
  again (a yard an Assembler is unpacking carries on, and doesn't take the slot). Units queue per kind of factory
  (soldiers, vehicles, aircraft, ships: `laneOf` in the sim), up to 5 each, and the lanes build side by side. Every
  weapon a unit or defence has fires on its own reload, as the rules' damage per second assumes. *Note:* in this
  build Sable's roster is nearly all soldiers, so separate lanes help Ordan (vehicles and soldiers at once) more:
  the simulator went from Ordan winning 40% to 85% at Normal (47% with one lane). That's the roster, not the rule.
- **Enemy buildings are seen as they were last seen.** Each side keeps a picture of the enemy buildings it has
  discovered (health, construction, power, facing) taken whenever they're in sight, and is sent that while they're
  out of it. One destroyed or sold out of sight stays in the picture until the spot is seen again. A building is
  discovered when it's in sight, not when an explored tile it stands on is. The computer gets the same views.
- **One loss rule for both sides:** a side is out when it has no buildings and no units left.
- **Esc is handled once, by the app** (`GameFlow`), not by the Phaser scene: a paused scene replays its key events
  on resume, which reopened the pause menu. The camera doesn't capture W / A / S / D, so they can be typed in fields.

## Scenery

- **Scenery is 2D images, not 3D models** (trees, rocks, bushes, logs and stumps). Static props need one frame, so
  AI-generated cut-outs work. The shadow is cast in code (`tools/sprites/make_scenery.py`) with the sprites' exact
  sun and camera, treating each slice of the silhouette as a disc, so a crown or a rock casts a round shadow.
  Images with a shadow drawn in are avoided: it wouldn't match the sun, and semi-transparent shadows don't survive
  background removal.
- **One shared shadow mask, capped at 18%, for everything that stands still:** scenery and buildings. Every shadow
  is drawn at full strength into a single render texture (half resolution, linear filtering, soft edges) that is
  shown at 18%, so overlapping shadows never get darker than that, and the light direction is the same for all.
  Scenery is added once per match; a building's shadow joins when it's finished and leaves when it's destroyed or
  sold (the layer is redrawn in one batch on the next frame).
- **Building shadows are split out of the renders** by `tools/sprites/split_shadows.py`: the baked shadow (pure
  black pixels, up to ~57%) is removed from every frame and saved as a mask (the union over an animation's frames).
  Units, harvesters and ore keep a baked shadow, since it moves with them, lightened to the same 18%. Untouched
  renders are kept in `art/sprites/baked/`, so the script can always be re-run; run it after rendering sprites.
- **A new landscape every match, grown on the server** from the match seed (`crypto.randomInt`), saved with the
  match (snapshot version 4; older saves load with their trees, or bare). Groves come from two octaves of value
  noise, positions from Poisson-disc sampling (blue noise), species from a coarser noise field with some mixing,
  dead trees mostly at grove edges. Rock outcrops are spread far apart (blue noise), each one or two 2 × 2 rocks
  with smaller rocks around, plus lone boulders. Bushes grow mostly at the edges of groves and outcrops, logs and
  stumps in the woods.
- **Trees and rocks block their tiles; bushes, logs and stumps don't.** Decoration is hidden when a building or
  growing ore covers it. Bases (8 tiles), ore (2 tiles) and starting units stay clear of blockers. Roads are cut
  three tiles wide between the bases and from each base to the ore, through the gaps, so a map is always playable
  (tested on many seeds).
- **Base decals and contact shadows.** Trees and bushes are two images: the object, without ground, and a base decal
  (`<kind>_base`: dirt, roots, grass, pebbles, 1.4–1.7 tiles wide under a tree, about 1 tile under a bush). The decal
  lies flat on the ground (`DEPTH.groundDecal`, under every shadow, so cast shadows fall onto it), follows its object's
  position and scale, and is hidden with it. Where the trunk or stem meets the ground there is a contact shadow
  (`<kind>_contact`: a soft 2:1 ellipse, sized from the trunk's width, or about half a bush), drawn into a second
  ShadowLayer shown at 40%, above the cast shadows, so contact shadows never stack either. With the ground in its
  own image, the object is anchored exactly at its trunk, its cast shadow starts there, and the ground patch sits
  under neighbouring trees and shadows instead of being drawn over them.
- **More scenery: rubble, wrecks, grass and flat decals.** One to three rare abandoned sites per match in the field
  (and often one past the edge), placed before the trees so they get a clearing: a wreck (2 × 2) with two to four
  rubble piles, an oil stain next to it and sometimes a scorch mark, at least 10 tiles from the starting buildings and
  6 from the ore. Roads go around a site if they can (its ground costs extra, the tiles next to its wreck as much as a
  tree). Rubble also comes in small clusters, mostly next to rock outcrops. Wrecks and rubble block, like rocks. Grass
  has its own noise field: patches (a cluster with tufts around it) where it's high, and single tufts at grove edges
  and in the open; about 650–900 pieces per match, field and margin. Flat decals (`flat: true`: craters, scorch marks,
  oil stains, ore bits) lie on the ground at `DEPTH.groundDecal` with no shadow; iso art can't be rotated, so they're
  mirrored by id for variety. A few craters and scorch marks are pre-placed in the open, ore bits around and under
  each ore field. The browser adds its own (cosmetic, not saved): a scorch mark sized to the footprint where a
  building burns down (and often a crater for a big one), an oil stain where a harvester dies, and `ore_scar` on ore
  tiles with no rocks left.
  - Ground patches (`dirt_*`, `gravel_*`, `cracked_*`) break up the tiled ground texture: about 90–100 dirt patches
    per match (field and margin, blue-noise spaced), 15–30 gravel patches by rocks, rubble and roads, 15–25 cracked
    earth in dry open ground and by sites; off ore (and 2 tiles around it) and the starting buildings. They're
    softened in the script (feathered edge, toned to the ground texture) and drawn under the other flat decals
    (`flatLayer`: dirt, then gravel and cracked earth, then craters, stains and ore bits).

## Controls

- **Attack-move is Ctrl+right-click; build panel hotkeys are Tab and Alt+number.** WASD stays camera panning, so
  attack-move has no letter key: Ctrl+right-click on the ground (Ctrl+click on macOS, where it is the right-click;
  over an enemy it's a plain attack), with a red sight cursor while Ctrl is held. The sim's `attackMove` order uses
  the move formation; on the way armed units look as far as idle ones (sight, or range + margin), buildings too
  when no unit is near, stop to fight, let go of what gets out of that reach, and carry on. Tab / Shift+Tab cycle
  the panel's tabs; Alt+1 … Alt+0 press its first ten cards like a click, read from `e.code` (Option+digit types a
  character on macOS); plain digits stay control groups.
- **Zoom is on the keyboard:** hold + / − (or the numpad keys), Z resets (0 was taken by control group 10). The mouse wheel doesn't zoom.
- **A debug and shortcuts panel** (` key or the gear button) lists every shortcut with its state: fog of war (dev
  servers only), tile grid, performance readout, zoom. Items can be clicked.
- **Clicks prefer units over buildings:** Phaser only reports the top-most object under the cursor, which hid a
  soldier standing behind a building, so the click goes to the unit whose body is nearest the cursor first.
- **Shadows are drawn in one batch** (`RenderTexture.draw(list)`): drawing ~450 props one by one cost a GPU pass
  each and froze the browser for seconds when a match started (15 s in the software-rendered test browser; 2 s
  for the whole start after the fix).
- **The camera stays over the field:** the centre of the view is clamped to the field's screen-aligned bounding box
  (not the diamond: clamping to the diamond made the view slide diagonally along its sides at an edge), for keys,
  right-drag and minimap jumps alike. The box's corners look out over the land around the field.
- **Scenery carries on past the field too,** so the field's diamond doesn't show in the woods: the server grows the
  landscape over the field plus a 16-tile margin from the same noise (a grove crossing the edge just continues;
  tested), a little thicker far out. Outside it's scenery only: no clearings, no roads, never reached, and it
  never blocks a tile of the field (lookups outside the map are guarded: tile keys would alias tiles inside).
  About 1,500–2,200 props per match in all; a match is ready in ~0.1 s.
- **The land carries on past the field:** the ground is drawn 30 tiles past the edge. Fog of war continues over
  it: each edge tile's state is carried outwards, never brighter than "explored" (a hint that play stops there; a
  visible edge eases into it over 3 tiles, so there's no line), fading into darkness over 22 tiles. Close up the world just continues; zoomed out at a corner it fades softly
  into the dark (the page background is black to match). The outside fog is drawn as strips per edge tile, not
  per tile, so it costs less than a millisecond.

## Ore

- **Ore is a density per tile, and it grows** (numbers in the spreadsheet's Economy sheet; the engine only decides
  how it looks). A full tile holds 12 units, shown as up to 3 rocks of 4, so a tile thins rock by rock. Fields start
  at 75% of full on average (full in the middle, thinner at the edges). Every 20 s growth tick:
  - a partly harvested tile has a 20% chance to gain a unit, up to full (`resource_growth_chance`);
  - an emptied tile next to one at least half full has a 25% chance to start again (`resource_spread_chance`);
  - an emptied tile at the heart of the field (its roots, the richest ~quarter) has a 10% chance to grow back on its
    own (`resource_root_regrowth_chance`), so a field thins but never vanishes.
  Fields never grow past their original tiles, nor under a building.
- **Why:** with 4 units per rock and no real regrowth, the home field (172 units, ~6 loads) was gone in 2.7 minutes.
  Now it has ~470 units (~17 loads; the fields are a little bigger, radius 4.3): one harvester thins it over ~8
  minutes, leaves for a full field, and the home field grows back to full in ~12 more; two harvesters earn ~60% more
  over 25 minutes. Measured in `packages/sim/src/ore.test.ts`.
- **Gravity vents keep the late game fed.** Before them every simulated match's economy died: Skirmish's two home
  fields (about $36,600 of ore against $15,000 starting credits) ran dry at 6.5–8 minutes and median income was $0
  from minute 10. A vent (`ScenarioDef.vents`, the `gravity_vent` scenery kind, 2 × 2, blocks) rings itself with a
  field of its own (`ENGINE.ventOreRadius` 3.6: about 34 tiles) that follows its own rules (`Ore.feedVents`): every
  growth tick each tile below full gains a unit with `ENGINE.ventGrowthChance` (20%), emptied ones too, and an emptied
  tile touching the vent always starts again; the normal growth, roots and spread rules skip it. One harvester working
  it from a home refinery 30 tiles away earns about $1,260 a minute for 20 minutes and more (a fresh home field gives
  one about $2,100); a second adds only about $180, as they share what it seeds (`ore.test.ts`). In the simulator the
  median side's income from minute 15 to 30 went from $0 to $600–950 a minute, and matches got longer (median 15.3 →
  18.5 minutes, timeouts 4 → 7 of 160). The ring is the same on opposite sides of the vent, so a vent between mirrored
  bases is fair. The numbers are engine constants in `layout.ts` for now; they could move to the spreadsheet's Economy
  sheet. *Why a map feature, not a rules change:* the late game needs a reason to fight over the middle; more ore at
  home would only make the snowball slower.
- **The computer sends its army to a gravity vent the enemy is harvesting** (an enemy harvester seen within 6 tiles of
  it in the last 30 s; the army gathers there instead of in front of its base). It harvests the vent like any ore it
  has seen once its home field runs low. Gathering at a vent its own harvesters work as well was tried and dropped:
  armies parked in the middle and more matches ran out of time.
- **Harvesters go for tiles worth the trip** (at least half full), in their own field first, then any field; only
  crumbs if nothing else is left. Otherwise they'd scrape single regrown units off an exhausted field forever.
- **Ore is drawn flat on the ground** (browser only; the server's model is unchanged): one decal per tile from the
  scenery atlas, chosen by its density step (full: `ore_dense_*`, two thirds: `ore_medium_*`, a third:
  `ore_bits_*`, empty: `ore_scar`), crossfading as it's mined or regrows, nudged and scaled a little per tile so a
  field's edges and scars don't follow the grid. Being flat, ore never covers a harvester (the rendered rocks were
  depth-sorted like trees and could draw over it). The ore images' own dirt is see-through (`dirt_alpha`), so tiles
  don't show as darker diamonds.

## Construction

- **Buildings assemble from their model's parts.** A Tripo "parts" export gives each piece of a building as its own
  mesh; a per-building config groups them into 5 stages (foundation, lower structure, main bodies, upper, finished,
  arriving at 0 / 20 / 40 / 65 / 90% built). Every stage is rendered from the same camera and framing, so the
  footprint, scale and position never change and the last stage is the finished sprite. Generating stages as
  separate 2D images drifted (parts moved between images), and the Meshy models are single fused meshes that can't
  be split.
- **In matches** (`apps/game/src/entities/BuildingSprite.ts`): every building goes up through its stages with the
  server's build progress, smokes below half health and burns below a quarter, and blows up when destroyed (sold
  ones fade out). The roster's buildings use the Tripo models; the old Meshy versions' animations (the refinery's
  bay door, the radar's dish, the power plant's steam, antenna beacons) aren't on them yet.
- **A stage arrives in place:** its new parts fade in over 0.3 s with a few welding flashes and sparks along their
  edges, then a little dust where they land. Nothing drops or slides in. Flat deck plates mark where the next parts
  will stand and hide the holes they attach to.
- **Damage and destruction are effects in code, over the same stage renders** (`apps/game/src/render/Destruction.ts`):
  a damaged building smokes from spots on its roof (found by the atlas packer), a badly damaged one burns there too;
  destroyed, a cluster of explosions (flashes, fireballs, embers, a small camera shake) goes off over it and under
  the first flash it's gone, leaving only a scorch mark (no ruin, debris or lingering fire). Fire and smoke are particles drawn from small
  textures made in code (`fxTextures.ts`); smoke drifts with a light wind to the right.
- Review pages on the dev server: `/dev/` lists the buildings, each opens `/dev/building.html?b=<id>` with a
  Construction and a Destruction tab (not part of the game build).

## Sound

- **Sounds are made with ElevenLabs** (sound effects from prompts, `tools/audio/elevenlabs.py` with the prompt sheet
  `tools/audio/sfx_prompts.json`), with Kenney's CC0 interface sounds for clicks. Candidates go in `art/audio/`; the
  `/dev/sounds.html` page picks them for the game's slots (`tools/audio/picks.json`), and `tools/audio/pack_audio.py`
  packs the picks into `public/assets/audio` at each slot's loudness. **The ElevenLabs sounds so far were made on the
  free plan, which may not ship:** each has its prompt saved beside it, so they're made again on a paid plan before a
  release. Music needs a paid plan (the free one has no music API).
- **In matches** (`audio/Sounds.ts`): a slot plays one of its files at random, slightly higher or lower each time; a sound
  in the world is as loud as it is near the middle of the screen (fading out past its edges, silent well off it) and
  panned to its side; each slot caps how many play at once and how soon after each other. Loops follow what's going
  on: the ambience, busy Service Bays, buildings going up and the nearest few vehicles' engines. Harvesters at work
  have no loop (they run all match long, so it was constant background noise); their unloading is heard instead.
  The sound volume is in Settings.
- **Voices** (ElevenLabs text to speech, `tools/audio/voice_lines.json`): an announcer says what matters to you
  (construction complete, unit ready, low power and power restored, base under attack, a unit or building lost,
  insufficient funds), one line at a time, never twice in quick succession; each unit type answers in its own voice
  when selected or ordered (vehicle crews over a radio filter), in the voice of most of the selection, the latest
  answer cutting off the last.

## Each unit fires its own shot

- Every armed unit's shot looks different, so a fight reads at a glance: a unit's `fire` in its art registry entry
  (`data/registry.ts`) names its shot, and `data/shots.ts` gives each shot its look (one file per look in
  `render/shots/`), sounds and behaviour (the Skimmer's rapid tracers, the Carrier's heavy rounds, the
  Jackal's light shell, the Ram's battle shell, the Spire's heavy artillery, the Hound's twin plasma, the Operator's
  arc bolt, the Grenadier's frag grenade, the Breaker's column of light). The Lancer fires two homing missiles, one
  from each pod. Projectiles without a look of their own (the defences', the rules' other weapons) keep
  the older looks in `render/shots/classic.ts`. Only the look: the rules' weapons, damage and balance are unchanged (the Skimmer
  and the Carrier share one weapon in the rules but look different).
- Energy weapons take their side's colour; guns and shells don't. Everything is drawn in code from the shared effect
  sheets, no new art. `/dev/weapons.html` and each armed unit's page show the shots as a match draws them.
