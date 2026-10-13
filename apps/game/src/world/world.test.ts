import { describe, expect, it } from 'vitest';
import { iso } from '../core/geometry';
import { GameMap, type Occluder } from './GameMap';

/** A building-like footprint for tests (same front-side rule as Building). */
function block(tx: number, ty: number, size: number): Occluder {
  return {
    tx, ty, size,
    depth: iso(tx + size / 2, ty + size / 2).y,
    inFront: (gx, gy) => gx >= tx + size || gy >= ty + size,
  };
}

describe('GameMap', () => {
  it('blocks out-of-bounds tiles and occluder footprints', () => {
    const map = new GameMap(10, 8);
    expect(map.isBlocked(-1, 0)).toBe(true);
    expect(map.isBlocked(10, 0)).toBe(true);
    expect(map.isBlocked(0, 8)).toBe(true);
    expect(map.isBlocked(3, 3)).toBe(false);
    const b = block(2, 2, 3);
    map.addOccluder(b);
    for (let x = 2; x < 5; x++) for (let y = 2; y < 5; y++) expect(map.isBlocked(x, y)).toBe(true);
    expect(map.isBlocked(5, 2)).toBe(false);
    map.removeOccluder(b, []);
    expect(map.isBlocked(3, 3)).toBe(false);
  });

  it('nearestFree finds the closest open tile', () => {
    const map = new GameMap(10, 10);
    map.addOccluder(block(4, 4, 3));
    expect(map.nearestFree(1, 1)).toEqual({ tx: 1, ty: 1 });
    const t = map.nearestFree(5, 5)!;
    expect(map.isBlocked(t.tx, t.ty)).toBe(false);
    expect(Math.max(Math.abs(t.tx - 5), Math.abs(t.ty - 5))).toBe(2);
  });

  it('sorts things in front of a building over it and things behind under it', () => {
    const map = new GameMap(20, 20);
    const b = block(8, 8, 4);
    map.addOccluder(b);
    expect(map.depthAt(13, 10)).toBeGreaterThan(b.depth); // in front (gx past the footprint)
    expect(map.depthAt(10, 13)).toBeGreaterThan(b.depth); // in front (gy past the footprint)
    expect(map.depthAt(7, 10)).toBeLessThan(b.depth); // behind
    expect(map.depthAt(1, 1)).toBe(iso(1, 1).y); // far away: plain isometric y
  });
});
