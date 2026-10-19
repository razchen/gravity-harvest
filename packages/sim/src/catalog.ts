// The roster as a match knows it: the full catalog limited to what is enabled, what players are told of it, and the
// production lanes.
import { BUILDINGS, CATALOG, UNITS, type Faction } from '@gravity-harvest/rules';
import type { MatchCatalog } from '@gravity-harvest/shared';
import { ASSUME_OWNED, ENGINE, ROSTER, matchCatalog } from './layout.js';

/** The full catalog limited to the roster, with stand-ins (see layout.ts). */
export const MATCH_CATALOG = matchCatalog(CATALOG);

/**
 * Production lanes: each kind of factory has a queue of its own, and the lanes build side by side (soldiers don't hold
 * up vehicles). Every lane holds up to ENGINE.queueMax.
 */
export type ProductionLane = 'infantry' | 'vehicle' | 'air' | 'naval';
export function laneOf(unit: string): ProductionLane {
  const c = UNITS[unit]?.category ?? '';
  return c === 'Infantry' ? 'infantry' : c === 'Aircraft' ? 'air' : c === 'Naval' ? 'naval' : 'vehicle';
}

/** What the browser is told about the roster (see MatchCatalog). */
export const MATCH_PUBLIC_CATALOG: MatchCatalog = {
  buildings: Object.fromEntries(ROSTER.buildings.map((id) => {
    const b = BUILDINGS[id];
    return [id, {
      id, name: b.name, faction: b.faction, stage: b.stage, cost: b.cost, buildTimeSec: b.buildTimeSec, power: b.power, prerequisites: [...MATCH_CATALOG.buildings[id].prerequisites],
      description: b.description ?? '', role: b.role ?? '', hp: b.hp, defense: b.weapons.length > 0,
    }];
  })),
  units: Object.fromEntries(ROSTER.units.map((id) => {
    const u = UNITS[id];
    const m = MATCH_CATALOG.units[id];
    return [id, {
      id, name: u.name, faction: u.faction, stage: u.stage, cost: u.cost, buildTimeSec: u.buildTimeSec, producedAt: [...m.producedAt], prerequisites: m.prerequisites.map((a) => [...a]), lane: laneOf(id),
      description: u.description ?? '', role: u.role ?? '', hp: u.hp,
    }];
  })),
  assumeOwned: [...ASSUME_OWNED],
  names: Object.fromEntries([...ROSTER.buildings, ...ROSTER.units, ...ASSUME_OWNED].map((id) => [id, (BUILDINGS[id] ?? UNITS[id]).name])),
  queueMax: ENGINE.queueMax,
};

/** The catalog one side is sent: its own faction's entries and the shared ones (the other side's stay unknown). */
export function catalogFor(faction: Faction): MatchCatalog {
  const mine = <T extends { faction: string }>(r: Record<string, T>) => Object.fromEntries(Object.entries(r).filter(([, d]) => d.faction === 'both' || d.faction === faction));
  const buildings = mine(MATCH_PUBLIC_CATALOG.buildings);
  const units = mine(MATCH_PUBLIC_CATALOG.units);
  const known = new Set([...Object.keys(buildings), ...Object.keys(units), ...MATCH_PUBLIC_CATALOG.assumeOwned]);
  return { ...MATCH_PUBLIC_CATALOG, buildings, units, names: Object.fromEntries(Object.entries(MATCH_PUBLIC_CATALOG.names).filter(([id]) => known.has(id))) };
}
