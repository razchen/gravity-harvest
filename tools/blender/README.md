# Sprite pipeline (Blender)

Every in-game sprite is rendered from a 3D model, so all art shares one camera, light and scale.
Blender 5.2: `/Applications/Blender.app/Contents/MacOS/Blender`.

**Conventions (all scripts):** orthographic camera, 45° yaw, 30° down (exact 2:1 isometric); one tile =
128 px wide at the 2× art scale; Cycles on the Metal GPU; transparent background with a baked shadow
(shadow catcher). Each atlas JSON has a `meta` block (`anchor` = ground-centre pixel, plus `fps`, `frames`,
`lights`, `muzzle`, `res` as relevant). Output goes to `apps/game/public/assets/sprites/`; raw frames to `tools/blender/frames/`.

Source models are in `art/models/` (gitignored, see `art/README.md`). Run the scripts from the repo root, e.g.
`Blender -b --disable-autoexec art/models/meshy/radar.blend -P tools/blender/render_building.py -- radar`.

| Script | Makes | Run |
|---|---|---|
| `add_meshy_door.py` | Adds the sliding bay door to the Meshy refinery | `Blender -b --disable-autoexec <refinery.blend> -P add_meshy_door.py` |
| `add_meshy_smoke.py` | Bakes the refinery's exhaust smoke | run on the .blend produced above |
| `render_sprites.py` | `refinery_door` (16-frame door) and `refinery_smoke` (32-frame loop) | `Blender -b --disable-autoexec meshy_refinery.blend -P render_sprites.py` |
| `render_building.py` | `b_power` (+ `b_power_steam`), `b_silo`, `b_barracks`, `b_radar` (spinning dish) | `Blender -b --disable-autoexec <model.blend> -P render_building.py -- power\|silo\|barracks\|radar` |
| `make_harvester.py` | `harvester`: 16 directions × 8 wheel frames | `Blender -b --disable-autoexec <harvester.blend> -P make_harvester.py` |
| `make_infantry.py` | A soldier's frames (units in its `UNITS`: rifleman, medic, raider, infiltrator): 16 directions × (stance + 12 run frames) and 16 × his death frames of being shot down; the rifleman's stance is his aim (the rifle is placed in his hands each frame), the others' their standing model, the medic holds his datapad; then `python3 tools/sprites/pack_infantry.py <unit>` trims and packs them into `<unit>` and `<unit>_death` (and the card, for those with a card view) | `Blender -b --factory-startup -P tools/blender/make_infantry.py -- medic` |
| `render_vehicle.py` | A vehicle's 16 directions and its card view (at 8×, also its dev-page picture) from its Tripo model (sizes in `vehicles.json`; `rig` loads a `.blend` with `wheel_<n>` and `turret` empties instead, adding hull-only and turret frames); then `python3 tools/sprites/pack_vehicles.py` trims and packs them into `v_<id>` and writes the card | `Blender -b --factory-startup -P tools/blender/render_vehicle.py -- ram` (no id: all of them) |
| `make_soldier.py` | The first rifleman (rifle attached to a separate rig); replaced by `make_infantry.py` | `Blender -b -P make_soldier.py -- <rigged soldier glb dir> <rifle.blend>` |
| `render_construction.py` | `<atlas>_stage_<n>` / `_new_<n>` construction frames of a parts model (Tripo; stages without a parts list are grouped automatically; `rig` loads a `.blend` instead, whose keyframed empties an anim can play), and for a turret (`turret: {cut, directions}` in the config) `turn_<d>` frames with its head turned to each direction; then `python3 tools/sprites/pack_construction.py <config>` packs them | `Blender -b --factory-startup -P tools/blender/render_construction.py -- tools/blender/construction/refinery.json` |
| `make_ore.py` | `ore`: 8 procedural rocks + Ore_Material | `Blender -b -P make_ore.py` |

Tips: Metal occasionally renders a black frame; the scripts detect and re-render those. Set `REUSE_FRAMES=1`
to repack existing frames without re-rendering (render_sprites, make_harvester).

## Construction stages

A building assembles itself from a model made of separate parts (Tripo's "parts" export). Its config in
`construction/<name>.json` says which parts arrive in each stage; every stage renders from the same camera, so
nothing moves between stages and the last stage is the finished building. The deck plates under the next stage's
parts are added by the script (flat slabs that cover the holes where those parts attach). The game plays the
stages with `apps/game/src/render/Construction.ts`; review them (and the destruction, `render/Destruction.ts`) on the dev server at `/dev/` (a card per building; a new one is added in `apps/game/src/dev/buildings.ts`).

The dev pages' pictures are separate, sharper renders: `PREVIEW=8 Blender -b --factory-startup -P
tools/blender/render_construction.py -- <config>` renders the finished building at 8× with more samples, and
`python3 tools/sprites/pack_previews.py` turns them into `apps/game/public/assets/previews/<atlas>.webp`, and
`python3 tools/sprites/make_cards.py` makes the build-panel cards (`apps/game/public/assets/ui/<id>.png`) from those.

## Other tools

- `autoreload.py`: run once inside Blender (Scripting tab → Run Script) to reload the open `.blend` automatically
  whenever a script re-saves it. Run it again to stop.
- `prototypes/make_refinery.py`: the first hand-built procedural refinery (before the Meshy model). Kept for reference;
  it writes `refinery.blend` next to itself.
- `../textures/seam_test.html`: tiles a texture in a grid with optional edge outlines, to check new ground
  textures for visible seams before using them. Open it from a local server at the repo root
  (`npx vite tools/textures` or `python3 -m http.server`) and pick a texture.
