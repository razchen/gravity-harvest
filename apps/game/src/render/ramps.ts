// Where a transport's side doors are, read from its door clip's frames (in matches and on the dev unit pages). No
// Phaser here: callers hand in the frames' pixels.

export interface Px {
  x: number;
  y: number;
}

/**
 * One side door's ramp, for one direction: world px from the vehicle's anchor (zoom 1). `foot` is where the ramp meets
 * the ground, `door` the doorway at its top; `pixels` is how much of it shows (more on the side nearer the viewer).
 */
export interface Ramp {
  /** 1: its left (a quarter turn counter-clockwise from the way it faces), -1: its right (as sim/layout doorSide). */
  side: 1 | -1;
  foot: Px;
  door: Px;
  pixels: number;
}

/** World px on screen for a step of (gx, gy) tiles (zoom 1), and back (on the ground). */
export const gridToPx = (gx: number, gy: number): Px => ({ x: (gx - gy) * 64, y: (gx + gy) * 32 });
export const pxToGrid = (p: Px) => ({ gx: (p.x / 64 + p.y / 32) / 2, gy: (p.y / 32 - p.x / 64) / 2 });

/** A (possibly trimmed) frame drawn into its full canvas, for reading its pixels. */
export function framePixels(
  img: CanvasImageSource, frame: { x: number; y: number; w: number; h: number }, offset: Px, full: { w: number; h: number },
): ImageData {
  const c = document.createElement('canvas');
  c.width = full.w;
  c.height = full.h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, frame.x, frame.y, frame.w, frame.h, offset.x, offset.y, frame.w, frame.h);
  return g.getImageData(0, 0, full.w, full.h);
}

/**
 * The ramps a door clip lowers in direction d of `directions`, from its first (shut) and last (open) frames, both on
 * the same canvas with the vehicle's `anchor` (frame px) at `res` x the game's art scale. A ramp is what turns solid or
 * lighter between them, split by which side of the hull it is on (on the ground, across the way it faces). Its foot is
 * its far end from the hull; the doorway is the far end's mirror through the middle of the ramp (it being a flat
 * panel). A side with too little of it showing (hidden behind the hull) is left out.
 */
export function findRamps(shut: ImageData, open: ImageData, anchor: Px, res: number, d: number, directions: number): Ramp[] {
  const { width: w, height: h } = open;
  const lum = (px: Uint8ClampedArray, i: number) => 0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2];
  const changed = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const solidA = shut.data[i * 4 + 3] > 200, solidB = open.data[i * 4 + 3] > 200;
    changed[i] = +(solidB && (!solidA || lum(open.data, i * 4) - lum(shut.data, i * 4) > 40));
  }
  const world = (x: number, y: number): Px => ({ x: (x - anchor.x) / res, y: (y - anchor.y) / res });
  const ramps: Ramp[] = [];
  for (const side of [1, -1] as const) {
    // how far out to this side of the hull each changed pixel is (tiles, taking it as on the ground)
    const ang = ((d * 360) / directions + 90 * side) * (Math.PI / 180);
    const ux = Math.cos(ang), uy = -Math.sin(ang);
    const px: number[] = [], out: number[] = [];
    for (let i = 0; i < w * h; i++) {
      if (!changed[i]) continue;
      const g = pxToGrid(world(i % w, Math.floor(i / w)));
      const o = g.gx * ux + g.gy * uy;
      if (o > 0.1) {
        px.push(i);
        out.push(o);
      }
    }
    if (px.length <= 20) continue;
    // the foot: the outermost twentieth of its pixels
    const cut = [...out].sort((p, q) => p - q)[Math.floor(out.length * 0.95)];
    let fx = 0, fy = 0, n = 0, seed = px[0], seedOut = -Infinity;
    px.forEach((i, j) => {
      if (out[j] < cut) return;
      fx += i % w;
      fy += Math.floor(i / w);
      n++;
      if (out[j] > seedOut) {
        seedOut = out[j];
        seed = i;
      }
    });
    fx /= n;
    fy /= n;
    // the ramp: the patch joined to its foot
    const ramp = changed.slice();
    let cx = 0, cy = 0, m = 0;
    const stack = [seed];
    ramp[seed] = 2;
    while (stack.length) {
      const i = stack.pop()!, x = i % w;
      cx += x;
      cy += Math.floor(i / w);
      m++;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j >= 0 && j < w * h && ramp[j] === 1) {
          ramp[j] = 2;
          stack.push(j);
        }
      }
    }
    ramps.push({ side, foot: world(fx, fy), door: world((2 * cx) / m - fx, (2 * cy) / m - fy), pixels: px.length });
  }
  return ramps;
}
