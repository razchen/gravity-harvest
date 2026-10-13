import type { OreTileView, RockView } from '@gravity-harvest/shared';
import type { Tile } from './geometry.js';
import type { Grid } from './grid.js';
import { ECONOMY } from '@gravity-harvest/rules';
import type { Rng } from './rng.js';

/** Number of rock shapes the client can draw. */
export const ROCK_SHAPES = 8;

/**
 * A tile holds up to ECONOMY.resourceTileMaxUnits (from the spreadsheet), shown as up to this many rocks: each rock is
 * a step of density, so a tile thins rock by rock as it's harvested and fills back up the same way.
 */
export const ROCKS_PER_TILE = 3;
export const UNITS_PER_ROCK = ECONOMY.resourceTileMaxUnits / ROCKS_PER_TILE;
/** Tiles this rich (0..1, the heart of a field: roughly its richest quarter) are its roots and regrow on their own. */
export const ROOT_RICHNESS = 0.55;

export interface Rock {
  id: number;
  gx: number;
  gy: number;
  shape: number;
  /** Resource units left. */
  amount: number;
}

export interface OreTile extends Tile {
  /** Which field the tile belongs to; harvesters prefer their own field. */
  field: number;
  /** 0..1, higher in the middle of a field. */
  richness: number;
  rocks: Rock[];
}

export type OreChange = { e: 'rockGone'; id: number } | { e: 'rockAdded'; rock: RockView } | { e: 'oreTile'; tile: OreTileView };

export const rockView = (r: Rock, t: Tile): RockView => ({ id: r.id, tx: t.tx, ty: t.ty, gx: r.gx, gy: r.gy, shape: r.shape });

/**
 * Ore deposits: roughly round fields of tiles, each tile holding a density of resource units (shown as up to
 * ROCKS_PER_TILE rocks). Harvesting lowers a tile's density; on each growth tick partly harvested tiles may gain a
 * unit, and emptied tiles next to well-filled ones may start growing again (rules in the spreadsheet's Economy
 * sheet). Fields never grow past their original tiles.
 */
export class Ore {
  readonly tiles = new Map<number, OreTile>();

  constructor(private readonly map: Grid) {}

  /** Mark tiles of a field. Call after buildings are placed (blocked tiles get no ore). */
  addField(field: number, centre: Tile, radius: number, rng: Rng): void {
    const reach = Math.ceil(radius * 1.3);
    for (let tx = centre.tx - reach; tx <= centre.tx + reach; tx++) {
      for (let ty = centre.ty - reach; ty <= centre.ty + reach; ty++) {
        const d = Math.hypot(tx - centre.tx, ty - centre.ty) / radius + rng.range(-0.25, 0.25);
        if (d < 1 && !this.map.isBlocked(tx, ty)) this.tiles.set(this.map.key(tx, ty), { tx, ty, field, richness: 1 - d, rocks: [] });
      }
    }
  }

  /**
   * Fill every tile to its starting density: full in the middle of a field, thinner at the edges, averaging
   * ECONOMY.resourceStartDensity of full over the field.
   */
  placeRocks(rng: Rng, nextId: () => number): void {
    const max = ECONOMY.resourceTileMaxUnits;
    const tiles = [...this.tiles.values()];
    const weight = (t: OreTile) => 0.35 + t.richness;
    const mean = tiles.reduce((n, t) => n + weight(t), 0) / Math.max(1, tiles.length);
    for (const tile of tiles) {
      const units = Math.max(1, Math.min(max, Math.round((max * ECONOMY.resourceStartDensity * weight(tile)) / mean + rng.range(-1, 1))));
      this.fill(tile, units, rng, nextId);
    }
  }

  /** Give a tile `units` resource units as rocks (full rocks first, the rest in a partial one). */
  private fill(tile: OreTile, units: number, rng: Rng, nextId: () => number): void {
    for (let left = units; left > 0; left -= UNITS_PER_ROCK) {
      const rock = this.newRock(tile, rng, nextId);
      rock.amount = Math.min(UNITS_PER_ROCK, left);
      tile.rocks.push(rock);
    }
  }

  private newRock(tile: Tile, rng: Rng, nextId: () => number): Rock {
    return {
      id: nextId(),
      gx: tile.tx + rng.range(0.15, 0.85),
      gy: tile.ty + rng.range(0.15, 0.85),
      shape: rng.int(ROCK_SHAPES),
      amount: UNITS_PER_ROCK,
    };
  }

  /**
   * Where a harvester should mine next: a tile worth the trip (at least half full) in its own field, else in any
   * field, else whatever is left nearby. Stops harvesters scraping single regrown units off an exhausted field while a
   * full one waits elsewhere.
   */
  pickFor(gx: number, gy: number, field: number): OreTile | null {
    const worth = ECONOMY.resourceTileMaxUnits / 2;
    const own = this.nearest(gx, gy, field, worth);
    if (own && own.field === field) return own;
    return own ?? this.nearest(gx, gy, field);
  }

  /** Resource units on a tile. */
  units(tile: OreTile): number {
    return tile.rocks.reduce((n, r) => n + r.amount, 0);
  }

  at(tx: number, ty: number): OreTile | undefined {
    if (!this.map.inBounds(tx, ty)) return undefined; // keys outside the map would alias tiles inside
    return this.tiles.get(this.map.key(tx, ty));
  }

  hasOre(tx: number, ty: number): boolean {
    return (this.at(tx, ty)?.rocks.length ?? 0) > 0;
  }

  /** Closest tile with rocks left (at least `minUnits`), preferring the given field. */
  nearest(gx: number, gy: number, field: number, minUnits = 1): OreTile | null {
    let best: OreTile | null = null;
    let bestD = Infinity;
    let any: OreTile | null = null;
    let anyD = Infinity;
    for (const tile of this.tiles.values()) {
      if (!tile.rocks.length || (minUnits > 1 && this.units(tile) < minUnits)) continue;
      const d = Math.hypot(tile.tx + 0.5 - gx, tile.ty + 0.5 - gy);
      if (tile.field === field && d < bestD) {
        best = tile;
        bestD = d;
      }
      if (d < anyD) {
        any = tile;
        anyD = d;
      }
    }
    return best ?? any;
  }

  /** Field whose ore is closest to a point. */
  nearestField(gx: number, gy: number): number {
    return this.nearest(gx, gy, -1)?.field ?? -1;
  }

  /** Take one resource unit from a tile. Returns the rock it came from (null if the tile is empty). */
  mine(tile: OreTile, changes: OreChange[]): Rock | null {
    const rock = tile.rocks[tile.rocks.length - 1];
    if (!rock) return null;
    rock.amount -= 1;
    if (rock.amount <= 0) {
      tile.rocks.pop();
      changes.push({ e: 'rockGone', id: rock.id });
    }
    return rock;
  }

  /** Growth tick: each partly harvested tile may gain a unit (a new rock when the last one is full), up to full. */
  grow(rng: Rng, nextId: () => number, changes: OreChange[]): void {
    const max = ECONOMY.resourceTileMaxUnits;
    for (const t of this.tiles.values()) {
      const units = this.units(t);
      if (units <= 0 || units >= max || rng.next() >= ECONOMY.resourceGrowthChance) continue;
      this.addUnit(t, rng, nextId, changes);
    }
  }

  /**
   * Spread tick: an emptied tile next to a tile of its field that is at least half full may start growing again
   * (one unit). Only the field's original tiles, and never under a building.
   */
  spread(rng: Rng, nextId: () => number, changes: OreChange[]): void {
    this.spreadFrom(rng, nextId, changes);
  }

  /** Roots: an emptied tile at the heart of a field (richest part) grows back on its own, so a field never vanishes. */
  regrowRoots(rng: Rng, nextId: () => number, changes: OreChange[]): void {
    for (const t of this.tiles.values()) {
      if (t.rocks.length || t.richness < ROOT_RICHNESS || this.map.isBlocked(t.tx, t.ty)) continue;
      if (rng.next() < ECONOMY.resourceRootRegrowthChance) this.addUnit(t, rng, nextId, changes);
    }
  }

  /** (see spread) */
  private spreadFrom(rng: Rng, nextId: () => number, changes: OreChange[]): void {
    const half = ECONOMY.resourceTileMaxUnits / 2;
    for (const t of this.tiles.values()) {
      if (t.rocks.length || this.map.isBlocked(t.tx, t.ty)) continue;
      let seeded = false;
      for (let dx = -1; dx <= 1 && !seeded; dx++) {
        for (let dy = -1; dy <= 1 && !seeded; dy++) {
          const n = (dx || dy) ? this.at(t.tx + dx, t.ty + dy) : undefined;
          if (n && n.field === t.field && this.units(n) >= half) seeded = true;
        }
      }
      if (seeded && rng.next() < ECONOMY.resourceSpreadChance) this.addUnit(t, rng, nextId, changes);
    }
  }

  private addUnit(t: OreTile, rng: Rng, nextId: () => number, changes: OreChange[]): void {
    const last = t.rocks[t.rocks.length - 1];
    if (last && last.amount < UNITS_PER_ROCK) {
      last.amount += 1;
      return;
    }
    if (t.rocks.length >= ROCKS_PER_TILE) return;
    const rock = this.newRock(t, rng, nextId);
    rock.amount = 1;
    t.rocks.push(rock);
    changes.push({ e: 'rockAdded', rock: rockView(rock, t) });
  }

  views(): { tiles: OreTileView[]; rocks: RockView[] } {
    const tiles: OreTileView[] = [];
    const rocks: RockView[] = [];
    for (const t of this.tiles.values()) {
      tiles.push({ tx: t.tx, ty: t.ty, richness: t.richness });
      for (const r of t.rocks) rocks.push(rockView(r, t));
    }
    return { tiles, rocks };
  }

  totalRocks(): number {
    let n = 0;
    for (const t of this.tiles.values()) n += t.rocks.length;
    return n;
  }
}
