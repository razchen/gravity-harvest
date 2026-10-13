import { describe, expect, it } from 'vitest';
import { TILE_H, TILE_W } from '../config/game';
import { diamond, distance, facing, iso, toGrid } from './geometry';

describe('iso / toGrid', () => {
  it('projects tile corners to a 2:1 diamond', () => {
    expect(iso(0, 0)).toEqual({ x: 0, y: 0 });
    expect(iso(1, 0)).toEqual({ x: TILE_W / 2, y: TILE_H / 2 });
    expect(iso(0, 1)).toEqual({ x: -TILE_W / 2, y: TILE_H / 2 });
    expect(iso(1, 1)).toEqual({ x: 0, y: TILE_H });
  });

  it('round-trips', () => {
    for (const [gx, gy] of [[0, 0], [3.25, 7.5], [63.9, 0.1], [12, 40]]) {
      const g = toGrid(iso(gx, gy).x, iso(gx, gy).y);
      expect(g.gx).toBeCloseTo(gx, 9);
      expect(g.gy).toBeCloseTo(gy, 9);
    }
  });

  it('diamond returns the four corners of a footprint', () => {
    expect(diamond(2, 3, 4)).toEqual([iso(2, 3), iso(6, 3), iso(6, 7), iso(2, 7)]);
  });
});

describe('facing', () => {
  it('direction 0 is grid +gx and turns counter-clockwise (grid +gy is world -Y)', () => {
    expect(facing(1, 0, 16)).toBe(0);
    expect(facing(0, -1, 16)).toBe(4);
    expect(facing(-1, 0, 16)).toBe(8);
    expect(facing(0, 1, 16)).toBe(12);
    expect(facing(1, -1, 8)).toBe(1);
    expect(facing(0, 1, 8)).toBe(6);
  });

  it('always returns a value in range', () => {
    for (let a = 0; a < 360; a += 7) {
      const d = facing(Math.cos((a * Math.PI) / 180), Math.sin((a * Math.PI) / 180), 16);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThan(16);
    }
  });
});

it('distance', () => {
  expect(distance({ gx: 0, gy: 0 }, { gx: 3, gy: 4 })).toBe(5);
});
