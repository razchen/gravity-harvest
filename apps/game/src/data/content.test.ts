// Content integrity: everything in the match roster has art, and the art exists on disk.
// (Scenario maps are checked in packages/sim.)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ATLASES, TERRAIN } from '../assets/manifest';
import { MATCH_PUBLIC_CATALOG, FOOTPRINT, ROSTER, SCENERY_KINDS } from '@gravity-harvest/sim';
import { BUILDING_ART, UNIT_ART } from './art';

const PUBLIC = join(import.meta.dirname, '..', '..', 'public');
const atlasKeys = new Set(ATLASES.map((a) => a.key));

describe('asset manifest', () => {
  it.each(ATLASES)('atlas $key has a png and a json that contains its first frame', (a) => {
    const json = join(PUBLIC, 'assets', 'sprites', `${a.file}.json`);
    expect(existsSync(join(PUBLIC, 'assets', 'sprites', `${a.file}.png`))).toBe(true);
    const data = JSON.parse(readFileSync(json, 'utf8')) as { frames: Record<string, unknown>; meta: Record<string, unknown> };
    expect(data.frames[a.firstFrame]).toBeDefined();
    expect(data.meta).toBeDefined();
  });

  it('terrain texture exists', () => {
    expect(existsSync(join(PUBLIC, TERRAIN.earth.file))).toBe(true);
  });
});

describe('roster art', () => {
  it.each(ROSTER.buildings.map((id) => [id]))('building %s has rules, a footprint, loaded atlases and a card', (id) => {
    const art = BUILDING_ART[id];
    expect(MATCH_PUBLIC_CATALOG.buildings[id]).toBeDefined();
    expect(FOOTPRINT[id]).toBeGreaterThan(0);
    expect(art, `add ${id} to data/art.ts`).toBeDefined();
    expect(atlasKeys.has(art.sprite)).toBe(true);
    expect(existsSync(join(PUBLIC, art.card))).toBe(true);
    // a construction atlas (tools/sprites/pack_construction.py): every stage, its arriving parts and its shadow mask
    const atlas = JSON.parse(readFileSync(join(PUBLIC, 'assets', 'sprites', `${art.sprite}.json`), 'utf8')) as
      { frames: Record<string, unknown>; meta: { construction?: { stages: unknown[] }; damage?: { spots: unknown[] } } };
    const stages = atlas.meta.construction?.stages.length ?? 0;
    expect(stages, `${art.sprite} has no construction stages`).toBeGreaterThan(0);
    for (let n = 1; n <= stages; n++) {
      for (const kind of ['stage', 'new', 'shadow']) expect(atlas.frames[`${art.sprite}_${kind}_${n}`], `${art.sprite}_${kind}_${n}`).toBeDefined();
    }
    expect(atlas.meta.damage?.spots.length, `${art.sprite} has no roof spots for smoke and fire`).toBeGreaterThan(0);
  });

  it.each(ROSTER.units.map((id) => [id]))('unit %s has rules, a loaded atlas and a card', (id) => {
    const art = UNIT_ART[id];
    expect(MATCH_PUBLIC_CATALOG.units[id]).toBeDefined();
    expect(art, `add ${id} to data/art.ts`).toBeDefined();
    expect(atlasKeys.has(art.sprite)).toBe(true);
    expect(existsSync(join(PUBLIC, art.card))).toBe(true);
  });

  it('art only exists for roster entries', () => {
    expect(Object.keys(BUILDING_ART).sort()).toEqual([...ROSTER.buildings].sort());
    expect(Object.keys(UNIT_ART).sort()).toEqual([...ROSTER.units].sort());
  });
});

describe('scenery', () => {
  it('every kind the server can grow has a frame and an anchor; standing ones a shadow, flat decals none', () => {
    const atlas = JSON.parse(readFileSync(join(PUBLIC, 'assets', 'sprites', 'scenery.json'), 'utf8')) as {
      frames: Record<string, unknown>; meta: { anchors: Record<string, { x: number; y: number }> };
    };
    for (const k of SCENERY_KINDS) {
      expect(atlas.frames[k.id], `scenery atlas is missing ${k.id}: run tools/sprites/make_scenery.py`).toBeDefined();
      expect(atlas.meta.anchors[k.id], `scenery atlas has no anchor for ${k.id}`).toBeDefined();
      if (k.flat) {
        expect(atlas.frames[`${k.id}_shadow`], `${k.id} lies flat on the ground and casts no shadow`).toBeUndefined();
      } else {
        expect(atlas.frames[`${k.id}_shadow`], `scenery atlas is missing the ${k.id} shadow`).toBeDefined();
      }
    }
  });

  it('every tree, bush, debris pile and wreck has a contact shadow, with an anchor', () => {
    const atlas = JSON.parse(readFileSync(join(PUBLIC, 'assets', 'sprites', 'scenery.json'), 'utf8')) as {
      frames: Record<string, unknown>; meta: { anchors: Record<string, { x: number; y: number }> };
    };
    const grounded = new Set(['tree', 'bush', 'debris', 'wreck']);
    const kinds = SCENERY_KINDS.filter((k) => grounded.has(k.category));
    expect(kinds.some((k) => k.category === 'debris') && kinds.some((k) => k.category === 'wreck')).toBe(true);
    for (const k of kinds) {
      expect(atlas.frames[`${k.id}_contact`], `scenery atlas is missing ${k.id}_contact: run tools/sprites/make_scenery.py`).toBeDefined();
      expect(atlas.meta.anchors[`${k.id}_contact`], `scenery atlas has no anchor for ${k.id}_contact`).toBeDefined();
    }
  });

  it('every tree and bush has a base decal and a contact shadow, with anchors', () => {
    const atlas = JSON.parse(readFileSync(join(PUBLIC, 'assets', 'sprites', 'scenery.json'), 'utf8')) as {
      frames: Record<string, unknown>; meta: { anchors: Record<string, { x: number; y: number }> };
    };
    const kinds = SCENERY_KINDS.filter((k) => k.category === 'tree' || k.category === 'bush');
    expect(kinds.length).toBeGreaterThan(0);
    for (const k of kinds) {
      for (const frame of [`${k.id}_base`, `${k.id}_contact`]) {
        expect(atlas.frames[frame], `scenery atlas is missing ${frame}: run tools/sprites/make_scenery.py`).toBeDefined();
        expect(atlas.meta.anchors[frame], `scenery atlas has no anchor for ${frame}`).toBeDefined();
      }
    }
  });

  it('the atlas fits a common GPU texture limit; ground patches are sized to break up the ground', () => {
    const atlas = JSON.parse(readFileSync(join(PUBLIC, 'assets', 'sprites', 'scenery.json'), 'utf8')) as {
      frames: Record<string, { frame: { w: number } }>; meta: { size: { w: number; h: number }; tile_px: number };
    };
    expect(atlas.meta.size.w).toBeLessThanOrEqual(4096);
    expect(atlas.meta.size.h).toBeLessThanOrEqual(4096);
    // width in tiles (one tile is `tile_px` art px wide)
    const sizes: Record<string, [number, number]> = { dirt: [2.5, 4], gravel: [1.5, 2.5], cracked: [2, 3] };
    for (const [prefix, [lo, hi]] of Object.entries(sizes)) {
      const kinds = SCENERY_KINDS.filter((k) => k.id.startsWith(`${prefix}_`));
      expect(kinds.length).toBeGreaterThan(0);
      for (const k of kinds) {
        const tiles = atlas.frames[k.id].frame.w / atlas.meta.tile_px;
        expect(tiles, `${k.id} is ${tiles.toFixed(2)} tiles wide`).toBeGreaterThanOrEqual(lo);
        expect(tiles, `${k.id} is ${tiles.toFixed(2)} tiles wide`).toBeLessThanOrEqual(hi);
      }
    }
  });
});
