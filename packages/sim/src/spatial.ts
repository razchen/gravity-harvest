// Where the units are, in cells of a few tiles: "who is near here" looks at a few cells instead of every unit.
// Answers come in the order the units are in the match's `units` map (the order a scan of every unit would meet
// them), so whatever is decided from them (ties, sums) comes out exactly as from that scan.
import type { Unit } from './entities.js';

/** A cell's size in tiles (small enough that a cell holds few units, big enough that a look covers few cells). */
const CELL = 2;
const cellOf = (g: number) => Math.floor(g / CELL);
/** A cell's key (any integer cell, off the map too). */
const keyOf = (cx: number, cy: number) => cx * 65536 + cy;

/** A unit in the grid: its cell, and its place in the `units` map's order. */
interface Entry {
  readonly u: Unit;
  key: number;
  seq: number;
}

export class UnitGrid {
  private readonly cells = new Map<number, Entry[]>();
  private readonly entries = new Map<Unit, Entry>();
  private nextSeq = 0;

  /** Start again from the `units` map, in its order. */
  rebuild(units: Iterable<Unit>): void {
    this.cells.clear();
    this.entries.clear();
    this.nextSeq = 0;
    for (const u of units) this.add(u);
  }

  /** A unit just put at the end of the `units` map. */
  add(u: Unit): void {
    const e: Entry = { u, key: keyOf(cellOf(u.gx), cellOf(u.gy)), seq: this.nextSeq++ };
    this.entries.set(u, e);
    this.cell(e.key).push(e);
  }

  /** A unit taken out of the `units` map. */
  remove(u: Unit): void {
    const e = this.entries.get(u);
    if (!e) return;
    this.entries.delete(u);
    this.drop(e);
  }

  /** A unit's position changed: into another cell if it crossed into one. */
  moved(u: Unit): void {
    const e = this.entries.get(u);
    if (!e) return;
    const key = keyOf(cellOf(u.gx), cellOf(u.gy));
    if (key === e.key) return;
    this.drop(e);
    e.key = key;
    this.cell(key).push(e);
  }

  /** The units on a tile (and maybe others in its cell: callers check the tile themselves), in no particular order. */
  on(tx: number, ty: number): Unit[] {
    return (this.cells.get(keyOf(cellOf(tx), cellOf(ty))) ?? []).map((e) => e.u);
  }

  /**
   * Every unit in a box (and some a little outside it: whole cells), in the `units` map's order. Callers check the
   * distance themselves, as a scan of every unit would.
   */
  within(gx0: number, gy0: number, gx1: number, gy1: number): Unit[] {
    // a hair wider, so rounding at a cell's edge never leaves out a unit the caller's own check would let in
    const x0 = cellOf(gx0 - 1e-6), x1 = cellOf(gx1 + 1e-6), y0 = cellOf(gy0 - 1e-6), y1 = cellOf(gy1 + 1e-6);
    const found: Entry[] = [];
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const c = this.cells.get(keyOf(x, y));
        if (c) for (const e of c) found.push(e);
      }
    }
    if (found.length > 1) found.sort((a, b) => a.seq - b.seq);
    return found.map((e) => e.u);
  }

  /** Every unit within `reach` of a point along both axes (a square), in the `units` map's order. */
  near(gx: number, gy: number, reach: number): Unit[] {
    return this.within(gx - reach, gy - reach, gx + reach, gy + reach);
  }

  private cell(key: number): Entry[] {
    let c = this.cells.get(key);
    if (!c) this.cells.set(key, (c = []));
    return c;
  }

  private drop(e: Entry): void {
    const c = this.cells.get(e.key);
    const i = c ? c.indexOf(e) : -1;
    if (i < 0) return;
    c!.splice(i, 1);
    if (!c!.length) this.cells.delete(e.key);
  }
}
