import { iso, type Tile } from '../core/geometry';

/** Anything with a footprint that other objects must sort in front of or behind (buildings). */
export interface Occluder {
  tx: number;
  ty: number;
  size: number;
  /** Isometric y of the footprint centre. */
  depth: number;
  /** True if a point at (gx, gy) should draw over this occluder. */
  inFront(gx: number, gy: number): boolean;
}

/**
 * Map grid: bounds, which tiles are blocked by buildings, and depth sorting near buildings.
 * Big building sprites can't be sorted by a single y value against units around them, so each
 * building registers itself on the tiles around it and nearby objects are pushed in front or behind.
 */
export class GameMap {
  private readonly blocked = new Set<number>();
  private readonly near = new Map<number, Occluder[]>();

  constructor(readonly width: number, readonly height: number) {}

  key(tx: number, ty: number): number {
    return tx * this.height + ty;
  }

  inBounds(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.width && ty < this.height;
  }

  isBlocked(tx: number, ty: number): boolean {
    return !this.inBounds(tx, ty) || this.blocked.has(this.key(tx, ty));
  }

  /** Nearest open tile to (tx, ty), searching outward ring by ring. */
  nearestFree(tx: number, ty: number, maxRadius = 6): Tile | null {
    for (let r = 0; r <= maxRadius; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (!this.isBlocked(tx + dx, ty + dy)) return { tx: tx + dx, ty: ty + dy };
        }
      }
    }
    return null;
  }

  /** Block a single tile (a tree). Tiles outside the map (scenery past the edge) are ignored: they're never reached. */
  blockTile(tx: number, ty: number): void {
    if (this.inBounds(tx, ty)) this.blocked.add(this.key(tx, ty));
  }

  /** Block the footprint and register for depth sorting. Returns the tile keys whose sorting changed. */
  addOccluder(o: Occluder): number[] {
    for (let x = 0; x < o.size; x++) for (let y = 0; y < o.size; y++) this.blocked.add(this.key(o.tx + x, o.ty + y));
    return this.index(o);
  }

  removeOccluder(o: Occluder, remaining: Occluder[]): void {
    for (let x = 0; x < o.size; x++) for (let y = 0; y < o.size; y++) this.blocked.delete(this.key(o.tx + x, o.ty + y));
    this.near.clear();
    for (const r of remaining) this.index(r);
  }

  private index(o: Occluder): number[] {
    const keys: number[] = [];
    for (let x = o.tx - 3; x < o.tx + o.size + 3; x++) {
      for (let y = o.ty - 3; y < o.ty + o.size + 3; y++) {
        if (!this.inBounds(x, y)) continue;
        const k = this.key(x, y);
        let list = this.near.get(k);
        if (!list) {
          list = [];
          this.near.set(k, list);
        }
        list.push(o);
        keys.push(k);
      }
    }
    return keys;
  }

  /** Draw depth for something standing at (gx, gy). */
  depthAt(gx: number, gy: number): number {
    let d = iso(gx, gy).y;
    if (!this.inBounds(Math.floor(gx), Math.floor(gy))) return d; // past the edge: no buildings to sort against
    const near = this.near.get(this.key(Math.floor(gx), Math.floor(gy)));
    if (near) for (const o of near) d = o.inFront(gx, gy) ? Math.max(d, o.depth + 1) : Math.min(d, o.depth - 1);
    return d;
  }
}
