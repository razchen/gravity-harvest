import type { Tile } from './geometry.js';
import type { Grid } from './grid.js';

interface Node extends Tile {
  g: number;
  f: number;
}

/** Binary min-heap on `f`. */
class MinHeap {
  private readonly items: Node[] = [];

  get size(): number {
    return this.items.length;
  }

  push(n: Node): void {
    const a = this.items;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }

  pop(): Node | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length && last) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * 8-way A* on tiles. Returns the tiles from start (exclusive) to goal (inclusive), or null.
 * Diagonal moves can't cut the corner of a blocked tile. `maxNodes` caps the search so an
 * unreachable goal can't stall a tick.
 */
export function findPath(map: Grid, start: Tile | null, goal: Tile | null, maxNodes = 12_000): Tile[] | null {
  if (!start || !goal || map.isBlocked(goal.tx, goal.ty)) return null;
  const h = (tx: number, ty: number) => {
    const dx = Math.abs(tx - goal.tx);
    const dy = Math.abs(ty - goal.ty);
    return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
  };
  const open = new MinHeap();
  open.push({ tx: start.tx, ty: start.ty, g: 0, f: h(start.tx, start.ty) });
  const came = new Map<number, Node>();
  const best = new Map<number, number>([[map.key(start.tx, start.ty), 0]]);
  let expanded = 0;
  while (open.size && expanded++ < maxNodes) {
    const cur = open.pop()!;
    if (cur.g > (best.get(map.key(cur.tx, cur.ty)) ?? Infinity)) continue; // stale entry
    if (cur.tx === goal.tx && cur.ty === goal.ty) {
      const path: Tile[] = [];
      for (let t: Node | undefined = cur; t && !(t.tx === start.tx && t.ty === start.ty); t = came.get(map.key(t.tx, t.ty))) {
        path.unshift({ tx: t.tx, ty: t.ty });
      }
      return path;
    }
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const nx = cur.tx + dx;
        const ny = cur.ty + dy;
        if (map.isBlocked(nx, ny)) continue;
        if (dx && dy && (map.isBlocked(cur.tx + dx, cur.ty) || map.isBlocked(cur.tx, cur.ty + dy))) continue;
        const g = cur.g + (dx && dy ? 1.414 : 1);
        const k = map.key(nx, ny);
        if (g >= (best.get(k) ?? Infinity)) continue;
        best.set(k, g);
        came.set(k, cur);
        open.push({ tx: nx, ty: ny, g, f: g + h(nx, ny) });
      }
    }
  }
  return null;
}
