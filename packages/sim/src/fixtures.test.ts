/// <reference types="node" />
// Frozen saves from older versions (test/fixtures): each must still load and play on. v8, v9 and v10 were made by
// those versions of this package; v5 and v2 were made from v8 in those versions' formats (by then the map had changed,
// so a save really made then would be on a map that no longer exists); v11 is the current format.
import { readFileSync } from 'node:fs';
import { TEAMS } from '@gravity-harvest/shared';
import { describe, expect, it } from 'vitest';
import { TICK_MS } from './layout.js';
import { Sim } from './sim.js';
import { SNAPSHOT_VERSION, type SimSnapshot } from './snapshot.js';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../test/fixtures/${name}.json`, import.meta.url), 'utf8')) as SimSnapshot;
const run = (sim: Sim, ms: number) => {
  for (let t = 0; t < ms; t += TICK_MS) sim.step();
};

describe('saves from older versions', () => {
  for (const name of ['v2', 'v5', 'v8', 'v9', 'v10', 'v11']) {
    it(`${name} loads and plays on`, () => {
      const saved = fixture(name);
      const sim = Sim.restore(saved);
      expect(sim.tick).toBe(saved.tick);
      const earned = TEAMS.map((t) => sim.players[t].stats.creditsEarned);
      // seat a's soldiers go and fight; both sides keep building
      const soldiers = [...sim.units.values()].filter((u) => u.team === 'a' && u.type === 'rifleman');
      sim.command('a', { c: 'attackMove', orders: soldiers.map((u) => ({ id: u.id, gx: 70, gy: 14 })) });
      for (const t of TEAMS) sim.command(t, { c: 'train', unit: 'rifleman' });
      run(sim, 150_000);
      // the harvesters went back to work, and it saves as a current match
      TEAMS.forEach((t, i) => expect(sim.players[t].stats.creditsEarned, t).toBeGreaterThan(earned[i]));
      expect(sim.players.a.stats.unitsKilled + sim.players.b.stats.unitsKilled).toBeGreaterThan(0);
      const again = sim.snapshot();
      expect(again.version).toBe(SNAPSHOT_VERSION);
      expect(Sim.restore(JSON.parse(JSON.stringify(again))).snapshot()).toEqual(again);
    });
  }

  it('v2 gets the Assembly Yards it assumed, and its harvesters a field', () => {
    const sim = Sim.restore(fixture('v2'));
    expect([...sim.buildings.values()].filter((b) => b.type === 'assembly_yard').map((b) => b.team).sort()).toEqual(['a', 'b']);
    expect(sim.scenery).toEqual([]);
    for (const u of sim.units.values()) if (u.kind === 'harvester') expect(u.field).toBeGreaterThanOrEqual(0);
  });

  it('v11 loads exactly as it was saved, passengers and all', () => {
    const saved = fixture('v11');
    const { rulesHash: _, ...again } = Sim.restore(saved).snapshot();
    const { rulesHash: __, ...frozen } = saved;
    expect(again).toEqual(frozen);
    expect(saved.units.some((u) => u.kind === 'fighter' && u.passengers.length > 0)).toBe(true);
  });
});
