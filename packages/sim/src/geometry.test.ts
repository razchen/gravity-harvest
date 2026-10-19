// facing() is the one direction rule for the sim and the browser (exported from ./layout for it). The copies the
// browser used to have are kept here, to show the shared one gives the same direction for every vector.
import { describe, expect, it } from 'vitest';
import { facing } from './layout.js';

/** entities/UnitSprite.ts had this for its 16 directions. */
const oldFacing16 = (dgx: number, dgy: number) => ((Math.round(Math.atan2(-dgy, dgx) / (Math.PI / 8)) % 16) + 16) % 16;
/** dev/fx.ts had this, for any number of directions. */
const oldFacing = (dgx: number, dgy: number, steps: number) => ((Math.round(Math.atan2(-dgy, dgx) / ((2 * Math.PI) / steps)) % steps) + steps) % steps;

describe('facing', () => {
  // all the way round in fine steps (so every direction's middle and both its edges, where rounding decides), at a few
  // lengths, plus the axes, diagonals, tile-grid slopes and the zero vector
  const vectors: [number, number][] = [[0, 0]];
  for (let i = 0; i < 512; i++) {
    const a = (i / 512) * 2 * Math.PI;
    for (const r of [0.01, 1, 37.5]) vectors.push([r * Math.cos(a), -r * Math.sin(a)]);
  }
  for (const [x, y] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [2, 1], [-2, 1], [1, 2], [-1, -2]]) vectors.push([x, y]);

  it('matches the old 16-direction copy', () => {
    for (const [x, y] of vectors) expect(facing(x, y, 16), `(${x}, ${y})`).toBe(oldFacing16(x, y));
  });

  it('matches the old copy for 8, 16 and 32 directions', () => {
    for (const steps of [8, 16, 32]) {
      for (const [x, y] of vectors) expect(facing(x, y, steps), `(${x}, ${y}) of ${steps}`).toBe(oldFacing(x, y, steps));
    }
  });

  it('starts along +gx and turns counter-clockwise seen from above', () => {
    expect(facing(1, 0, 16)).toBe(0);
    expect(facing(0, -1, 16)).toBe(4);
    expect(facing(-1, 0, 16)).toBe(8);
    expect(facing(0, 1, 16)).toBe(12);
  });
});
