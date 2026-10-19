// The match: authoritative state and a fixed-step update. No rendering, no timers, no Math.random, so
// the same inputs give the same match (needed for saves and replays, replay.ts).
//
// Sim is the public face: the state lives in a SimState (state.ts) and each mechanic is a system in ./systems, plain
// functions over that state. `step` below is the schedule: the order the systems run in each tick.
import type { Faction, PowerBalance } from '@gravity-harvest/rules';
import { TEAMS, type Command, type DebugCommand, type GridPoint, type MatchEvent, type MatchHello, type TeamId, type TeamView } from '@gravity-harvest/shared';
import type { Building, Entity, Harvester, PlayerState, Unit } from './entities.js';
import type { Fog } from './fog.js';
import type { Grid } from './grid.js';
import { ENGINE, TICK_MS } from './layout.js';
import type { RawSave } from './migrations.js';
import type { Ore } from './ore.js';
import type { Rng } from './rng.js';
import { SCENARIOS, type ScenarioDef } from './scenarios.js';
import type { Scenery } from './scenery.js';
import type { SimSnapshot } from './snapshot.js';
import type { SimState } from './state.js';
import { separate, unstick } from './systems/collisions.js';
import { defend } from './systems/combat.js';
import { construct, placementWorld, produce, underConstruction } from './systems/construction.js';
import { debug } from './systems/debug.js';
import { updateFighter } from './systems/fighters.js';
import { growOre, nearestRefinery, returnHome, updateHarvester } from './systems/harvesting.js';
import { addBuilding, checkGameOver, destroyBuilding, killUnit } from './systems/lifecycle.js';
import { command } from './systems/orders.js';
import { refresh } from './systems/power.js';
import { restoreMatch, snapshot } from './systems/save.js';
import { repair } from './systems/service.js';
import { newMatch, type CreateOptions } from './systems/setup.js';
import { updateFog } from './systems/visibility.js';
import { hello, view } from './systems/views.js';

export { MATCH_CATALOG, MATCH_PUBLIC_CATALOG, catalogFor, laneOf, type ProductionLane } from './catalog.js';
export { distTo, type Building, type Entity, type Fighter, type Harvester, type PlayerState, type QueueItem, type Unit } from './entities.js';
export type { CreateOptions } from './systems/setup.js';

export class Sim {
  private constructor(private readonly s: SimState) {}

  /**
   * A new match. `faction`: the faction of the human's seat (`opts.seat`, default the scenario's human seat); the computer
   * takes the other seat and the other faction. Both default to the scenario's. A scenario that isn't in SCENARIOS can be passed as it is
   * (a dev page's own little map); such a match can't be restored.
   */
  static create(scenarioId: string | ScenarioDef, seed = 1, faction?: Faction, opts: CreateOptions = {}): Sim {
    const sc = typeof scenarioId === 'string' ? SCENARIOS[scenarioId] : scenarioId;
    if (!sc) throw new Error(`Unknown scenario "${scenarioId}"`);
    return new Sim(newMatch(sc, seed, faction, opts));
  }

  /**
   * Carry on a saved match exactly where it was (an older save is migrated first; it loads with every unit idle). The
   * scenario is rebuilt from code: a save made on an earlier version of its map still loads (see `saveWarnings`).
   */
  static restore(saved: SimSnapshot | RawSave): Sim {
    return new Sim(restoreMatch(saved));
  }

  /** The whole match, as plain JSON (a copy: it never changes with the match). */
  snapshot(): SimSnapshot {
    return snapshot(this.s);
  }

  // --- State --------------------------------------------------------------------------------------------------------

  get scenario(): ScenarioDef {
    return this.s.scenario;
  }
  get map(): Grid {
    return this.s.map;
  }
  get ore(): Ore {
    return this.s.ore;
  }
  get fog(): Record<TeamId, Fog> {
    return this.s.fog;
  }
  get players(): Record<TeamId, PlayerState> {
    return this.s.players;
  }
  get buildings(): ReadonlyMap<number, Building> {
    return this.s.buildings;
  }
  get units(): ReadonlyMap<number, Unit> {
    return this.s.units;
  }
  /** Trees, rocks (they block their tiles), bushes and logs. */
  get scenery(): Scenery[] {
    return this.s.scenery;
  }
  set scenery(list: Scenery[]) {
    this.s.scenery = list;
  }
  get tick(): number {
    return this.s.tick;
  }
  get timeMs(): number {
    return this.s.timeMs;
  }
  get nextId(): number {
    return this.s.nextId;
  }
  get rng(): Rng {
    return this.s.rng;
  }
  /** Set when the match ends. */
  get winner(): TeamId | null {
    return this.s.winner;
  }

  entity(id: number): Entity | undefined {
    return this.s.entity(id);
  }

  powerOf(team: TeamId): PowerBalance {
    return this.s.power[team];
  }

  nearestRefinery(gx: number, gy: number, team: TeamId): Building | null {
    return nearestRefinery(this.s, gx, gy, team);
  }

  /**
   * The building (`defence`: the defence) a side has going up, if any: each side builds one of each at a time. A yard an
   * Assembler unpacked doesn't count (that's the Assembler's doing, not the yard's).
   */
  underConstruction(team: TeamId, defence: boolean): Building | null {
    return underConstruction(this.s, team, defence);
  }

  placementWorld(team: TeamId) {
    return placementWorld(this.s, team);
  }

  /** Put a building on the map as it is, built or not (tests set up situations with it). */
  addBuilding(type: string, team: TeamId, tx: number, ty: number, built: boolean, id?: number): Building {
    return addBuilding(this.s, type, team, tx, ty, built, id);
  }

  // --- Orders and the tick ------------------------------------------------------------------------------------------

  /** Apply a player's order. Invalid orders are ignored (with a toast explaining why, where useful). */
  command(team: TeamId, cmd: Command): void {
    command(this.s, team, cmd);
  }

  /** Advance the match by one tick. */
  step(): void {
    const s = this.s;
    if (s.winner) return;
    s.tick++;
    s.timeMs += TICK_MS;
    // (the grid follows every move as it happens; starting each tick afresh also covers what happened between ticks)
    s.grid.rebuild(s.units.values());
    const dt = TICK_MS / 1000;
    for (const t of TEAMS) s.players[t].stats.gameTimeMs = s.timeMs;
    refresh(s);
    construct(s, dt);
    produce(s, dt);
    defend(s, dt);
    repair(s, dt);
    const before = new Map<number, GridPoint>();
    for (const u of s.units.values()) before.set(u.id, { gx: u.gx, gy: u.gy });
    for (const u of [...s.units.values()]) {
      if (!u.alive) continue;
      if (u.kind === 'harvester') updateHarvester(s, u, dt);
      else updateFighter(s, u, dt);
    }
    separate(s);
    unstick(s, before, dt);
    growOre(s);
    s.fogTimer += TICK_MS;
    if (s.fogTimer >= ENGINE.fogUpdateMs) {
      s.fogTimer = 0;
      updateFog(s);
      checkGameOver(s);
    }
  }

  returnHome(h: Harvester, refinery?: Building): void {
    returnHome(this.s, h, refinery);
  }

  killUnit(u: Unit): void {
    killUnit(this.s, u);
  }

  destroyBuilding(b: Building, sold = false): void {
    destroyBuilding(this.s, b, sold);
  }

  // --- Views --------------------------------------------------------------------------------------------------------

  hello(team: TeamId): MatchHello {
    return hello(this.s, team);
  }

  /**
   * What `team` may know right now, with the whole fog. Pure: looking never changes the match, whoever looks and in
   * whatever order. Its `events` are empty: events leave the sim only through `takeEvents`, and a TeamFeed (feed.ts)
   * puts them into the views it sends, along with the fog only when it changed.
   */
  view(team: TeamId, paused = false): TeamView {
    return view(this.s, team, paused);
  }

  /**
   * Hand over the events `team` has been told of since the last call, and forget them. The one call that empties
   * them: whoever runs the match calls it at a fixed point (after each step), never as a side effect of looking.
   */
  takeEvents(team: TeamId): MatchEvent[] {
    const events = this.s.pending[team];
    this.s.pending[team] = [];
    return events;
  }

  /** Development and test helpers (the server only accepts them with debug commands enabled). */
  debug(team: TeamId, cmd: DebugCommand): void {
    debug(this.s, team, cmd);
  }
}
