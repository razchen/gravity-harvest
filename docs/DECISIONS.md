# Decisions

Why things are the way they are. Add an entry when a choice is made that a newcomer (or future you) would
otherwise undo by accident. Newest first within each section.

## Game and look

- **Classic isometric RTS for the browser.** Fixed camera that never rotates; pre-rendered 2D sprites, not real-time 3D.
  *Why:* a fixed camera lets every model be rendered once at studio quality (lighting, shadows, smoke) and drawn
  as cheap sprites, so very heavy models (Meshy exports are 1–3 million faces) cost nothing at runtime and
  hundreds of units stay fast.
- **Engine: Phaser 3** (pinned 3.90.0). Mature 2D framework with sprites, animation, input, cameras, loading.
- **Projection: 2:1 isometric diamonds.** One tile is 64 × 32 px on screen at the default zoom.
  Art is rendered at 2× (128 × 64 per tile) and shown at zoom 0.5 so it stays sharp when zoomed in.
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
- **Team colours:** enemy buildings and units are the same models tinted red for now.

## Gameplay

- **Skirmish layout:** 64 × 64 map, your base in the top corner (refinery, harvester, 2 riflemen, $2,500), the enemy
  base in the bottom corner (refinery, barracks, radar, 2 power plants, 6 guards).
- **Enemy is passive for now:** guards defend their base (chase up to 9 tiles, then return); raids are off
  (`AI.raids` in `config/game.ts`). Attacks every minute felt too aggressive.
- **Fog of war, three states:** black = unexplored, dimmed = explored, clear = in sight. Enemy units only show while in
  sight; enemy buildings stay on the map once discovered.
- **Power:** 500 base supply, +100 per power plant; other buildings draw power. Low power doubles refinery unload
  time and takes the radar offline.
- **Radar is required for the minimap.** **Storage:** 3,000 base, plus 2,000 per refinery and 3,000 per silo.
- **Rocks disappear quickly when mined** (kept fast on purpose for now, to see the loop working).

## Menus and saves

- **Menus are DOM screens over a live backdrop scene,** styled like the HUD (same panels, fonts, yellow accents).
- **Autosave:** one slot per map, overwritten, counted in game time so it doesn't fire while paused. Default every
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

- **TypeScript + Vite, monorepo with npm workspaces + Turborepo:** `apps/game`, `apps/server`, `packages/shared`.
  The save API contract is in `shared` so client and server can't drift.
- **Everything on TypeScript 6** for now (the NestJS 12 toolchain doesn't support 7 yet).
- **Backend: NestJS + SQLite** (better-sqlite3 via TypeORM) for saves; port **4310** (3001 is taken by an SSH
  tunnel on the dev machine). Vitest instead of Jest (Nest 12 is ESM-only, and Jest can't load it on Node 22).
- **The HUD is plain DOM** talking to the game only through `HudBridge`; no UI framework yet.
- **Tests:** Vitest for logic and content integrity, Playwright for the real game in a browser (against a
  throwaway in-memory backend), Vitest + supertest for the API.

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
- **The full roster is data, not content:** only entities with art are enabled (`ROSTER` in `sim/layout.ts`), with
  explicit stand-ins (`STAND_INS`) for missing tech-tree links, now empty: every base starts with a real Assembly Yard
  and harvesters come from the Motor Works. The rest stay in the spreadsheet and are never sent to players.
- **Every model goes into matches when it's rendered**, with whatever behaviour it needs, not only onto the dev pages.
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
  rendered without it: the sim aims it at what the vehicle shoots (`TURRET_UNITS`, sent as `aim`) and the hull keeps
  its heading. The Jackal is the first. Units' sheets are trimmed and packed tightly (`tools/sprites/trim_pack.py`),
  which keeps 16 directions in the memory 8 used to take. Units turn through the in-between directions rather than
  snapping. Abilities so far: combat vehicles fight with their rules weapons, and the Assembler deploys (E) into an
  Assembly Yard anywhere it fits; the Watcher's radar disruption, the Shroud's concealment, the Seeder's mines and
  the Carrier's passengers aren't in yet.
- **Buildings animate from their own parts:** a construction config's `anims` name groups of parts that spin (whole
  turns per loop), swing, or (a `door`) slide or swing open. The finished building is rendered once without them, and
  each animation's parts alone per frame with the rest holding them out, so the frames are small and trimmed. An
  animation runs `always` (while powered), while `working` (the server sends `working`: producing, repairing, or the
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
- **Service Bays** repair their side's vehicles parked next to them (`ENGINE.repairSharePerSec`).
- **The spreadsheet is committed** (private repo; the concern is players, not the repo). The reader is a small
  script on `fflate`, because the workbook's namespaced XML breaks common xlsx libraries.

## Server-run matches

- **Fixed 50 ms tick, views every 100 ms** over one WebSocket per match (`/api/match`, same server and port as the
  API). The browser glides units between views and shows order markers and the placement preview locally, so the
  round trip isn't felt. Fog is only resent when it changes.
- **Deterministic simulation:** a seeded RNG in the match state, no timers or `Math.random`, so the same start
  and orders give the same match (tested). Needed for saves now; replays and lockstep later.
- **Saves are written only by the server's match.** `POST`/`PUT /api/saves` are gone (a client that can upload a
  state can give itself any credits) and `GET /api/saves/:id` returns the summary, never the state. The client asks
  over the socket and adds a thumbnail. Old browser-format saves (version 1) can't be loaded.
- **Autosave on disconnect:** closing the tab mid-match autosaves on the server. Leaving on purpose (quit, load, new
  game) sends `end` first, so it doesn't; quitting saves explicitly.
- **Debug commands** (set credits, reveal, teleport, spawn, destroy a side, fast-forward, finish builds) exist for
  development and tests only: on unless `NODE_ENV=production`, forced with `DEBUG_COMMANDS`.
- **Spreadsheet numbers in play:** $15,000 start, full loads worth 1,050, no storage cap (the Silo is gone), real
  build times, a production queue, 50% refunds on cancel / sell, low power slows building and unloading and turns the
  radar off. The skirmish now starts with a Power Plant, since the Assembly Yard that would power the base has no art.
  Riflemen see 4 tiles and fire 3 (was 6 and 4). The enemy's guards are riflemen (the spreadsheet's Raider is a
  different, unarmed infiltrator).
- **Units pick their own fights.** Idle units notice enemies within their weapon range + 3 tiles (or their sight, if
  larger; a rifleman reacts at 6) and move in. A unit on a move order stops to fight anything that comes within
  weapon range, or that shoots it, then carries on to where it was sent. (A "force move" that ignores enemies, for
  retreating, can come later as a modifier key.)
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

- **Zoom is on the keyboard:** hold + / − (or the numpad keys), 0 resets. The mouse wheel doesn't zoom.
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
