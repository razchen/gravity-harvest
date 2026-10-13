import { describe, expect, it } from 'vitest';
import { Grid } from './grid.js';
import { findPath } from './pathfinder.js';

describe('Grid', () => {
  it('blocks out-of-bounds tiles and footprints; nearestFree finds the closest open tile', () => {
    const map = new Grid(10, 8);
    expect(map.isBlocked(-1, 0)).toBe(true);
    expect(map.isBlocked(0, 8)).toBe(true);
    map.setFootprint(4, 4, 3, true);
    expect(map.isBlocked(5, 5)).toBe(true);
    const t = map.nearestFree(5, 5)!;
    expect(map.isBlocked(t.tx, t.ty)).toBe(false);
    expect(Math.max(Math.abs(t.tx - 5), Math.abs(t.ty - 5))).toBe(2);
    map.setFootprint(4, 4, 3, false);
    expect(map.isBlocked(5, 5)).toBe(false);
  });
});

describe('findPath', () => {
  const walk = (path: { tx: number; ty: number }[], start: { tx: number; ty: number }) => {
    let prev = start;
    for (const t of path) {
      expect(Math.max(Math.abs(t.tx - prev.tx), Math.abs(t.ty - prev.ty))).toBe(1); // 8-way steps
      prev = t;
    }
  };

  it('walks straight across open ground', () => {
    const map = new Grid(10, 10);
    const path = findPath(map, { tx: 0, ty: 0 }, { tx: 5, ty: 0 })!;
    expect(path).toHaveLength(5);
    expect(path.at(-1)).toEqual({ tx: 5, ty: 0 });
    walk(path, { tx: 0, ty: 0 });
  });

  it('goes around a wall without entering it or cutting corners', () => {
    const map = new Grid(12, 12);
    map.setFootprint(5, 0, 2, true);
    map.setFootprint(5, 2, 2, true);
    map.setFootprint(5, 4, 2, true); // wall x=5..6, y=0..5
    const start = { tx: 2, ty: 1 };
    const path = findPath(map, start, { tx: 9, ty: 1 })!;
    expect(path).not.toBeNull();
    walk(path, start);
    let prev = start;
    for (const t of path) {
      expect(map.isBlocked(t.tx, t.ty)).toBe(false);
      if (t.tx !== prev.tx && t.ty !== prev.ty) {
        expect(map.isBlocked(t.tx, prev.ty) || map.isBlocked(prev.tx, t.ty)).toBe(false);
      }
      prev = t;
    }
    expect(path.some((t) => t.ty >= 6)).toBe(true); // had to go below the wall
  });

  it('returns null for blocked or unreachable goals', () => {
    const map = new Grid(10, 10);
    map.setFootprint(4, 4, 2, true);
    expect(findPath(map, { tx: 0, ty: 0 }, { tx: 4, ty: 4 })).toBeNull();
    const boxed = new Grid(10, 10);
    for (const [x, y] of [[0, 2], [2, 2], [4, 0], [4, 2]]) boxed.setFootprint(x, y, 2, true); // seals off the top-left corner
    expect(findPath(boxed, { tx: 0, ty: 0 }, { tx: 8, ty: 8 })).toBeNull();
  });

  it('returns an empty path when already there', () => {
    expect(findPath(new Grid(5, 5), { tx: 2, ty: 2 }, { tx: 2, ty: 2 })).toEqual([]);
  });
});
