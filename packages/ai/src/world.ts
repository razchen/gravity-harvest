// What the computer knows, built only from what its side is sent: the hello (map size, the ore and scenery every
// player is shown, its catalog) and each view (its own units and buildings, enemies in sight, discovered enemy
// buildings, its fog, events). It remembers what it has seen, as a player would.
import type { BuildingView, MatchEvent, MatchHello, TeamId, TeamView, UnitView } from '@gravity-harvest/shared';
import { sceneryKind } from '@gravity-harvest/sim/layout';

export interface OreField {
  id: number;
  /** Middle of the field's tiles. */
  gx: number;
  gy: number;
  tiles: number[];
}

/** An enemy unit as last seen. */
export interface Sighting {
  id: number;
  type: string;
  gx: number;
  gy: number;
  hp: number;
  maxHp: number;
  atMs: number;
}

/**
 * What the World remembers between views, as plain data (for saving the computer's memory with a match). The rest
 * (the map, its scenery and fields) comes from the hello again, and each view replaces what it says about now.
 * Lists keep the order the World's maps had: that order decides ties, so a restored computer plays the same.
 */
export interface WorldMemory {
  fog: string;
  /** Ore tiles and the rocks on each, in the order they were first known. */
  ore: { tx: number; ty: number; richness: number; rocks: number[] }[];
  enemyUnits: Sighting[];
  lastShot: [number, number][];
  lastHit: [number, { atMs: number; from: number; gx: number; gy: number }][];
  /** Events seen since the last think. */
  events: MatchEvent[];
}

/** How long an enemy unit out of sight is still counted (ms). */
const FORGET_UNITS_MS = 150_000;

export class World {
  readonly width: number;
  readonly height: number;
  readonly team: TeamId;
  /** Tiles blocked by scenery (trees, rocks, wrecks): they never change. */
  private readonly scenery = new Set<number>();
  /** Ore tiles and the rocks on each. */
  readonly ore = new Map<number, { tx: number; ty: number; richness: number; rocks: Set<number> }>();
  private readonly rockTile = new Map<number, number>();
  readonly fields: OreField[] = [];
  /** Gravity vents (the middle of each): ore that never runs out, worth holding. */
  readonly vents: { gx: number; gy: number }[] = [];
  fog = '';
  timeMs = 0;
  view: TeamView | null = null;
  own: { units: UnitView[]; buildings: BuildingView[] } = { units: [], buildings: [] };
  /** Enemy buildings discovered, as last seen (one destroyed out of sight stays until its spot is seen again). */
  enemyBuildings: BuildingView[] = [];
  /** Enemy units seen recently. */
  readonly enemyUnits = new Map<number, Sighting>();
  /** When each of our units last fired, and when each of our units or buildings was last hit (and from where). */
  readonly lastShot = new Map<number, number>();
  readonly lastHit = new Map<number, { atMs: number; from: number; gx: number; gy: number }>();
  private ownIds = new Set<number>();
  private unitById = new Map<number, UnitView>();
  /** Event log since the last think (drained by the AI). */
  events: MatchEvent[] = [];

  constructor(hello: MatchHello) {
    this.width = hello.map.width;
    this.height = hello.map.height;
    this.team = hello.team;
    for (const s of hello.scenery) {
      const k = sceneryKind(s.kind);
      if (k.category === 'vent') this.vents.push({ gx: s.tx + k.size / 2, gy: s.ty + k.size / 2 });
      if (!k.blocks) continue;
      for (let x = s.tx; x < s.tx + k.size; x++) for (let y = s.ty; y < s.ty + k.size; y++) if (this.inBounds(x, y)) this.scenery.add(this.key(x, y));
    }
    for (const t of hello.ore.tiles) this.ore.set(this.key(t.tx, t.ty), { tx: t.tx, ty: t.ty, richness: t.richness, rocks: new Set() });
    for (const r of hello.ore.rocks) this.addRock(r.id, r.tx, r.ty);
    this.findFields();
  }

  key(tx: number, ty: number): number {
    return ty * this.width + tx;
  }

  inBounds(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.width && ty < this.height;
  }

  /** Ore tiles that touch make a field. */
  private findFields(): void {
    const seen = new Set<number>();
    for (const k of this.ore.keys()) {
      if (seen.has(k)) continue;
      const tiles: number[] = [];
      const stack = [k];
      seen.add(k);
      while (stack.length) {
        const c = stack.pop()!;
        tiles.push(c);
        const o = this.ore.get(c)!;
        for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
          const n = this.key(o.tx + dx, o.ty + dy);
          if (this.inBounds(o.tx + dx, o.ty + dy) && this.ore.has(n) && !seen.has(n)) {
            seen.add(n);
            stack.push(n);
          }
        }
      }
      const gx = tiles.reduce((n, c) => n + this.ore.get(c)!.tx + 0.5, 0) / tiles.length;
      const gy = tiles.reduce((n, c) => n + this.ore.get(c)!.ty + 0.5, 0) / tiles.length;
      this.fields.push({ id: this.fields.length, gx, gy, tiles });
    }
  }

  private addRock(id: number, tx: number, ty: number): void {
    const k = this.key(tx, ty);
    let t = this.ore.get(k);
    if (!t) this.ore.set(k, (t = { tx, ty, richness: 0, rocks: new Set() }));
    t.rocks.add(id);
    this.rockTile.set(id, k);
  }

  /** Take in a view (every one fetched for this side, in order). */
  observe(v: TeamView): void {
    this.view = v;
    this.timeMs = v.timeMs;
    if (v.fog) this.fog = v.fog;
    this.own = { units: v.units.filter((u) => u.team === this.team), buildings: v.buildings.filter((b) => b.team === this.team) };
    this.enemyBuildings = v.buildings.filter((b) => b.team !== this.team);
    this.ownIds = new Set([...this.own.units.map((u) => u.id), ...this.own.buildings.map((b) => b.id)]);
    this.unitById = new Map(v.units.map((u) => [u.id, u]));
    for (const u of v.units) {
      if (u.team === this.team) continue;
      this.enemyUnits.set(u.id, { id: u.id, type: u.type, gx: u.gx, gy: u.gy, hp: u.hp, maxHp: u.maxHp, atMs: v.timeMs });
    }
    for (const e of v.events) {
      switch (e.e) {
        case 'rockGone': {
          const k = this.rockTile.get(e.id);
          if (k !== undefined) this.ore.get(k)?.rocks.delete(e.id);
          this.rockTile.delete(e.id);
          break;
        }
        case 'rockAdded':
          this.addRock(e.rock.id, e.rock.tx, e.rock.ty);
          break;
        case 'unitDied':
          this.enemyUnits.delete(e.id);
          this.lastShot.delete(e.id);
          this.lastHit.delete(e.id);
          break;
        case 'shot':
          if (this.ownIds.has(e.from)) this.lastShot.set(e.from, v.timeMs);
          else if (this.ownIds.has(e.to)) {
            const from = this.unitById.get(e.from);
            this.lastHit.set(e.to, { atMs: v.timeMs, from: e.from, gx: from?.gx ?? e.at.gx, gy: from?.gy ?? e.at.gy });
          }
          break;
      }
      this.events.push(e);
    }
    for (const [id, s] of this.enemyUnits) if (v.timeMs - s.atMs > FORGET_UNITS_MS) this.enemyUnits.delete(id);
  }

  /** What it remembers, as plain data (see WorldMemory). */
  memory(): WorldMemory {
    return {
      fog: this.fog,
      ore: [...this.ore.values()].map((t) => ({ tx: t.tx, ty: t.ty, richness: t.richness, rocks: [...t.rocks] })),
      enemyUnits: [...this.enemyUnits.values()].map((s) => ({ ...s })),
      lastShot: [...this.lastShot],
      lastHit: [...this.lastHit].map(([id, h]) => [id, { ...h }]),
      events: JSON.parse(JSON.stringify(this.events)) as MatchEvent[],
    };
  }

  /** Take back what a `memory()` held (on a World made from the same hello). */
  remember(m: WorldMemory): void {
    this.fog = m.fog;
    this.ore.clear();
    this.rockTile.clear();
    for (const t of m.ore) {
      const k = this.key(t.tx, t.ty);
      this.ore.set(k, { tx: t.tx, ty: t.ty, richness: t.richness, rocks: new Set(t.rocks) });
      for (const r of t.rocks) this.rockTile.set(r, k);
    }
    this.enemyUnits.clear();
    for (const s of m.enemyUnits) this.enemyUnits.set(s.id, { ...s });
    this.lastShot.clear();
    for (const [id, ms] of m.lastShot) this.lastShot.set(id, ms);
    this.lastHit.clear();
    for (const [id, h] of m.lastHit) this.lastHit.set(id, { ...h });
    this.events = JSON.parse(JSON.stringify(m.events)) as MatchEvent[];
  }

  isOwn(id: number): boolean {
    return this.ownIds.has(id);
  }

  /** '0' unexplored, '1' explored, '2' in sight. */
  fogAt(tx: number, ty: number): number {
    if (!this.inBounds(tx, ty) || !this.fog) return 0;
    return this.fog.charCodeAt(this.key(tx, ty)) - 48;
  }

  hasOre(tx: number, ty: number): boolean {
    return (this.ore.get(this.key(tx, ty))?.rocks.size ?? 0) > 0;
  }

  /** Blocked for building or driving, as far as this side knows: off the map, scenery, or a known building. */
  isBlocked(tx: number, ty: number): boolean {
    if (!this.inBounds(tx, ty) || this.scenery.has(this.key(tx, ty))) return true;
    for (const b of this.view?.buildings ?? []) if (tx >= b.tx && tx < b.tx + b.size && ty >= b.ty && ty < b.ty + b.size) return true;
    return false;
  }

  /** Rocks left in a field (each is a few loads' worth), counting only tiles this side has explored. */
  fieldRocks(f: OreField): number {
    let n = 0;
    for (const k of f.tiles) {
      const t = this.ore.get(k)!;
      if (this.fogAt(t.tx, t.ty) > 0) n += t.rocks.size;
    }
    return n;
  }

  /** Recently seen enemy units. */
  sightings(): Sighting[] {
    return [...this.enemyUnits.values()];
  }
}
