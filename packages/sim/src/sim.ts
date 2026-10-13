// The match: authoritative state and a fixed-step update. No rendering, no timers, no Math.random, so
// the same inputs give the same match (needed for saves now, and for replays and lockstep later).
import {
  BUILDINGS, CATALOG, ECONOMY, UNITS, canBuild, creditsFor, missingRequirements, powerBalance, refundFor,
  speedToTilesPerSec, volleyDamage, weapon, type Armor, type Faction, type PowerBalance,
} from '@gravity-harvest/rules';
import {
  emptyStats, type BuildingView, type Command, type DebugCommand, type GridPoint, type HarvesterActivity, type MatchEvent,
  type MatchCatalog, type MatchHello, type MatchStats, type TeamId, type TeamView, type UnitView,
} from '@gravity-harvest/shared';
import { Fog, type Viewer } from './fog.js';
import { distance, facing, type Tile } from './geometry.js';
import { Grid } from './grid.js';
import {
  ASSUME_OWNED, DOCK_FACING, ENGINE, ROSTER, TICK_MS, VIEW_EVERY_TICKS, checkPlacement, footprint, matchCatalog, refineryDock, sceneryKind,
  FACTION_COUNTERPART, TURRET_UNITS,
} from './layout.js';
import { Ore, type OreChange, type OreTile } from './ore.js';
import { findPath } from './pathfinder.js';
import { Rng } from './rng.js';
import { SCENARIOS, type ScenarioDef } from './scenarios.js';
import { OLDEST_LOADABLE_VERSION, SNAPSHOT_VERSION, type SimSnapshot } from './snapshot.js';
import { growScenery, type Scenery } from './scenery.js';

export const TEAMS: readonly TeamId[] = ['player', 'enemy'];
export const opponent = (t: TeamId): TeamId => (t === 'player' ? 'enemy' : 'player');

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
      id, name: u.name, faction: u.faction, stage: u.stage, cost: u.cost, buildTimeSec: u.buildTimeSec, producedAt: [...m.producedAt], prerequisites: m.prerequisites.map((a) => [...a]),
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
  /** Refineries: the harvester docked or heading to the dock. */
  occupant: number | null;
  /** Built during the match (a finished refinery then grants a harvester). */
  constructed: boolean;
  /** Being repaired (until full, or until the money runs out). */
  repairing: boolean;
  /** Building speed-up: an Assembler's yard unpacks in seconds rather than being built from scratch. */
  boost: number;
  /** A Service Bay: when it last repaired something (it's "working" for a moment after). */
  lastRepairMs: number;
  /** Defences: the head's direction (TURRET_DIRECTIONS steps; -1 = at rest), what it's shooting at, and its reload. */
  dir: number;
  target: number | null;
  cool: number;
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
}

export interface Fighter extends UnitBase {
  kind: 'fighter';
  mode: 'idle' | 'move' | 'attack';
  target: number | null;
  /** Long-range objective (raids): attacked when nothing else is in sight. */
  mission: number | null;
  /** Guard post: stay near it and return after a chase. */
  post: GridPoint | null;
  /** Where a move order was heading when the unit stopped to fight; it carries on there afterwards. */
  resume: GridPoint | null;
  weapons: string[];
  cool: number;
  scan: number;
  repath: number;
  /** A turret that turns on its own (TURRET_UNITS): its direction (TURRET_DIRECTIONS steps; -1 = along the hull). */
  aim: number;
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
}

/** A point on a unit's path; `back`: it reverses there, still facing the way it faced (backing onto a ramp). */
interface Waypoint extends GridPoint {
  back?: boolean;
}

const isHarvesterType = (type: string) => type === 'harvester';
/** Ground vehicles (combat and support, harvesters included): what a Service Bay repairs. Not infantry, aircraft or ships. */
const isVehicleType = (type: string) => UNITS[type]?.category?.endsWith('Vehicle') ?? false;
/** Defence heads and vehicle turrets aim in this many directions (their sprites have as many: render_construction.py `turret`, render_vehicle.py). */
const TURRET_DIRECTIONS = 32;

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
  private readonly fast: Record<TeamId, number> = { player: 1, enemy: 1 };
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
  private readonly pending: Record<TeamId, MatchEvent[]> = { player: [], enemy: [] };
  private readonly lastFog: Record<TeamId, string> = { player: '', enemy: '' };
  private power: Record<TeamId, PowerBalance>;
  private fogTimer = 0;
  private growTimer = 0;
  private raidTimer: number;
  private raidCount = 0;

  private constructor(readonly scenario: ScenarioDef, seed: number) {
    this.map = new Grid(scenario.map.width, scenario.map.height);
    this.ore = new Ore(this.map);
    this.fog = { player: new Fog(this.map), enemy: new Fog(this.map) };
    const credits = (c: number | 'rules') => (c === 'rules' ? ECONOMY.startingCredits : c);
    this.players = {
      player: { team: 'player', credits: credits(scenario.players.player.credits), human: scenario.players.player.human, faction: scenario.players.player.faction, queue: [], stats: emptyStats() },
      enemy: { team: 'enemy', credits: credits(scenario.players.enemy.credits), human: scenario.players.enemy.human, faction: scenario.players.enemy.faction, queue: [], stats: emptyStats() },
    };
    this.rng = new Rng(seed);
    this.power = { player: powerBalance([]), enemy: powerBalance([]) };
    this.raidTimer = ECONOMY.aiFirstAttackMinutes * 60_000;
  }

  /** A fresh match on a scenario. */
  /** A new match. `faction`: the side the human plays (the computer takes the other); default the scenario's. */
  static create(scenarioId: string, seed = 1, faction?: Faction): Sim {
    const sc = SCENARIOS[scenarioId];
    if (!sc) throw new Error(`Unknown scenario "${scenarioId}"`);
    const sim = new Sim(sc, seed);
    if (faction) {
      sim.players.player.faction = faction;
      sim.players.enemy.faction = faction === 'ordan' ? 'sable' : 'ordan';
    }
    // starting buildings of the other faction become the owner's own counterpart
    const buildings = sc.buildings.map((b) => {
      const f = BUILDINGS[b.type].faction;
      return f !== 'both' && f !== sim.players[b.team].faction && FACTION_COUNTERPART[b.type] ? { ...b, type: FACTION_COUNTERPART[b.type] } : b;
    });
    for (const b of buildings) sim.addBuilding(b.type, b.team, b.tx, b.ty, true);
    sc.oreFields.forEach((f, i) => sim.ore.addField(i, f.centre, f.radius, new Rng(f.seed)));
    sim.ore.placeRocks(sim.rng, () => sim.nextId++);
    sim.scenery = growScenery(sim.map, sim.ore, { buildings: buildings.map((b) => ({ ...b, size: footprint(b.type) })), units: sc.units }, sim.rng, () => sim.nextId++);
    for (const u of sc.units) {
      const unit = sim.addUnit(u.type, u.team, u.gx, u.gy);
      if (unit.kind === 'harvester') sim.autoHarvest(unit);
      else if (u.guard) unit.post = { gx: u.gx, gy: u.gy };
    }
    sim.refresh();
    sim.updateFog();
    return sim;
  }

  /** Resume a saved match. */
  static restore(raw: SimSnapshot): Sim {
    if (raw.version > SNAPSHOT_VERSION) throw new Error('Save is from a newer version');
    if (raw.version < OLDEST_LOADABLE_VERSION) throw new Error('Save is from an older version and can no longer be loaded');
    const sc = SCENARIOS[raw.scenario];
    if (!sc) throw new Error(`Unknown scenario "${raw.scenario}"`);
    const sim = new Sim(sc, raw.rng);
    sim.tick = raw.tick;
    sim.timeMs = raw.timeMs;
    for (const team of TEAMS) {
      const p = raw.players[team];
      Object.assign(sim.players[team], { credits: p.credits, queue: p.queue.map((q) => ({ ...q })), stats: { ...p.stats }, ...(p.faction && { faction: p.faction }) });
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
    for (const u of raw.units) {
      const nu = sim.addUnit(u.type, u.team, u.gx, u.gy, u.id);
      nu.hp = u.hp;
      if (nu.kind === 'harvester') {
        nu.cargo = u.cargo ?? 0;
        nu.field = u.field ?? sim.ore.nearestField(nu.gx, nu.gy);
      } else nu.post = u.post ?? null;
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
      players: {
        player: { credits: this.players.player.credits, queue: this.players.player.queue.map((q) => ({ ...q })), stats: { ...this.players.player.stats }, faction: this.players.player.faction },
        enemy: { credits: this.players.enemy.credits, queue: this.players.enemy.queue.map((q) => ({ ...q })), stats: { ...this.players.enemy.stats }, faction: this.players.enemy.faction },
      },
      buildings: [...this.buildings.values()].map((b) => ({
        id: b.id, type: b.type, team: b.team, tx: b.tx, ty: b.ty, hp: b.hp, progress: b.progress, constructed: b.constructed, seenBy: [...b.seenBy],
        ...(b.repairing && { repairing: true }),
      })),
      units: [...this.units.values()].map((u) => u.kind === 'harvester'
        ? { id: u.id, type: u.type, team: u.team, gx: u.gx, gy: u.gy, hp: u.hp, cargo: u.cargo, field: u.field }
        : { id: u.id, type: u.type, team: u.team, gx: u.gx, gy: u.gy, hp: u.hp, post: u.post }),
      ore: [...this.ore.tiles.values()].map((t) => ({ tx: t.tx, ty: t.ty, field: t.field, richness: t.richness, rocks: t.rocks.map((r) => ({ ...r })) })),
      scenery: this.scenery.map((t) => ({ ...t })),
      explored: { player: this.fog.player.serializeExplored(), enemy: this.fog.enemy.serializeExplored() },
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
      repairing: false, boost: 1, lastRepairMs: -1e9, dir: -1, target: null, cool: 0,
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
      path: [], moving: false, speed: speedToTilesPerSec(def.speed), sight: def.sight,
    };
    // a heal (the medic's) is never turned on enemies; healing their own side comes later
    const weapons = def.weapons.filter((w) => weapon(w).damage > 0);
    const u: Unit = isHarvesterType(type)
      ? { ...base, kind: 'harvester', dir: DOCK_FACING, state: 'idle', cargo: 0, field: this.ore.nearestField(gx, gy), home: this.nearestRefinery(gx, gy, team)?.id ?? null, oreKey: null, lastOreKey: null, timer: 0, unloaded: 0 }
      : { ...base, kind: 'fighter', dir: 14, mode: 'idle', target: null, mission: null, post: null, resume: null, weapons, cool: 0, scan: this.rng.range(0, 300), repath: 0, aim: -1 };
    this.units.set(id, u);
    return u;
  }

  private teamBuildings(team: TeamId, builtOnly = true): Building[] {
    return [...this.buildings.values()].filter((b) => b.team === team && (!builtOnly || b.built));
  }

  private teamUnits(team: TeamId): Unit[] {
    return [...this.units.values()].filter((u) => u.team === team);
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

  private nearestBuilding(gx: number, gy: number, team: TeamId): Building | null {
    let best: Building | null = null;
    let bestD = Infinity;
    for (const b of this.buildings.values()) {
      if (b.team !== team) continue;
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

  private toast(team: TeamId, text: string): void {
    if (this.players[team].human) this.emit(team, { e: 'toast', text });
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
        for (const o of cmd.orders) {
          const u = own(o.id);
          if (u) this.moveUnit(u, o.gx, o.gy);
        }
        return;
      case 'attack': {
        const target = this.entity(cmd.target);
        if (!target?.alive || target.team === team || !this.canSee(team, target)) return;
        for (const id of cmd.units) {
          const u = own(id);
          if (u?.kind === 'fighter') {
            u.target = target.id;
            u.mode = 'attack';
            u.repath = 0;
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
      case 'stop':
        for (const id of cmd.units) {
          const u = own(id);
          if (u?.kind === 'harvester') this.cancelHarvester(u);
          else if (u) Object.assign(u, { path: [], target: null, mode: 'idle' });
        }
        return;
      case 'place':
        return this.place(team, cmd.building, cmd.tx, cmd.ty);
      case 'train':
        return this.train(team, cmd.unit, cmd.near);
      case 'cancelTrain': {
        const q = this.players[team].queue;
        for (let i = q.length - 1; i >= 0; i--) {
          if (q[i].unit !== cmd.unit) continue;
          q.splice(i, 1);
          this.players[team].credits += UNITS[cmd.unit].cost; // nothing was used yet: all of it back
          return;
        }
        return;
      }
      case 'sell': {
        const b = this.buildings.get(cmd.building);
        if (!b || b.team !== team || !b.built) return;
        this.players[team].credits += refundFor(BUILDINGS[b.type].cost);
        this.toast(team, `${BUILDINGS[b.type].name} sold`);
        this.destroyBuilding(b, true);
        return;
      }
      case 'deploy':
        return this.deploy(team, cmd.unit);
      case 'cancelBuild': {
        const b = this.buildings.get(cmd.building);
        if (!b || b.team !== team || b.built) return;
        this.players[team].credits += BUILDINGS[b.type].cost;
        this.players[team].stats.buildingsBuilt = Math.max(0, this.players[team].stats.buildingsBuilt - 1);
        this.toast(team, `${BUILDINGS[b.type].name} cancelled`);
        this.destroyBuilding(b, true);
        return;
      }
      case 'repair': {
        const b = this.buildings.get(cmd.building);
        if (!b || b.team !== team || !b.built) return;
        if (cmd.on && b.hp >= b.maxHp) return this.toast(team, `${BUILDINGS[b.type].name} isn't damaged`);
        b.repairing = cmd.on;
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
    if (check.problem) return this.toast(team, `Can't deploy here: ${check.problem.toLowerCase()}`);
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
      return this.toast(team, `Build a ${this.missing(team, type) ?? 'prerequisite'} first`);
    }
    const check = checkPlacement(type, tx, ty, this.placementWorld(team));
    if (check.problem) return this.toast(team, check.problem);
    if (p.credits < def.cost) return this.toast(team, `Need $${Math.ceil(def.cost - p.credits).toLocaleString('en-US')} more`);
    p.credits -= def.cost;
    this.addBuilding(type, team, tx, ty, false);
    p.stats.buildingsBuilt++;
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
      return this.toast(team, `Build a ${this.missing(team, unit) ?? 'prerequisite'} first`);
    }
    if (this.teamUnits(team).length + p.queue.length >= ENGINE.unitCap) return this.toast(team, 'Unit cap reached');
    if (p.queue.length >= ENGINE.queueMax) return this.toast(team, 'Production queue is full');
    if (p.credits < def.cost) return this.toast(team, `Need $${Math.ceil(def.cost - p.credits).toLocaleString('en-US')} more`);
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
    for (const u of [...this.units.values()]) {
      if (!u.alive) continue;
      if (u.kind === 'harvester') this.updateHarvester(u, dt);
      else this.updateFighter(u, dt);
    }
    this.growOre();
    if (ENGINE.aiRaids) this.raids();
    this.fogTimer += TICK_MS;
    if (this.fogTimer >= ENGINE.fogUpdateMs) {
      this.fogTimer = 0;
      this.updateFog();
      this.checkGameOver();
    }
  }

  private construct(dt: number): void {
    for (const b of this.buildings.values()) {
      if (b.built) continue;
      b.progress = Math.min(1, b.progress + (dt * this.fast[b.team] * b.boost) / BUILDINGS[b.type].buildTimeSec / this.slowdown(b.team));
      if (b.progress < 1) continue;
      b.built = true;
      this.emit(b.team, { e: 'buildingDone', id: b.id });
      this.toast(b.team, `${BUILDINGS[b.type].name} ready`);
      if (b.type === 'refinery' && b.constructed) this.spawnHarvester(b); // refinery completion grants one
    }
  }

  private produce(dt: number): void {
    for (const t of TEAMS) {
      const p = this.players[t];
      const item = p.queue[0];
      if (!item) continue;
      const producers = this.teamBuildings(t).filter((b) => MATCH_CATALOG.units[item.unit].producedAt.includes(b.type));
      if (!producers.length) continue; // stalls until a producer exists again
      item.progress = Math.min(1, item.progress + (dt * this.fast[t]) / UNITS[item.unit].buildTimeSec / this.slowdown(t));
      if (item.progress < 1) continue;
      p.queue.shift();
      const near = item.near;
      const from = near ? producers.reduce((a, b) => (distance(centre(a), near) <= distance(centre(b), near) ? a : b)) : producers[0];
      const u = isHarvesterType(item.unit) && from.type === 'refinery' ? this.spawnHarvester(from) : this.spawnFighter(item.unit, from);
      this.emitSeen({ e: 'unitOut', building: from.id, unit: u.id }, centre(from), from.team);
      this.emit(t, { e: 'unitReady', id: u.id, type: u.type });
      this.toast(t, `${UNITS[u.type].name} ready`);
    }
  }

  private spawnHarvester(ref: Building): Harvester {
    const d = refineryDock(ref.tx, ref.ty);
    const h = this.addUnit('harvester', ref.team, d.wait.gx, d.wait.gy) as Harvester;
    h.home = ref.id;
    h.field = this.ore.nearestField(d.wait.gx, d.wait.gy);
    this.autoHarvest(h);
    return h;
  }

  /** A unit out of a building's front (its entrance, the lower-left face); a harvester then goes to work. */
  private spawnFighter(type: string, from: Building): Unit {
    const at = this.map.nearestFree(Math.floor(from.tx + from.size / 2), from.ty + from.size) ?? { tx: from.tx, ty: from.ty + from.size };
    const u = this.addUnit(type, from.team, at.tx + 0.5, at.ty + 0.5);
    if (u.kind === 'harvester') {
      u.home = this.nearestRefinery(u.gx, u.gy, u.team)?.id ?? null;
      this.autoHarvest(u);
    } else this.moveUnit(u, at.tx + 0.5 + this.rng.range(-1, 1), at.ty + 1.5 + this.rng.range(0, 1));
    // straight out of the door first, a tile clear of the building, then it turns towards where it's going
    const out = { gx: at.tx + 0.5, gy: at.ty + 1.5 };
    const first = u.path[0];
    if (first && !this.map.isBlocked(at.tx, at.ty + 1) && (first.gx !== out.gx || first.gy !== out.gy)) u.path.unshift(out);
    return u;
  }

  /**
   * Every growth tick (spreadsheet): partly harvested tiles grow back, the field's roots regrow from empty, and emptied
   * tiles next to well-filled ones start growing again.
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
    this.emitOre(changes);
  }

  /** Computer raids (off by default: ENGINE.aiRaids). Pacing from the spreadsheet. */
  private raids(): void {
    if ((this.raidTimer -= TICK_MS) > 0) return;
    this.raidTimer = ECONOMY.aiAttackIntervalMinutes * 60_000;
    for (const t of TEAMS) {
      if (this.players[t].human) continue;
      const barracks = this.teamBuildings(t).find((b) => b.type === 'barracks');
      if (!barracks) continue;
      const target = this.nearestBuilding(barracks.tx, barracks.ty, opponent(t));
      if (!target) continue;
      this.raidCount++;
      const count = Math.min(ENGINE.aiRaidMax, 1 + this.raidCount);
      for (let i = 0; i < count; i++) {
        const at = this.map.nearestFree(barracks.tx + 1 + (i % 3), barracks.ty - 1 - Math.floor(i / 3));
        if (at) (this.addUnit('rifleman', t, at.tx + 0.5, at.ty + 0.5) as Fighter).mission = target.id;
      }
      this.toast(opponent(t), `Enemy raid: ${count} soldiers heading for your base`);
    }
  }

  // --- Fog and game over ------------------------------------------------------------------------------------------

  private canSee(team: TeamId, e: Entity): boolean {
    if (e.team === team) return true;
    return e.cat === 'building' ? e.seenBy.has(team) : this.fog[team].isVisible(e.gx, e.gy);
  }

  private updateFog(): void {
    for (const t of TEAMS) {
      const viewers: Viewer[] = [];
      for (const u of this.units.values()) if (u.team === t) viewers.push({ gx: u.gx, gy: u.gy, sight: u.sight });
      for (const b of this.buildings.values()) if (b.team === t) viewers.push({ ...centre(b), sight: BUILDINGS[b.type].sight + b.size / 2 });
      this.fog[t].update(viewers);
      for (const b of this.buildings.values()) if (b.team !== t && !b.seenBy.has(t) && this.fog[t].isExplored(b.tx, b.ty, b.size)) b.seenBy.add(t);
    }
  }

  /** A side is out when it has no buildings left (a human also needs no units left). */
  private checkGameOver(): void {
    for (const t of TEAMS) {
      const out = !this.teamBuildings(t, false).length && (!this.players[t].human || !this.teamUnits(t).length);
      if (out) {
        this.winner = opponent(t);
        return;
      }
    }
  }

  // --- Movement -----------------------------------------------------------------------------------------------------

  /** A harvester on its refinery's ramp (at the dock) drives straight off it to here before anything else. */
  private leadOut(u: Unit): GridPoint | null {
    if (u.kind !== 'harvester' || u.home === null) return null;
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
   * the last stretch in a straight line (up a ramp, nose out).
   */
  private goTo(u: Unit, gx: number, gy: number, via: GridPoint | null = null): boolean {
    let goal: Tile | null = via ? { tx: Math.floor(via.gx), ty: Math.floor(via.gy) } : { tx: Math.floor(gx), ty: Math.floor(gy) };
    if (!via && this.map.isBlocked(goal.tx, goal.ty)) {
      goal = this.map.nearestFree(goal.tx, goal.ty);
      if (!goal) return false;
      gx = goal.tx + 0.5;
      gy = goal.ty + 0.5;
    }
    const tiles = findPath(this.map, this.startTile(u), goal);
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
      u.gx += (dgx / (dist || 1)) * move;
      u.gy += (dgy / (dist || 1)) * move;
      moved += move;
      step -= move;
      if (move >= dist) u.path.shift();
    }
    u.moving = moved > 0;
    return moved;
  }

  private moveUnit(u: Unit, gx: number, gy: number): void {
    if (u.kind === 'harvester') {
      this.cancelHarvester(u);
      if (this.goTo(u, gx, gy)) u.state = 'move';
      return;
    }
    u.target = null;
    u.resume = null;
    u.mode = this.goTo(u, gx, gy) ? 'move' : 'idle';
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

  private autoHarvest(h: Harvester): void {
    const t = this.ore.pickFor(h.gx, h.gy, h.field);
    if (t) this.harvest(h, t);
  }

  private harvest(h: Harvester, tile: OreTile): void {
    h.field = tile.field; // works this field from now on
    h.oreKey = h.lastOreKey = this.map.key(tile.tx, tile.ty);
    h.state = this.goTo(h, tile.tx + 0.5, tile.ty + 0.5) ? 'toOre' : 'idle';
  }

  returnHome(h: Harvester, refinery?: Building): void {
    h.timer = 0;
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
    const from = last?.rocks.length ? last : this.ore.pickFor(h.gx, h.gy, h.field);
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
            const next = this.ore.pickFor(h.gx, h.gy, h.field);
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
        h.timer = ENGINE.doorMs;
        return;
      }
      case 'closing':
        h.timer -= ms;
        if (h.timer <= 0) this.leaveDock(h);
        return;
      case 'idle':
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

  private range(u: Fighter): number {
    return Math.max(0, ...u.weapons.map((w) => weapon(w).rangeTiles));
  }

  /** How far an idle unit looks for a fight: its sight, or its weapon range plus a margin, whichever is larger. */
  private acquireRange(u: Fighter): number {
    return Math.max(u.sight, this.range(u) + ENGINE.acquireMargin);
  }

  /** Closest hostile unit within range; computer soldiers also consider buildings (they raid bases). */
  private findEnemy(u: Fighter, range: number): Entity | null {
    let best: Entity | null = null;
    let bestD = range;
    for (const o of this.units.values()) {
      if (!o.alive || o.team === u.team) continue;
      if (Math.abs(o.gx - u.gx) > range || Math.abs(o.gy - u.gy) > range) continue;
      const d = Math.hypot(o.gx - u.gx, o.gy - u.gy);
      if (d <= bestD) {
        best = o;
        bestD = d;
      }
    }
    if (!this.players[u.team].human) {
      for (const b of this.buildings.values()) {
        if (b.team === u.team) continue;
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
    u.scan -= ms;
    u.repath -= ms;
    let target = u.target !== null ? this.entity(u.target) : undefined;
    if (target && !target.alive) target = undefined;
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
    }
    // Look for something to shoot. On the move, only enemies already within weapon range (the unit stops to fight,
    // then carries on, unless its turret turns on its own: that fires on the move); otherwise anything within
    // acquire range, which it moves in on.
    const firesOnTheMove = TURRET_UNITS.has(u.type) && u.mode === 'move';
    if (u.scan <= 0 && (!target || target.id === u.mission) && u.weapons.length) {
      u.scan = 300;
      const moving = u.mode === 'move';
      const seen = this.findEnemy(u, moving ? this.range(u) : this.acquireRange(u));
      if (seen) {
        if (moving && !firesOnTheMove) {
          u.resume = u.path[u.path.length - 1] ?? null;
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
    if (!target && u.post && !u.path.length && distance(u, u.post) > 0.6) this.goTo(u, u.post.gx, u.post.gy);
    // Raiders with nothing in sight march on their objective
    if (!target && u.mission !== null) {
      let m = this.entity(u.mission);
      if (!m?.alive) {
        m = this.nearestBuilding(u.gx, u.gy, opponent(u.team)) ?? undefined;
        u.mission = m?.id ?? null;
      }
      target = m;
    }
    u.target = target?.id ?? null;
    if (TURRET_UNITS.has(u.type)) {
      const at = target && u.weapons.length ? pos(target) : null;
      u.aim = at ? facing(at.gx - u.gx, at.gy - u.gy, TURRET_DIRECTIONS) : -1;
    }
    if (target && u.weapons.length && firesOnTheMove) {
      // keeps to its path, shooting what it passes; what falls out of range is let go
      if (distTo(u, target) <= this.range(u)) {
        if (u.cool <= 0) this.fire(u, target);
      } else {
        u.target = null;
        u.aim = -1;
      }
      this.stepAlong(u, dt);
      if (!u.path.length) u.mode = 'idle';
    } else if (target && u.weapons.length) {
      if (distTo(u, target) <= this.range(u)) {
        u.path = [];
        if (u.cool <= 0) this.fire(u, target);
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
      if (!u.path.length && u.mode === 'move') u.mode = 'idle';
    } else if (u.mode === 'move') u.mode = 'idle';
  }

  /** Defences shoot the nearest enemy unit in range (those that need power stop when it's low), turning to face it. */
  private defend(dt: number): void {
    for (const b of this.buildings.values()) {
      const def = BUILDINGS[b.type];
      if (!b.built || !def.weapons.length) continue;
      b.cool -= dt * 1000;
      if (def.requiresPower && this.power[b.team].low) continue;
      const range = Math.max(...def.weapons.map((w) => weapon(w).rangeTiles));
      let target = b.target !== null ? this.units.get(b.target) : undefined;
      if (!target?.alive || distTo(target, b) > range) {
        target = undefined;
        let best = range;
        for (const u of this.units.values()) {
          if (!u.alive || u.team === b.team) continue;
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
      if (b.cool > 0) continue;
      const w = def.weapons[0];
      b.cool = weapon(w).fireIntervalSec * 1000;
      const at = pos(target);
      for (const t of TEAMS) {
        if (t === b.team || t === target.team || b.seenBy.has(t)) this.emit(t, { e: 'shot', from: b.id, to: target.id, at, p: weapon(w).projectile ?? undefined });
      }
      this.damage(target, volleyDamage(w, target.armor), b);
    }
  }

  /** Busy right now (for its animations): producing, repairing, or (an Assembly Yard) its side building something. */
  private isWorking(b: Building): boolean {
    if (b.type === 'service_bay') return this.timeMs - b.lastRepairMs < 400;
    if (b.type === 'assembly_yard') return this.teamBuildings(b.team, false).some((o) => !o.built);
    const head = this.players[b.team].queue[0];
    return !!head && MATCH_CATALOG.units[head.unit]?.producedAt.includes(b.type);
  }

  /**
   * Repairs: buildings being repaired heal steadily, and Service Bays repair their side's vehicles parked next to
   * them. Both pay as they heal (a full repair costs the spreadsheet's share of the price) and stop when the money
   * runs out.
   */
  private repair(dt: number): void {
    for (const b of this.buildings.values()) {
      if (!b.repairing) continue;
      const p = this.players[b.team];
      const hp = Math.min(b.maxHp - b.hp, (b.maxHp / ENGINE.repairSecondsForFull) * dt / this.slowdown(b.team));
      const cost = (hp / b.maxHp) * BUILDINGS[b.type].cost * ECONOMY.structureFullRepairFraction;
      if (p.credits < cost) {
        b.repairing = false;
        this.toast(b.team, `Not enough money to repair the ${BUILDINGS[b.type].name}`);
        continue;
      }
      p.credits -= cost;
      b.hp += hp;
      if (b.hp >= b.maxHp) {
        b.repairing = false;
        this.toast(b.team, `${BUILDINGS[b.type].name} repaired`);
      }
    }
    for (const bay of this.buildings.values()) {
      if (bay.type !== 'service_bay' || !bay.built) continue;
      for (const u of this.units.values()) {
        if (u.team !== bay.team || !isVehicleType(u.type) || u.hp >= u.maxHp) continue;
        if (distTo(u, bay) > ENGINE.repairRangeTiles) continue;
        const hp = Math.min(u.maxHp - u.hp, u.maxHp * ENGINE.repairSharePerSec * dt);
        const cost = (hp / u.maxHp) * UNITS[u.type].cost * ECONOMY.unitFullRepairFraction;
        if (this.players[u.team].credits < cost) continue;
        this.players[u.team].credits -= cost;
        u.hp += hp;
        bay.lastRepairMs = this.timeMs;
      }
    }
  }

  private fire(u: Fighter, target: Entity): void {
    const w = u.weapons[0];
    u.cool = weapon(w).fireIntervalSec * 1000;
    const at = pos(target);
    // a turret aims on its own (updateFighter); otherwise the whole vehicle turns to fire
    if (!TURRET_UNITS.has(u.type)) u.dir = facing(at.gx - u.gx, at.gy - u.gy, 16);
    for (const t of TEAMS) {
      if (t === u.team || t === target.team || this.fog[t].isVisible(u.gx, u.gy) || this.canSee(t, target)) this.emit(t, { e: 'shot', from: u.id, to: target.id, at, p: weapon(w).projectile ?? undefined });
    }
    this.damage(target, volleyDamage(w, target.armor), u);
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
      if (target.mode === 'move' && !TURRET_UNITS.has(target.type)) {
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
    this.players[u.team].stats.unitsLost++;
    this.players[opponent(u.team)].stats.unitsKilled++;
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
      this.players[opponent(b.team)].stats.buildingsDestroyed++;
    }
    for (const t of TEAMS) {
      if (t !== b.team && !b.seenBy.has(t)) continue;
      this.emit(t, { e: 'buildingDestroyed', id: b.id, tx: b.tx, ty: b.ty, size: b.size, type: b.type, team: b.team, sold });
      if (!sold) this.toast(t, t === b.team ? `${name} destroyed` : `Enemy ${name} destroyed`);
    }
    for (const u of this.units.values()) if (u.kind === 'harvester' && u.home === b.id) this.onHomeLost(u);
    this.refresh();
  }

  // --- Views --------------------------------------------------------------------------------------------------------

  hello(team: TeamId): MatchHello {
    return {
      scenario: this.scenario.id,
      team,
      map: { ...this.scenario.map },
      camera: { ...this.scenario.camera },
      viewMs: TICK_MS * VIEW_EVERY_TICKS,
      ore: this.ore.views(),
      scenery: this.scenery.map((t) => ({ ...t })),
      catalog: catalogFor(this.players[team].faction),
      faction: this.players[team].faction,
      debug: false,
    };
  }

  /** What `team` may know right now; drains its pending events. */
  view(team: TeamId, paused = false): TeamView {
    const p = this.players[team];
    const fog = this.fog[team];
    const units: UnitView[] = [];
    for (const u of this.units.values()) {
      if (u.team !== team && !fog.isVisible(u.gx, u.gy)) continue;
      const v: UnitView = { id: u.id, type: u.type, team: u.team, gx: u.gx, gy: u.gy, dir: u.dir, hp: u.hp, maxHp: u.maxHp, moving: u.moving };
      if (u.kind === 'fighter' && u.aim >= 0) v.aim = u.aim;
      if (u.kind === 'harvester') {
        v.activity = harvesterActivity(u.state);
        if (u.team === team) {
          v.cargo = u.cargo;
          v.capacity = ECONOMY.harvesterCapacity;
        }
      }
      units.push(v);
    }
    const buildings: BuildingView[] = [];
    for (const b of this.buildings.values()) {
      if (b.team !== team && !b.seenBy.has(team)) continue;
      // low power: animations stop and beacons go dark (and buildings that need power stop working)
      buildings.push({
        id: b.id, type: b.type, team: b.team, tx: b.tx, ty: b.ty, size: b.size, hp: b.hp, maxHp: b.maxHp, progress: b.progress, built: b.built,
        powered: !this.power[b.team].low, ...(b.dir >= 0 && { facing: b.dir }), ...(b.repairing && b.team === team && { repairing: true }),
        ...(b.built && this.isWorking(b) && { working: true }),
      });
    }
    const fogStr = fog.encode();
    const fogChanged = fogStr !== this.lastFog[team];
    this.lastFog[team] = fogStr;
    const events = this.pending[team];
    this.pending[team] = [];
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
      ...(fogChanged && { fog: fogStr }),
      events,
      stats: { ...p.stats, creditsEarned: Math.floor(p.stats.creditsEarned) },
    };
  }

  /** Make the next view resend the whole fog (a client just (re)connected). */
  resendFog(team: TeamId): void {
    this.lastFog[team] = '';
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
          else Object.assign(u, { path: [], mode: 'idle', target: null });
          u.gx = cmd.gx + (i % 3) * 0.8;
          u.gy = cmd.gy + Math.floor(i / 3) * 0.8;
        });
        this.updateFog();
        return;
      case 'spawn': {
        const u = this.addUnit(cmd.unit, cmd.team, cmd.gx, cmd.gy);
        if (u.kind === 'harvester') this.autoHarvest(u);
        this.updateFog();
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
