// The dev building page's traffic runs in the real sim: every trip on every building has to get there and finish (if
// the sim changes so one never does, the page would show a unit standing about forever).
import { describe, expect, it } from 'vitest';
import { ROSTER, TICK_MS, footprint } from '@gravity-harvest/sim';
import { TripRun, tripsFor } from './trafficSim';

/** As the page stands its building: on a 48-tile map, along its middle row (dev/building.ts). */
const MAP = 48;
const site = (type: string) => {
  const size = footprint(type);
  const tx = MAP / 2 - 10;
  return { type, tx, ty: MAP - tx - size, size };
};
/** No trip takes anywhere near this long. */
const LIMIT_MS = 90_000;

const cases = ROSTER.buildings.flatMap((b) => tripsFor(b).map((trip) => ({ b, ...trip })));

describe('dev building traffic', () => {
  it('has trips to show', () => {
    expect(cases.some((c) => c.kind === 'out')).toBe(true);
    expect(cases.some((c) => c.kind === 'dock')).toBe(true);
    expect(cases.some((c) => c.kind === 'service')).toBe(true);
  });

  it.each(cases)('$unit $kind at $b finishes', ({ b, unit, kind }) => {
    const run = new TripRun({ unit, kind }, site(b), MAP);
    const seen = new Set<string>();
    for (let t = 0; t < LIMIT_MS && run.stage !== 'done'; t += TICK_MS) {
      const view = run.step();
      for (const e of view.events) seen.add(e.e);
      if (view.buildings.find((x) => x.id === run.building)?.working) seen.add('working');
    }
    expect(run.stage).toBe('done');
    const u = run.sim.units.get(run.unit!)!;
    expect(u.type).toBe(unit);
    if (kind === 'out') expect(seen.has('unitOut')).toBe(true);
    if (kind === 'dock') {
      expect(seen.has('door') && seen.has('unloaded')).toBe(true);
      expect(u.kind === 'harvester' && u.cargo).toBe(0);
    }
    if (kind === 'service') {
      expect(seen.has('working')).toBe(true);
      expect(u.hp).toBe(u.maxHp);
    }
    // it ends up clear of the building
    const s = site(b);
    const inside = u.gx >= s.tx && u.gx < s.tx + s.size && u.gy >= s.ty && u.gy < s.ty + s.size;
    expect(inside).toBe(false);
  });
});
