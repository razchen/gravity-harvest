// The match's state, shared by every system (./systems): the map, ore, fog, players, units and buildings, clocks and
// the RNG. No behaviour beyond a few lookups; the systems are plain functions over it, and Sim (sim.ts) is the public
// face that runs them.
import { ECONOMY, powerBalance, type PowerBalance } from '@gravity-harvest/rules';
import { DEFAULT_DIFFICULTY, emptyStats, perTeam, type BuildingView, type MatchEvent, type TeamId } from '@gravity-harvest/shared';
import type { Building, Entity, PlayerState, Unit } from './entities.js';
import { Fog } from './fog.js';
import { Grid } from './grid.js';
import { Ore } from './ore.js';
import { Rng } from './rng.js';
import type { ScenarioDef } from './scenarios.js';
import type { Scenery } from './scenery.js';

export class SimState {
  readonly map: Grid;
  readonly ore: Ore;
  readonly fog: Record<TeamId, Fog>;
  readonly players: Record<TeamId, PlayerState>;
  /** Debug fast mode: each team's speed-up for building, production and movement (1 = normal). */
  readonly fast: Record<TeamId, number> = perTeam(() => 1);
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
  readonly pending: Record<TeamId, MatchEvent[]> = perTeam(() => []);
  /**
   * Each side's picture of the enemy buildings it has discovered, as they were when last in its sight. Out of sight it
   * is sent this instead of the real thing, and one destroyed or sold out of sight stays until the spot is seen again.
   */
  readonly ghosts: Record<TeamId, Map<number, BuildingView>> = perTeam(() => new Map());
  power: Record<TeamId, PowerBalance>;
  fogTimer = 0;
  growTimer = 0;

  constructor(readonly scenario: ScenarioDef, seed: number) {
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

  entity(id: number): Entity | undefined {
    return this.buildings.get(id) ?? this.units.get(id);
  }

  teamBuildings(team: TeamId, builtOnly = true): Building[] {
    return [...this.buildings.values()].filter((b) => b.team === team && (!builtOnly || b.built));
  }

  teamUnits(team: TeamId): Unit[] {
    return [...this.units.values()].filter((u) => u.team === team);
  }

  /** A side's units for the unit cap: those on the map and those riding in its transports. */
  armySize(team: TeamId): number {
    return this.teamUnits(team).reduce((n, u) => n + 1 + (u.kind === 'fighter' ? u.passengers.length : 0), 0);
  }

  ownedTypes(team: TeamId): string[] {
    return this.teamBuildings(team).map((b) => b.type);
  }
}
