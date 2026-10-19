import { describe, expect, it } from 'vitest';
import { CAPABILITIES } from '@gravity-harvest/rules/public';
import { FOOTPRINT, ROSTER, footprint } from './layout.js';

describe('layout', () => {
  it('every roster building has a footprint, and only roster buildings do', () => {
    expect(Object.keys(FOOTPRINT).sort()).toEqual([...ROSTER.buildings].sort());
    for (const id of ROSTER.buildings) expect(footprint(id)).toBeGreaterThan(0);
  });

  it('a building with no footprint is an error, not a guess', () => {
    expect(() => footprint('no_such_building')).toThrow(/no_such_building/);
  });

  it('every entity with a capability is in the roster (the table is sent to the browser)', () => {
    const roster = new Set<string>([...ROSTER.units, ...ROSTER.buildings]);
    for (const id of Object.keys(CAPABILITIES)) expect(roster.has(id), id).toBe(true);
  });
});
