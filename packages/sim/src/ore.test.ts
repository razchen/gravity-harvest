import { ECONOMY } from '@gravity-harvest/rules';
import { describe, expect, it } from 'vitest';
import { ROCKS_PER_TILE, ROOT_RICHNESS, UNITS_PER_ROCK } from './ore.js';
import { TICK_MS } from './layout.js';
import { Sim } from './sim.js';

const run = (sim: Sim, ms: number) => {
  for (let t = 0; t < ms; t += TICK_MS) sim.step();
};
const units = (sim: Sim, field: number) =>
  [...sim.ore.tiles.values()].filter((t) => t.field === field).reduce((n, t) => n + sim.ore.units(t), 0);

describe('ore density and growth (rules from the Economy sheet)', () => {
  it('a tile holds at most a full load of density, shown as up to 3 rocks of equal steps', () => {
    expect(UNITS_PER_ROCK * ROCKS_PER_TILE).toBe(ECONOMY.resourceTileMaxUnits);
    const sim = Sim.create('skirmish', 7);
    for (const t of sim.ore.tiles.values()) {
      expect(sim.ore.units(t)).toBeGreaterThan(0);
      expect(sim.ore.units(t)).toBeLessThanOrEqual(ECONOMY.resourceTileMaxUnits);
      expect(t.rocks.length).toBeLessThanOrEqual(ROCKS_PER_TILE);
    }
  });

  it('fields start at about the sheet\'s average density, fuller in the middle', () => {
    const sim = Sim.create('skirmish', 7);
    const tiles = [...sim.ore.tiles.values()];
    const avg = tiles.reduce((n, t) => n + sim.ore.units(t), 0) / tiles.length / ECONOMY.resourceTileMaxUnits;
    expect(avg).toBeGreaterThan(ECONOMY.resourceStartDensity - 0.1);
    expect(avg).toBeLessThan(ECONOMY.resourceStartDensity + 0.1);
    const heart = tiles.filter((t) => t.richness >= ROOT_RICHNESS);
    const edge = tiles.filter((t) => t.richness < 0.2);
    const mean = (l: typeof tiles) => l.reduce((n, t) => n + sim.ore.units(t), 0) / l.length;
    expect(mean(heart)).toBeGreaterThan(mean(edge));
  });

  it('one harvester takes several minutes to thin its field', () => {
    const sim = Sim.create('skirmish', 7);
    const home = sim.ore.nearestField(7, 9);
    const start = units(sim, home);
    expect(start / ECONOMY.harvesterCapacity).toBeGreaterThan(12); // a dozen loads or more
    run(sim, 5 * 60_000);
    expect(units(sim, home)).toBeGreaterThan(start * 0.25); // still going after 5 minutes
  });

  it('a field nobody harvests grows back', () => {
    const sim = Sim.create('skirmish', 7);
    const far = sim.ore.nearestField(44, 42);
    for (const t of sim.ore.tiles.values()) if (t.field === far) for (const r of t.rocks) r.amount = 1;
    const thin = units(sim, far);
    run(sim, 5 * 60_000); // the player's harvester is still busy at home
    expect(units(sim, far)).toBeGreaterThan(thin * 1.5);
  });

  it('a mined-out field never vanishes: its heart grows back on its own, and spread builds on it', () => {
    const sim = Sim.create('skirmish', 7);
    const far = sim.ore.nearestField(44, 42);
    for (const t of sim.ore.tiles.values()) if (t.field === far) t.rocks = [];
    run(sim, 10 * 60_000);
    expect(units(sim, far)).toBeGreaterThan(10);
  });

  it('fields never grow past their original tiles, nor under a building', () => {
    const sim = Sim.create('skirmish', 7);
    const before = new Set(sim.ore.tiles.keys());
    const tile = [...sim.ore.tiles.values()].find((t) => t.field === sim.ore.nearestField(44, 42))!;
    tile.rocks = [];
    sim.map.setFootprint(tile.tx, tile.ty, 1, true); // as if a building stood there
    run(sim, 10 * 60_000);
    expect(new Set(sim.ore.tiles.keys())).toEqual(before);
    expect(tile.rocks).toEqual([]);
  });

  it('harvesters go for tiles worth the trip, and leave an exhausted field for a full one', () => {
    const sim = Sim.create('skirmish', 7);
    const home = sim.ore.nearestField(7, 9);
    // leave only crumbs at home
    for (const t of sim.ore.tiles.values()) if (t.field === home) t.rocks = t.rocks.slice(0, 1).map((r) => ({ ...r, amount: 1 }));
    const pick = sim.ore.pickFor(7, 9, home)!;
    expect(pick.field).not.toBe(home);
    expect(sim.ore.units(pick)).toBeGreaterThanOrEqual(ECONOMY.resourceTileMaxUnits / 2);
  });
});
