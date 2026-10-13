// Every scenario is a legal map: buildings fit and don't overlap, ramps are open, units start on open ground.
import { describe, expect, it } from 'vitest';
import { Grid } from './grid.js';
import { ROSTER, footprint } from './layout.js';
import { SCENARIOS } from './scenarios.js';

describe.each(Object.values(SCENARIOS))('scenario $id', (sc) => {
  const map = new Grid(sc.map.width, sc.map.height);
  const occupied = new Set<number>();

  it('buildings are inside the map and do not overlap', () => {
    for (const b of sc.buildings) {
      const size = footprint(b.type);
      for (let x = b.tx; x < b.tx + size; x++) {
        for (let y = b.ty; y < b.ty + size; y++) {
          expect(map.inBounds(x, y)).toBe(true);
          const k = map.key(x, y);
          expect(occupied.has(k), `${b.type} at ${b.tx},${b.ty} overlaps another building`).toBe(false);
          occupied.add(k);
        }
      }
    }
  });

  it('refinery ramps are open', () => {
    for (const b of sc.buildings.filter((x) => x.type === 'refinery')) {
      for (const [x, y] of [[b.tx + 2, b.ty + 4], [b.tx + 2, b.ty + 5]]) {
        expect(map.inBounds(x, y)).toBe(true);
        expect(occupied.has(map.key(x, y))).toBe(false);
      }
    }
  });

  it('units start on open ground inside the map', () => {
    for (const u of sc.units) {
      const tx = Math.floor(u.gx);
      const ty = Math.floor(u.gy);
      expect(map.inBounds(tx, ty)).toBe(true);
      expect(occupied.has(map.key(tx, ty)), `${u.type} at ${u.gx},${u.gy} starts inside a building`).toBe(false);
    }
  });

  it('every side starts with a building, the human with a refinery and harvester', () => {
    for (const team of Object.keys(sc.players)) expect(sc.buildings.some((b) => b.team === team)).toBe(true);
    for (const b of sc.buildings) expect(ROSTER.buildings as readonly string[]).toContain(b.type);
    for (const u of sc.units) expect(ROSTER.units as readonly string[]).toContain(u.type);
    const human = Object.entries(sc.players).find(([, p]) => p.human)![0];
    expect(sc.buildings.some((b) => b.team === human && b.type === 'refinery')).toBe(true);
    expect(sc.units.some((u) => u.team === human && u.type === 'harvester')).toBe(true);
  });

  it('ore fields and the camera are on the map', () => {
    for (const f of sc.oreFields) expect(map.inBounds(f.centre.tx, f.centre.ty)).toBe(true);
    expect(map.inBounds(Math.floor(sc.camera.gx), Math.floor(sc.camera.gy))).toBe(true);
  });
});
