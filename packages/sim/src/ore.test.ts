import { ECONOMY } from '@gravity-harvest/rules';
import { describe, expect, it } from 'vitest';
import { ROCKS_PER_TILE, ROOT_RICHNESS, UNITS_PER_ROCK } from './ore.js';
import { ENGINE, TICK_MS, VENT_KIND } from './layout.js';
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

  it('a mirrored field is its original\'s mirror image, tile for tile and density for density', () => {
    for (const seed of [1, 7, 23]) {
      const sim = Sim.create('skirmish', seed);
      const W = sim.map.width;
      const field = (f: number) => [...sim.ore.tiles.values()].filter((t) => t.field === f);
      const a = field(0).map((t) => `${W - 1 - t.tx},${t.ty}:${sim.ore.units(t)}`).sort();
      const b = field(1).map((t) => `${t.tx},${t.ty}:${sim.ore.units(t)}`).sort();
      expect(b.length).toBeGreaterThan(40);
      expect(b).toEqual(a);
    }
  });

  it('a field nobody harvests grows back', () => {
    const sim = Sim.create('skirmish', 7);
    const far = sim.ore.nearestField(72, 9);
    sim.debug('player', { d: 'destroyTeam', team: 'enemy', units: true, buildings: false }); // nobody: not even the enemy's harvester
    for (const t of sim.ore.tiles.values()) if (t.field === far) for (const r of t.rocks) r.amount = 1;
    const thin = units(sim, far);
    run(sim, 5 * 60_000); // the player's harvester is still busy at home
    expect(units(sim, far)).toBeGreaterThan(thin * 1.5);
  });

  it('a mined-out field never vanishes: its heart grows back on its own, and spread builds on it', () => {
    const sim = Sim.create('skirmish', 7);
    const far = sim.ore.nearestField(72, 9);
    sim.debug('player', { d: 'destroyTeam', team: 'enemy', units: true, buildings: false }); // nobody: not even the enemy's harvester
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

describe('which ore harvesters go for', () => {
  type Seen = { isExplored: (tx: number, ty: number, size: number) => boolean };
  const fogOf = (sim: Sim, team: 'player' | 'enemy') => (sim as unknown as { fog: Record<string, Seen> }).fog[team];
  const centreOf = (b: { tx: number; ty: number; size: number }) => ({ gx: b.tx + b.size / 2, gy: b.ty + b.size / 2 });
  const dist = (t: { tx: number; ty: number }, p: { gx: number; gy: number }) => Math.hypot(t.tx + 0.5 - p.gx, t.ty + 0.5 - p.gy);

  it('a side\'s harvester works the field nearest its refinery among the ore that side has seen', () => {
    let checked = 0;
    for (const seed of [1, 7, 42]) {
      const sim = Sim.create('skirmish', seed);
      for (const team of ['player', 'enemy'] as const) {
        const ref = [...sim.buildings.values()].find((b) => b.team === team && b.type === 'refinery');
        const h = [...sim.units.values()].find((u) => u.team === team && u.kind === 'harvester');
        if (!ref || h?.kind !== 'harvester') continue;
        const seen = [...sim.ore.tiles.values()].filter((t) => t.rocks.length && fogOf(sim, team).isExplored(t.tx, t.ty, 1));
        if (!seen.length) continue;
        const best = seen.reduce((a, b) => (dist(b, centreOf(ref)) < dist(a, centreOf(ref)) ? b : a));
        expect(h.field, `${team}, seed ${seed}`).toBe(best.field);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(2);
  });

  it('once its field runs out it moves to the field nearest its base, not the one nearest itself, and only to ore it has seen', () => {
    const sim = Sim.create('skirmish', 7);
    const fields = [...new Set([...sim.ore.tiles.values()].map((t) => t.field))];
    expect(fields.length).toBeGreaterThan(1);
    const [a, b] = fields;
    const tileOf = (f: number) => [...sim.ore.tiles.values()].find((t) => t.field === f && t.rocks.length)!;
    const ta = tileOf(a), tb = tileOf(b);
    const base = { gx: ta.tx + 0.5, gy: ta.ty + 0.5 };      // its refinery by field a
    const here = { gx: tb.tx + 0.5, gy: tb.ty + 0.5 };      // but it stands in field b
    const gone = 999;                                       // its own field is used up
    expect(sim.ore.pickFor(here.gx, here.gy, gone, base)?.field).toBe(a);
    // with field a unseen, it goes for b instead
    expect(sim.ore.pickFor(here.gx, here.gy, gone, base, (t) => t.field !== a)?.field).not.toBe(a);
  });
});

describe('gravity vents', () => {
  /** Skirmish with only the vent's ore left, nobody but `harvesters` of the player's, sent out from its home refinery. */
  const ventOnly = (harvesters: number) => {
    const sim = Sim.create('skirmish', 7);
    sim.debug('player', { d: 'reveal', on: true });
    sim.debug('player', { d: 'destroyTeam', team: 'enemy', units: true, buildings: false });
    for (const [k, t] of sim.ore.tiles) if (!sim.ore.isVentField(t.field)) sim.ore.tiles.delete(k); // the home fields are dry
    for (const u of [...sim.units.values()]) if (u.team === 'player') sim.killUnit(u);
    for (let i = 0; i < harvesters; i++) sim.debug('player', { d: 'spawn', unit: 'harvester', team: 'player', gx: 9 + i, gy: 12 });
    return sim;
  };

  it('a vent rings itself with a field of its own, the same on opposite sides', () => {
    const sim = Sim.create('skirmish', 7);
    expect(sim.ore.vents).toHaveLength(1);
    const v = sim.ore.vents[0];
    const ring = [...sim.ore.tiles.values()].filter((t) => t.field === v.field);
    expect(ring.length).toBeGreaterThan(24);
    for (const t of ring) {
      expect(Math.hypot(t.tx + 0.5 - (v.tx + 1), t.ty + 0.5 - (v.ty + 1))).toBeLessThan(ENGINE.ventOreRadius * 1.35);
      expect(sim.ore.at(2 * v.tx + 1 - t.tx, 2 * v.ty + 1 - t.ty)?.field, `${t.tx},${t.ty} has no opposite`).toBe(v.field);
    }
    for (let x = v.tx; x < v.tx + 2; x++) for (let y = v.ty; y < v.ty + 2; y++) {
      expect(sim.map.isBlocked(x, y)).toBe(true);
      expect(sim.ore.at(x, y)).toBeUndefined();
    }
  });

  it('an emptied tile touching the vent always starts again; the rest of its field grows back from empty too', () => {
    const sim = ventOnly(0);
    const v = sim.ore.vents[0];
    const ring = [...sim.ore.tiles.values()].filter((t) => t.field === v.field);
    for (const t of ring) t.rocks = [];
    run(sim, ECONOMY.resourceGrowthIntervalSec * 1000 + TICK_MS);
    const touching = ring.filter((t) => t.tx >= v.tx - 1 && t.tx <= v.tx + 2 && t.ty >= v.ty - 1 && t.ty <= v.ty + 2);
    expect(touching.length).toBeGreaterThan(4);
    for (const t of touching) expect(sim.ore.units(t)).toBeGreaterThan(0);
    run(sim, 10 * 60_000);
    expect(ring.filter((t) => sim.ore.units(t) >= ECONOMY.resourceTileMaxUnits / 2).length).toBeGreaterThan(ring.length / 2);
  });

  it('one harvester on a vent keeps earning for 20 minutes: modest, but it never dries up', () => {
    // the late game: home fields dry, one harvester working the vent from its home refinery (about 30 tiles away)
    const sim = ventOnly(1);
    const field = sim.ore.vents[0].field;
    const earned = () => sim.players.player.stats.creditsEarned;
    run(sim, 10 * 60_000);
    const first = earned();
    run(sim, 10 * 60_000);
    const perMin = (earned() - first) / 10;
    // measured: about $1,260 a minute over both halves (a fresh home field gives one harvester about $2,100)
    expect(first / 10).toBeGreaterThan(900);
    expect(perMin).toBeGreaterThan(900);
    expect(perMin).toBeLessThan(1800);
    expect(units(sim, field)).toBeGreaterThan(0);
  });

  it('two harvesters on a vent drain it, then share what it seeds: no more than one harvester\'s income', () => {
    const one = ventOnly(1);
    const two = ventOnly(2);
    run(one, 10 * 60_000);
    run(two, 10 * 60_000);
    const a = one.players.player.stats.creditsEarned;
    const b = two.players.player.stats.creditsEarned;
    run(one, 10 * 60_000);
    run(two, 10 * 60_000);
    const lateOne = (one.players.player.stats.creditsEarned - a) / 10;
    const lateTwo = (two.players.player.stats.creditsEarned - b) / 10;
    // measured: one about $1,260 a minute, two about $1,440 between them: a second harvester adds little once it's drained
    expect(lateTwo).toBeLessThan(lateOne * 1.4);
    expect(lateTwo).toBeLessThan(1800);
  });

  it('a vent and its field survive a save and load', () => {
    const sim = Sim.create('skirmish', 7);
    const back = Sim.restore(JSON.parse(JSON.stringify(sim.snapshot())));
    expect(back.ore.vents).toEqual(sim.ore.vents);
    const v = back.ore.vents[0];
    expect(back.map.isBlocked(v.tx, v.ty)).toBe(true);
    expect(back.hello('player').scenery.some((s) => s.kind === VENT_KIND && s.tx === v.tx && s.ty === v.ty)).toBe(true);
    for (const t of back.ore.tiles.values()) if (t.field === v.field) t.rocks = [];
    run(back, ECONOMY.resourceGrowthIntervalSec * 1000 + TICK_MS);
    expect(units(back, v.field)).toBeGreaterThan(0);
  });
});
