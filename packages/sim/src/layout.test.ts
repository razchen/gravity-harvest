import { describe, expect, it } from 'vitest';
import { FIXERS, FOOTPRINT, HOVER_UNITS, ROSTER, TURRET_UNITS, footprint } from './layout.js';

describe('layout', () => {
  it('every roster building has a footprint, and only roster buildings do', () => {
    expect(Object.keys(FOOTPRINT).sort()).toEqual([...ROSTER.buildings].sort());
    for (const id of ROSTER.buildings) expect(footprint(id)).toBeGreaterThan(0);
  });

  it('a building with no footprint is an error, not a guess', () => {
    expect(() => footprint('no_such_building')).toThrow(/no_such_building/);
  });

  it('the units with turrets, hover bodies and repair work are all in the roster', () => {
    const units = new Set<string>(ROSTER.units);
    for (const id of [...TURRET_UNITS, ...HOVER_UNITS, ...FIXERS]) expect(units.has(id), id).toBe(true);
  });
});
