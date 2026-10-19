import { RULES_HASH, type Faction, type PowerBalance } from '@gravity-harvest/rules';
import type { BuildingView, Difficulty, MatchStats, TeamId } from '@gravity-harvest/shared';
import type { Rock, Vent } from './ore.js';
import { SCENARIOS, scenarioHash } from './scenarios.js';
import type { Scenery } from './scenery.js';
import type { Building, Fighter, Harvester, QueueItem } from './sim.js';

/**
 * Bump when the shape changes, and add the step from the version before to `MIGRATIONS` (migrations.ts). Version 1
 * was the browser-side format (before the server ran matches); version 2 had no scenery (still loads, as a bare map);
 * version 3 had trees only (`trees`); before version 5 the Assembly Yard was assumed (loading gives each side the
 * scenario's one, where it fits); version 6 added transports' passengers; version 7 added the computer's difficulty
 * (older saves play Normal); version 8 added gravity vents (older saves have none, and play on as they were); version 9
 * named the sides by seat (`a`, `b`) instead of `player` and `enemy`, and records which seat the human plays
 * (`human`); version 10 added the rules it was made with (`rulesHash`) and the computer players' seeds and memory
 * (`computers`; older saves start a fresh computer); version 11 keeps the whole match (what every unit and building is
 * doing, `live`, `scenarioHash`), so a save plays on exactly as the match it was taken from (older saves load with
 * every unit idle, as before).
 */
export const SNAPSHOT_VERSION = 11;
export const OLDEST_LOADABLE_VERSION = 2;

/** What a unit's or building's type gives it from the rules: not saved, so it comes from the rules a save loads under. */
type FromRules = 'cat' | 'maxHp' | 'armor' | 'alive';
type UnitFromRules = FromRules | 'speed' | 'sight';

/** A harvester as saved: everything it is doing (its route, its trip, its timers). */
export type SavedHarvester = Omit<Harvester, UnitFromRules>;
/** A fighter as saved: everything it is doing, and who rides inside it (saved the same way). */
export type SavedFighter = Omit<Fighter, UnitFromRules | 'weapons' | 'seats' | 'passengers'> & { passengers: SavedFighter[] };
export type SavedUnit = SavedHarvester | SavedFighter;
/** A building as saved: its build, repair and defence state, and which sides have discovered it. */
export type SavedBuilding = Omit<Building, FromRules | 'size' | 'seenBy'> & { seenBy: TeamId[] };

export interface SavedPlayer {
  credits: number;
  queue: QueueItem[];
  stats: MatchStats;
  /** A person plays this seat, not the computer. */
  human: boolean;
  faction: Faction;
  difficulty: Difficulty;
}

/**
 * The match as it is between two ticks, beyond what's on the map: what each side sees right now and remembers of the
 * other's buildings, power, the sim's own clocks, debug speed-ups, and who won. Saves from before version 11 don't have
 * it: loading rebuilds it from the rest (fog and memories from what is in sight now). Events waiting for `takeEvents`
 * aren't part of the match (whoever runs it hands them out after every step), so a save never carries them.
 */
export interface LiveState {
  /** Per team, one char per tile: 0 unexplored, 1 explored, 2 in sight (the fog beneath any debug reveal). */
  fog: Record<TeamId, string>;
  revealAll: Record<TeamId, boolean>;
  /** Each side's picture of the other's buildings, as last seen, in the order it was kept. */
  ghosts: Record<TeamId, BuildingView[]>;
  power: Record<TeamId, PowerBalance>;
  fogTimer: number;
  growTimer: number;
  fast: Record<TeamId, number>;
  winner: TeamId | null;
}

/**
 * Everything needed to carry on a match exactly where it was: restoring it and playing on with the same orders gives
 * the same match, tick for tick, as the one it was taken from (tested). Plain JSON, stored server-side as the save's
 * state; never sent to players. What a type gets from the rules (health, armor, speed, weapons) isn't saved.
 * Older saves are brought up to this shape on load, one version at a time (`migrateSnapshot`, migrations.ts).
 */
export interface SimSnapshot {
  version: number;
  scenario: string;
  /** `scenarioHash` of the scenario it was played on (since version 11): the map is rebuilt from code on load. */
  scenarioHash?: string;
  tick: number;
  timeMs: number;
  nextId: number;
  rng: number;
  players: Record<TeamId, SavedPlayer>;
  buildings: SavedBuilding[];
  units: SavedUnit[];
  ore: { tx: number; ty: number; field: number; richness: number; rocks: Rock[] }[];
  /** Gravity vents and the ore field each seeds (the vent itself is in `scenery`). */
  vents: Vent[];
  scenery: Scenery[];
  /** Per team, one char per tile: 1 = explored. */
  explored: Record<TeamId, string>;
  /** Since version 11; absent in older saves (see LiveState). */
  live?: LiveState;
  /** RULES_HASH of the rules the match was played under (since version 10). Loading under other rules still works. */
  rulesHash?: string;
  /**
   * Each computer side's seed and memory (since version 10). The sim doesn't run the computer players, so it neither
   * writes nor reads this: whoever runs them (the server's match room) adds it to the snapshot and restores from it.
   */
  computers?: Partial<Record<TeamId, SavedComputer>>;
}

/** A computer player as saved: its seed and its `getState()` (plain JSON, opaque to the sim). */
export interface SavedComputer {
  seed: number;
  state: unknown;
}

/**
 * Why a save may not play as it did: made under other rules, or on a scenario that has changed since. It loads all the
 * same (whoever loads it logs these); an older save that doesn't record one or the other is taken as it is.
 */
export function saveWarnings(saved: Pick<SimSnapshot, 'scenario' | 'rulesHash' | 'scenarioHash'>): string[] {
  const out: string[] = [];
  if (saved.rulesHash && saved.rulesHash !== RULES_HASH) out.push(`made under other rules (${saved.rulesHash.slice(0, 12)})`);
  const sc = SCENARIOS[saved.scenario];
  if (sc && saved.scenarioHash && saved.scenarioHash !== scenarioHash(sc)) out.push(`made on an earlier version of the "${saved.scenario}" map`);
  return out;
}
