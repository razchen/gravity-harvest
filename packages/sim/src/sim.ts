// The match: authoritative state and a fixed-step update. No rendering, no timers, no Math.random, so
// the same inputs give the same match (needed for saves and replays, replay.ts).
import {
  BUILDINGS, CATALOG, ECONOMY, UNITS, canBuild, creditsFor, missingRequirements, powerBalance, refundFor,
  speedToTilesPerSec, volleyDamage, weapon, weaponFor, layerOf, canHit, RULES_HASH, type Armor, type Faction, type PowerBalance,
} from '@gravity-harvest/rules';
import {
  DEFAULT_DIFFICULTY, TEAMS, emptyStats, opponentOf, perTeam, type BuildingView, type Difficulty, type Command, type DebugCommand, type GridPoint, type HarvesterActivity, type MatchEvent, type ToastCode,
  type MatchCatalog, type MatchHello, type MatchStats, type TeamId, type TeamView, type UnitView,
} from '@gravity-harvest/shared';
import { Fog, type Viewer } from './fog.js';
import { distance, facing, type Tile } from './geometry.js';
import { Grid } from './grid.js';
import {
  ASSUME_OWNED, DOCK_FACING, ENGINE, ROSTER, TICK_MS, VIEW_EVERY_TICKS, checkPlacement, footprint, matchCatalog, refineryDock, sceneryKind, VENT_KIND,
  FACTION_COUNTERPART, FIXERS, HOVER_UNITS, TURRET_UNITS, doorSide, serviceBayPad, viewerSide,
} from './layout.js';
import { Ore, type OreChange, type OreTile } from './ore.js';
import { findPath } from './pathfinder.js';
import { Rng } from './rng.js';
import { SCENARIOS, humanSeat, type ScenarioDef } from './scenarios.js';
import { OLDEST_LOADABLE_VERSION, SNAPSHOT_VERSION, migrateSnapshot, type SimSnapshot } from './snapshot.js';
import { growScenery, type Scenery } from './scenery.js';

/** The full catalog limited to the roster, with stand-ins (see layout.ts). */
export const MATCH_CATALOG = matchCatalog(CATALOG);

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

// --- State shapes -------------------------------------------------------------------------------------------

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

type HarvesterState = 'idle' | 'move' | 'toOre' | 'harvest' | 'toDock' | 'toWait' | 'wait' | 'docking' | 'unload' | 'closing';

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

export interface Fighter extends UnitBase {
  kind: 'fighter';
  /**
   * `service`: going to a Service Bay's pad, repaired on it, or waiting for it (`service`). `board`: infantry walking
   * to a transport and getting in (`board`).
   */
  mode: 'idle' | 'move' | 'attack' | 'service' | 'board';
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
  weapons: string[];
  /** Each weapon's reload (ms; they fire independently), and a Medic's or Engineer's between heals or sparks. */
  cools: number[];
  cool: number;
  scan: number;
  repath: number;
  /** A turret that turns on its own (TURRET_UNITS): its direction (TURRET_DIRECTIONS steps; -1 = along the hull). */
  aim: number;
  /** At a Service Bay: which one, whether it's waiting for the pad, and whether it's driving off it. */
  service: { bay: number; waiting: boolean; leaving: boolean } | null;
  /**
   * Transports (the rules' `passengers` > 0): how many it carries, who is inside (off the map, kept as they were), its
   * side doors, until the next one may go in or out (ms), and whether it's letting them all out.
   */
  seats: number;
  passengers: Fighter[];
  hatch: 'closed' | 'opening' | 'open' | 'closing';
  hatchTimer: number;
  gap: number;
  unloading: boolean;
  /** Infantry on a `board` order: the transport, whether it's at its door (waiting to go in), and which door. */
  board: { transport: number; atDoor: boolean; side: 1 | -1 } | null;
  /** A Medic or Engineer: how long its arms keep working (ms), for its animation (absent in older saves). */
  work?: number;
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

/** Options for a new match. */
export interface CreateOptions {
  /** The seat the human plays (the computer takes the other). Default: the scenario's human seat. */
  seat?: TeamId;
  /** How well the computer plays (each computer side). */
  difficulty?: Difficulty;
  /** The other side's faction, if not the opposite of the human's (mirror matches in simulations). */
  otherFaction?: Faction;
  /** Both sides played by the computer (AI against AI, headless simulations). */
  computerOnly?: boolean;
}

/** A point on a unit's path; `back`: it reverses there, still facing the way it faced (backing onto a ramp). */
interface Waypoint extends GridPoint {
  back?: boolean;
}

const isHarvesterType = (type: string) => type === 'harvester';
/** Ground vehicles (combat and support, harvesters included): what a Service Bay repairs. Not infantry, aircraft or ships. */
const isVehicleType = (type: string) => UNITS[type]?.category?.endsWith('Vehicle') ?? false;
/** Soldiers: what rides in transports. */
const isInfantryType = (type: string) => UNITS[type]?.category === 'Infantry';
/** A unit's heal (a weapon that mends instead of harming: the Medic's), if it has one. */
const healOf = (type: string): string | null => UNITS[type]?.weapons.find((w) => weapon(w).damage < 0) ?? null;
/**
 * Production lanes: each kind of factory has a queue of its own, and the lanes build side by side (soldiers don't hold
 * up vehicles). Every lane holds up to ENGINE.queueMax.
 */
export type ProductionLane = 'infantry' | 'vehicle' | 'air' | 'naval';
export function laneOf(unit: string): ProductionLane {
  const c = UNITS[unit]?.category ?? '';
  return c === 'Infantry' ? 'infantry' : c === 'Aircraft' ? 'air' : c === 'Naval' ? 'naval' : 'vehicle';
}
/** A defence (it shoots): built one at a time alongside one other building (each has its own build slot). */
const isDefence = (type: string) => BUILDINGS[type].weapons.length > 0;
/** How often an idle harvester with no orders looks for work again (ms). */
const HARVESTER_RETRY_MS = 3000;
/** Defence heads and vehicle turrets aim in this many directions (their sprites have as many: render_construction.py `turret`, render_vehicle.py). */
const TURRET_DIRECTIONS = 32;
/** The eight tiles around one. */
const NEIGHBOURS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Distance in tiles from a point to a unit, or to the edge of a building's footprint. */
export function distTo(a: GridPoint, t: Entity): number {
  if (t.cat === 'building') {
    const dx = Math.max(t.tx - a.gx, 0, a.gx - (t.tx + t.size));
    const dy = Math.max(t.ty - a.gy, 0, a.gy - (t.ty + t.size));
    return Math.hypot(dx, dy);
  }
  return Math.hypot(t.gx - a.gx, t.gy - a.gy);
}

const centre = (b: Building): GridPoint => ({ gx: b.tx + b.size / 2, gy: b.ty + b.size / 2 });
const pos = (e: Entity): GridPoint => (e.cat === 'building' ? centre(e) : { gx: e.gx, gy: e.gy });

// --- The simulation -----------------------------------------------------------------------------------------

export class Sim {
  readonly map: Grid;
  readonly ore: Ore;
  readonly fog: Record<TeamId, Fog>;
  readonly players: Record<TeamId, PlayerState>;
  /** Debug fast mode: each team's speed-up for building, production and movement (1 = normal; not saved). */
  private readonly fast: Record<TeamId, number> = perTeam(() => 1);
  readonly buildings = new Map<number, Building>();
  readonly units = new Map<number, Unit>();
  /** Trees, rocks (they block their tiles), bushes and logs. */
  scenery: Scenery[] = [];
  tick = 0;
  timeMs = 0;
  nextId = 1;
  rng: Rng;
  /** Set when the match ends. */
  winner: TeamId | null = null;
  /** Events each side has been told of since the last `takeEvents`. */
  private readonly pending: Record<TeamId, MatchEvent[]> = perTeam(() => []);
  /**
   * Each side's picture of the enemy buildings it has discovered, as they were when last in its sight. Out of sight it
   * is sent this instead of the real thing, and one destroyed or sold out of sight stays until the spot is seen again.
   */
  private readonly ghosts: Record<TeamId, Map<number, BuildingView>> = perTeam(() => new Map());
  private power: Record<TeamId, PowerBalance>;
  private fogTimer = 0;
  private growTimer = 0;

  private constructor(readonly scenario: ScenarioDef, seed: number) {
    this.map = new Grid(scenario.map.width, scenario.map.height);
    this.ore = new Ore(this.map);
    this.fog = perTeam(() => new Fog(this.map));
    const credits = (c: number | 'rules') => (c === 'rules' ? ECONOMY.startingCredits : c);
    this.players = perTeam((team) => {
      const sp = scenario.players[team];
      return { team, credits: credits(sp.credits), human: sp.human, faction: sp.faction, queue: [], stats: emptyStats(), difficulty: DEFAULT_DIFFICULTY };
    });
    this.rng = new Rng(seed);
    this.power = perTeam(() => powerBalance([]));
  }

  /**
   * A new match. `faction`: the faction of the human's seat (`opts.seat`, default the scenario's human seat); the computer
   * takes the other seat and the other faction. Both default to the scenario's. A scenario that isn't in SCENARIOS can be passed as it is
   * (a dev page's own little map); such a match can't be restored.
   */
  static create(scenarioId: string | ScenarioDef, seed = 1, faction?: Faction, opts: CreateOptions = {}): Sim {
    const sc = typeof scenarioId === 'string' ? SCENARIOS[scenarioId] : scenarioId;
    if (!sc) throw new Error(`Unknown scenario "${scenarioId}"`);
    const sim = new Sim(sc, seed);
    const seat = opts.seat ?? humanSeat(sc.players);
    if (opts.seat) for (const t of TEAMS) sim.players[t].human = t === seat;
    if (faction) {
      sim.players[seat].faction = faction;
      sim.players[opponentOf(seat)].faction = faction === 'ordan' ? 'sable' : 'ordan';
    }
    if (opts.otherFaction) sim.players[opponentOf(seat)].faction = opts.otherFaction;
    for (const t of TEAMS) {
      if (opts.difficulty) sim.players[t].difficulty = opts.difficulty;
      if (opts.computerOnly) sim.players[t].human = false;
    }
    // starting buildings of the other faction become the owner's own counterpart
    const buildings = sc.buildings.map((b) => {
      const f = BUILDINGS[b.type].faction;
      return f !== 'both' && f !== sim.players[b.team].faction && FACTION_COUNTERPART[b.type] ? { ...b, type: FACTION_COUNTERPART[b.type] } : b;
    });
    for (const b of buildings) sim.addBuilding(b.type, b.team, b.tx, b.ty, true);
    // gravity vents block their footprint before any ore is laid, so their rings go round them
    const vents = (sc.vents ?? []).map((v) => {
      const size = sceneryKind(VENT_KIND).size;
      sim.map.setFootprint(v.tx, v.ty, size, true);
      return { id: sim.nextId++, kind: VENT_KIND, tx: v.tx, ty: v.ty, gx: v.tx + size / 2, gy: v.ty + size / 2, scale: 1 };
    });
    sc.oreFields.forEach((f, i) => {
      if (f.mirrorOf !== undefined) sim.ore.addMirroredField(i, f.mirrorOf, sc.map.width);
      else sim.ore.addField(i, f.centre, f.radius, new Rng(f.seed));
    });
    (sc.vents ?? []).forEach((v, i) => sim.ore.addVent(sc.oreFields.length + i, v, new Rng(v.seed)));
    sim.ore.placeRocks(sim.rng, () => sim.nextId++);
    sim.scenery = [...vents, ...growScenery(sim.map, sim.ore, { buildings: buildings.map((b) => ({ ...b, size: footprint(b.type) })), units: sc.units, mirrorX: sc.mirrorX }, sim.rng, () => sim.nextId++)];
    const harvesters: Harvester[] = [];
    for (const u of sc.units) {
      const unit = sim.addUnit(u.type, u.team, u.gx, u.gy);
      if (unit.kind === 'harvester') harvesters.push(unit);
      else if (u.guard) unit.post = { gx: u.gx, gy: u.gy };
    }
    sim.refresh();
    sim.updateFog();
    // harvesters go to work once their side has looked around: the nearest field it can see
    for (const h of harvesters) sim.autoHarvest(h, true);
    return sim;
  }

  /** Resume a saved match. */
  static restore(saved: SimSnapshot): Sim {
    if (saved.version > SNAPSHOT_VERSION) throw new Error('Save is from a newer version');
    if (saved.version < OLDEST_LOADABLE_VERSION) throw new Error('Save is from an older version and can no longer be loaded');
    const raw = migrateSnapshot(saved);
    const sc = SCENARIOS[raw.scenario];
    if (!sc) throw new Error(`Unknown scenario "${raw.scenario}"`);
    const sim = new Sim(sc, raw.rng);
    sim.tick = raw.tick;
    sim.timeMs = raw.timeMs;
    for (const team of TEAMS) {
      const p = raw.players[team];
      Object.assign(sim.players[team], {
        credits: p.credits, queue: p.queue.map((q) => ({ ...q })), stats: { ...p.stats }, ...(p.human !== undefined && { human: p.human }),
        ...(p.faction && { faction: p.faction }), ...(p.difficulty && { difficulty: p.difficulty }),
      });
      sim.fog[team].restoreExplored(raw.explored[team]);
    }
    for (const b of raw.buildings) {
      const nb = sim.addBuilding(b.type, b.team, b.tx, b.ty, b.progress >= 1, b.id);
      Object.assign(nb, { hp: b.hp, progress: b.progress, constructed: b.constructed, seenBy: new Set<TeamId>([b.team, ...b.seenBy]), repairing: !!b.repairing });
    }
    sim.scenery = (raw.scenery ?? raw.trees ?? []).map((t) => ({ ...t }));
    for (const t of sim.scenery) {
      const k = sceneryKind(t.kind);
      if (k.blocks) sim.map.setFootprint(t.tx, t.ty, k.size, true);
    }
    for (const t of raw.ore) sim.ore.tiles.set(sim.map.key(t.tx, t.ty), { ...t, rocks: t.rocks.map((r) => ({ ...r })) });
    for (const v of raw.vents ?? []) sim.ore.vents.push({ ...v });
    for (const u of raw.units) {
      const nu = sim.addUnit(u.type, u.team, u.gx, u.gy, u.id);
      nu.hp = u.hp;
      if (nu.kind === 'harvester') {
        nu.cargo = u.cargo ?? 0;
        nu.field = u.field ?? sim.ore.nearestField(nu.gx, nu.gy);
      } else {
        nu.post = u.post ?? null;
        // its passengers, back inside it
        for (const p of u.passengers ?? []) {
          const np = sim.addUnit(p.type, u.team, u.gx, u.gy, p.id);
          sim.units.delete(np.id);
          np.hp = p.hp;
          if (np.kind === 'fighter') nu.passengers.push(np);
        }
      }
    }
    sim.nextId = raw.nextId;
    // saves from before the Assembly Yard was a real building: each side gets the scenario's one, where it fits
    if (raw.version < 5) {
      for (const y of sc.buildings.filter((b) => b.type === 'assembly_yard')) {
        if (sim.teamBuildings(y.team, false).some((b) => b.type === 'assembly_yard')) continue;
        const n = footprint(y.type);
        let free = true;
        for (let x = y.tx; x < y.tx + n; x++) for (let z = y.ty; z < y.ty + n; z++) if (sim.map.isBlocked(x, z)) free = false;
        if (free) sim.addBuilding(y.type, y.team, y.tx, y.ty, true);
      }
    }
    sim.refresh();
    // transient state (paths, timers, targets) isn't saved: harvesters go back to work, guards back to posts
    for (const u of sim.units.values()) {
      if (u.kind !== 'harvester') continue;
      u.home = sim.nearestRefinery(u.gx, u.gy, u.team)?.id ?? null;
      if (u.cargo >= ECONOMY.harvesterCapacity) sim.returnHome(u);
      else sim.autoHarvest(u);
    }
    sim.updateFog();
    // saves don't carry what each side last saw of the other's buildings: they start from how they are now
    for (const t of TEAMS) for (const b of sim.buildings.values()) if (b.team !== t && b.seenBy.has(t) && !sim.ghosts[t].has(b.id)) sim.ghosts[t].set(b.id, sim.buildingView(b, t));
    return sim;
  }

  snapshot(): SimSnapshot {
    return {
      version: SNAPSHOT_VERSION,
      scenario: this.scenario.id,
      tick: this.tick,
      timeMs: this.timeMs,
      nextId: this.nextId,
      rng: this.rng.state,
      players: perTeam((t) => {
        const p = this.players[t];
        return { credits: p.credits, queue: p.queue.map((q) => ({ ...q })), stats: { ...p.stats }, human: p.human, faction: p.faction, difficulty: p.difficulty };
      }),
      buildings: [...this.buildings.values()].map((b) => ({
        id: b.id, type: b.type, team: b.team, tx: b.tx, ty: b.ty, hp: b.hp, progress: b.progress, constructed: b.constructed, seenBy: [...b.seenBy],
        ...(b.repairing && { repairing: true }),
      })),
      units: [...this.units.values()].map((u) => u.kind === 'harvester'
        ? { id: u.id, type: u.type, team: u.team, gx: u.gx, gy: u.gy, hp: u.hp, cargo: u.cargo, field: u.field }
        : {
          id: u.id, type: u.type, team: u.team, gx: u.gx, gy: u.gy, hp: u.hp, post: u.post,
          ...(u.passengers.length > 0 && { passengers: u.passengers.map((p) => ({ id: p.id, type: p.type, hp: p.hp })) }),
        }),
      ore: [...this.ore.tiles.values()].map((t) => ({ tx: t.tx, ty: t.ty, field: t.field, richness: t.richness, rocks: t.rocks.map((r) => ({ ...r })) })),
      vents: this.ore.vents.map((v) => ({ ...v })),
      scenery: this.scenery.map((t) => ({ ...t })),
      explored: perTeam((t) => this.fog[t].serializeExplored()),
      rulesHash: RULES_HASH,
    };
  }

  // --- Entities ---------------------------------------------------------------------------------------------

  entity(id: number): Entity | undefined {
    return this.buildings.get(id) ?? this.units.get(id);
  }

  private addBuilding(type: string, team: TeamId, tx: number, ty: number, built: boolean, id = this.nextId++): Building {
    const def = BUILDINGS[type];
    if (!def) throw new Error(`Unknown building "${type}"`);
    const size = footprint(type);
    const b: Building = {
      cat: 'building', id, type, team, tx, ty, size, hp: def.hp, maxHp: def.hp, armor: def.armor,
      progress: built ? 1 : 0, built, alive: true, seenBy: new Set([team]), occupant: null, constructed: !built,
      repairing: false, boost: 1, dir: -1, target: null, cools: def.weapons.map(() => 0),
    };
    this.buildings.set(id, b);
    this.map.setFootprint(tx, ty, size, true);
    return b;
  }

  private addUnit(type: string, team: TeamId, gx: number, gy: number, id = this.nextId++): Unit {
    const def = UNITS[type];
    if (!def) throw new Error(`Unknown unit "${type}"`);
    const base = {
      cat: 'unit' as const, id, type, team, gx, gy, hp: def.hp, maxHp: def.hp, armor: def.armor, alive: true,
      path: [], moving: false, speed: speedToTilesPerSec(def.speed), sight: def.sight, stuck: 0, detours: 0,
    };
    // a heal (the medic's) is never turned on enemies; healing their own side comes later
    const weapons = def.weapons.filter((w) => weapon(w).damage > 0);
    const u: Unit = isHarvesterType(type)
      ? { ...base, kind: 'harvester', dir: DOCK_FACING, state: 'idle', cargo: 0, field: this.ore.nearestField(gx, gy), home: this.nearestRefinery(gx, gy, team)?.id ?? null, oreKey: null, lastOreKey: null, timer: 0, unloaded: 0, parked: false, retry: 0 }
      : {
        ...base, kind: 'fighter', dir: 14, mode: 'idle', target: null, mission: null, post: null, resume: null, attackMove: null, rest: null, weapons, cools: weapons.map(() => 0), cool: 0, scan: this.rng.range(0, 300), repath: 0, aim: -1, service: null,
        seats: def.passengers ?? 0, passengers: [], hatch: 'closed', hatchTimer: 0, gap: 0, unloading: false, board: null,
      };
    this.units.set(id, u);
    return u;
  }

  private teamBuildings(team: TeamId, builtOnly = true): Building[] {
    return [...this.buildings.values()].filter((b) => b.team === team && (!builtOnly || b.built));
  }

  private teamUnits(team: TeamId): Unit[] {
    return [...this.units.values()].filter((u) => u.team === team);
  }

  /** A side's units for the unit cap: those on the map and those riding in its transports. */
  private armySize(team: TeamId): number {
    return this.teamUnits(team).reduce((n, u) => n + 1 + (u.kind === 'fighter' ? u.passengers.length : 0), 0);
  }

  private ownedTypes(team: TeamId): string[] {
    return this.teamBuildings(team).map((b) => b.type);
  }

  nearestRefinery(gx: number, gy: number, team: TeamId): Building | null {
    let best: Building | null = null;
    let bestD = Infinity;
    for (const b of this.buildings.values()) {
      if (b.type !== 'refinery' || !b.built || b.team !== team) continue;
      const d = Math.hypot(b.tx + 2 - gx, b.ty + 2 - gy);
      if (d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
  }

  /** `team`'s building nearest a point; `knownTo`: only those that side has discovered. */
  private nearestBuilding(gx: number, gy: number, team: TeamId, knownTo?: TeamId): Building | null {
    let best: Building | null = null;
    let bestD = Infinity;
    for (const b of this.buildings.values()) {
      if (b.team !== team || (knownTo && !b.seenBy.has(knownTo))) continue;
      const d = distance(centre(b), { gx, gy });
      if (d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
  }

  // --- Events -------------------------------------------------------------------------------------------------

  private emit(team: TeamId, ev: MatchEvent): void {
    this.pending[team].push(ev);
  }

  private toast(team: TeamId, code: ToastCode, text: string): void {
    if (this.players[team].human) this.emit(team, { e: 'toast', text, code });
  }

  /** Send an event to the owner and to every team that can see the spot. */
  private emitSeen(ev: MatchEvent, at: GridPoint, owner?: TeamId): void {
    for (const t of TEAMS) if (t === owner || this.fog[t].isVisible(at.gx, at.gy)) this.emit(t, ev);
  }

  private emitOre(changes: OreChange[]): void {
    for (const c of changes) for (const t of TEAMS) this.emit(t, c);
  }

  // --- Power ----------------------------------------------------------------------------------------------------

  /** Recompute power from finished buildings. */
  private refresh(): void {
    for (const t of TEAMS) this.power[t] = powerBalance(this.ownedTypes(t));
  }

  powerOf(team: TeamId): PowerBalance {
    return this.power[team];
  }

  private slowdown(team: TeamId): number {
    return this.power[team].low ? ENGINE.lowPowerSlowdown : 1;
  }

  private radar(team: TeamId): TeamView['radar'] {
    if (!this.teamBuildings(team).some((b) => b.type === 'radar')) return 'none';
    return BUILDINGS.radar.requiresPower && this.power[team].low ? 'offline' : 'online';
  }

  // --- Commands --------------------------------------------------------------------------------------------------

  /** Apply a player's order. Invalid orders are ignored (with a toast explaining why, where useful). */
  command(team: TeamId, cmd: Command): void {
    if (this.winner) return;
    const own = (id: number) => {
      const u = this.units.get(id);
      return u && u.alive && u.team === team ? u : null;
    };
    switch (cmd.c) {
      case 'move':
      case 'attackMove': {
        // units sent to the same point move as a group: each gets a tile of its own around it (formation())
        const fight = cmd.c === 'attackMove';
        const groups = new Map<string, { at: GridPoint; units: Unit[] }>();
        for (const o of cmd.orders) {
          const u = own(o.id);
          if (!u) continue;
          const k = `${o.gx},${o.gy}`;
          if (!groups.has(k)) groups.set(k, { at: { gx: o.gx, gy: o.gy }, units: [] });
          groups.get(k)!.units.push(u);
        }
        for (const { at, units } of groups.values()) {
          if (units.length === 1) this.moveUnit(units[0], at.gx, at.gy, fight);
          else this.formation(units, at).forEach((p, i) => this.moveUnit(units[i], p.gx, p.gy, fight));
        }
        return;
      }
      case 'attack': {
        const target = this.entity(cmd.target);
        if (!target?.alive || target.team === team || !this.canSee(team, target)) return;
        for (const id of cmd.units) {
          const u = own(id);
          if (u?.kind === 'fighter') {
            Object.assign(u, { target: target.id, mode: 'attack', repath: 0, rest: null, attackMove: null });
          }
        }
        return;
      }
      case 'harvest': {
        const tile = this.ore.at(cmd.tx, cmd.ty);
        if (!tile?.rocks.length) return;
        for (const id of cmd.units) {
          const u = own(id);
          if (u?.kind === 'harvester') {
            this.cancelHarvester(u);
            this.harvest(u, tile);
          }
        }
        return;
      }
      case 'dock': {
        const ref = this.buildings.get(cmd.refinery);
        if (!ref || ref.type !== 'refinery' || ref.team !== team || !ref.built) return;
        for (const id of cmd.units) {
          const u = own(id);
          if (u?.kind === 'harvester') {
            this.cancelHarvester(u);
            this.returnHome(u, ref);
          }
        }
        return;
      }
      case 'service': {
        const bay = this.buildings.get(cmd.bay);
        if (!bay || bay.type !== 'service_bay' || bay.team !== team || !bay.built) return;
        for (const id of cmd.units) {
          const u = own(id);
          if (u?.kind === 'fighter' && isVehicleType(u.type) && u.hp < u.maxHp) this.toBay(u, bay);
        }
        return;
      }
      case 'stop':
        for (const id of cmd.units) {
          const u = own(id);
          if (u?.kind === 'harvester') {
            this.cancelHarvester(u);
            u.parked = true;
          } else if (u) Object.assign(u, { path: [], target: null, mode: 'idle', unloading: false, rest: null, attackMove: null });
        }
        return;
      case 'place':
        return this.place(team, cmd.building, cmd.tx, cmd.ty);
      case 'train':
        return this.train(team, cmd.unit, cmd.near);
      case 'cancelTrain': {
        // the last one queued: all of its money back if it hadn't started, else the rules' refund
        const q = this.players[team].queue;
        for (let i = q.length - 1; i >= 0; i--) {
          if (q[i].unit !== cmd.unit) continue;
          const [item] = q.splice(i, 1);
          const cost = UNITS[cmd.unit].cost;
          this.players[team].credits += item.progress > 0 ? refundFor(cost) : cost;
          return;
        }
        return;
      }
      case 'sell': {
        const b = this.buildings.get(cmd.building);
        if (!b || b.team !== team || !b.built) return;
        this.players[team].credits += refundFor(BUILDINGS[b.type].cost);
        this.toast(team, 'sold', `${BUILDINGS[b.type].name} sold`);
        this.destroyBuilding(b, true);
        return;
      }
      case 'deploy':
        return this.deploy(team, cmd.unit);
      case 'cancelBuild': {
        const b = this.buildings.get(cmd.building);
        if (!b || b.team !== team || b.built) return;
        this.players[team].credits += refundFor(BUILDINGS[b.type].cost);
        this.players[team].stats.buildingsBuilt = Math.max(0, this.players[team].stats.buildingsBuilt - 1);
        this.toast(team, 'cancelled', `${BUILDINGS[b.type].name} cancelled`);
        this.destroyBuilding(b, true);
        return;
      }
      case 'support': {
        // Medics and Engineers sent to a damaged unit or building of their own side (updateSupport)
        const t = this.entity(cmd.target);
        if (!t?.alive || t.team !== team) return;
        for (const id of cmd.units) {
          const u = own(id);
          if (u?.kind === 'fighter' && !u.weapons.length && (healOf(u.type) || FIXERS.has(u.type))) {
            Object.assign(u, { target: t.id, mode: 'attack', repath: 0, rest: null, attackMove: null, path: [] });
          }
        }
        return;
      }
      case 'repair': {
        const b = this.buildings.get(cmd.building);
        if (!b || b.team !== team || !b.built) return;
        if (cmd.on && b.hp >= b.maxHp) return this.toast(team, 'notDamaged', `${BUILDINGS[b.type].name} isn't damaged`);
        b.repairing = cmd.on;
        return;
      }
      case 'board': {
        const t = own(cmd.transport);
        if (t?.kind !== 'fighter' || !t.seats) return;
        for (const id of cmd.units) {
          const u = own(id);
          if (u?.kind !== 'fighter' || u.id === t.id || !isInfantryType(u.type)) continue;
          this.leaveBay(u);
          Object.assign(u, { mode: 'board', target: null, resume: null, attackMove: null, rest: null, path: [], repath: 0, board: { transport: t.id, atDoor: false, side: 1 } });
        }
        return;
      }
      case 'unload': {
        const t = own(cmd.transport);
        if (t?.kind !== 'fighter' || !t.passengers.length) return;
        this.leaveBay(t);
        Object.assign(t, { mode: 'idle', path: [], target: null, resume: null, attackMove: null, unloading: true });
        return;
      }
    }
  }

  /** An Assembler unpacks into an Assembly Yard centred where it stands, if the ground there is clear. */
  private deploy(team: TeamId, id: number): void {
    const u = this.units.get(id);
    if (!u || u.team !== team || u.type !== 'assembler') return;
    const n = footprint('assembly_yard');
    const tx = Math.round(u.gx - n / 2), ty = Math.round(u.gy - n / 2);
    const world = this.placementWorld(team);
    // it doesn't need to be near the base (that's the point), and it isn't in its own way
    const check = checkPlacement('assembly_yard', tx, ty, { ...world, unitOn: (x, y) => [...this.units.values()].some((o) => o.id !== u.id && Math.floor(o.gx) === x && Math.floor(o.gy) === y), ownBuildings: [{ tx, ty, size: n }] });
    if (check.problem) return this.toast(team, 'cantDeploy', `Can't deploy here: ${check.problem.toLowerCase()}`);
    u.alive = false;
    this.units.delete(u.id);
    const b = this.addBuilding('assembly_yard', team, tx, ty, false);
    b.boost = BUILDINGS.assembly_yard.buildTimeSec / ENGINE.deploySec;
    this.players[team].stats.buildingsBuilt++;
    this.refresh();
  }

  /** Name the first thing missing before `id` can be built, or null if nothing is. */
  private missing(team: TeamId, id: string): string | null {
    const miss = missingRequirements(MATCH_CATALOG, id, this.ownedTypes(team), { assumeOwned: ASSUME_OWNED });
    if (!miss.length) return null;
    return miss[0].map((m) => BUILDINGS[m]?.name ?? m).join(' or ');
  }

  private place(team: TeamId, type: string, tx: number, ty: number): void {
    const def = BUILDINGS[type];
    const p = this.players[team];
    if (!def || !(ROSTER.buildings as readonly string[]).includes(type)) return;
    if (!canBuild(MATCH_CATALOG, type, p.faction, this.ownedTypes(team), { assumeOwned: ASSUME_OWNED })) {
      return this.toast(team, 'needPrerequisite', `Build a ${this.missing(team, type) ?? 'prerequisite'} first`);
    }
    // buildings go up from an Assembly Yard, one at a time (and one defence at a time beside it)
    if (!ASSUME_OWNED.has('assembly_yard') && !this.teamBuildings(team).some((b) => b.type === 'assembly_yard')) return this.toast(team, 'needAssemblyYard', 'Needs an Assembly Yard');
    const busy = this.underConstruction(team, isDefence(type));
    if (busy) return this.toast(team, 'alreadyBuilding', `Already building a ${BUILDINGS[busy.type].name}`);
    const check = checkPlacement(type, tx, ty, this.placementWorld(team));
    if (check.problem) return this.toast(team, 'cantPlace', check.problem);
    if (p.credits < def.cost) return this.toast(team, 'needCredits', `Need $${Math.ceil(def.cost - p.credits).toLocaleString('en-US')} more`);
    p.credits -= def.cost;
    this.addBuilding(type, team, tx, ty, false);
    p.stats.buildingsBuilt++;
  }

  /**
   * The building (`defence`: the defence) a side has going up, if any: each side builds one of each at a time. A yard an
   * Assembler unpacked doesn't count (that's the Assembler's doing, not the yard's).
   */
  underConstruction(team: TeamId, defence: boolean): Building | null {
    for (const b of this.buildings.values()) if (b.team === team && !b.built && b.boost === 1 && isDefence(b.type) === defence) return b;
    return null;
  }

  placementWorld(team: TeamId) {
    return {
      isBlocked: (x: number, y: number) => this.map.isBlocked(x, y),
      hasOre: (x: number, y: number) => this.ore.hasOre(x, y),
      unitOn: (x: number, y: number) => [...this.units.values()].some((u) => Math.floor(u.gx) === x && Math.floor(u.gy) === y),
      ownBuildings: this.teamBuildings(team, false),
    };
  }

  private train(team: TeamId, unit: string, near?: GridPoint): void {
    const def = UNITS[unit];
    const p = this.players[team];
    if (!def || !(ROSTER.units as readonly string[]).includes(unit)) return;
    if (!canBuild(MATCH_CATALOG, unit, p.faction, this.ownedTypes(team), { assumeOwned: ASSUME_OWNED })) {
      return this.toast(team, 'needPrerequisite', `Build a ${this.missing(team, unit) ?? 'prerequisite'} first`);
    }
    if (this.armySize(team) + p.queue.length >= ENGINE.unitCap) return this.toast(team, 'unitCap', 'Unit cap reached');
    const lane = laneOf(unit);
    if (p.queue.filter((q) => laneOf(q.unit) === lane).length >= ENGINE.queueMax) return this.toast(team, 'queueFull', 'Production queue is full');
    if (p.credits < def.cost) return this.toast(team, 'needCredits', `Need $${Math.ceil(def.cost - p.credits).toLocaleString('en-US')} more`);
    p.credits -= def.cost;
    p.queue.push({ unit, progress: 0, near });
  }

  // --- Update -----------------------------------------------------------------------------------------------------

  /** Advance the match by one tick. */
  step(): void {
    if (this.winner) return;
    this.tick++;
    this.timeMs += TICK_MS;
    const dt = TICK_MS / 1000;
    for (const t of TEAMS) this.players[t].stats.gameTimeMs = this.timeMs;
    this.refresh();
    this.construct(dt);
    this.produce(dt);
    this.defend(dt);
    this.repair(dt);
    const before = new Map<number, GridPoint>();
    for (const u of this.units.values()) before.set(u.id, { gx: u.gx, gy: u.gy });
    for (const u of [...this.units.values()]) {
      if (!u.alive) continue;
      if (u.kind === 'harvester') this.updateHarvester(u, dt);
      else this.updateFighter(u, dt);
    }
    this.separate();
    this.unstick(before, dt);
    this.growOre();
    this.fogTimer += TICK_MS;
    if (this.fogTimer >= ENGINE.fogUpdateMs) {
      this.fogTimer = 0;
      this.updateFog();
      this.checkGameOver();
    }
  }

  private construct(dt: number): void {
    const yard = new Set(TEAMS.filter((t) => ASSUME_OWNED.has('assembly_yard') || this.teamBuildings(t).some((b) => b.type === 'assembly_yard')));
    for (const b of this.buildings.values()) {
      if (b.built) continue;
      // with no Assembly Yard left, what's going up stops until there's one again (an unpacking yard goes on)
      if (!yard.has(b.team) && b.boost === 1) continue;
      b.progress = Math.min(1, b.progress + (dt * this.fast[b.team] * b.boost) / BUILDINGS[b.type].buildTimeSec / this.slowdown(b.team));
      if (b.progress < 1) continue;
      b.built = true;
      this.emit(b.team, { e: 'buildingDone', id: b.id });
      this.toast(b.team, 'buildingReady', `${BUILDINGS[b.type].name} ready`);
      if (b.type === 'refinery' && b.constructed) this.spawnHarvester(b); // refinery completion grants one
    }
  }

  /** The unit each lane is building: the first one queued in it. */
  private laneHeads(queue: readonly QueueItem[]): QueueItem[] {
    const seen = new Set<ProductionLane>();
    return queue.filter((q) => {
      const lane = laneOf(q.unit);
      if (seen.has(lane)) return false;
      seen.add(lane);
      return true;
    });
  }

  private produce(dt: number): void {
    for (const t of TEAMS) {
      const p = this.players[t];
      for (const item of this.laneHeads(p.queue)) this.produceItem(t, item, dt);
    }
  }

  private produceItem(t: TeamId, item: QueueItem, dt: number): void {
    const p = this.players[t];
    const producers = this.teamBuildings(t).filter((b) => MATCH_CATALOG.units[item.unit].producedAt.includes(b.type));
    if (!producers.length) return; // stalls until a producer exists again
    item.progress = Math.min(1, item.progress + (dt * this.fast[t]) / UNITS[item.unit].buildTimeSec / this.slowdown(t));
    if (item.progress < 1) return;
    p.queue.splice(p.queue.indexOf(item), 1);
    const near = item.near;
    const from = near ? producers.reduce((a, b) => (distance(centre(a), near) <= distance(centre(b), near) ? a : b)) : producers[0];
    const u = isHarvesterType(item.unit) && from.type === 'refinery' ? this.spawnHarvester(from) : this.spawnFighter(item.unit, from);
    this.emitSeen({ e: 'unitOut', building: from.id, unit: u.id }, centre(from), from.team);
    this.emit(t, { e: 'unitReady', id: u.id, type: u.type });
    this.toast(t, 'unitReady', `${UNITS[u.type].name} ready`);
  }

  private spawnHarvester(ref: Building): Harvester {
    const d = refineryDock(ref.tx, ref.ty);
    const h = this.addUnit('harvester', ref.team, d.wait.gx, d.wait.gy) as Harvester;
    h.home = ref.id;
    this.autoHarvest(h, true);
    return h;
  }

  /** A unit out of a building's front (its entrance, the lower-left face); a harvester then goes to work. */
  private spawnFighter(type: string, from: Building): Unit {
    const at = this.map.nearestFree(Math.floor(from.tx + from.size / 2), from.ty + from.size) ?? { tx: from.tx, ty: from.ty + from.size };
    const u = this.addUnit(type, from.team, at.tx + 0.5, at.ty + 0.5);
    if (u.kind === 'harvester') {
      u.home = this.nearestRefinery(u.gx, u.gy, u.team)?.id ?? null;
      this.autoHarvest(u, true);
    } else this.moveUnit(u, at.tx + 0.5 + this.rng.range(-1, 1), at.ty + 1.5 + this.rng.range(0, 1));
    // straight out of the door first, a tile clear of the building, then it turns towards where it's going
    const out = { gx: at.tx + 0.5, gy: at.ty + 1.5 };
    const first = u.path[0];
    if (first && !this.map.isBlocked(at.tx, at.ty + 1) && (first.gx !== out.gx || first.gy !== out.gy)) u.path.unshift(out);
    return u;
  }

  /**
   * Every growth tick (spreadsheet): partly harvested tiles grow back, the field's roots regrow from empty, and emptied
   * tiles next to well-filled ones start growing again. Gravity vents seed their own fields (always on).
   */
  private growOre(): void {
    if ((this.growTimer += TICK_MS) < ECONOMY.resourceGrowthIntervalSec * 1000) return;
    this.growTimer = 0;
    const changes: OreChange[] = [];
    if (ECONOMY.resourceRegrowth) {
      this.ore.grow(this.rng, () => this.nextId++, changes);
      this.ore.regrowRoots(this.rng, () => this.nextId++, changes);
    }
    if (ECONOMY.resourceSpread) this.ore.spread(this.rng, () => this.nextId++, changes);
    this.ore.feedVents(this.rng, () => this.nextId++, changes);
    this.emitOre(changes);
  }

  // --- Fog and game over ------------------------------------------------------------------------------------------

  /** Known to `team`: its own, an enemy unit in sight, or an enemy building it has discovered (seen as it was last). */
  private canSee(team: TeamId, e: Entity): boolean {
    if (e.team === team) return true;
    return e.cat === 'building' ? e.seenBy.has(team) : this.fog[team].isVisible(e.gx, e.gy);
  }

  /** In `team`'s sight right now (a building: any tile of it). */
  private inSight(team: TeamId, e: Entity): boolean {
    if (e.team === team) return true;
    return e.cat === 'building' ? this.fog[team].anyVisible(e.tx, e.ty, e.size) : this.fog[team].isVisible(e.gx, e.gy);
  }

  private updateFog(): void {
    for (const t of TEAMS) {
      const viewers: Viewer[] = [];
      for (const u of this.units.values()) if (u.team === t) viewers.push({ gx: u.gx, gy: u.gy, sight: u.sight });
      for (const b of this.buildings.values()) if (b.team === t) viewers.push({ ...centre(b), sight: BUILDINGS[b.type].sight + b.size / 2 });
      this.fog[t].update(viewers);
      // enemy buildings in sight are discovered, and remembered as they are now
      for (const b of this.buildings.values()) {
        if (b.team === t || !this.inSight(t, b)) continue;
        b.seenBy.add(t);
        this.ghosts[t].set(b.id, this.buildingView(b, t));
      }
      // one that's gone is forgotten once its spot is seen again
      for (const [id, g] of this.ghosts[t]) if (!this.buildings.has(id) && this.fog[t].anyVisible(g.tx, g.ty, g.size)) this.ghosts[t].delete(id);
    }
  }

  /** A side is out when it has no buildings and no units left (the same for the human and the computer). */
  private checkGameOver(): void {
    for (const t of TEAMS) {
      const out = !this.teamBuildings(t, false).length && !this.teamUnits(t).length;
      if (out) {
        this.winner = opponentOf(t);
        return;
      }
    }
  }

  // --- Movement -----------------------------------------------------------------------------------------------------

  /**
   * A harvester on its refinery's ramp (at the dock), or a vehicle on a Service Bay's pad, drives straight off it to
   * here before anything else.
   */
  private leadOut(u: Unit): GridPoint | null {
    if (u.kind === 'fighter') {
      const bay = this.bayUnder(u);
      return bay ? serviceBayPad(bay.tx, bay.ty).front : null;
    }
    if (u.home === null) return null;
    const home = this.buildings.get(u.home);
    if (!home) return null;
    const d = refineryDock(home.tx, home.ty);
    return distance(u, d.dock) < 0.5 ? d.front : null;
  }

  /** Tile to path from (units standing inside a blocked tile, e.g. on a ramp, step out first). */
  private startTile(u: Unit): Tile | null {
    const t = { tx: Math.floor(u.gx), ty: Math.floor(u.gy) };
    if (!this.map.isBlocked(t.tx, t.ty)) return t;
    const lead = this.leadOut(u);
    if (lead) return { tx: Math.floor(lead.gx), ty: Math.floor(lead.gy) }; // leaving a ramp
    return this.map.nearestFree(t.tx, t.ty);
  }

  /**
   * Path to (gx, gy). `via` is driven to first when the destination is inside a blocked tile: from there it backs
   * the last stretch in a straight line (up a ramp, nose out). `avoid`: tiles to go round (others in the way).
   */
  private goTo(u: Unit, gx: number, gy: number, via: GridPoint | null = null, avoid?: (tx: number, ty: number) => boolean): boolean {
    let goal: Tile | null = via ? { tx: Math.floor(via.gx), ty: Math.floor(via.gy) } : { tx: Math.floor(gx), ty: Math.floor(gy) };
    if (!via && this.map.isBlocked(goal.tx, goal.ty)) {
      goal = this.map.nearestFree(goal.tx, goal.ty);
      if (!goal) return false;
      gx = goal.tx + 0.5;
      gy = goal.ty + 0.5;
    }
    const tiles = findPath(this.map, this.startTile(u), goal, undefined, avoid);
    if (!tiles) return false;
    u.path = tiles.map((t) => ({ gx: t.tx + 0.5, gy: t.ty + 0.5 }));
    const end = via ?? { gx, gy };
    if (u.path.length) u.path[u.path.length - 1] = end;
    else u.path = [end];
    if (via) u.path.push({ gx, gy, back: true });
    const lead = this.leadOut(u);
    if (lead) u.path.unshift(lead);
    return true;
  }

  /** Advance along the path; returns the distance moved. */
  private stepAlong(u: Unit, dt: number): number {
    let step = u.speed * dt * this.fast[u.team];
    let moved = 0;
    const steps = 16;
    while (step > 0 && u.path.length) {
      const target = u.path[0];
      const dgx = target.gx - u.gx;
      const dgy = target.gy - u.gy;
      const dist = Math.hypot(dgx, dgy);
      if (dist > 1e-4) u.dir = target.back ? facing(-dgx, -dgy, steps) : facing(dgx, dgy, steps);
      const move = Math.min(step, dist);
      const mx = (dgx / (dist || 1)) * move, my = (dgy / (dist || 1)) * move;
      const [sx, sy] = this.steer(u, mx, my);
      if (sx !== mx || sy !== my) {
        // someone in the way: round them this tick (or wait, if there's no room)
        const to = { gx: u.gx + sx, gy: u.gy + sy };
        if (this.straight(u, to)) {
          u.gx = to.gx;
          u.gy = to.gy;
          moved += Math.hypot(sx, sy);
        }
        break;
      }
      u.gx += mx;
      u.gy += my;
      moved += move;
      step -= move;
      if (move >= dist) u.path.shift();
    }
    u.moving = moved > 0;
    return moved;
  }

  /** `fight`: an attack-move (armed units only; the rest just move). */
  private moveUnit(u: Unit, gx: number, gy: number, fight = false): void {
    if (u.kind === 'harvester') {
      this.cancelHarvester(u);
      u.parked = true; // it waits there for orders
      if (this.goTo(u, gx, gy)) u.state = 'move';
      return;
    }
    u.target = null;
    u.resume = null;
    u.rest = null;
    u.mode = this.goTo(u, gx, gy) ? 'move' : 'idle';
    u.attackMove = fight && u.mode === 'move' && u.weapons.length ? { gx, gy } : null;
  }

  // --- Groups and collisions --------------------------------------------------------------------------------------------

  private tileOf(p: GridPoint): Tile {
    return { tx: Math.floor(p.gx), ty: Math.floor(p.gy) };
  }

  /** Soldiers on their way into a transport file through the others (they queue at its door, as before collisions). */
  private ghost(u: Unit): boolean {
    return u.kind === 'fighter' && u.mode === 'board';
  }

  /** Its body's radius in tiles: vehicles are about a tile across, soldiers less. */
  private radius(u: Unit): number {
    return HOVER_UNITS.has(u.type) ? ENGINE.hoverRadius : isInfantryType(u.type) ? ENGINE.infantryRadius : ENGINE.vehicleRadius;
  }

  /**
   * Destinations for a group sent to one point: a tile each around it, as compact as the ground allows, each unit
   * keeping its place in the group where it can (a group spread wider than `ENGINE.formationSpread` closes up). Tiles
   * that are blocked, cut off from the point, or where others stand or are heading are skipped.
   */
  private formation(units: Unit[], at: GridPoint): GridPoint[] {
    const n = units.length;
    const mid = { gx: units.reduce((s, u) => s + u.gx, 0) / n, gy: units.reduce((s, u) => s + u.gy, 0) / n };
    const spread = Math.max(...units.map((u) => distance(u, mid)));
    const k = Math.min(1, (ENGINE.formationSpread * Math.sqrt(n)) / (spread || 1));
    const want = units.map((u) => ({ gx: at.gx + (u.gx - mid.gx) * k, gy: at.gy + (u.gy - mid.gy) * k }));
    const taken = this.claimedTiles(new Set(units.map((u) => u.id)));
    const free = this.freeTiles(this.tileOf(at), n * 3 + 8, (key) => taken.has(key));
    const used = new Set<number>();
    const out: GridPoint[] = units.map(() => at);
    // the middle of the group first, so it fills in round the point; the outer ones take the tiles left nearest them
    const order = units.map((_, i) => i).sort((a, b) => distance(want[a], at) - distance(want[b], at) || units[a].id - units[b].id);
    for (const i of order) {
      let best = -1;
      let bestD = Infinity;
      free.forEach((t, j) => {
        const d = Math.hypot(t.tx + 0.5 - want[i].gx, t.ty + 0.5 - want[i].gy);
        if (!used.has(j) && d < bestD - 1e-9) {
          best = j;
          bestD = d;
        }
      });
      if (best < 0) continue;
      used.add(best);
      out[i] = { gx: free[best].tx + 0.5, gy: free[best].ty + 0.5 };
    }
    return out;
  }

  /** Tiles others stand on, or are heading to (the end of their path), which nobody else should be sent to. */
  private claimedTiles(except: Set<number>): Set<number> {
    const keys = new Set<number>();
    for (const o of this.units.values()) {
      if (except.has(o.id)) continue;
      const at = o.path.length ? o.path[o.path.length - 1] : o;
      keys.add(this.map.key(Math.floor(at.gx), Math.floor(at.gy)));
    }
    return keys;
  }

  /** Up to `count` open tiles nearest `from` (itself included) that can be driven to from it, skipping `taken` ones. */
  private freeTiles(from: Tile, count: number, taken: (key: number) => boolean): Tile[] {
    const start = this.map.isBlocked(from.tx, from.ty) ? this.map.nearestFree(from.tx, from.ty) : from;
    if (!start) return [];
    const out: Tile[] = [];
    const seen = new Set([this.map.key(start.tx, start.ty)]);
    const queue: Tile[] = [start];
    for (let i = 0; i < queue.length && out.length < count && i < 2000; i++) {
      const t = queue[i];
      if (!taken(this.map.key(t.tx, t.ty))) out.push(t);
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = t.tx + dx, ny = t.ty + dy;
        if (this.map.isBlocked(nx, ny) || seen.has(this.map.key(nx, ny))) continue;
        if (dx && dy && (this.map.isBlocked(nx, t.ty) || this.map.isBlocked(t.tx, ny))) continue;
        seen.add(this.map.key(nx, ny));
        queue.push({ tx: nx, ty: ny });
      }
    }
    return out;
  }

  /** Whether someone other than `self` stands at `p`, or is heading there. */
  private spotTaken(p: GridPoint, self: Unit): boolean {
    for (const o of this.units.values()) {
      if (o === self) continue;
      const r = this.radius(o) + this.radius(self);
      const end = o.path[o.path.length - 1];
      if (distance(o, p) < r || (end && distance(end, p) < r)) return true;
    }
    return false;
  }

  /**
   * Units that hold their place whatever bumps into them: on a ramp or a pad (or backing onto one, or driving off a
   * Service Bay's), unloading at a refinery, letting passengers in or out, or a soldier at a transport's door.
   */
  private anchored(u: Unit): boolean {
    if (this.map.isBlocked(Math.floor(u.gx), Math.floor(u.gy))) return true;
    if (u.path.length && u.path.length <= 2 && u.path[u.path.length - 1].back) return true;
    if (u.kind === 'harvester') return u.state === 'docking' || u.state === 'unload' || u.state === 'closing';
    return !!u.service?.leaving || u.hatch !== 'closed' || !!u.board?.atDoor;
  }

  /** How readily a unit gives way when bodies overlap: not at all (anchored), a little at work or on the move, most when idle. */
  private give(u: Unit): number {
    if (this.anchored(u)) return 0;
    if (u.path.length) return 0.25;
    const busy = u.kind === 'harvester' ? u.state === 'harvest' : u.target !== null;
    return busy ? 0.15 : 1;
  }

  /** Whether a unit can drive straight from `a` to `b`, a tile over at most, without cutting a blocked corner. */
  private straight(a: GridPoint, b: GridPoint): boolean {
    const ax = Math.floor(a.gx), ay = Math.floor(a.gy), bx = Math.floor(b.gx), by = Math.floor(b.gy);
    if (Math.abs(ax - bx) > 1 || Math.abs(ay - by) > 1) return false;
    if (ax === bx && ay === by) return true;
    if (this.map.isBlocked(bx, by)) return false;
    return ax === bx || ay === by || (!this.map.isBlocked(bx, ay) && !this.map.isBlocked(ax, by));
  }

  /** A fresh path to where it was going (backing onto a ramp or pad at the end, if it was); the old one if there's none. */
  private rePath(u: Unit, avoid?: (tx: number, ty: number) => boolean): boolean {
    const end = u.path[u.path.length - 1];
    if (!end) return false;
    const via = end.back ? u.path[u.path.length - 2] ?? null : null;
    const old = u.path;
    if (this.goTo(u, end.gx, end.gy, via, avoid)) return true;
    u.path = old;
    return false;
  }

  /**
   * Units keep apart. Overlapping bodies are eased apart, the one that gives way more moving more (an idle unit is
   * nudged aside by one driving through, one at work hardly), and a unit driving into another also steps to its
   * right, so two meeting head on pass each other. Nobody is pushed into a blocked tile; one pushed off its line is
   * given a new path.
   */
  private separate(): void {
    const list = [...this.units.values()];
    const push = list.map(() => ({ gx: 0, gy: 0 }));
    const give = list.map((u) => this.give(u));
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (this.ghost(a)) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (this.ghost(b)) continue;
        const r = this.radius(a) + this.radius(b);
        const dx = b.gx - a.gx, dy = b.gy - a.gy;
        if (Math.abs(dx) >= r || Math.abs(dy) >= r) continue;
        const d = Math.hypot(dx, dy);
        const total = give[i] + give[j];
        if (d >= r || !total) continue;
        // right on top of each other: apart in a direction from their ids, so it's the same every run
        const ang = ((a.id * 7 + b.id * 3) % 16) * (Math.PI / 8);
        const nx = d > 1e-6 ? dx / d : Math.cos(ang), ny = d > 1e-6 ? dy / d : Math.sin(ang);
        const ease = (r - d) / 2;
        push[i].gx -= (nx * ease * give[i]) / total;
        push[i].gy -= (ny * ease * give[i]) / total;
        push[j].gx += (nx * ease * give[j]) / total;
        push[j].gy += (ny * ease * give[j]) / total;
        for (const [k, sx, sy] of [[i, nx, ny], [j, -nx, -ny]] as const) {
          const u = list[k];
          const next = u.path[0];
          if (!next || !give[k] || this.sameWay(list[i], list[j])) continue;
          const hx = next.gx - u.gx, hy = next.gy - u.gy, hl = Math.hypot(hx, hy);
          if (hl < 1e-6 || (hx * sx + hy * sy) / hl < 0.5) continue;
          push[k].gx += (-hy / hl) * ease * 0.5;
          push[k].gy += (hx / hl) * ease * 0.5;
        }
      }
    }
    list.forEach((u, k) => {
      let { gx: px, gy: py } = push[k];
      const len = Math.hypot(px, py);
      if (len < 1e-6) return;
      if (len > ENGINE.pushTilesPerTick) {
        px *= ENGINE.pushTilesPerTick / len;
        py *= ENGINE.pushTilesPerTick / len;
      }
      // along a wall, it slides
      const from = { gx: u.gx, gy: u.gy };
      const to = [{ gx: u.gx + px, gy: u.gy + py }, { gx: u.gx + px, gy: u.gy }, { gx: u.gx, gy: u.gy + py }].find((p) => this.straight(from, p));
      if (!to) return;
      u.gx = to.gx;
      u.gy = to.gy;
      const next = u.path[0];
      if (next && (Math.floor(to.gx) !== Math.floor(from.gx) || Math.floor(to.gy) !== Math.floor(from.gy)) && !this.straight(u, next)) this.rePath(u);
    });
  }

  /**
   * A step that would drive into someone who won't give way (on the move too, at work, or held in place) turns to the
   * right of them instead, so it goes round; behind one going the same way, it just keeps its distance. An idle unit
   * is driven into and nudged aside (separate()).
   */
  private steer(u: Unit, mx: number, my: number): [number, number] {
    if (this.anchored(u) || this.ghost(u)) return [mx, my];
    for (const o of this.units.values()) {
      if (o === u || this.ghost(o)) continue;
      const r = this.radius(u) + this.radius(o);
      const dx = o.gx - u.gx, dy = o.gy - u.gy;
      if (Math.abs(dx) > r + 0.5 || Math.abs(dy) > r + 0.5) continue;
      const d = Math.hypot(dx, dy);
      if (d < 1e-6 || Math.hypot(dx - mx, dy - my) >= Math.min(r, d) || this.give(o) >= 1) continue; // no contact, or parting
      const ux = dx / d, uy = dy / d;
      const into = mx * ux + my * uy;
      if (into <= 0) continue;
      mx -= ux * into;
      my -= uy * into;
      if (this.sameWay(u, o)) continue;
      mx -= uy * into;
      my += ux * into;
    }
    return [mx, my];
  }

  /** Both on the move, heading roughly the same way (one following the other, or side by side in a group). */
  private sameWay(a: Unit, b: Unit): boolean {
    const p = a.path[0], q = b.path[0];
    if (!p || !q) return false;
    const ax = p.gx - a.gx, ay = p.gy - a.gy, bx = q.gx - b.gx, by = q.gy - b.gy;
    return ax * bx + ay * by > 0.3 * Math.hypot(ax, ay) * Math.hypot(bx, by);
  }

  /** Tiles where others stand in a unit's way (still, held in place, or stuck themselves): to path round them. */
  private standing(self: Unit): (tx: number, ty: number) => boolean {
    const keys = new Set<number>();
    for (const o of this.units.values()) {
      if (o === self || distance(o, self) > 6) continue;
      if (!o.path.length || o.stuck > 0 || this.anchored(o)) keys.add(this.map.key(Math.floor(o.gx), Math.floor(o.gy)));
    }
    return (tx, ty) => keys.has(this.map.key(tx, ty));
  }

  /**
   * A unit that makes no headway along its path (others are in its way) goes round them; after `ENGINE.detours` tries,
   * or once it's nearly there, it settles (settle()). So a crowd in a choke point waits its turn rather than shoving
   * back and forth.
   */
  private unstick(before: Map<number, GridPoint>, dt: number): void {
    const ms = dt * 1000;
    for (const u of [...this.units.values()]) {
      const was = before.get(u.id);
      const next = u.path[0];
      if (!next) u.detours = 0;
      if (!was || !next || this.anchored(u) || this.ghost(u)) {
        u.stuck = 0;
        continue;
      }
      const hx = next.gx - was.gx, hy = next.gy - was.gy, hl = Math.hypot(hx, hy);
      const ahead = hl > 1e-6 ? ((u.gx - was.gx) * hx + (u.gy - was.gy) * hy) / hl : Infinity;
      if (ahead >= 0.3 * u.speed * dt * this.fast[u.team]) {
        u.stuck = Math.max(0, u.stuck - ms);
        continue;
      }
      if ((u.stuck += ms) < ENGINE.stuckMs) continue;
      u.stuck = 0;
      if (distance(u, u.path[u.path.length - 1]) <= ENGINE.settleTiles || u.detours >= ENGINE.detours) this.settle(u);
      else {
        u.detours++;
        this.rePath(u, this.standing(u));
      }
    }
  }

  /**
   * A unit that can get no nearer to where it's going. Sent somewhere, it settles on the nearest free tile to it (it
   * drives there, once) or where it is; a harvester near its ore or its refinery's queue spot carries on from there.
   * Units going onto a ramp or a pad, or after a target, keep trying (their goal is theirs, or moves).
   */
  private settle(u: Unit): void {
    const end = u.path[u.path.length - 1];
    const near = distance(u, end) <= ENGINE.settleTiles;
    const keepAt = () => {
      u.detours = 0;
      this.rePath(u, this.standing(u));
    };
    if (u.kind === 'harvester') {
      if (u.state === 'toOre' || u.state === 'toWait') {
        if (!near) return keepAt();
        u.path = [];
        return this.arrive(u);
      }
      if (u.state !== 'move') return keepAt();
    } else if (u.mode === 'attack' || u.mode === 'service') {
      if (u.mode === 'attack' || !u.service?.waiting) return keepAt();
      if (near) u.path = []; // by the bay: it waits from here
      return;
    }
    const halt = () => {
      u.path = [];
      if (u.kind === 'harvester') u.state = 'idle';
      else if (u.mode === 'move' || u.mode === 'idle') this.stopped(u);
    };
    if (u.detours > ENGINE.detours) return halt(); // already on its way to the free tile
    u.detours = ENGINE.detours + 1;
    const taken = this.claimedTiles(new Set([u.id]));
    const spot = this.freeTiles(this.tileOf(end), 1, (k) => taken.has(k))[0];
    const at = spot && { gx: spot.tx + 0.5, gy: spot.ty + 0.5 };
    if (!at || distance(u, at) < 0.75 || !this.goTo(u, at.gx, at.gy, null, this.standing(u))) halt();
  }

  // --- Harvesters ---------------------------------------------------------------------------------------------------

  private cancelHarvester(h: Harvester): void {
    h.path = [];
    h.timer = 0;
    const home = h.home !== null ? this.buildings.get(h.home) : undefined;
    if (home?.occupant === h.id) {
      if (h.state === 'docking' || h.state === 'unload') this.emitSeen({ e: 'door', refinery: home.id, open: false }, centre(home), home.team);
      home.occupant = null;
    }
    h.state = 'idle';
  }

  /** A harvester goes to work; `choose`: on the field nearest its base that its side has seen (a new harvester). */
  private autoHarvest(h: Harvester, choose = false): void {
    if (choose) {
      const b = this.harvesterBase(h);
      h.field = this.ore.fieldFor(b.gx, b.gy, this.seenOre(h.team));
    }
    const t = this.nextOre(h);
    if (t) this.harvest(h, t);
  }

  /** Where a harvester's trips start and end: its refinery (else where it is). */
  private harvesterBase(h: Harvester): GridPoint {
    const home = h.home !== null ? this.buildings.get(h.home) : undefined;
    return home ? centre(home) : { gx: h.gx, gy: h.gy };
  }

  /** Ore a side's harvesters may go for of their own accord: what that side has seen (not under unexplored fog). */
  private seenOre(team: TeamId): (t: OreTile) => boolean {
    return (t) => this.fog[team].isExplored(t.tx, t.ty, 1);
  }

  /** The tile a harvester mines next (ore.pickFor): its field, else the nearest one to its base that its side has seen. */
  private nextOre(h: Harvester): OreTile | null {
    return this.ore.pickFor(h.gx, h.gy, h.field, this.harvesterBase(h), this.seenOre(h.team));
  }

  private harvest(h: Harvester, tile: OreTile): void {
    h.parked = false;
    h.field = tile.field; // works this field from now on
    h.oreKey = h.lastOreKey = this.map.key(tile.tx, tile.ty);
    h.state = this.goTo(h, tile.tx + 0.5, tile.ty + 0.5) ? 'toOre' : 'idle';
  }

  returnHome(h: Harvester, refinery?: Building): void {
    h.timer = 0;
    h.parked = false;
    const current = h.home !== null ? this.buildings.get(h.home) : undefined;
    const ref = refinery ?? (current?.alive && current.built ? current : this.nearestRefinery(h.gx, h.gy, h.team));
    if (!ref) {
      h.state = 'idle';
      return;
    }
    h.home = ref.id;
    const d = refineryDock(ref.tx, ref.ty);
    const occ = ref.occupant !== null ? this.units.get(ref.occupant) : undefined;
    if (occ && occ.id !== h.id && occ.alive) {
      h.state = this.goTo(h, d.wait.gx, d.wait.gy) ? 'toWait' : 'idle';
      return;
    }
    ref.occupant = h.id;
    if (this.goTo(h, d.dock.gx, d.dock.gy, d.front)) h.state = 'toDock';
    else {
      ref.occupant = null;
      h.state = 'idle';
    }
  }

  private leaveDock(h: Harvester): void {
    const home = h.home !== null ? this.buildings.get(h.home) : undefined;
    if (home?.occupant === h.id) home.occupant = null;
    const last = h.lastOreKey !== null ? this.ore.tiles.get(h.lastOreKey) : undefined;
    const from = last?.rocks.length ? last : this.nextOre(h);
    if (from) this.harvest(h, from);
    else h.state = 'idle';
  }

  private updateHarvester(h: Harvester, dt: number): void {
    const ms = dt * 1000;
    h.moving = false;
    const home = h.home !== null ? this.buildings.get(h.home) : undefined;
    switch (h.state) {
      case 'move':
      case 'toOre':
      case 'toDock':
      case 'toWait':
        this.stepAlong(h, dt);
        if (!h.path.length) this.arrive(h);
        return;
      case 'harvest': {
        h.timer -= ms;
        while (h.timer <= 0 && h.state === 'harvest') {
          h.timer += ENGINE.harvestMsPerUnit;
          if (h.cargo >= ECONOMY.harvesterCapacity) return this.returnHome(h);
          const tile = h.oreKey !== null ? this.ore.tiles.get(h.oreKey) : undefined;
          const changes: OreChange[] = [];
          const rock = tile ? this.ore.mine(tile, changes) : null;
          this.emitOre(changes);
          if (!rock) {
            const next = this.nextOre(h);
            if (next) return this.harvest(h, next);
            if (h.cargo) return this.returnHome(h);
            h.state = 'idle';
            return;
          }
          h.dir = facing(rock.gx - h.gx, rock.gy - h.gy, 16);
          h.cargo += 1;
        }
        return;
      }
      case 'wait':
        h.timer -= ms;
        if (h.timer <= 0) {
          h.timer = 400;
          const occ = home?.occupant != null ? this.units.get(home.occupant) : undefined;
          if (!home?.alive || !occ?.alive) this.returnHome(h);
        }
        return;
      case 'docking':
        h.timer -= ms;
        if (h.timer > 0) return;
        if (!home?.alive) return this.cancelHarvester(h);
        h.state = 'unload';
        h.timer = ENGINE.unloadMsPerUnit * this.slowdown(h.team);
        h.unloaded = 0;
        return;
      case 'unload': {
        if (!home?.alive) return this.cancelHarvester(h);
        h.timer -= ms;
        const p = this.players[h.team];
        while (h.timer <= 0 && h.cargo > 0) {
          h.cargo -= 1;
          const credits = creditsFor(1, 'common'); // no storage cap: all of it becomes credits
          p.credits += credits;
          p.stats.creditsEarned += credits;
          h.unloaded += credits;
          h.timer += ENGINE.unloadMsPerUnit * this.slowdown(h.team); // re-read power for every unit
        }
        if (h.cargo > 0) return;
        this.emit(h.team, { e: 'unloaded', refinery: home.id, credits: h.unloaded });
        this.emitSeen({ e: 'door', refinery: home.id, open: false }, centre(home), home.team);
        h.state = 'closing';
        // the door closes, but not before its bed has finished tipping out (ENGINE.dockMinMs since it docked)
        h.timer = Math.max(ENGINE.doorMs, ENGINE.dockMinMs - (this.timeMs - (h.dockedAt ?? this.timeMs)));
        return;
      }
      case 'closing':
        h.timer -= ms;
        if (h.timer <= 0) this.leaveDock(h);
        return;
      case 'idle':
        // with nothing to do (no ore it knows of, no refinery), it looks again now and then: fields grow back
        if (h.parked || (h.retry -= ms) > 0) return;
        h.retry = HARVESTER_RETRY_MS;
        if (h.cargo >= ECONOMY.harvesterCapacity) return this.returnHome(h);
        if (this.nextOre(h)) return this.autoHarvest(h);
        if (h.cargo) this.returnHome(h);
        return;
    }
  }

  private arrive(h: Harvester): void {
    switch (h.state) {
      case 'toOre':
        h.state = 'harvest';
        h.timer = ENGINE.harvestMsPerUnit;
        return;
      case 'toWait':
        h.state = 'wait';
        h.timer = 400;
        return;
      case 'toDock': {
        const home = h.home !== null ? this.buildings.get(h.home) : undefined;
        h.dir = DOCK_FACING;
        if (!home?.alive) return this.cancelHarvester(h);
        if (!h.cargo) return this.leaveDock(h);
        h.state = 'docking';
        h.timer = ENGINE.doorMs;
        h.dockedAt = this.timeMs;
        this.emitSeen({ e: 'door', refinery: home.id, open: true }, centre(home), home.team);
        return;
      }
      default:
        h.state = 'idle';
    }
  }

  /** Its refinery was destroyed: find another, or keep mining. */
  private onHomeLost(h: Harvester): void {
    const was = h.state;
    this.cancelHarvester(h);
    h.home = this.nearestRefinery(h.gx, h.gy, h.team)?.id ?? null;
    if (h.home === null) return;
    if (was === 'unload' || was === 'docking' || was === 'wait' || was === 'toWait' || was === 'toDock' || h.cargo >= ECONOMY.harvesterCapacity) this.returnHome(h);
    else this.leaveDock(h);
  }

  // --- Fighters ---------------------------------------------------------------------------------------------------

  /** How far it shoots: at this target, with the weapon it would use on it; otherwise its longest reach. */
  private range(u: Fighter, target?: Entity): number {
    if (target) {
      const w = this.weaponAt(u.weapons, target);
      return w ? weapon(w).rangeTiles : 0;
    }
    return Math.max(0, ...u.weapons.map((w) => weapon(w).rangeTiles));
  }

  /** The weapon used on a target: the first that reaches it (an anti-air missile never fires at the ground). */
  private weaponAt(weapons: readonly string[], target: Entity): string | null {
    return weaponFor(weapons, target.cat === 'unit' ? layerOf(target.type) : 'ground');
  }

  /** How far an idle unit looks for a fight: its sight, or its weapon range plus a margin, whichever is larger. */
  private acquireRange(u: Fighter): number {
    return Math.max(u.sight, this.range(u) + ENGINE.acquireMargin);
  }

  /**
   * Closest hostile unit within range that its side can see; computer soldiers also consider buildings their side has
   * discovered (they raid bases), and so does a unit on an attack-move (`buildings`) when no hostile unit is in range.
   */
  private findEnemy(u: Fighter, range: number, buildings = false): Entity | null {
    let best: Entity | null = null;
    let bestD = range;
    for (const o of this.units.values()) {
      if (!o.alive || o.team === u.team) continue;
      if (Math.abs(o.gx - u.gx) > range || Math.abs(o.gy - u.gy) > range) continue;
      if (!this.weaponAt(u.weapons, o) || !this.inSight(u.team, o)) continue;
      const d = Math.hypot(o.gx - u.gx, o.gy - u.gy);
      if (d <= bestD) {
        best = o;
        bestD = d;
      }
    }
    if (!this.players[u.team].human || (buildings && !best)) {
      for (const b of this.buildings.values()) {
        if (b.team === u.team || !this.weaponAt(u.weapons, b) || !b.seenBy.has(u.team)) continue;
        const d = distTo(u, b);
        if (d < bestD) {
          best = b;
          bestD = d;
        }
      }
    }
    return best;
  }

  /** Where to walk to engage: the target itself, or the nearest open tile around a building. */
  private approachPoint(t: Entity, from: GridPoint): GridPoint | null {
    if (t.cat === 'unit') return { gx: t.gx, gy: t.gy };
    let best: GridPoint | null = null;
    let bestD = Infinity;
    for (let x = t.tx - 1; x <= t.tx + t.size; x++) {
      for (let y = t.ty - 1; y <= t.ty + t.size; y++) {
        const edge = x === t.tx - 1 || y === t.ty - 1 || x === t.tx + t.size || y === t.ty + t.size;
        if (!edge || this.map.isBlocked(x, y)) continue;
        const d = Math.hypot(x + 0.5 - from.gx, y + 0.5 - from.gy);
        if (d < bestD) {
          bestD = d;
          best = { gx: x + 0.5, gy: y + 0.5 };
        }
      }
    }
    return best;
  }

  private updateFighter(u: Fighter, dt: number): void {
    const ms = dt * 1000;
    u.moving = false;
    u.cool -= ms;
    for (let i = 0; i < u.cools.length; i++) u.cools[i] -= ms;
    u.scan -= ms;
    u.repath -= ms;
    // a transport holds still while it lets its passengers out, or while someone is at its door
    if (u.seats && this.updateHatch(u, ms)) return;
    if (u.mode === 'service') return this.updateService(u, dt);
    if (u.mode === 'board') return this.updateBoarding(u, dt);
    u.board = null;
    // given another order at a Service Bay: let the pad go, and drive off it first if it's on it
    if (u.service) {
      this.leaveBay(u);
      const lead = this.leadOut(u);
      if (lead && !u.path.length) u.path = [lead];
    }
    // Medics heal their side's damaged units, Engineers repair its damaged buildings
    if (u.work) u.work = Math.max(0, u.work - ms);
    if (!u.weapons.length && (healOf(u.type) || FIXERS.has(u.type)) && this.updateSupport(u, dt)) return;
    let target = u.target !== null ? this.entity(u.target) : undefined;
    if (target && (!target.alive || !this.weaponAt(u.weapons, target))) target = undefined;
    if (!target && u.target !== null) {
      // target gone: look for the next one straight away, or carry on with an interrupted move
      u.target = null;
      u.scan = 0;
      if (u.mode === 'attack') u.mode = 'idle';
    }
    if (!target && u.mode === 'idle' && u.resume && u.scan > 0) {
      const to = u.resume;
      u.resume = null;
      u.mode = this.goTo(u, to.gx, to.gy) ? 'move' : 'idle';
      if (u.mode === 'idle') u.attackMove = null;
    }
    // Look for something to shoot. On the move, only enemies already within weapon range (the unit stops to fight,
    // then carries on, unless its turret turns on its own: that fires on the move); otherwise anything within
    // acquire range, which it moves in on. On an attack-move it looks as far as an idle unit, buildings too, and
    // always stops to fight; while it shoots a building it keeps looking, for units that turn up.
    const firesOnTheMove = TURRET_UNITS.has(u.type) && u.mode === 'move' && !u.attackMove;
    if (u.scan <= 0 && (!target || target.id === u.mission || (u.attackMove && target.cat === 'building')) && u.weapons.length) {
      u.scan = 300;
      const moving = u.mode === 'move';
      const seen = this.findEnemy(u, moving && !u.attackMove ? this.range(u) : this.acquireRange(u), !!u.attackMove);
      if (seen) {
        if (moving && !firesOnTheMove) {
          u.resume = u.attackMove ?? u.path[u.path.length - 1] ?? null;
          u.path = [];
          u.mode = 'idle';
        }
        target = seen;
      }
    }
    // Guards give up chases that lure them too far, then walk back to their post
    if (u.post && target && distance(pos(target), u.post) > ENGINE.guardLeash) {
      target = undefined;
      u.path = [];
    }
    // On an attack-move, an enemy that gets out of reach is let go, and it carries on to its point
    if (u.attackMove && target && target.id !== u.mission && distTo(u, target) > this.acquireRange(u)) {
      target = undefined;
      u.path = [];
      u.mode = 'idle';
      u.resume ??= u.attackMove;
    }
    if (!target && u.post && !u.path.length && distance(u, u.post) > 0.6) this.goTo(u, u.post.gx, u.post.gy);
    // Raiders with nothing in sight march on their objective
    if (!target && u.mission !== null) {
      let m = this.entity(u.mission);
      if (!m?.alive) {
        m = this.nearestBuilding(u.gx, u.gy, opponentOf(u.team), u.team) ?? undefined;
        u.mission = m?.id ?? null;
      }
      target = m;
    }
    u.target = target?.id ?? null;
    if (target) u.rest = null;
    else if (u.rest && u.mode === 'idle' && !u.post && !u.path.length && u.repath <= 0 && distance(u, u.rest) > ENGINE.restSlack) {
      // nudged off where it stopped: back there once the spot is free, or it stays where it is now
      u.repath = 1000;
      if (this.spotTaken(u.rest, u) || !this.goTo(u, u.rest.gx, u.rest.gy)) u.rest = { gx: u.gx, gy: u.gy };
    }
    if (TURRET_UNITS.has(u.type)) {
      const at = target && u.weapons.length ? pos(target) : null;
      u.aim = at ? facing(at.gx - u.gx, at.gy - u.gy, TURRET_DIRECTIONS) : -1;
    }
    if (target && u.weapons.length && firesOnTheMove) {
      // keeps to its path, shooting what it passes; what falls out of range is let go
      if (distTo(u, target) <= this.range(u, target)) {
        this.fire(u, target);
      } else {
        u.target = null;
        u.aim = -1;
      }
      this.stepAlong(u, dt);
      if (!u.path.length) this.stopped(u);
    } else if (target && u.weapons.length) {
      if (distTo(u, target) <= this.range(u, target)) {
        u.path = [];
        this.fire(u, target);
      } else {
        if (u.repath <= 0 || !u.path.length) {
          u.repath = 1200;
          const t = this.approachPoint(target, u);
          if (t) this.goTo(u, t.gx, t.gy);
        }
        this.stepAlong(u, dt);
      }
    } else if (u.path.length) {
      this.stepAlong(u, dt);
      if (!u.path.length && u.mode === 'move') this.stopped(u);
    } else if (u.mode === 'move') this.stopped(u);
  }

  /**
   * A Medic or an Engineer sees to its side: the damaged unit (a Medic: soldiers and hovering units, not vehicles) or
   * building (an Engineer) it was sent to, else the nearest one it can see, unless it's on its way somewhere. It goes
   * there and, in reach, heals it a volley at a time (its heal's damage, at its fire rate) or repairs it steadily, for
   * free. Returns whether it saw to something this tick (else it moves or stands as any unit).
   */
  private updateSupport(u: Fighter, dt: number): boolean {
    const heal = healOf(u.type);
    const needs = (e: Entity | undefined): e is Entity => !!e && e.alive && e.team === u.team && e.hp < e.maxHp
      && (heal ? e.cat === 'unit' && e.id !== u.id && isInfantryType(e.type) : e.cat === 'building' && e.built);
    const was = u.target !== null ? this.entity(u.target) : undefined;
    let t: Entity | undefined = was;
    if (!needs(t)) {
      // a building it was mending is whole again
      if (was?.cat === 'building' && was.alive && was.team === u.team && !heal) this.toast(u.team, 'repaired', `${BUILDINGS[was.type].name} repaired`);
      t = undefined;
      u.target = null;
      if (u.mode === 'attack') u.mode = 'idle';
    }
    if (!t && u.mode === 'idle' && u.scan <= 0) {
      u.scan = 500;
      const look = Math.max(u.sight, ENGINE.supportLook);
      let best: Entity | undefined;
      let bestD = look;
      const all: Entity[] = heal ? [...this.units.values()] : [...this.buildings.values()];
      for (const e of all) {
        if (!needs(e)) continue;
        const d = distTo(u, e);
        if (d < bestD) {
          best = e;
          bestD = d;
        }
      }
      t = best;
      u.target = t?.id ?? null;
    }
    if (!t) return false;
    const reach = heal ? weapon(heal).rangeTiles : ENGINE.fixReach;
    if (distTo(u, t) > reach) {
      if (u.repath <= 0 || !u.path.length) {
        u.repath = 1200;
        const to = this.approachPoint(t, u);
        if (!to || !this.goTo(u, to.gx, to.gy)) {
          u.target = null;
          return false;
        }
      }
      this.stepAlong(u, dt);
      return true;
    }
    u.path = [];
    u.rest = { gx: u.gx, gy: u.gy };
    const at = pos(t);
    u.dir = facing(at.gx - u.gx, at.gy - u.gy, 16);
    if (heal) {
      if (u.cool > 0) return true;
      u.cool = weapon(heal).fireIntervalSec * 1000;
      this.emitSeen({ e: 'shot', from: u.id, to: t.id, at, p: weapon(heal).projectile ?? 'beam' }, u, u.team);
      t.hp = Math.min(t.maxHp, t.hp - weapon(heal).damage);
    } else {
      t.hp = Math.min(t.maxHp, t.hp + (t.maxHp / ENGINE.fixSecondsForFull) * dt);
      // a spark of its work now and then (the browser draws the welding at the building)
      if (u.cool <= 0) {
        u.cool = 700;
        this.emitSeen({ e: 'shot', from: u.id, to: t.id, at, p: 'repair' }, u, u.team);
      }
    }
    u.work = ENGINE.workMs;
    return true;
  }

  /** A move is over: it stays here (and comes back here if a unit passing nudges it off). */
  private stopped(u: Fighter): void {
    u.mode = 'idle';
    u.attackMove = null;
    u.rest = { gx: u.gx, gy: u.gy };
  }

  // --- Service Bays ---------------------------------------------------------------------------------------------------

  /** The vehicle parked on a Service Bay's pad being repaired (not still backing on, nor driving off), if any. */
  private onPad(bay: Building): Fighter | null {
    const u = bay.occupant !== null ? this.units.get(bay.occupant) : undefined;
    if (u?.kind !== 'fighter' || !u.alive || !u.service || u.service.waiting || u.service.leaving || u.path.length) return null;
    return u.hp < u.maxHp ? u : null;
  }

  /** The Service Bay whose footprint a unit stands in (on its pad), if any. */
  private bayUnder(u: GridPoint): Building | undefined {
    const tx = Math.floor(u.gx), ty = Math.floor(u.gy);
    for (const b of this.buildings.values()) {
      if (b.type === 'service_bay' && b.alive && tx >= b.tx && tx < b.tx + b.size && ty >= b.ty && ty < b.ty + b.size) return b;
    }
    return undefined;
  }

  /**
   * Send a vehicle to a Service Bay: it backs onto the pad (nose out) if it's free, or waits by the bay and takes the pad
   * when it comes free. On the pad it's repaired to full (repair()), or
   * until its side runs out of money, then it drives straight off.
   */
  private toBay(u: Fighter, bay: Building): void {
    this.leaveBay(u);
    Object.assign(u, { target: null, resume: null, attackMove: null, rest: null, mode: 'service', service: { bay: bay.id, waiting: false, leaving: false } });
    if (!this.claimPad(u, bay)) {
      // each waits on a tile of its own by the bay, off the pad's way in and out
      const d = serviceBayPad(bay.tx, bay.ty);
      const keep = new Set([...d.apron, this.tileOf(d.front)].map((t) => this.map.key(t.tx, t.ty)));
      const taken = this.claimedTiles(new Set([u.id]));
      const spot = this.freeTiles(this.tileOf(d.wait), 1, (k) => taken.has(k) || keep.has(k))[0];
      const w = !spot || (spot.tx === Math.floor(d.wait.gx) && spot.ty === Math.floor(d.wait.gy)) ? d.wait : { gx: spot.tx + 0.5, gy: spot.ty + 0.5 };
      u.service!.waiting = true;
      if (!this.goTo(u, w.gx, w.gy)) this.leaveBay(u, true);
    }
  }

  /** Take the bay's pad if it's free (or already ours) and head onto it. */
  private claimPad(u: Fighter, bay: Building): boolean {
    const occ = bay.occupant !== null ? this.units.get(bay.occupant) : undefined;
    if (occ?.alive && occ.id !== u.id) return false;
    const d = serviceBayPad(bay.tx, bay.ty);
    if (!this.goTo(u, d.pad.gx, d.pad.gy, d.front)) return false;
    bay.occupant = u.id;
    u.service!.waiting = false;
    return true;
  }

  /** Done with a Service Bay (or sent elsewhere): the pad is free again; with `idle`, it stops where it is. */
  private leaveBay(u: Fighter, idle = false): void {
    if (u.service) {
      const bay = this.buildings.get(u.service.bay);
      if (bay?.occupant === u.id) bay.occupant = null;
    }
    u.service = null;
    if (idle) Object.assign(u, { mode: 'idle', path: [], rest: null });
  }

  private updateService(u: Fighter, dt: number): void {
    const s = u.service;
    const bay = s ? this.buildings.get(s.bay) : undefined;
    if (!s || !bay?.alive || !bay.built) {
      // the bay is gone: it stays where it is
      this.leaveBay(u, true);
      return;
    }
    if (u.path.length) {
      this.stepAlong(u, dt);
      if (!u.path.length && s.leaving) this.leaveBay(u, true);
      return;
    }
    const done = u.hp >= u.maxHp || this.players[u.team].credits < 1;
    if (s.waiting) {
      // by the bay, waiting for the pad
      if (done) this.leaveBay(u, true);
      else this.claimPad(u, bay);
      return;
    }
    // on the pad: repaired until it's full or its side can't pay, then straight off it, nose first
    if (done) {
      s.leaving = true;
      u.path = [serviceBayPad(bay.tx, bay.ty).front];
    }
  }

  // --- Transports -------------------------------------------------------------------------------------------------------

  /** Where the foot of a transport's door on `side` is (on the ground, `ENGINE.transportDoorTiles` out to that side). */
  private doorFoot(t: Fighter, side: 1 | -1): GridPoint {
    const v = doorSide(t.dir, side);
    return { gx: t.gx + v.gx * ENGINE.transportDoorTiles, gy: t.gy + v.gy * ENGINE.transportDoorTiles };
  }

  /**
   * Infantry boarding: walk to the transport's nearer side door (after it, if it moves), wait there for the doors, and
   * go in when it's their turn. A transport that's full when they get there leaves them standing by it.
   */
  private updateBoarding(u: Fighter, dt: number): void {
    const b = u.board;
    const t = b ? this.units.get(b.transport) : undefined;
    if (!b || t?.kind !== 'fighter' || !t.alive || t.team !== u.team) return this.stopBoarding(u);
    const sides: (1 | -1)[] = b.atDoor ? [b.side] : [1, -1];
    const doors = sides.map((side) => ({ side, ...this.doorFoot(t, side) }));
    const door = doors.reduce((a, c) => (distance(u, c) < distance(u, a) ? c : a));
    const reach = distance(u, door);
    if (!t.path.length && (reach < 0.3 || (!u.path.length && reach <= ENGINE.boardReachTiles))) {
      if (t.passengers.length >= t.seats) return this.stopBoarding(u);
      Object.assign(b, { atDoor: true, side: door.side });
      u.path = [];
      u.dir = facing(t.gx - u.gx, t.gy - u.gy, 16);
      if (t.hatch === 'open' && t.gap <= 0) this.getIn(u, t, door.side);
      return;
    }
    b.atDoor = false;
    const end = u.path[u.path.length - 1];
    if (u.repath <= 0 && (!end || distance(end, door) > 0.5)) {
      u.repath = 500;
      if (!this.goTo(u, door.gx, door.gy)) return this.stopBoarding(u);
    }
    this.stepAlong(u, dt);
  }

  private stopBoarding(u: Fighter): void {
    Object.assign(u, { mode: 'idle', board: null, path: [] });
  }

  /** A soldier at its door goes in: off the map, kept (with his health) until he comes out. */
  private getIn(u: Fighter, t: Fighter, side: 1 | -1): void {
    this.units.delete(u.id);
    Object.assign(u, { path: [], moving: false, mode: 'idle', target: null, resume: null, board: null, post: null, mission: null });
    t.passengers.push(u);
    t.gap = ENGINE.boardGapMs;
    t.hatchTimer = ENGINE.hatchHoldMs;
    this.emitSeen({ e: 'boarded', unit: u.id, type: u.type, transport: t.id, gx: u.gx, gy: u.gy, side }, t, t.team);
  }

  private setHatch(t: Fighter, open: boolean, ms: number = ENGINE.hatchMs): void {
    t.hatch = open ? 'opening' : 'closing';
    t.hatchTimer = ms;
    this.emitSeen({ e: 'hatch', unit: t.id, open }, t, t.team);
  }

  /**
   * A transport's doors: they open for someone waiting at them or to let its passengers out (it stops for that, and
   * holds still meanwhile), stay open a moment after the last one, and shut when it drives off. Returns true while it
   * holds still.
   */
  private updateHatch(t: Fighter, ms: number): boolean {
    const ordered = t.path.length > 0 || t.mode !== 'idle';
    if (ordered) t.unloading = false; // sent elsewhere
    if (t.unloading && !t.passengers.length) t.unloading = false;
    const waiting = !ordered && [...this.units.values()].some((o) => o.kind === 'fighter' && o.board?.transport === t.id && o.board.atDoor);
    const want = t.unloading || waiting;
    t.hatchTimer -= ms;
    t.gap -= ms;
    switch (t.hatch) {
      case 'closed':
        if (want) this.setHatch(t, true);
        break;
      case 'opening':
        if (ordered) this.setHatch(t, false, ENGINE.hatchMs - Math.max(0, t.hatchTimer));
        else if (t.hatchTimer <= 0) Object.assign(t, { hatch: 'open', hatchTimer: ENGINE.hatchHoldMs, gap: 0 });
        break;
      case 'open':
        if (t.unloading && t.gap <= 0) {
          t.gap = ENGINE.boardGapMs; // no room by its doors: it tries again after a moment
          if (this.letOut(t)) t.hatchTimer = ENGINE.hatchHoldMs;
        }
        if (ordered || (!want && t.hatchTimer <= 0)) this.setHatch(t, false);
        break;
      case 'closing':
        if (t.hatchTimer <= 0) t.hatch = 'closed';
        else if (want) this.setHatch(t, true, ENGINE.hatchMs - t.hatchTimer);
        break;
    }
    return !ordered && want;
  }

  /**
   * Its first passenger comes out of the door on the camera's side (the other if there's no room there): down the
   * ramp, then onto the nearest free tile by it. False if there's no room by either door.
   */
  private letOut(t: Fighter): boolean {
    const p = t.passengers[0];
    if (!p) return false;
    const first = viewerSide(t.dir);
    for (const side of [first, -first as 1 | -1]) {
      const foot = this.doorFoot(t, side);
      const fx = Math.floor(foot.gx), fy = Math.floor(foot.gy);
      // where someone stands, or is heading (the one let out just before is still walking off the ramp)
      const at = (q: GridPoint | undefined, x: number, y: number) => !!q && Math.floor(q.gx) === x && Math.floor(q.gy) === y;
      const taken = (x: number, y: number) => this.map.isBlocked(x, y) || [...this.units.values()].some((o) => at(o, x, y) || at(o.path[o.path.length - 1], x, y));
      let best: { tx: number; ty: number } | null = null;
      let bestD = Infinity;
      for (let x = fx - 2; x <= fx + 2; x++) {
        for (let y = fy - 2; y <= fy + 2; y++) {
          const d = Math.hypot(x + 0.5 - foot.gx, y + 0.5 - foot.gy);
          if (d < bestD && !taken(x, y)) {
            best = { tx: x, ty: y };
            bestD = d;
          }
        }
      }
      if (!best) continue;
      t.passengers.shift();
      const from = this.map.isBlocked(fx, fy) ? { gx: best.tx + 0.5, gy: best.ty + 0.5 } : foot;
      const v = doorSide(t.dir, side);
      Object.assign(p, { gx: from.gx, gy: from.gy, dir: facing(v.gx, v.gy, 16), path: [], moving: false, mode: 'idle', target: null, resume: null, rest: null, board: null, scan: 0 });
      this.units.set(p.id, p);
      if (distance(from, { gx: best.tx + 0.5, gy: best.ty + 0.5 }) > 0.05 && this.goTo(p, best.tx + 0.5, best.ty + 0.5)) p.mode = 'move';
      this.emitSeen({ e: 'disembarked', unit: p.id, transport: t.id, side }, t, t.team);
      return true;
    }
    return false;
  }

  /** Defences shoot the nearest enemy unit in range (those that need power stop when it's low), turning to face it. */
  private defend(dt: number): void {
    for (const b of this.buildings.values()) {
      const def = BUILDINGS[b.type];
      if (!b.built || !def.weapons.length) continue;
      for (let i = 0; i < b.cools.length; i++) b.cools[i] -= dt * 1000;
      if (def.requiresPower && this.power[b.team].low) continue;
      const range = Math.max(...def.weapons.map((w) => weapon(w).rangeTiles));
      // it only fires on what its side can see
      let target = b.target !== null ? this.units.get(b.target) : undefined;
      if (!target?.alive || distTo(target, b) > range || !this.inSight(b.team, target)) {
        target = undefined;
        let best = range;
        for (const u of this.units.values()) {
          if (!u.alive || u.team === b.team || !this.weaponAt(def.weapons, u) || !this.inSight(b.team, u)) continue;
          const d = distTo(u, b);
          if (d <= best) {
            best = d;
            target = u;
          }
        }
      }
      b.target = target?.id ?? null;
      if (!target) continue;
      const c = { gx: b.tx + b.size / 2, gy: b.ty + b.size / 2 };
      b.dir = facing(target.gx - c.gx, target.gy - c.gy, TURRET_DIRECTIONS);
      this.volley(b, def.weapons, b.cools, target);
    }
  }

  /**
   * Busy right now (for its animations): producing, (a Service Bay) repairing a vehicle that's on its pad, or (an
   * Assembly Yard) its side building something.
   */
  private isWorking(b: Building): boolean {
    if (b.type === 'service_bay') return this.onPad(b) !== null;
    if (b.type === 'assembly_yard') return this.teamBuildings(b.team, false).some((o) => !o.built);
    return this.laneHeads(this.players[b.team].queue).some((q) => MATCH_CATALOG.units[q.unit]?.producedAt.includes(b.type));
  }

  /**
   * Repairs: buildings being repaired heal steadily, and Service Bays repair the vehicle parked on their
   * pad. Both pay as they heal (a full repair costs the spreadsheet's share of the price), stop when the money runs
   * out, and go at half speed on low power.
   */
  private repair(dt: number): void {
    for (const b of this.buildings.values()) {
      if (!b.repairing) continue;
      const p = this.players[b.team];
      const hp = Math.min(b.maxHp - b.hp, (b.maxHp / ENGINE.repairSecondsForFull) * dt / this.slowdown(b.team));
      const cost = (hp / b.maxHp) * BUILDINGS[b.type].cost * ECONOMY.structureFullRepairFraction;
      if (p.credits < cost) {
        b.repairing = false;
        this.toast(b.team, 'repairNoCredits', `Not enough money to repair the ${BUILDINGS[b.type].name}`);
        continue;
      }
      p.credits -= cost;
      b.hp += hp;
      if (b.hp >= b.maxHp) {
        b.repairing = false;
        this.toast(b.team, 'repaired', `${BUILDINGS[b.type].name} repaired`);
      }
    }
    for (const bay of this.buildings.values()) {
      if (bay.type !== 'service_bay' || !bay.built) continue;
      // only the vehicle parked on the pad: the ones waiting by the bay get nothing until it's their turn
      const u = this.onPad(bay);
      if (!u) continue;
      const hp = Math.min(u.maxHp - u.hp, (u.maxHp * ENGINE.repairSharePerSec * dt) / this.slowdown(bay.team));
      const cost = (hp / u.maxHp) * UNITS[u.type].cost * ECONOMY.unitFullRepairFraction;
      if (this.players[u.team].credits < cost) continue;
      this.players[u.team].credits -= cost;
      u.hp += hp;
    }
  }

  private fire(u: Fighter, target: Entity): void {
    const at = pos(target);
    // a turret aims on its own (updateFighter); otherwise the whole vehicle turns to fire
    if (!TURRET_UNITS.has(u.type) && this.weaponAt(u.weapons, target)) u.dir = facing(at.gx - u.gx, at.gy - u.gy, 16);
    this.volley(u, u.weapons, u.cools, target);
  }

  /**
   * Every weapon that's reloaded, reaches the target's layer and is in range fires, each on its own reload (the
   * rules' damage per second counts them all). Seen by the two sides and whoever has the shooter or target in sight.
   */
  private volley(from: Building | Fighter, weapons: readonly string[], cools: number[], target: Entity): void {
    const layer = target.cat === 'unit' ? layerOf(target.type) : 'ground';
    const at = pos(target);
    const d = from.cat === 'building' ? distTo(pos(target), from) : distTo(from, target);
    weapons.forEach((w, i) => {
      if (cools[i] > 0 || !canHit(w, layer) || d > weapon(w).rangeTiles || !target.alive) return;
      cools[i] = weapon(w).fireIntervalSec * 1000;
      for (const t of TEAMS) {
        if (t === from.team || t === target.team || this.inSight(t, from) || this.inSight(t, target)) this.emit(t, { e: 'shot', from: from.id, to: target.id, at, p: weapon(w).projectile ?? undefined });
      }
      this.damage(target, volleyDamage(w, target.armor), from);
    });
  }

  private damage(target: Entity, amount: number, attacker?: Entity): void {
    if (!target.alive) return;
    target.hp = Math.min(target.maxHp, target.hp - amount);
    if (target.hp <= 0) {
      if (target.cat === 'building') this.destroyBuilding(target);
      else this.killUnit(target);
      return;
    }
    // fight back unless already busy with a chosen target (a unit on the move stops, then carries on afterwards; one
    // whose turret turns on its own fires back on the move)
    if (target.cat === 'unit' && target.kind === 'fighter' && target.weapons.length && attacker?.alive && attacker.team !== target.team && (target.target === null || target.target === target.mission)) {
      if (target.mode === 'move' && (!TURRET_UNITS.has(target.type) || target.attackMove)) {
        target.resume = target.path[target.path.length - 1] ?? null;
        target.path = [];
        target.mode = 'idle';
      }
      target.target = attacker.id;
    }
  }

  killUnit(u: Unit): void {
    if (!u.alive) return;
    if (u.kind === 'harvester') this.cancelHarvester(u);
    u.alive = false;
    u.path = [];
    this.units.delete(u.id);
    // a transport's passengers die with it
    const lost = 1 + (u.kind === 'fighter' ? u.passengers.length : 0);
    if (u.kind === 'fighter') for (const p of u.passengers.splice(0)) p.alive = false;
    this.players[u.team].stats.unitsLost += lost;
    this.players[opponentOf(u.team)].stats.unitsKilled += lost;
    this.emitSeen({ e: 'unitDied', id: u.id, gx: u.gx, gy: u.gy, type: u.type }, u, u.team);
  }

  destroyBuilding(b: Building, sold = false): void {
    if (!b.alive) return;
    b.alive = false;
    this.buildings.delete(b.id);
    this.map.setFootprint(b.tx, b.ty, b.size, false);
    const name = BUILDINGS[b.type].name;
    if (!sold) {
      this.players[b.team].stats.buildingsLost++;
      this.players[opponentOf(b.team)].stats.buildingsDestroyed++;
    }
    for (const t of TEAMS) {
      // out of sight, the other side still sees it standing (its ghost) until it looks again
      if (t !== b.team && !this.inSight(t, b)) continue;
      this.ghosts[t].delete(b.id);
      this.emit(t, { e: 'buildingDestroyed', id: b.id, tx: b.tx, ty: b.ty, size: b.size, type: b.type, team: b.team, sold });
      if (!sold) this.toast(t, t === b.team ? 'buildingDestroyed' : 'enemyBuildingDestroyed', t === b.team ? `${name} destroyed` : `Enemy ${name} destroyed`);
    }
    for (const u of this.units.values()) if (u.kind === 'harvester' && u.home === b.id) this.onHomeLost(u);
    this.refresh();
  }

  // --- Views --------------------------------------------------------------------------------------------------------

  hello(team: TeamId): MatchHello {
    return {
      scenario: this.scenario.id,
      you: team,
      map: { ...this.scenario.map },
      camera: { ...this.scenario.camera[team] },
      viewMs: TICK_MS * VIEW_EVERY_TICKS,
      ore: this.ore.views(),
      scenery: this.scenery.map((t) => ({ ...t })),
      catalog: catalogFor(this.players[team].faction),
      factions: perTeam((t) => this.players[t].faction),
      difficulty: this.players[opponentOf(team)].difficulty,
      debug: false,
    };
  }

  /**
   * What `team` may know right now, with the whole fog. Pure: looking never changes the match, whoever looks and in
   * whatever order. Its `events` are empty: events leave the sim only through `takeEvents`, and a TeamFeed (feed.ts)
   * puts them into the views it sends, along with the fog only when it changed.
   */
  view(team: TeamId, paused = false): TeamView {
    const p = this.players[team];
    const fog = this.fog[team];
    const units: UnitView[] = [];
    for (const u of this.units.values()) {
      if (u.team !== team && !fog.isVisible(u.gx, u.gy)) continue;
      const v: UnitView = { id: u.id, type: u.type, team: u.team, gx: u.gx, gy: u.gy, dir: u.dir, hp: u.hp, maxHp: u.maxHp, moving: u.moving };
      if (u.kind === 'fighter' && u.aim >= 0) v.aim = u.aim;
      if (u.kind === 'fighter' && u.work) v.work = true;
      if (u.kind === 'fighter' && u.seats && u.team === team) {
        v.passengers = u.passengers.length;
        v.seats = u.seats;
      }
      if (u.kind === 'harvester') {
        v.activity = harvesterActivity(u.state);
        if (u.team === team) {
          v.cargo = u.cargo;
          v.capacity = ECONOMY.harvesterCapacity;
        }
      }
      units.push(v);
    }
    // its own buildings and enemy ones in sight as they are; the enemy's others as last seen
    const buildings: BuildingView[] = [];
    for (const b of this.buildings.values()) if (b.team === team || this.inSight(team, b)) buildings.push(this.buildingView(b, team));
    for (const [id, g] of this.ghosts[team]) {
      const b = this.buildings.get(id);
      if (!b || !this.inSight(team, b)) buildings.push({ ...g });
    }
    const power = this.power[team];
    return {
      tick: this.tick,
      timeMs: this.timeMs,
      paused,
      credits: Math.floor(p.credits),
      power: { made: power.produced, used: power.consumed, low: power.low },
      radar: this.radar(team),
      units,
      buildings,
      queue: p.queue.map((q) => ({ unit: q.unit, progress: q.progress })),
      unitCap: ENGINE.unitCap,
      fog: fog.encode(),
      events: [],
      stats: { ...p.stats, creditsEarned: Math.floor(p.stats.creditsEarned) },
    };
  }

  private buildingView(b: Building, team: TeamId): BuildingView {
    // low power: animations stop and beacons go dark (and buildings that need power stop working)
    return {
      id: b.id, type: b.type, team: b.team, tx: b.tx, ty: b.ty, size: b.size, hp: b.hp, maxHp: b.maxHp, progress: b.progress, built: b.built,
      powered: !this.power[b.team].low, ...(b.dir >= 0 && { facing: b.dir }), ...(b.repairing && b.team === team && { repairing: true }),
      ...(b.built && this.isWorking(b) && { working: true }),
    };
  }

  /**
   * Hand over the events `team` has been told of since the last call, and forget them. The one call that empties
   * them: whoever runs the match calls it at a fixed point (after each step), never as a side effect of looking.
   */
  takeEvents(team: TeamId): MatchEvent[] {
    const events = this.pending[team];
    this.pending[team] = [];
    return events;
  }

  // --- Debug ----------------------------------------------------------------------------------------------------------

  /** Development and test helpers (the server only accepts them with debug commands enabled). */
  debug(team: TeamId, cmd: DebugCommand): void {
    switch (cmd.d) {
      case 'credits':
        this.players[team].credits = cmd.amount;
        return;
      case 'fast':
        this.fast[team] = cmd.factor;
        return;
      case 'reveal':
        this.fog[team].revealAll = cmd.on;
        this.updateFog();
        return;
      case 'teleport':
        cmd.units.forEach((id, i) => {
          const u = this.units.get(id);
          if (!u) return;
          if (u.kind === 'harvester') this.cancelHarvester(u);
          else Object.assign(u, { path: [], mode: 'idle', target: null, rest: null });
          u.gx = cmd.gx + (i % 3) * 0.8;
          u.gy = cmd.gy + Math.floor(i / 3) * 0.8;
        });
        this.updateFog();
        return;
      case 'spawn': {
        const u = this.addUnit(cmd.unit, cmd.team, cmd.gx, cmd.gy);
        this.updateFog();
        if (u.kind === 'harvester') this.autoHarvest(u, true);
        return;
      }
      case 'destroyTeam':
        if (cmd.units) for (const u of this.teamUnits(cmd.team)) this.killUnit(u);
        if (cmd.buildings) for (const b of this.teamBuildings(cmd.team, false)) this.destroyBuilding(b);
        this.checkGameOver();
        return;
      case 'addTime':
        this.timeMs += cmd.ms;
        for (const t of TEAMS) this.players[t].stats.gameTimeMs = this.timeMs;
        return;
      case 'finishBuilds':
        for (const b of this.buildings.values()) if (b.team === team && !b.built) b.progress = 0.9999;
        for (const q of this.players[team].queue) q.progress = 0.9999;
        return;
    }
  }
}

function harvesterActivity(s: HarvesterState): HarvesterActivity {
  if (s === 'move' || s === 'toOre' || s === 'toDock' || s === 'toWait') return 'move';
  if (s === 'docking' || s === 'unload' || s === 'closing') return 'unload';
  return s;
}
