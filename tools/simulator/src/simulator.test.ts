import { describe, expect, it } from 'vitest';
import { runMatch } from './match.js';
import { buildReport } from './report.js';
import { specs } from './suite.js';

describe('simulator', () => {
  const list = specs({ pairings: [['ordan:hard', 'sable:easy']], scenarios: ['skirmish'], matches: 2, seed: 3, maxMinutes: 6 });

  it('plays headless matches between two computer players and measures them', () => {
    expect(list.map((s) => s.aSlot)).toEqual(['a', 'b']); // they swap start positions
    const r = runMatch(list[0]);
    expect(r.error).toBeUndefined();
    expect(r.lengthMs).toBeGreaterThan(0);
    expect(r.setup).toEqual({ blockedStarts: 0, reachable: true, unreachableFields: 0 });
    for (const s of [r.sides.a, r.sides.b]) {
      expect(s.firstUnloadMs).not.toBeNull();
      expect(Object.values(s.unitsBuilt).reduce((a, b) => a + b, 0)).toBeGreaterThan(3);
      expect(s.timeline.length).toBeGreaterThan(5);
    }
    expect(r.firstContactMs).not.toBeNull();
  });

  it('gives the same result for the same seed, and reports on it', () => {
    const strip = (r: ReturnType<typeof runMatch>) => ({ ...r, realMs: 0 });
    const a = runMatch(list[1]);
    expect(strip(runMatch(list[1]))).toEqual(strip(a));
    const report = buildReport([a], { realMs: a.realMs, workers: 1 });
    expect(report.verdicts.map((v) => v.question)).toEqual(['time', 'fair', 'fun', 'progress', 'build speed', 'ore']);
    expect(report.maps[0].scenario).toBe('skirmish');
    expect(report.text).toContain('VERDICTS');
  });
});
