// What depends on what: prerequisites, producers, unlocks, tech order, validation.
// Written against a minimal catalog shape so the same logic runs on the full rules (server) and on the
// public subset (browser), without the browser bundle ever importing the full data.
import type { FactionScope, Stage } from './types.js';
import { STAGES } from './types.js';

export interface CatalogBuilding {
  id: string;
  faction: FactionScope;
  stage: Stage;
  prerequisites: string[];
}

export interface CatalogUnit {
  id: string;
  faction: FactionScope;
  stage: Stage;
  producedAt: string[];
  prerequisites: string[][];
}

export interface Catalog {
  buildings: Readonly<Record<string, CatalogBuilding>>;
  units: Readonly<Record<string, CatalogUnit>>;
}

/** A requirement is met by owning any one of its alternatives. */
export type Requirement = string[];

export interface AvailabilityOptions {
  /** Treat these building IDs as owned (e.g. buildings left out of a reduced roster). */
  assumeOwned?: ReadonlySet<string>;
}

const available = (scope: FactionScope, faction: 'ordan' | 'sable') => scope === 'both' || scope === faction;

/** Everything an entity needs before it can be built, as requirements (each = alternatives). */
export function requirementsOf(cat: Catalog, id: string): Requirement[] {
  const b = cat.buildings[id];
  if (b) return b.prerequisites.map((p) => [p]);
  const u = cat.units[id];
  if (u) return [u.producedAt, ...u.prerequisites];
  throw new Error(`Unknown entity "${id}"`);
}

/** Requirements not met by the buildings a player owns (finished ones). Empty = can build. */
export function missingRequirements(cat: Catalog, id: string, owned: Iterable<string>, opts: AvailabilityOptions = {}): Requirement[] {
  const have = new Set(owned);
  for (const a of opts.assumeOwned ?? []) have.add(a);
  return requirementsOf(cat, id).filter((alts) => !alts.some((a) => have.has(a)));
}

/** Can this faction build it at all, and is every requirement met? */
export function canBuild(cat: Catalog, id: string, faction: 'ordan' | 'sable', owned: Iterable<string>, opts: AvailabilityOptions = {}): boolean {
  const e = cat.buildings[id] ?? cat.units[id];
  if (!e) throw new Error(`Unknown entity "${id}"`);
  return available(e.faction, faction) && missingRequirements(cat, id, owned, opts).length === 0;
}

/** Buildings (for this faction) a unit can come out of. */
export function producersOf(cat: Catalog, unitId: string, faction?: 'ordan' | 'sable'): string[] {
  const u = cat.units[unitId];
  if (!u) throw new Error(`Unknown unit "${unitId}"`);
  return u.producedAt.filter((p) => !faction || (cat.buildings[p] && available(cat.buildings[p].faction, faction)));
}

/** Units a building produces. */
export function productionOf(cat: Catalog, buildingId: string): string[] {
  return Object.values(cat.units).filter((u) => u.producedAt.includes(buildingId)).map((u) => u.id);
}

/** Entities that directly list this building as a prerequisite (or producer). */
export function directlyUnlocks(cat: Catalog, buildingId: string): string[] {
  const out: string[] = [];
  for (const b of Object.values(cat.buildings)) if (b.prerequisites.includes(buildingId)) out.push(b.id);
  for (const u of Object.values(cat.units)) if (u.producedAt.includes(buildingId) || u.prerequisites.some((alts) => alts.includes(buildingId))) out.push(u.id);
  return out;
}

/** Everything that (transitively) depends on this building. Losing it can lock these. */
export function dependentsOf(cat: Catalog, buildingId: string): string[] {
  const seen = new Set<string>();
  const queue = [buildingId];
  while (queue.length) {
    for (const d of directlyUnlocks(cat, queue.shift()!)) {
      if (!seen.has(d)) {
        seen.add(d);
        if (cat.buildings[d]) queue.push(d);
      }
    }
  }
  return [...seen];
}

/** Every building an entity needs, transitively (the full path to unlock it, ignoring alternatives' order). */
export function prerequisiteClosure(cat: Catalog, id: string): string[] {
  const seen = new Set<string>();
  const walk = (x: string) => {
    for (const alts of requirementsOf(cat, x)) {
      for (const a of alts) {
        if (!seen.has(a) && cat.buildings[a]) {
          seen.add(a);
          walk(a);
        }
      }
    }
  };
  walk(id);
  return [...seen];
}

export interface DependencyEdge {
  from: string;
  to: string;
  kind: 'prerequisite' | 'produces' | 'requires';
}

/** The whole dependency graph as edges (for docs, tooling, UI tech trees). */
export function dependencyGraph(cat: Catalog): DependencyEdge[] {
  const edges: DependencyEdge[] = [];
  for (const b of Object.values(cat.buildings)) for (const p of b.prerequisites) edges.push({ from: p, to: b.id, kind: 'prerequisite' });
  for (const u of Object.values(cat.units)) {
    for (const p of u.producedAt) edges.push({ from: p, to: u.id, kind: 'produces' });
    for (const alts of u.prerequisites) for (const p of alts) edges.push({ from: p, to: u.id, kind: 'requires' });
  }
  return edges;
}

/** Buildings in an order where every prerequisite comes first. Throws on a cycle. */
export function buildOrder(cat: Catalog): string[] {
  const out: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string, trail: string[]) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') throw new Error(`Prerequisite cycle: ${[...trail, id].join(' → ')}`);
    state.set(id, 'visiting');
    for (const p of cat.buildings[id]?.prerequisites ?? []) visit(p, [...trail, id]);
    state.set(id, 'done');
    out.push(id);
  };
  for (const id of Object.keys(cat.buildings)) visit(id, []);
  return out;
}

/** Problems with the catalog's references: unknown IDs, cycles, prerequisites from a later stage. */
export function validateCatalog(cat: Catalog): string[] {
  const problems: string[] = [];
  const isBuilding = (id: string) => id in cat.buildings;
  for (const b of Object.values(cat.buildings)) {
    for (const p of b.prerequisites) {
      if (!isBuilding(p)) problems.push(`${b.id}: unknown prerequisite "${p}"`);
      else if (STAGES.indexOf(cat.buildings[p].stage) > STAGES.indexOf(b.stage)) problems.push(`${b.id}: prerequisite ${p} is from a later stage`);
    }
  }
  for (const u of Object.values(cat.units)) {
    if (!u.producedAt.length) problems.push(`${u.id}: not produced anywhere`);
    for (const p of u.producedAt) if (!isBuilding(p)) problems.push(`${u.id}: unknown producer "${p}"`);
    for (const alts of u.prerequisites) for (const p of alts) if (!isBuilding(p)) problems.push(`${u.id}: unknown prerequisite "${p}"`);
    for (const f of ['ordan', 'sable'] as const) {
      if (!available(u.faction, f)) continue;
      if (!u.producedAt.some((p) => isBuilding(p) && available(cat.buildings[p].faction, f))) problems.push(`${u.id}: ${f} has no building that produces it`);
      for (const alts of u.prerequisites) {
        if (!alts.some((p) => isBuilding(p) && available(cat.buildings[p].faction, f))) problems.push(`${u.id}: ${f} can never meet requirement ${alts.join('|')}`);
      }
    }
  }
  try {
    buildOrder(cat);
  } catch (e) {
    problems.push((e as Error).message);
  }
  return problems;
}
