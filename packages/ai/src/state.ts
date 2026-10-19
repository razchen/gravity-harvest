// Everything the computer remembers from one think to the next, in one plain object: numbers, strings, arrays and
// plain records only (no Sets, Maps or class instances), so it can go into a save game as JSON and come back as the
// same player. Sets are kept as arrays of IDs, maps as records keyed by ID or type, and "never" or "not yet" is null
// (JSON has no Infinity). Each part of the computer (see brain.ts) keeps its own section.
import { ECONOMY } from '@gravity-harvest/rules';
import type { Command, GridPoint } from '@gravity-harvest/shared';
import type { AiProfile } from './profiles.js';
import type { WorldMemory } from './world.js';

/** What it did, for the simulator's reports. */
export interface AiReport {
  orders: number;
  waves: number;
  firstAttackMs: number | null;
  /** Buildings it ordered that never appeared (the spot turned out to be taken). */
  failedPlacements: number;
  /** When it first knew where an enemy building was. */
  foundEnemyMs: number | null;
  /** When it first found no room for a building it wanted (its base is out of space). */
  noSpaceMs: number | null;
}

export interface Wave {
  units: number[];
  /** An enemy building, or a place to look for them (and how close it has got to that place, and when). */
  target: number | null;
  explore: GridPoint | null;
  /** `d` is null until it has had a first look at how far it is. */
  closest: { d: number | null; ms: number };
  launchedValue: number;
}

export interface AiState {
  /** Bumped when this shape changes, so a save's AI memory from an older version is dropped, not misread. */
  version: 1;
  /** The random generator's state. */
  rng: number;
  /** Orders decided but not given yet (reaction time), the order budget (actions per minute), and the last place each unit was sent. */
  orders: {
    nextThinkMs: number;
    pending: { due: number; cmd: Command }[];
    tokens: number;
    tokenMs: number;
    lastSent: Partial<Record<number, { gx: number; gy: number; ms: number }>>;
  };
  /** Where home is (the middle of its buildings) and where the army gathers. */
  home: GridPoint;
  rally: GridPoint;
  economy: {
    /** How many harvesters it means to have (lost ones are replaced up to this). */
    harvesterGoal: number;
    /** Credits earned so far, sampled each think over the income window: [time, earned]. */
    earned: [number, number][];
    /** The ore field (its index in the World's fields) an Assembler is on its way to. */
    expansion: { field: number; unit: number | null; tries: number } | null;
    /** When each Assembler last tried to deploy. */
    deployAt: Partial<Record<number, number>>;
    brokeSince: number | null;
  };
  base: {
    /** When we lost a building of each type (it waits `rebuildDelayMs` before putting it up again). */
    lostAt: Partial<Record<string, number>>;
    /** Buildings ordered, to check they went up. */
    placed: { type: string; tx: number; ty: number; checkAt: number }[];
    /** Spots (tile keys) where a building it ordered never went up. */
    badSpots: number[];
    /** Cost of the building it is saving up for (production keeps some of it in hand). */
    savingFor: number;
  };
  army: {
    wave: Wave | null;
    nextWaveMs: number;
    waveWaits: number;
    threatSince: number | null;
    defenders: number[];
    retreating: number[];
    /** When it last had a good look at the enemy's army. */
    sawArmyMs: number | null;
  };
  scouting: {
    scout: { id: number; target: GridPoint | null; legs: number } | null;
    /** Null: it doesn't scout. */
    nextScoutMs: number | null;
    /** Places (tile keys) to look at that it couldn't get to. */
    unreachable: number[];
  };
  report: AiReport;
  /** What it has seen of the map and the enemy. */
  world: WorldMemory;
}

/** The state the computer has while it plays (the random generator and the World keep theirs until it's saved). */
export type LiveState = Omit<AiState, 'rng' | 'world'>;

/** A new player's state. */
export function startState(profile: AiProfile): LiveState {
  return {
    version: 1,
    orders: { nextThinkMs: 0, pending: [], tokens: 5, tokenMs: 0, lastSent: {} },
    home: { gx: 0, gy: 0 },
    rally: { gx: 0, gy: 0 },
    economy: { harvesterGoal: 1, earned: [], expansion: null, deployAt: {}, brokeSince: null },
    base: { lostAt: {}, placed: [], badSpots: [], savingFor: 0 },
    army: { wave: null, nextWaveMs: ECONOMY.aiFirstAttackMinutes * 60_000 * profile.attackTimeShift, waveWaits: 0, threatSince: null, defenders: [], retreating: [], sawArmyMs: null },
    scouting: { scout: null, nextScoutMs: profile.scoutEveryMs ? 20_000 : null, unreachable: [] },
    report: { orders: 0, waves: 0, firstAttackMs: null, failedPlacements: 0, foundEnemyMs: null, noSpaceMs: null },
  };
}

/** Add an ID to a list kept as a set. */
export function addTo(list: number[], id: number): void {
  if (!list.includes(id)) list.push(id);
}

/** Take an ID out of a list kept as a set. */
export function removeFrom(list: number[], id: number): void {
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
}
