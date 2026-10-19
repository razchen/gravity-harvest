# Original art (source files)

Art is made with ChatGPT (2D images) and Meshy (3D models, rigs, animations). Blender only renders Meshy models
into sprites; we don't model or animate in it ourselves.


Everything the game's sprites were made from is kept here: the 3D models, the concept sheets they were
generated from, and the source textures. **These files are not in git** (about 2 GB of `.blend` files);
only this README is. `.gitignore` excludes everything else in `art/`, so back this folder up separately
(external drive, cloud storage, or Git LFS if you ever want it versioned).

The game itself only uses the rendered output in `apps/game/public/assets/`. To change a sprite, edit the
model here and re-render it with the scripts in `tools/blender/` (see `tools/blender/README.md`).

## models/meshy/ (untouched exports from Meshy)

| File | What | Used for |
|---|---|---|
| `refinery.blend` | Flux Refinery | `refinery_door`, `refinery_smoke` sprites |
| `power_plant.blend` | Power Plant | `b_power`, `b_power_steam` |
| `silo.blend` | Resource Silo | `b_silo` |
| `barracks.blend` | Barracks | `b_barracks` |
| `radar.blend` | Radar facility | `b_radar` (dish split out and spun) |
| `harvester.blend` | Ore harvester | `harvester` (wheels split out and spun) |
| `assault_rifle.blend` | Rifle | put in the rifleman's hands (`make_infantry.py`) |
| `medic_datapad.blend` | Medic's datapad (a scanner with a pistol grip) | in the medic's right hand (`make_infantry.py`) |
| `rifleman_rigged/*.glb` | The first rigged soldier, with Walking and Running animations | Nothing now (the rifleman below replaced it) |
| `rifleman_v2/*.glb` | Rigged sci-fi rifleman (rifle included): Running, Rifle Aim Turn Right, Shot and Blown Back, Run and Shoot, Walking | `rifleman` and `rifleman_death` (`tools/blender/make_infantry.py`; the stance is the steady aim at the end of the aim-and-turn clip) |
| `medic/`, `raider/`, `infiltrator/` | Rigged soldiers, one GLB each with Running, Walking and a death clip (`*_all_animations.glb`), and their standing model (`*_standing.blend`, the rest pose remeshed) | `<unit>` and `<unit>_death` (`tools/blender/make_infantry.py`) |

## models/tripo/ (untouched exports from Tripo, split into parts)

Buildings face their entrance left (the -Y side): see docs/ADDING_CONTENT.md, and `turn` in the construction configs
for one that doesn't.

Export with parts and textures: each part is its own mesh (`tripo_part_<n>`), which is what lets a building assemble
itself stage by stage.

| File | What | Used for |
|---|---|---|
| `assembly_yard.glb` | Assembly Yard, 130 textured parts | `b_assembly_build` construction stages (`tools/blender/construction/assembly_yard.json`, grouped automatically) |
| `reactor_plant.glb` | Reactor Plant, 166 textured parts | `b_reactor_plant_build` construction stages (`tools/blender/construction/reactor_plant.json`, grouped automatically) |
| `motor_works.glb` | Motor Works, 127 textured parts | `b_motor_works_build` construction stages (`tools/blender/construction/motor_works.json`, grouped automatically) |
| `service_bay.glb` | Service Bay, 96 textured parts | `b_service_bay_build` construction stages (`tools/blender/construction/service_bay.json`, grouped automatically) |
| `power_plant.glb` | Power Plant, 133 textured parts | `b_power_plant_build` construction stages (`tools/blender/construction/power_plant.json`, grouped automatically) |
| `barracks.glb` | Barracks, 160 textured parts | `b_barracks_build` construction stages (`tools/blender/construction/barracks.json`, grouped automatically) |
| `radar.glb` | Radar, 148 textured parts | `b_radar_build` construction stages (`tools/blender/construction/radar.json`, grouped automatically) |
| `gravity_lab.glb` | Gravity Lab (Ordan remake), 109 textured parts | `b_gravity_lab_build` construction stages (`tools/blender/construction/gravity_lab.json`, grouped automatically) |
| `gravity_forge.glb` | Gravity Forge (Sable remake), 123 textured parts | `b_gravity_forge_build` construction stages (`tools/blender/construction/gravity_forge.json`, grouped automatically) |
| `sentry.glb` | Sentry (1×1, Ordan remake), 130 textured parts | `b_sentry_build` construction stages and 16 head directions (`tools/blender/construction/sentry.json`, grouped automatically) |
| `lance_battery.glb` | Lance Battery (2×2, Ordan remake), 112 textured parts | `b_lance_battery_build` construction stages and 16 head directions (`tools/blender/construction/lance_battery.json`, grouped automatically) |
| `incinerator.glb` | Incinerator (1×1), 83 textured parts | `b_incinerator_build` construction stages (`tools/blender/construction/incinerator.json`, grouped automatically) |
| `anchor.glb` | Anchor (2×2), 199 textured parts | `b_anchor_build` construction stages and 16 head directions (`tools/blender/construction/anchor.json`, grouped automatically) |
| `hound_kennel.glb` | Hound Kennel (2×2), 189 textured parts | `b_hound_kennel_build` construction stages (`tools/blender/construction/hound_kennel.json`, grouped automatically) |
| `refinery.glb` | Refinery, 20 textured parts (replaces the Meshy refinery once it's in matches) | `b_refinery_build` construction stages (`tools/blender/construction/refinery.json`) |
| `skimmer.glb` | Skimmer (Ordan scout), Tripo parts model | `v_skimmer`: 16 directions (`tools/blender/render_vehicle.py`, size in `tools/blender/vehicles.json`) and its card |
| `jackal.glb` | Jackal (Ordan light tank), Tripo parts model | `v_jackal`: 16 directions (`tools/blender/render_vehicle.py`, size in `tools/blender/vehicles.json`) and its card |
| `ram.glb` | Ram (Ordan main battle tank), Tripo parts model | `v_ram`: 16 directions (`tools/blender/render_vehicle.py`, size in `tools/blender/vehicles.json`) and its card |
| `spire.glb` | Spire (Ordan artillery), Tripo parts model | `v_spire`: 16 directions (`tools/blender/render_vehicle.py`, size in `tools/blender/vehicles.json`) and its card |
| `carrier.glb` | Carrier (Ordan transport), Tripo parts model | `v_carrier`: 16 directions (`tools/blender/render_vehicle.py`, size in `tools/blender/vehicles.json`) and its card |
| `watcher.glb` | Watcher (Ordan radar disruption), Tripo parts model | `v_watcher`: 16 directions (`tools/blender/render_vehicle.py`, size in `tools/blender/vehicles.json`) and its card |
| `shroud.glb` | Shroud (Ordan concealment), Tripo parts model | `v_shroud`: 16 directions (`tools/blender/render_vehicle.py`, size in `tools/blender/vehicles.json`) and its card |
| `seeder.glb` | Seeder (mine layer), Tripo parts model | `v_seeder`: 16 directions (`tools/blender/render_vehicle.py`, size in `tools/blender/vehicles.json`) and its card |
| `assembler.glb` | Assembler (deploys an Assembly Yard), Tripo parts model | `v_assembler`: 16 directions (`tools/blender/render_vehicle.py`, size in `tools/blender/vehicles.json`) and its card |

## brand/ (the game's logo)

`gravity_harvest_logo.png`: the cracked molten moon with the G, over "GRAVITY HARVEST" (from ChatGPT). The game uses
`apps/game/public/assets/ui/logo.webp` (1000 px wide) on the title screen, and the moon alone as the browser-tab icon
(`public/favicon.png`, `public/icon-192.png`).
`gravity_harvest_wordmark.png` is just the lettering, cut from the logo: `assets/ui/wordmark.webp` (900 px wide) on the
loading screen, the HUD's top-left corner and the dev pages' sidebar.

## factions/ (emblems)

`ordan_logo.png` (bird of prey, white + violet) and `sable_logo.png` (wolf head, white / charcoal + orange), from
ChatGPT. The game's copies are `apps/game/public/assets/ui/factions/` (see `docs/FACTIONS.md`).

## vfx/unity_labs/ (fire, smoke and explosion flipbooks)

From Unity Labs' free VFX image sequences (CC0 1.0, no credit needed):
https://unity.com/blog/engine-platform/free-vfx-image-sequences-flipbooks. `zips/` holds the downloads (Flame02,
Flame03, SmallFlame01, WispySmoke01, Cloud02, Explosion01, Explosion02), `sheets/` their TGA flipbooks;
`tools/sprites/pack_vfx.py` turns them into `apps/game/public/assets/fx/`.

## models/working/ (our edited versions, made by the tools/blender scripts)

| File | Made by | Notes |
|---|---|---|
| `refinery_with_door_smoke.blend` | `add_meshy_door.py` + `add_meshy_smoke.py` | Animated bay door and white exhaust smoke. The baked smoke cache isn't kept; re-run `add_meshy_smoke.py` to rebake (about 1 minute). |
| `harvester_split_wheels.blend` | `make_harvester.py` | The six wheels as separate spinning objects |
| `rifleman_with_rifle.blend` | `make_soldier.py` | Rig with the rifle attached to the right hand, both animations |
| `ore_rocks.blend` | `make_ore.py` | The 8 procedural ore rocks and `Ore_Material` |
| `refinery_procedural_blockout.blend` | (early prototype) | First hand-built refinery blockout, before the Meshy model |

## concepts/

| Folder | Contents |
|---|---|
| `buildings/` | Concepts for every building in the game (see below) |
| `units/` | Harvester, Rifleman, Rocket Trooper, Engineer, Faction Specialist (the last three aren't in the game yet) |
| `environment/` | Trees: pine, broadleaf, cypress, dead, scrub (not in the game yet) |
| `ui/` | `hud_mockup.png`: the HUD design the in-game interface is built from |

### concepts/buildings/

`<id>.png` is the image the building's 3D model was made from. `_sheet` files are multi-view concept sheets.
`_neutral` files are the first versions in the shared look (blue energy), made before the building became Ordan or
Sable. They are kept for reference only.

| Building | Side | Files |
|---|---|---|
| Assembly Yard | shared | `assembly_yard.png`, `assembly_yard_sheet.png` |
| Power Plant | shared | `power_plant.png` (sheet) |
| Reactor Plant | shared | `reactor_plant.png`, `reactor_plant_sheet.png` |
| Refinery | shared | `refinery.png` (sheet) |
| Barracks | shared | `barracks.png` (sheet) |
| Radar | shared | `radar.png` (sheet) |
| Motor Works | shared | `motor_works.png`, `motor_works_sheet.png` |
| Service Bay | shared | `service_bay.png` (current, with the arms), `service_bay_v1.png`, `service_bay_sheet.png` |
| Gravity Lab | Ordan | `gravity_lab.png`; earlier: `gravity_lab_neutral.png`, `gravity_lab_neutral_sheet.png` |
| Sentry | Ordan | `sentry.png`; earlier: `sentry_neutral.png`, `sentry_neutral_sheet.png` |
| Lance Battery | Ordan | `lance_battery.png`; earlier: `lance_battery_neutral.png`, `lance_battery_neutral_sheet.png` |
| Gravity Forge | Sable | `gravity_forge.png`; earlier: `gravity_forge_neutral.png`, `gravity_forge_neutral_sheet.png` |
| Incinerator | Sable | `incinerator.png` |
| Anchor | Sable | `anchor.png` |
| Hound Kennel | Sable | `hound_kennel.png` |
| (none) | shared | `silo.png`: resource storage silo sheet, from before storage was dropped |

## textures/

| File | Notes |
|---|---|
| `dry_earth.png` | Seamless ground texture (1254 px). The game uses a 1024 px copy: `apps/game/public/assets/terrain/dry_earth.png` |
| `rocky_dirt.png` | Seamless rocky ground, tried and set aside |

## scenery/source/ (cut-out scenery images)

AI-generated images with the background removed and no shadow, one object (or one base decal) each.
`tools/sprites/make_scenery.py` turns them into the `scenery` atlas (kind names in brackets):

| Files | What |
|---|---|
| `tree_v2_1..5.png` | trees, standing on the trunk (evergreen, oak, cypress, deadwood, olive): in use |
| `tree_v2_1..5_base.png` | base decals for those trees, same order: the ground patch under each (roots, dirt, grass, pebbles) |
| `tree_src_1..4.png`, `tree_evergreen.png` | the first trees, with a ground patch at the base (not used) |
| `rock_01..06.png` | rocks (boulders, stack, rubble, crag, spire, ledge) |
| `bush_v2_1..6.png` | bushes without ground: 1 shrub, 2 drybrush, 3 rockbush, 4 juniper, 5 thornbush, 6 sage: in use |
| `bush_v2_1..6_base.png` | base decals for those bushes, same numbers (dirt, twigs, dry grass, pebbles) |
| `bush_08..13.png` | the first bushes, with ground in the image (shrub, sage, thornbush, drybrush, rockbush, juniper; not used) |
| `log_14..17.png` | logs and stumps (log, mossy_log, stump, snag) |
| `debris_1..4.png` | rubble and scrap piles, about a tile each (debris_1..4) |
| `wreck_generator.png`, `wreck_pump.png`, `wreck_drill.png`, `wreck_unit.png` | wrecked machines on 2 x 2 tiles: a yellow generator, a pipe and pump rig, a drill rig with a wheel, a grey power unit |
| `grass_1..8.png` | single grass tufts (grass_1..8) |
| `grass_patch_1..8.png` | clusters of grass and low dry vegetation (grass_patch_1..8) |
| `crater_1..4.png` | craters, drawn from above (the script squashes them onto the 2:1 ground): flat decals |
| `scorch_1..4.png` | scorch marks, 1, 2 and 4 drawn from above: flat decals |
| `oil_1..2.png` | oil and burn stains, drawn from above: flat decals |
| `ore_scar.png` | dug-out, depleted ground: flat decal |
| `ore_bits_1..6.png` | loose ore fragments on the ground: flat decals |
| `dirt_1..6.png` | loose dirt patches, drawn from above: big flat decals (2.5 to 4 tiles) that break up the tiled ground |
| `gravel_1..4.png` | gravel and pebble patches, drawn from above: flat decals (about 2 tiles) |
| `cracked_1..4.png` | cracked dry earth, drawn from above (hard cut-outs, feathered by the script): flat decals (2 to 3 tiles) |

## sprites/baked/ (untouched renders)

The Blender renders as they came out, with their baked ground shadows. `tools/sprites/split_shadows.py` reads these
and writes the game's sprites (buildings without their shadow, plus a shadow mask; units with a lighter shadow).

## Adding new art

Put new exports in the matching folder with a short, descriptive name (`models/meshy/<thing>.blend`,
`concepts/units/<unit>.png`) and add a row to the tables above.
