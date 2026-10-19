import { describe, expect, it } from 'vitest';
import { EVENT_ONLY_SCENERY, SCENERY, SCENERY_KINDS, sceneryKind } from './layout.js';
import { Sim } from './sim.js';
import { SCENARIOS } from './scenarios.js';
import type { SimSnapshot } from './snapshot.js';
import { footprint } from './layout.js';

const layout = (sim: Sim) => sim.scenery.map((t) => `${t.kind}@${t.tx},${t.ty}`).join(' ');
const { width: W, height: H } = SCENARIOS.skirmish.map;
const inField = (t: { tx: number; ty: number }) => t.tx >= 0 && t.ty >= 0 && t.tx < W && t.ty < H;
/** Scenery of a category inside the field (the landscape also carries on past the edge, as pure scenery). */
const of = (sim: Sim, category: string) => sim.scenery.filter((t) => inField(t) && sceneryKind(t.kind).category === category);
/** A snapshot as an older save holds it (sides named `player` and `enemy` until version 9). */
const asOldSave = (s: SimSnapshot, version: number) => {
  const old = (t: string) => (t === 'a' ? 'player' : 'enemy');
  const byOld = (r: Record<string, unknown>) => ({ player: r.a, enemy: r.b });
  return JSON.parse(JSON.stringify({
    ...s, version, players: byOld(s.players), explored: byOld(s.explored),
    buildings: s.buildings.map((b) => ({ ...b, team: old(b.team), seenBy: b.seenBy.map(old) })),
    units: s.units.map((u) => ({ ...u, team: old(u.team) })),
  }));
};

/** Tiles reachable from a start tile (8-way, no corner cutting, like the pathfinder). */
function reachable(sim: Sim, from: { tx: number; ty: number }): Set<number> {
  const map = sim.map;
  const seen = new Set([map.key(from.tx, from.ty)]);
  const queue = [from];
  while (queue.length) {
    const c = queue.pop()!;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const x = c.tx + dx;
        const y = c.ty + dy;
        if ((!dx && !dy) || map.isBlocked(x, y) || seen.has(map.key(x, y))) continue;
        if (dx && dy && (map.isBlocked(c.tx + dx, c.ty) || map.isBlocked(c.tx, c.ty + dy))) continue;
        seen.add(map.key(x, y));
        queue.push({ tx: x, ty: y });
      }
    }
  }
  return seen;
}

describe('scenery', () => {
  const seeds = [1, 7, 42, 2024, 987654, 31337];

  it('the same seed grows the same forest; different seeds grow different ones', () => {
    expect(layout(Sim.create('skirmish', 42))).toBe(layout(Sim.create('skirmish', 42)));
    const forests = new Set(seeds.map((s) => layout(Sim.create('skirmish', s))));
    expect(forests.size).toBe(seeds.length);
  }, 20_000); // grows three whole forests: slow when the machine is busy (rendering, say)

  it.each(seeds)('seed %i: a forest, rock outcrops, bushes and logs; blockers never overlap', (seed) => {
    const sim = Sim.create('skirmish', seed);
    expect(of(sim, 'tree').length).toBeGreaterThan(80);
    expect(of(sim, 'tree').length).toBeLessThan(1200); // (a mirrored map doubles whichever its left half grew)
    expect(of(sim, 'rock').length).toBeGreaterThan(5);
    expect(of(sim, 'bush').length).toBeGreaterThan(10);
    const kinds = new Set(SCENERY_KINDS.map((k) => k.id));
    const covered = new Set<string>();
    for (const t of sim.scenery) {
      expect(kinds.has(t.kind)).toBe(true);
      const k = sceneryKind(t.kind);
      if (!k.blocks) continue;
      for (let x = t.tx; x < t.tx + k.size; x++) {
        for (let y = t.ty; y < t.ty + k.size; y++) {
          expect(covered.has(`${x},${y}`), `${t.kind} overlaps at ${x},${y}`).toBe(false);
          covered.add(`${x},${y}`);
        }
      }
    }
  });

  it.each(seeds)('seed %i: the landscape carries on past the edge, as far as the margin, thicker far out', (seed) => {
    const sim = Sim.create('skirmish', seed);
    const M = SCENERY.outside.margin;
    const outside = sim.scenery.filter((t) => !inField(t));
    expect(outside.length).toBeGreaterThan(200);
    for (const t of outside) {
      expect(t.tx).toBeGreaterThanOrEqual(-M);
      expect(t.ty).toBeGreaterThanOrEqual(-M);
      expect(t.tx).toBeLessThan(W + M);
      expect(t.ty).toBeLessThan(H + M);
    }
    // nothing outside blocks a tile of the field
    const blockedTiles = [...Array(W * H).keys()].filter((i) => sim.map.isBlocked(Math.floor(i / H), i % H)).length;
    const insideBlockers = sim.scenery.filter((t) => sceneryKind(t.kind).blocks).reduce((n, t) => {
      const k = sceneryKind(t.kind);
      let c = 0;
      for (let x = t.tx; x < t.tx + k.size; x++) for (let y = t.ty; y < t.ty + k.size; y++) if (inField({ tx: x, ty: y })) c++;
      return n + c;
    }, 0);
    const buildingTiles = [...sim.buildings.values()].reduce((n, b) => n + b.size * b.size, 0);
    expect(blockedTiles).toBe(insideBlockers + buildingTiles);
  });

  it('a grove crossing the edge carries on: the forest density just outside matches just inside', () => {
    let inner = 0;
    let outer = 0;
    for (const seed of seeds) {
      const sim = Sim.create('skirmish', seed);
      const ring = (d0: number, d1: number) => sim.scenery.filter((t) => {
        if (sceneryKind(t.kind).category !== 'tree') return false;
        const d = Math.max(-t.tx, -t.ty, t.tx - (W - 1), t.ty - (H - 1)); // > 0 outside, <= 0 inside
        return d > d0 && d <= d1;
      }).length;
      inner += ring(-4, 0);
      outer += ring(0, 4);
    }
    expect(outer / inner).toBeGreaterThan(0.6);
    expect(outer / inner).toBeLessThan(1.6);
  });

  it('every category shows up across matches, and so does every kind', () => {
    const seen = new Set(seeds.flatMap((s) => Sim.create('skirmish', s).scenery.map((t) => t.kind)));
    // except the decals only the browser places, where something happens (ore_scar: on mined-out ore tiles)
    for (const k of SCENERY_KINDS) expect(seen.has(k.id), `${k.id} never grows`).toBe(!EVENT_ONLY_SCENERY.includes(k.id));
  });

  it.each(seeds)('seed %i: decoration does not block; it stays off buildings, ore, and blockers', (seed) => {
    const sim = Sim.create('skirmish', seed);
    const blockerTiles = new Set<string>();
    for (const t of sim.scenery) {
      const k = sceneryKind(t.kind);
      if (k.blocks) for (let x = t.tx; x < t.tx + k.size; x++) for (let y = t.ty; y < t.ty + k.size; y++) blockerTiles.add(`${x},${y}`);
    }
    for (const t of sim.scenery.filter((s) => inField(s) && !sceneryKind(s.kind).blocks)) {
      expect(blockerTiles.has(`${t.tx},${t.ty}`)).toBe(false);
      // (ore bits are meant to lie under a field's edge)
      if (!t.kind.startsWith('ore_bits_')) expect(sim.ore.at(t.tx, t.ty), `${t.kind} on ore at ${t.tx},${t.ty}`).toBeUndefined();
      for (const b of sim.buildings.values()) {
        const inside = t.tx >= b.tx && t.tx < b.tx + b.size && t.ty >= b.ty && t.ty < b.ty + b.size;
        expect(inside).toBe(false);
      }
    }
  });

  it.each(seeds)('seed %i: bases, ore and units are kept clear of trees and rocks, which block their tiles', (seed) => {
    const sim = Sim.create('skirmish', seed);
    const sc = SCENARIOS.skirmish;
    for (const t of sim.scenery) {
      const k = sceneryKind(t.kind);
      if (!k.blocks) continue;
      for (let x = t.tx; x < t.tx + k.size; x++) {
        for (let y = t.ty; y < t.ty + k.size; y++) {
          expect(sim.map.isBlocked(x, y)).toBe(true);
          if (k.category === 'vent') continue; // (the scenario's: its ore rings it)
          for (const b of sc.buildings) {
            const n = footprint(b.type);
            const gap = Math.max(b.tx - x, x - (b.tx + n - 1), b.ty - y, y - (b.ty + n - 1));
            expect(gap, `${t.kind} at ${x},${y} too close to ${b.type}`).toBeGreaterThan(SCENERY.baseClearance);
          }
          for (const o of sim.ore.tiles.values()) expect(Math.max(Math.abs(o.tx - x), Math.abs(o.ty - y))).toBeGreaterThan(SCENERY.oreClearance);
          for (const u of sc.units) expect(Math.max(Math.abs(Math.floor(u.gx) - x), Math.abs(Math.floor(u.gy) - y))).toBeGreaterThan(1);
        }
      }
    }
  });

  it.each(seeds)('seed %i: the enemy base and every ore field can be reached from the player base', (seed) => {
    const sim = Sim.create('skirmish', seed);
    const home = sim.map.nearestFree(7, 10)!;
    const ok = reachable(sim, home);
    for (const b of sim.buildings.values()) {
      const door = sim.map.nearestFree(b.tx + Math.floor(b.size / 2), b.ty + b.size, 4)!;
      expect(ok.has(sim.map.key(door.tx, door.ty)), `${b.team} ${b.type} cut off`).toBe(true);
    }
    for (const t of sim.ore.tiles.values()) expect(ok.has(sim.map.key(t.tx, t.ty)), `ore at ${t.tx},${t.ty} cut off`).toBe(true);
  });

  it.each(seeds)('seed %i: one to three abandoned sites in the field, far from the bases and the ore', (seed) => {
    const sim = Sim.create('skirmish', seed);
    const wrecks = of(sim, 'wreck');
    // (a left-right mirrored map grows them on its left half and mirrors them: twice as many, in pairs)
    const m = SCENARIOS.skirmish.mirrorX ? 2 : 1;
    expect(wrecks.length).toBeGreaterThanOrEqual(SCENERY.sites.fieldMin * m);
    expect(wrecks.length).toBeLessThanOrEqual(SCENERY.sites.fieldMax * m);
    expect(wrecks.length % m).toBe(0);
    expect(sim.scenery.filter((t) => !inField(t) && sceneryKind(t.kind).category === 'wreck').length).toBeLessThanOrEqual(m);
    for (const w of wrecks) {
      for (const b of SCENARIOS.skirmish.buildings) {
        const n = footprint(b.type);
        const gap = Math.max(b.tx - (w.tx + 1), w.tx - (b.tx + n - 1), b.ty - (w.ty + 1), w.ty - (b.ty + n - 1));
        expect(gap).toBeGreaterThan(SCENERY.baseClearance + SCENERY.sites.baseGapExtra);
      }
      for (const o of sim.ore.tiles.values()) {
        expect(Math.max(o.tx - (w.tx + 1), w.tx - o.tx, o.ty - (w.ty + 1), w.ty - o.ty)).toBeGreaterThan(SCENERY.sites.oreGap);
      }
      // rubble and an oil stain around it
      const around = (cat: string, r: number) => sim.scenery.filter((t) => sceneryKind(t.kind).category === cat && Math.hypot(t.tx - w.tx - 0.5, t.ty - w.ty - 0.5) <= r);
      expect(around('debris', SCENERY.sites.radius + 1).length).toBeGreaterThan(0);
      expect(around('decal', 2.5).some((t) => t.kind.startsWith('oil_'))).toBe(true);
    }
  });

  it.each(seeds)('seed %i: wrecks and debris block their tiles; grass and decals never block or sit on buildings', (seed) => {
    const sim = Sim.create('skirmish', seed);
    for (const t of sim.scenery.filter(inField)) {
      const k = sceneryKind(t.kind);
      if (k.category === 'wreck' || k.category === 'debris') {
        expect(k.blocks).toBe(true);
        for (let x = t.tx; x < t.tx + k.size; x++) for (let y = t.ty; y < t.ty + k.size; y++) if (inField({ tx: x, ty: y })) expect(sim.map.isBlocked(x, y)).toBe(true);
      }
      if (k.category === 'grass' || k.category === 'decal') {
        expect(k.blocks).toBe(false);
        expect(k.flat ?? false).toBe(k.category === 'decal');
        if (k.category === 'grass') expect(sim.ore.at(t.tx, t.ty)).toBeUndefined();
        for (const b of sim.buildings.values()) {
          expect(t.tx >= b.tx && t.tx < b.tx + b.size && t.ty >= b.ty && t.ty < b.ty + b.size, `${t.kind} on ${b.type}`).toBe(false);
        }
      }
    }
  });

  it.each(seeds)('seed %i: ore bits lie around and under the ore fields; craters and scorch marks keep off ore and bases', (seed) => {
    const sim = Sim.create('skirmish', seed);
    const ore = [...sim.ore.tiles.values()];
    const bits = sim.scenery.filter((t) => t.kind.startsWith('ore_bits_'));
    expect(bits.length).toBeGreaterThanOrEqual(SCENARIOS.skirmish.oreFields.length * (SCENERY.oreBits.ringMin + SCENERY.oreBits.edgeMin) - 2);
    for (const t of bits) expect(Math.min(...ore.map((o) => Math.max(Math.abs(o.tx - t.tx), Math.abs(o.ty - t.ty))))).toBeLessThanOrEqual(2);
    for (const field of SCENARIOS.skirmish.oreFields.keys()) {
      expect(bits.some((t) => sim.ore.at(t.tx, t.ty)?.field === field), `no ore bits under field ${field}`).toBe(true);
    }
    const scars = sim.scenery.filter((t) => /^(crater|scorch)_/.test(t.kind));
    expect(scars.filter((t) => t.kind.startsWith('crater_')).length).toBeGreaterThanOrEqual(SCENERY.scars.cratersMin);
    for (const t of scars) {
      expect(sim.ore.at(t.tx, t.ty)).toBeUndefined();
      for (const b of sim.buildings.values()) {
        expect(Math.max(b.tx - t.tx, t.tx - (b.tx + b.size - 1), b.ty - t.ty, t.ty - (b.ty + b.size - 1))).toBeGreaterThan(SCENERY.baseClearance);
      }
    }
  });

  it.each(seeds)('seed %i: ground patches (dirt, gravel, cracked earth) in range, flat, off ore and buildings, under other decals', (seed) => {
    const sim = Sim.create('skirmish', seed);
    const patches = sim.scenery.filter((t) => /^(dirt|gravel|cracked)_/.test(t.kind));
    const count = (prefix: string) => patches.filter((t) => t.kind.startsWith(`${prefix}_`)).length;
    expect(count('dirt')).toBeGreaterThanOrEqual(60);
    expect(count('dirt')).toBeLessThanOrEqual(120);
    expect(count('gravel')).toBeGreaterThanOrEqual(5);
    expect(count('gravel')).toBeLessThan(count('dirt'));
    expect(count('cracked')).toBeGreaterThanOrEqual(5);
    expect(count('cracked')).toBeLessThan(count('dirt'));
    const ore = [...sim.ore.tiles.values()];
    for (const t of patches) {
      const k = sceneryKind(t.kind);
      expect(k.blocks).toBe(false);
      expect(k.flat).toBe(true);
      expect(k.flatLayer).toBe(t.kind.startsWith('dirt_') ? 0 : 1);
      expect(sim.ore.at(t.tx, t.ty), `${t.kind} on ore at ${t.tx},${t.ty}`).toBeUndefined();
      for (const o of ore) expect(Math.max(Math.abs(o.tx - t.tx), Math.abs(o.ty - t.ty))).toBeGreaterThan(SCENERY.ground.dirtOreGap);
      for (const b of sim.buildings.values()) {
        expect(t.tx >= b.tx && t.tx < b.tx + b.size && t.ty >= b.ty && t.ty < b.ty + b.size, `${t.kind} on ${b.type}`).toBe(false);
      }
      if (inField(t)) expect(sim.map.isBlocked(t.tx, t.ty), `${t.kind} on a blocked tile`).toBe(false);
    }
    // craters, scorch marks, stains and ore bits draw on top of them
    for (const k of SCENERY_KINDS.filter((k) => k.flat && !/^(dirt|gravel|cracked)_/.test(k.id))) expect(k.flatLayer ?? 2).toBe(2);
  });

  it.each(seeds)('seed %i: grass is common but within budget, and so is the whole landscape', (seed) => {
    const sim = Sim.create('skirmish', seed);
    const grass = sim.scenery.filter((t) => sceneryKind(t.kind).category === 'grass');
    expect(grass.length).toBeGreaterThan(300);
    expect(grass.length).toBeLessThanOrEqual(1500);
    expect(grass.some((t) => t.kind.startsWith('grass_patch_'))).toBe(true);
    expect(grass.filter((t) => !inField(t)).length).toBeGreaterThan(50);
    expect(sim.scenery.length).toBeLessThanOrEqual(4500);
    // at most one grass item per tile
    expect(new Set(grass.map((t) => `${t.tx},${t.ty}`)).size).toBe(grass.length);
  });

  it('scenery is part of the save; saves from before (trees only, or none) still load', () => {
    const sim = Sim.create('skirmish', 5);
    const snap = JSON.parse(JSON.stringify(sim.snapshot()));
    const back = Sim.restore(snap);
    expect(layout(back)).toBe(layout(sim));
    for (const t of back.scenery.filter(inField)) {
      const k = sceneryKind(t.kind);
      expect(back.map.isBlocked(t.tx, t.ty)).toBe(k.blocks);
    }

    const v3 = { ...asOldSave(snap, 3), trees: of(sim, 'tree') };
    delete v3.scenery;
    expect(Sim.restore(v3).scenery).toHaveLength(of(sim, 'tree').length);
    const v2 = asOldSave(snap, 2);
    delete v2.scenery;
    expect(Sim.restore(v2).scenery).toEqual([]);
  });

  it('the hello tells the browser where the scenery is', () => {
    const sim = Sim.create('skirmish', 5);
    expect(sim.hello('a').scenery).toEqual(sim.scenery);
  });

  it('you cannot build on a tree, but you can on a bush', () => {
    const sim = Sim.create('skirmish', 2024);
    const t = of(sim, 'tree')[0];
    const check = sim.placementWorld('a');
    expect(check.isBlocked(t.tx, t.ty)).toBe(true);
    const b = of(sim, 'bush')[0];
    expect(check.isBlocked(b.tx, b.ty)).toBe(false);
  });
});
