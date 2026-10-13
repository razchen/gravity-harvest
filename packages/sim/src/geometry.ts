import type { GridPoint } from '@gravity-harvest/shared';

export type { GridPoint };

/** Integer tile coordinate. */
export interface Tile {
  tx: number;
  ty: number;
}

/**
 * Sprite facing for a grid-space vector, in `steps` directions (16 for vehicles, 8 for infantry).
 * Direction 0 points along grid +gx; directions turn counter-clockwise seen from above (matches the sprites).
 */
export function facing(dgx: number, dgy: number, steps: number): number {
  const angle = Math.atan2(-dgy, dgx);
  return ((Math.round(angle / ((2 * Math.PI) / steps)) % steps) + steps) % steps;
}

export const distance = (a: GridPoint, b: GridPoint): number => Math.hypot(a.gx - b.gx, a.gy - b.gy);
