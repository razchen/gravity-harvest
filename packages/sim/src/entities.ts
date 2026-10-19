// What is on the map: buildings and units, and the players. Plain data (saved as it is, snapshot.ts); the systems in
// ./systems give it its behaviour.
import { UNITS, weapon, type Armor, type Faction } from '@gravity-harvest/rules';
import type { Difficulty, GridPoint, MatchStats, TeamId } from '@gravity-harvest/shared';

export interface Building {
  readonly cat: 'building';
  id: number;
  type: string;
  team: TeamId;
  tx: number;
  ty: number;
  size: number;
  hp: number;
  maxHp: number;
  armor: Armor;
  progress: number;
  built: boolean;
  alive: boolean;
  /** Teams that have discovered it (always includes the owner). */
  seenBy: Set<TeamId>;
  /** Refineries: the harvester docked or heading to the dock. Service Bays: the vehicle on the pad or heading to it. */
  occupant: number | null;
  /** Built during the match (a finished refinery then grants a harvester). */
  constructed: boolean;
  /** Being repaired (until full, or until the money runs out). */
  repairing: boolean;
  /** Building speed-up: an Assembler's yard unpacks in seconds rather than being built from scratch. */
  boost: number;
  /** Defences: the head's direction (TURRET_DIRECTIONS steps; -1 = at rest), what it's shooting at, and each weapon's reload. */
  dir: number;
  target: number | null;
  cools: number[];
}

export type HarvesterState = 'idle' | 'move' | 'toOre' | 'harvest' | 'toDock' | 'toWait' | 'wait' | 'docking' | 'unload' | 'closing';

/** A point on a unit's path; `back`: it reverses there, still facing the way it faced (backing onto a ramp). */
export interface Waypoint extends GridPoint {
  back?: boolean;
}

interface UnitBase {
  readonly cat: 'unit';
  id: number;
  type: string;
  team: TeamId;
  gx: number;
  gy: number;
  dir: number;
  hp: number;
  maxHp: number;
  armor: Armor;
  alive: boolean;
  path: Waypoint[];
  moving: boolean;
  /** Tiles per second. */
  speed: number;
  sight: number;
  /** How long it has made no headway along its path (ms), and how often it has gone round what's in its way since. */
  stuck: number;
  detours: number;
}

export interface Harvester extends UnitBase {
  kind: 'harvester';
  state: HarvesterState;
  cargo: number;
  field: number;
  home: number | null;
  oreKey: number | null;
  lastOreKey: number | null;
  timer: number;
  unloaded: number;
  /** When it docked (sim ms; absent in older saves). */
  dockedAt?: number;
  /** Idle because it was told to stop or move (it waits for orders); otherwise idle means it's looking for work. */
  parked: boolean;
  /** Idle and looking for work: until it looks again for ore and a refinery (ms). */
  retry: number;
}

// A fighter (every unit that isn't a harvester) is made of one part per mechanic, each owned by one system. They are
// flat on the unit, not nested, so a save keeps the shape it has always had (snapshot.ts).

/** Its orders, and what it does about them (fighters.ts, movement.ts). */
export interface FighterOrders {
  /**
   * `service`: going to a Service Bay's pad, repaired on it, or waiting for it (`service`). `board`: infantry walking
   * to a transport and getting in (`board`).
   */
  mode: 'idle' | 'move' | 'attack' | 'service' | 'board';
  /** What it's shooting at, or (a Medic or Engineer) seeing to. */
  target: number | null;
  /** Long-range objective: attacked when nothing else is in sight (no order sets it now that the AI plays by orders). */
  mission: number | null;
  /** Guard post: stay near it and return after a chase. */
  post: GridPoint | null;
  /** Where a move order was heading when the unit stopped to fight; it carries on there afterwards. */
  resume: GridPoint | null;
  /**
   * On an attack-move: its point. On the way it looks for a fight as far as an idle unit would (buildings too), stops
   * for it, and carries on once it's over (or the enemy got away); cleared when it gets there or is given another order.
   */
  attackMove: GridPoint | null;
  /** Where it stopped after a move: nudged off it by a unit passing, it goes back once the spot is free. */
  rest: GridPoint | null;
  /** Until it next looks for something to shoot or see to (ms), and until it next works out a way there (ms). */
  scan: number;
  repath: number;
}

/** Its weapons (combat.ts). */
export interface Armament {
  weapons: string[];
  /** Each weapon's reload (ms; they fire independently), and a Medic's or Engineer's between heals or sparks. */
  cools: number[];
  cool: number;
  /** A turret that turns on its own (the `turret` capability): its direction (TURRET_DIRECTIONS steps; -1 = along the hull). */
  aim: number;
}

/** At a Service Bay: which one, whether it's waiting for the pad, and whether it's driving off it (service.ts). */
export interface ServiceVisit {
  service: { bay: number; waiting: boolean; leaving: boolean } | null;
}

/**
 * Transports (the rules' `passengers` > 0): how many it carries, who is inside (off the map, kept as they were), its
 * side doors, until the next one may go in or out (ms), and whether it's letting them all out (transport.ts).
 */
export interface Cabin {
  seats: number;
  passengers: Fighter[];
  hatch: 'closed' | 'opening' | 'open' | 'closing';
  hatchTimer: number;
  gap: number;
  unloading: boolean;
}

/** Infantry on a `board` order: the transport, whether it's at its door (waiting to go in), and which door (transport.ts). */
export interface Boarding {
  board: { transport: number; atDoor: boolean; side: 1 | -1 } | null;
}

/** A Medic or Engineer: how long its arms keep working (ms), for its animation (absent in older saves; support.ts). */
export interface SupportWork {
  work?: number;
}

export interface Fighter extends UnitBase, FighterOrders, Armament, ServiceVisit, Cabin, Boarding, SupportWork {
  kind: 'fighter';
}

export type Unit = Harvester | Fighter;
export type Entity = Building | Unit;

export interface QueueItem {
  unit: string;
  progress: number;
  near?: GridPoint;
}

export interface PlayerState {
  team: TeamId;
  credits: number;
  human: boolean;
  faction: Faction;
  queue: QueueItem[];
  stats: MatchStats;
  /** A computer side: how well it plays (its AI runs outside the sim, in packages/ai; kept here so saves carry it). */
  difficulty: Difficulty;
}

export const isHarvesterType = (type: string) => type === 'harvester';
/** Ground vehicles (combat and support, harvesters included): what a Service Bay repairs. Not infantry, aircraft or ships. */
export const isVehicleType = (type: string) => UNITS[type]?.category?.endsWith('Vehicle') ?? false;
/** Soldiers: what rides in transports. */
export const isInfantryType = (type: string) => UNITS[type]?.category === 'Infantry';
/** A unit's heal (a weapon that mends instead of harming: the Medic's), if it has one. */
export const healOf = (type: string): string | null => UNITS[type]?.weapons.find((w) => weapon(w).damage < 0) ?? null;

/** Distance in tiles from a point to a unit, or to the edge of a building's footprint. */
export function distTo(a: GridPoint, t: Entity): number {
  if (t.cat === 'building') {
    const dx = Math.max(t.tx - a.gx, 0, a.gx - (t.tx + t.size));
    const dy = Math.max(t.ty - a.gy, 0, a.gy - (t.ty + t.size));
    return Math.hypot(dx, dy);
  }
  return Math.hypot(t.gx - a.gx, t.gy - a.gy);
}

export const centre = (b: Building): GridPoint => ({ gx: b.tx + b.size / 2, gy: b.ty + b.size / 2 });
export const pos = (e: Entity): GridPoint => (e.cat === 'building' ? centre(e) : { gx: e.gx, gy: e.gy });
