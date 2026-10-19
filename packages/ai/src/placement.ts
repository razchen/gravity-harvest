// Where the computer puts a building: a spot the server will accept (the same check the browser's placement preview
// uses), that keeps lanes open between buildings and in front of ramps and doors, scored by what the building is for.
import type { GridPoint } from '@gravity-harvest/shared';
import { ENGINE, checkPlacement, footprint, refineryDock, serviceBayPad } from '@gravity-harvest/sim/layout';
import type { Rng } from './rng.js';
import { ENGINE_IDS } from './tech.js';
import type { World } from './world.js';

/** Tiles kept free around buildings, so units can always get between them. */
const LANE = 1;

/** Tiles that must stay open in front of our buildings: refinery ramps, Service Bay pads, the way out of every building. */
function reserved(w: World): Set<number> {
  const out = new Set<number>();
  const add = (tx: number, ty: number) => w.inBounds(tx, ty) && out.add(w.key(tx, ty));
  for (const b of w.own.buildings) {
    if (b.type === ENGINE_IDS.refinery) {
      const d = refineryDock(b.tx, b.ty);
      for (const t of d.ramp) add(t.tx, t.ty);
      for (const p of [d.front, d.wait]) for (let dx = -1; dx <= 1; dx++) add(Math.floor(p.gx) + dx, Math.floor(p.gy) + 1);
    }
    if (b.type === ENGINE_IDS.serviceBay) {
      const d = serviceBayPad(b.tx, b.ty);
      for (const p of [d.front, d.wait]) for (let dx = -1; dx <= 1; dx++) for (let dy = 0; dy <= 1; dy++) add(Math.floor(p.gx) + dx, Math.floor(p.gy) + dy);
    }
    // units come out of the front (the footprint's +y side, in the middle)
    const mx = Math.floor(b.tx + b.size / 2);
    for (let dy = 0; dy < 3; dy++) for (let dx = -1; dx <= 1; dx++) add(mx + dx, b.ty + b.size + dy);
  }
  return out;
}

/**
 * The best spot for `type` (lowest `score`), or null if there is none. With `random`, any valid spot (a careless
 * player's choice).
 */
export function findSpot(w: World, type: string, score: (centre: GridPoint) => number, rng: Rng, random = false): { tx: number; ty: number } | null {
  const own = w.own.buildings;
  if (!own.length) return null;
  const n = footprint(type);
  const keep = reserved(w);
  const units = new Set((w.view?.units ?? []).map((u) => w.key(Math.floor(u.gx), Math.floor(u.gy))));
  const world = {
    isBlocked: (x: number, y: number) => w.isBlocked(x, y),
    hasOre: (x: number, y: number) => w.hasOre(x, y),
    unitOn: (x: number, y: number) => units.has(w.key(x, y)),
    ownBuildings: own,
  };
  const all = w.view?.buildings ?? [];
  const r = ENGINE.buildRadius;
  const x0 = Math.max(0, Math.min(...own.map((b) => b.tx)) - r - n), x1 = Math.min(w.width - n, Math.max(...own.map((b) => b.tx + b.size)) + r);
  const y0 = Math.max(0, Math.min(...own.map((b) => b.ty)) - r - n), y1 = Math.min(w.height - n, Math.max(...own.map((b) => b.ty + b.size)) + r);
  const valid: { tx: number; ty: number; s: number }[] = [];
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      // a lane all round: no other building within LANE tiles, and nothing on the tiles kept open
      let ok = true;
      for (const b of all) {
        if (tx - LANE < b.tx + b.size && tx + n + LANE > b.tx && ty - LANE < b.ty + b.size && ty + n + LANE > b.ty) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      for (let x = tx; x < tx + n && ok; x++) for (let y = ty; y < ty + n && ok; y++) if (keep.has(w.key(x, y))) ok = false;
      // and its own way out stays open
      for (let dx = -1; dx <= 1 && ok; dx++) if (w.isBlocked(Math.floor(tx + n / 2) + dx, ty + n)) ok = false;
      if (!ok || checkPlacement(type, tx, ty, world).problem) continue;
      valid.push({ tx, ty, s: random ? 0 : score({ gx: tx + n / 2, gy: ty + n / 2 }) });
    }
  }
  if (!valid.length) return null;
  if (random) return rng.pick(valid)!;
  return valid.reduce((a, b) => (b.s < a.s ? b : a));
}
