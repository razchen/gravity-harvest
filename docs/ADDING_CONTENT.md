# Adding content

**Where art comes from:** ChatGPT generates the 2D images (scenery, decals, ground patches, cards) and Meshy makes the
3D models and animations (buildings, units). Blender only *renders* Meshy models into sprites with the game's camera
and light (`tools/blender`); we don't model, texture or animate anything ourselves, because the results aren't good
enough. When something is missing, write a ChatGPT prompt or a Meshy request; don't build it. ChatGPT makes up
to 10 images per request and Meshy up to 4 models, so ask for whole batches. Buildings now come from **Tripo** as
textured models split into parts, which is what lets them assemble stage by stage (`tools/blender/README.md`).

**Which side an asset belongs to decides its look:** blue energy for shared technology, violet for Ordan, orange for
Sable, plus each side's materials and shapes. Put that in every prompt; see [FACTIONS.md](FACTIONS.md).

**Entrances always face left.** Every building's way in and out (its doors, bay, vehicle exit, ramp) is on its
**lower-left face** as seen in the game: that's the edge of the footprint units come out of and harvesters dock at
(grid +y, the footprint's `ty + size` side). In Blender terms the entrance faces **-Y** (the game camera looks from
+X/-Y). Ask for it in every prompt ("main entrance and vehicle doors on the front-left side, as seen from an
isometric camera at the front-right corner"), and if a model still comes out facing another way, don't regenerate it:
set `turn` (90, 180 or 270, counter-clockwise seen from above) in its `tools/blender/construction/<id>.json` and it's
rendered turned. Check it on the dev page's 3D model and Picture tabs before rendering everything.

Every unit and building already exists in the rules (`design/balance.xlsx`, 33 of each). Adding one to the game
means giving it art and turning it on: no gameplay numbers are typed anywhere. A match only contains what is in
the **roster** (`packages/sim/src/layout.ts`); everything else stays on the server and is never sent to players.

## Checklist: a new building

Example: the Motor Works (`motor_works` in the spreadsheet).

1. **Model and render.** Get a Tripo model exported **with parts and textures** and put it in `art/models/tripo/`
   (gitignored). Write its stage config `tools/blender/construction/motor_works.json` (model path, atlas name
   `b_motor_works_build`, footprint; stages without a `parts` list are grouped automatically), then render and pack:
   ```bash
   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/render_construction.py -- tools/blender/construction/motor_works.json
   python3 tools/sprites/pack_construction.py tools/blender/construction/motor_works.json
   ```
   This writes `apps/game/public/assets/sprites/b_motor_works_build.{png,json}`: every construction stage, the parts
   that arrive at each, each stage's shadow mask, and the roof spots where it smokes and burns. Check it on the dev
   server at `/dev/building.html?b=motor_works`. Render its preview (see `tools/blender/README.md`), then
   `python3 tools/sprites/pack_previews.py` and `python3 tools/sprites/make_cards.py` (add it to `CARDS` there) for
   its dev-page picture and its build card `apps/game/public/assets/ui/motor_works.png`. A defence whose head turns
   gets a `turret` section in its config (see `render_construction.py`); the game then aims it. One with moving
   parts (rings, fans, dishes) gets an `idle` section: groups of parts that turn while it runs.
2. **Load the atlas:** add it to `ATLASES` in `apps/game/src/assets/manifest.ts`.
3. **Describe its look:** add `motor_works` to `BUILDING_ART` in `apps/game/src/data/art.ts` (its atlas and card).
4. **Footprint:** add its size to `FOOTPRINT` in `packages/sim/src/layout.ts`.
5. **Turn it on:** add `motor_works` to `ROSTER.buildings` in the same file.
6. **Behaviour:** anything that isn't data yet goes in the sim (defences shoot by their rules weapons on their own;
   the Service Bay's repairs are in `Sim.repair`). Remove any `STAND_INS` entry it replaces.
7. `npm run check`. The content tests fail until every roster entry has art, a card and a footprint; the scenario
   tests check every map still fits.

Costs, HP, power, build time and prerequisites come from the spreadsheet automatically, and the build panel shows the
card (locked until its prerequisites are built).

## Checklist: a new unit

Example: the Lancer (`lancer`).

1. **Model and render** with a script in `tools/blender` (infantry: add it to `UNITS` in `make_infantry.py`, 16
   directions × stance + run, and its death; then `python3 tools/sprites/pack_infantry.py <id>`, which also makes its
   card; `render_vehicle.py` for vehicles: 16 directions × wheel frames). The packers lighten its baked shadow to the
   18% of everything else. A vehicle with a turret that should turn on its own: add empties to its model in Blender
   (`wheel_<n>` at each axle and `turret` at the turret's pivot, its parts parented to them), save it as
   `art/models/tripo/<id>.blend`, set `rig` in `vehicles.json`, and add it to `TURRET_UNITS` (`sim/layout.ts`).
2. **Load the atlas** in `assets/manifest.ts`.
3. **Describe its look** in `UNIT_ART` (`data/art.ts`): atlas, card, `kind: 'infantry' | 'vehicle'`.
4. **Turn it on:** add `lancer` to `ROSTER.units`.
5. If it needs a behaviour the sim doesn't have yet (see below), add it in `packages/sim/src/sim.ts` with tests.
6. `npm run check`.

What already works for any unit from the sheet: movement (speed), sight, HP and armor, its weapons (damage, burst,
fire interval, range, damage class against the target's armor), production at the right building with its
prerequisites, the queue, refunds. Abilities, ammo, passengers, aircraft, naval units, cloaking, decoys and the trait
notes in the spreadsheet are **not** implemented yet; they come with the units that need them.

## Scenery: trees, rocks, bushes, logs, rubble, wrecks, grass, decals

No 3D needed: scenery is plain cut-out images (AI-generated is fine).

1. **Make the image:** transparent background, **no shadow** (the script casts one that matches the game's sun),
   light from the left, seen slightly from above. Trees and bushes come as **two images**: the object with **no
   ground** (cut off where the trunk or stem meets the ground), and a **base decal**: the ground patch under it
   (dirt, roots, grass, pebbles), seen from the same angle, with nothing standing up out of it. Rocks and logs are one
   image, with a little ground at the base.
2. Save them in `art/scenery/source/` (gitignored originals) and add a line to `SCENERY` in
   `tools/sprites/make_scenery.py`: its kind, file and height in art pixels (trees 235–300, rocks 78–230, bushes
   64–100, logs 72–104; one tile is 128 px wide). Trees and bushes: `trunk: True`, `base` (the decal's file),
   `base_width` (trees 175–220, bushes 116–136) and, for trees, `base_anchor` (where the trunk stands on the decal);
   bushes also set `contact_width`. Set `low: True` for rocks and logs.
3. Add the kind to `SCENERY_KINDS` in `packages/sim/src/layout.ts` with its category (`tree`, `rock`, `bush`,
   `log`, `debris`, `wreck`, `grass`, `decal`), its footprint (1 or 2 tiles) and whether it blocks (trees, rocks,
   debris and wrecks do; bushes, logs, grass and decals are decoration). Decals (craters, scorch marks, stains) also
   set `flat: true`: they lie on the ground under every shadow, aren't depth-sorted and have no shadow or contact
   shadow (only the frame). A decal only the browser places (like `ore_scar`) goes in `EVENT_ONLY_SCENERY` too.
4. Run `python3 tools/sprites/make_scenery.py` (needs Pillow, NumPy and SciPy). It cleans the cut-out's edges and
   stray specks, scales and anchors it, casts its shadow, adds the base decal and a contact shadow for trees and
   bushes, and rewrites `apps/game/public/assets/sprites/scenery.*`.
5. `npm run check`: tests fail if a kind the server can grow has no frame or shadow (or, for a tree or bush, no
   base decal or contact shadow), or never grows at all.

How the landscape is grown (grove density, outcrops, bushes at the edges, logs in the woods, clearances, roads)
is tuned in `SCENERY` in `layout.ts`; the generator is `packages/sim/src/scenery.ts`.

## Starting an MVP subset

The roster is just two lists. Add the IDs you have art for, and use `STAND_INS` for missing links in the tech
tree (`assumeOwned` treats a prerequisite as owned, e.g. the Assembly Yard; `producedAt` builds a unit somewhere
else until its real producer exists). `docs/rules/tech-tree.md` shows what each entity depends on, and
`prerequisiteClosure` / `dependentsOf` in `packages/rules/src/deps.ts` answer "what do I need for X" in code.

## A map

Add a `ScenarioDef` to `packages/sim/src/scenarios.ts` and register it in `SCENARIOS`. It appears on the New Game
screen (from `GET /api/scenarios`); its layout never reaches the browser until the fog reveals it.

## A rules change

Edit `design/balance.xlsx`, then run `npm run import --workspace @gravity-harvest/rules`. That regenerates the typed
data and `docs/rules/`. The rules tests fail if you forget to re-import, or if a prerequisite, producer, weapon or
damage class points at something that doesn't exist.

## A save-format change

Bump `SNAPSHOT_VERSION` in `packages/sim/src/snapshot.ts`. `Sim.restore` refuses other versions with a clear message;
add a migration there if old saves need to keep loading.
