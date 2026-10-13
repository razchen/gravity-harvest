import { TILE_H, TILE_W, WORLD } from '../config/game';

/** Continuous grid position (tiles). Tile (tx, ty) spans grid points (tx, ty)..(tx + 1, ty + 1). */
export interface GridPoint {
  gx: number;
  gy: number;
}

/** Integer tile coordinate. */
export interface Tile {
  tx: number;
  ty: number;
}

/** World pixel position. */
export interface Point {
  x: number;
  y: number;
}

/** Grid point -> world pixels (2:1 isometric diamond projection). */
export function iso(gx: number, gy: number): Point {
  return { x: (gx - gy) * (TILE_W / 2), y: (gx + gy) * (TILE_H / 2) };
}

/**
 * Where a shot from `from` flying straight along a level barrel pointing in direction `dir` (of `steps`, 0 = +gx,
 * counter-clockwise from above) passes closest to `at`: the point it lands. At least `min` px out.
 */
export function alongBarrel(from: Point, dir: number, steps: number, at: Point, min = 20): Point {
  const a = (dir * 2 * Math.PI) / steps;
  const gx = Math.cos(a), gy = -Math.sin(a);
  const sx = (gx - gy) * (TILE_W / 2), sy = (gx + gy) * (TILE_H / 2);
  const n = Math.hypot(sx, sy);
  const t = Math.max(min, ((at.x - from.x) * sx + (at.y - from.y) * sy) / n);
  return { x: from.x + (sx / n) * t, y: from.y + (sy / n) * t };
}

/** World pixels -> grid point. */
export function toGrid(x: number, y: number): GridPoint {
  return {
    gx: (x / (TILE_W / 2) + y / (TILE_H / 2)) / 2,
    gy: (y / (TILE_H / 2) - x / (TILE_W / 2)) / 2,
  };
}

/** The four world-pixel corners of an n x n tile footprint starting at (tx, ty). */
export function diamond(tx: number, ty: number, n = 1): Point[] {
  return [iso(tx, ty), iso(tx + n, ty), iso(tx + n, ty + n), iso(tx, ty + n)];
}

/**
 * Sprite facing for a grid-space vector, in `steps` directions (16 for vehicles, 8 for infantry).
 * Direction 0 points along world +X (grid +gx); directions turn counter-clockwise seen from above.
 * This matches how the Blender sprite sheets are rendered.
 */
export function facing(dgx: number, dgy: number, steps: 8 | 16): number {
  const angle = Math.atan2(-dgy, dgx);
  return ((Math.round(angle / ((2 * Math.PI) / steps)) % steps) + steps) % steps;
}

export const distance = (a: GridPoint, b: GridPoint): number => Math.hypot(a.gx - b.gx, a.gy - b.gy);

/** World-pixel rectangle covering the map plus its surrounding border (where ground and fog are drawn). */
export function worldRect(width: number, height: number, border = WORLD.borderTiles): { left: number; top: number; right: number; bottom: number } {
  return {
    left: iso(-border, height + border).x,
    right: iso(width + border, -border).x,
    top: iso(-border, -border).y,
    bottom: iso(width + border, height + border).y,
  };
}
