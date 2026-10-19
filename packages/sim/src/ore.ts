import type { OreTileView, RockView } from '@gravity-harvest/shared';
import type { Tile } from './geometry.js';
import type { Grid } from './grid.js';
import { ECONOMY } from '@gravity-harvest/rules';
import { ENGINE, VENT_KIND, sceneryKind } from './layout.js';
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

/** A gravity vent: the top-left tile of its footprint, and the field of ore it keeps seeding around itself. */
export interface Vent extends Tile {
  field: number;
}

export type OreChange = { e: 'rockGone'; id: number } | { e: 'rockAdded'; rock: RockView } | { e: 'oreTile'; tile: OreTileView };

export const rockView = (r: Rock, t: Tile): RockView => ({ id: r.id, tx: t.tx, ty: t.ty, gx: r.gx, gy: r.gy, shape: r.shape });

/**
 * Ore deposits: roughly round fields of tiles, each tile holding a density of resource units (shown as up to
 * ROCKS_PER_TILE rocks). Harvesting lowers a tile's density; on each growth tick partly harvested tiles may gain a
 * unit, and emptied tiles next to well-filled ones may start growing again (rules in the spreadsheet's Economy
 * sheet). Fields never grow past their original tiles. A gravity vent's field follows its own, stronger rules
 * (`feedVents`), so it never dies out.
 */
export class Ore {
  readonly tiles = new Map<number, OreTile>();
  readonly vents: Vent[] = [];
  /** Tiles of mirrored fields -> the tile each copies (only while the match is set up). */
  private readonly mirrors = new Map<number, number>();

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
   * A field that is another one's mirror image left to right (tile tx <-> `width` - 1 - tx): the same tiles, richness
   * and (in `placeRocks`) starting density, so two mirrored bases get the same field. Call after the field it copies.
   */
  addMirroredField(field: number, of: number, width: number): void {
    for (const t of [...this.tiles.values()]) {
      if (t.field !== of) continue;
      const tx = width - 1 - t.tx;
      if (this.map.isBlocked(tx, t.ty) || this.at(tx, t.ty)) continue;
      const key = this.map.key(tx, t.ty);
      this.tiles.set(key, { tx, ty: t.ty, field, richness: t.richness, rocks: [] });
      this.mirrors.set(key, this.map.key(t.tx, t.ty));
    }
  }

  /**
   * A gravity vent with its footprint's top-left tile at `at` (block the footprint first): a ring of ore of its own
   * (field `field`) about ENGINE.ventOreRadius tiles from its middle, as ragged as a normal field's edge but the same
   * on opposite sides of the vent (and left and right, top and bottom), so a vent between two mirrored bases is as
   * good for both.
   */
  addVent(field: number, at: Tile, rng: Rng): void {
    const size = sceneryKind(VENT_KIND).size;
    const cx = at.tx + size / 2;
    const cy = at.ty + size / 2;
    const radius = ENGINE.ventOreRadius;
    const reach = Math.ceil(radius * 1.3);
    const jitter = new Map<string, number>();
    for (let tx = Math.floor(cx) - reach; tx <= Math.floor(cx) + reach; tx++) {
      for (let ty = Math.floor(cy) - reach; ty <= Math.floor(cy) + reach; ty++) {
        const dx = tx + 0.5 - cx;
        const dy = ty + 0.5 - cy;
        // (a tile and its mirror images across the vent, left to right, top to bottom and opposite, share one random
        // nudge: the ring is the same seen from bases mirrored either way)
        const side = `${Math.abs(dx)},${Math.abs(dy)}`;
        if (!jitter.has(side)) jitter.set(side, rng.range(-0.25, 0.25));
        const d = Math.hypot(dx, dy) / radius + jitter.get(side)!;
        if (d < 1 && !this.map.isBlocked(tx, ty) && !this.at(tx, ty)) this.tiles.set(this.map.key(tx, ty), { tx, ty, field, richness: 1 - d, rocks: [] });
      }
    }
    this.vents.push({ tx: at.tx, ty: at.ty, field });
  }

  isVentField(field: number): boolean {
    return this.vents.some((v) => v.field === field);
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
    const placed = new Map<number, number>();
    for (const tile of tiles) {
      const key = this.map.key(tile.tx, tile.ty);
      if (this.mirrors.has(key)) continue; // filled after the tile it copies
      const units = Math.max(1, Math.min(max, Math.round((max * ECONOMY.resourceStartDensity * weight(tile)) / mean + rng.range(-1, 1))));
      placed.set(key, units);
      this.fill(tile, units, rng, nextId);
    }
    for (const [key, from] of this.mirrors) this.fill(this.tiles.get(key)!, placed.get(from) ?? 1, rng, nextId);
    this.mirrors.clear();
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
   * Where a harvester at (gx, gy) working `field` should mine next: the nearest tile worth the trip (at least half
   * full) in its own field; once its field has none, the field nearest its base (`base`, its refinery) among the ore
   * `allow` lets it go for (what its side has seen), and that field's nearest tile; failing those, whatever is left.
   * Stops harvesters scraping single regrown units off an exhausted field while a full one waits elsewhere, and from
   * wandering off to far or unexplored ore while there's some by the base.
   */
  pickFor(gx: number, gy: number, field: number, base: { gx: number; gy: number } = { gx, gy }, allow: (t: OreTile) => boolean = () => true): OreTile | null {
    const worth = ECONOMY.resourceTileMaxUnits / 2;
    const own = this.closest(gx, gy, (t) => t.field === field && this.units(t) >= worth);
    if (own) return own;
    const next = this.closest(base.gx, base.gy, (t) => allow(t) && this.units(t) >= worth);
    if (next) return this.closest(gx, gy, (t) => t.field === next.field && this.units(t) >= worth) ?? next;
    return this.closest(gx, gy, (t) => t.field === field) ?? this.closest(base.gx, base.gy, allow) ?? this.closest(gx, gy, () => true);
  }

  /** The field a harvester based at (gx, gy) should work: the one with ore nearest it among what `allow` lets it go for. */
  fieldFor(gx: number, gy: number, allow: (t: OreTile) => boolean = () => true): number {
    return (this.closest(gx, gy, allow) ?? this.closest(gx, gy, () => true))?.field ?? -1;
  }

  /** The tile with rocks left nearest (gx, gy) that passes `test`. */
  private closest(gx: number, gy: number, test: (t: OreTile) => boolean): OreTile | null {
    let best: OreTile | null = null;
    let bestD = Infinity;
    for (const tile of this.tiles.values()) {
      if (!tile.rocks.length || !test(tile)) continue;
      const d = Math.hypot(tile.tx + 0.5 - gx, tile.ty + 0.5 - gy);
      if (d < bestD) {
        best = tile;
        bestD = d;
      }
    }
    return best;
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
      if (this.isVentField(t.field)) continue; // (feedVents)
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
      if (t.rocks.length || t.richness < ROOT_RICHNESS || this.map.isBlocked(t.tx, t.ty) || this.isVentField(t.field)) continue;
      if (rng.next() < ECONOMY.resourceRootRegrowthChance) this.addUnit(t, rng, nextId, changes);
    }
  }

  /** (see spread) */
  private spreadFrom(rng: Rng, nextId: () => number, changes: OreChange[]): void {
    const half = ECONOMY.resourceTileMaxUnits / 2;
    for (const t of this.tiles.values()) {
      if (t.rocks.length || this.map.isBlocked(t.tx, t.ty) || this.isVentField(t.field)) continue;
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

  /**
   * Vent tick (every growth tick, whatever the spreadsheet says about regrowth): each tile of a vent's field below full,
   * emptied ones too, gains a unit with ENGINE.ventGrowthChance, and an emptied tile touching the vent always starts
   * again. Never under a building.
   */
  feedVents(rng: Rng, nextId: () => number, changes: OreChange[]): void {
    if (!this.vents.length) return;
    const max = ECONOMY.resourceTileMaxUnits;
    const size = sceneryKind(VENT_KIND).size;
    for (const v of this.vents) {
      for (const t of this.tiles.values()) {
        if (t.field !== v.field || this.map.isBlocked(t.tx, t.ty)) continue;
        const units = this.units(t);
        if (units >= max) continue;
        const touching = t.tx >= v.tx - 1 && t.tx <= v.tx + size && t.ty >= v.ty - 1 && t.ty <= v.ty + size;
        if ((units === 0 && touching) || rng.next() < ENGINE.ventGrowthChance) this.addUnit(t, rng, nextId, changes);
      }
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
