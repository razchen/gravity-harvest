# Pending assets

Art that has been generated (or is being generated) but isn't in the game yet. We add them all in one pass at the
end, the same way as the existing scenery (see [ADDING_CONTENT.md](ADDING_CONTENT.md)): 2D cut-outs from
`~/Downloads`, no ground and no shadow on the object; shadows are cast in code into the shared shadow layer.

| Asset | Count | Where | Decisions so far |
|---|---|---|---|

More are being generated; add them to this table as they come in.

## When we do them

- Copy the originals into `art/scenery/source/` with clear names, add them to `tools/sprites/make_scenery.py` and
  `SCENERY_KINDS` (`packages/sim/src/layout.ts`), and teach the generator (`packages/sim/src/scenery.ts`) where they go.
- Bases and contact shadows where the images suit them, like the trees and bushes.
- Check every kind grows (tests) and look at it in the browser.

## Done (2026-10-11)

- Rubble / debris piles (4): `debris_1`–`debris_4`, block 1 tile; clusters near outcrops and at abandoned sites.
- Abandoned industrial props (4): `wreck_generator`, `wreck_pump`, `wreck_drill`, `wreck_unit`, 2 × 2, block; 1–3 sites per match.
- Grass and grass clusters (8 + 8): `grass_1`–`grass_8`, `grass_patch_1`–`grass_patch_8`, decoration, in patches.
- Craters (4), scorch marks (4), oil stains (2): flat decals, a few pre-placed; also where buildings burn and harvesters die.
- Ore scar and ore bits: `ore_scar` on mined-out ore tiles (browser only), `ore_bits_1`–`ore_bits_6` around the ore fields.
- Dirt patches (6), gravel patches (4), cracked earth (4): `dirt_1`–`dirt_6`, `gravel_1`–`gravel_4`, `cracked_1`–`cracked_4`, flat decals under the others; dirt all over, gravel by rocks and roads, cracked earth in dry open ground.
