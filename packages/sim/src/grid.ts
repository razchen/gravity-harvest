import type { Tile } from './geometry.js';

/** Map bounds and which tiles buildings block. */
export class Grid {
  private readonly blocked = new Set<number>();

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

  /** Block or free a footprint (tiles outside the map are ignored: their keys would alias tiles inside). */
  setFootprint(tx: number, ty: number, size: number, on: boolean): void {
    for (let x = tx; x < tx + size; x++) {
      for (let y = ty; y < ty + size; y++) {
        if (!this.inBounds(x, y)) continue;
        if (on) this.blocked.add(this.key(x, y));
        else this.blocked.delete(this.key(x, y));
      }
    }
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
}
