// Views: what a side is told at the start (hello) and in every view (its own state, what it sees, what it remembers).
// Pure: looking never changes the match.
import { ECONOMY } from '@gravity-harvest/rules';
import { opponentOf, perTeam, type BuildingView, type HarvesterActivity, type MatchHello, type TeamId, type TeamView, type UnitView } from '@gravity-harvest/shared';
import { ENGINE, TICK_MS, VIEW_EVERY_TICKS } from '../layout.js';
import type { Building, HarvesterState } from '../entities.js';
import { catalogFor } from '../catalog.js';
import type { SimState } from '../state.js';
import { isWorking } from './construction.js';
import { radar } from './power.js';
import { inSight } from './visibility.js';

function harvesterActivity(s: HarvesterState): HarvesterActivity {
  if (s === 'move' || s === 'toOre' || s === 'toDock' || s === 'toWait') return 'move';
  if (s === 'docking' || s === 'unload' || s === 'closing') return 'unload';
  return s;
}

export function hello(s: SimState, team: TeamId): MatchHello {
  return {
    scenario: s.scenario.id,
    you: team,
    map: { ...s.scenario.map },
    camera: { ...s.scenario.camera[team] },
    viewMs: TICK_MS * VIEW_EVERY_TICKS,
    ore: s.ore.views(),
    scenery: s.scenery.map((t) => ({ ...t })),
    catalog: catalogFor(s.players[team].faction),
    factions: perTeam((t) => s.players[t].faction),
    difficulty: s.players[opponentOf(team)].difficulty,
    debug: false,
  };
}

/**
 * What `team` may know right now, with the whole fog. Pure: looking never changes the match, whoever looks and in
 * whatever order. Its `events` are empty: events leave the sim only through `takeEvents`, and a TeamFeed (feed.ts)
 * puts them into the views it sends, along with the fog only when it changed.
 */
export function view(s: SimState, team: TeamId, paused = false): TeamView {
  const p = s.players[team];
  const fog = s.fog[team];
  const units: UnitView[] = [];
  for (const u of s.units.values()) {
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
  for (const b of s.buildings.values()) if (b.team === team || inSight(s, team, b)) buildings.push(buildingView(s, b, team));
  for (const [id, g] of s.ghosts[team]) {
    const b = s.buildings.get(id);
    if (!b || !inSight(s, team, b)) buildings.push({ ...g });
  }
  const power = s.power[team];
  return {
    tick: s.tick,
    timeMs: s.timeMs,
    paused,
    credits: Math.floor(p.credits),
    power: { made: power.produced, used: power.consumed, low: power.low },
    radar: radar(s, team),
    units,
    buildings,
    queue: p.queue.map((q) => ({ unit: q.unit, progress: q.progress })),
    unitCap: ENGINE.unitCap,
    fog: fog.encode(),
    events: [],
    stats: { ...p.stats, creditsEarned: Math.floor(p.stats.creditsEarned) },
  };
}

export function buildingView(s: SimState, b: Building, team: TeamId): BuildingView {
  // low power: animations stop and beacons go dark (and buildings that need power stop working)
  return {
    id: b.id, type: b.type, team: b.team, tx: b.tx, ty: b.ty, size: b.size, hp: b.hp, maxHp: b.maxHp, progress: b.progress, built: b.built,
    powered: !s.power[b.team].low, ...(b.dir >= 0 && { facing: b.dir }), ...(b.repairing && b.team === team && { repairing: true }),
    ...(b.built && isWorking(s, b) && { working: true }),
  };
}
