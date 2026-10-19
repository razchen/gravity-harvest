// Units and buildings coming and going: made (with what their type gives them from the rules), killed, destroyed or
// sold, and the end of the match when a side has nothing left.
import { BUILDINGS, UNITS, speedToTilesPerSec, weapon } from '@gravity-harvest/rules';
import { TEAMS, opponentOf, type TeamId } from '@gravity-harvest/shared';
import { DOCK_FACING, footprint } from '../layout.js';
import { isHarvesterType, type Building, type Unit } from '../entities.js';
import type { SimState } from '../state.js';
import { emit, toast, emitSeen } from './events.js';
import { nearestRefinery, cancelHarvester, onHomeLost } from './harvesting.js';
import { refresh } from './power.js';
import { inSight } from './visibility.js';

export function addBuilding(s: SimState, type: string, team: TeamId, tx: number, ty: number, built: boolean, id = s.nextId++): Building {
  const def = BUILDINGS[type];
  if (!def) throw new Error(`Unknown building "${type}"`);
  const size = footprint(type);
  const b: Building = {
    cat: 'building', id, type, team, tx, ty, size, hp: def.hp, maxHp: def.hp, armor: def.armor,
    progress: built ? 1 : 0, built, alive: true, seenBy: new Set([team]), occupant: null, constructed: !built,
    repairing: false, boost: 1, dir: -1, target: null, cools: def.weapons.map(() => 0),
  };
  s.putBuilding(b);
  s.map.setFootprint(tx, ty, size, true);
  return b;
}

export function addUnit(s: SimState, type: string, team: TeamId, gx: number, gy: number, id = s.nextId++): Unit {
  const def = UNITS[type];
  if (!def) throw new Error(`Unknown unit "${type}"`);
  const base = {
    cat: 'unit' as const, id, type, team, gx, gy, hp: def.hp, maxHp: def.hp, armor: def.armor, alive: true,
    path: [], moving: false, speed: speedToTilesPerSec(def.speed), sight: def.sight, stuck: 0, detours: 0,
  };
  // a heal (the medic's) is never turned on enemies; healing their own side comes later
  const weapons = def.weapons.filter((w) => weapon(w).damage > 0);
  const u: Unit = isHarvesterType(type)
    ? { ...base, kind: 'harvester', dir: DOCK_FACING, state: 'idle', cargo: 0, field: s.ore.nearestField(gx, gy), home: nearestRefinery(s, gx, gy, team)?.id ?? null, oreKey: null, lastOreKey: null, timer: 0, unloaded: 0, parked: false, retry: 0 }
    : {
      ...base, kind: 'fighter', dir: 14, mode: 'idle', target: null, mission: null, post: null, resume: null, attackMove: null, rest: null, weapons, cools: weapons.map(() => 0), cool: 0, scan: s.rng.range(0, 300), repath: 0, aim: -1, service: null,
      seats: def.passengers ?? 0, passengers: [], hatch: 'closed', hatchTimer: 0, gap: 0, unloading: false, board: null,
    };
  s.putUnit(u);
  return u;
}

export function killUnit(s: SimState, u: Unit): void {
  if (!u.alive) return;
  if (u.kind === 'harvester') cancelHarvester(s, u);
  u.alive = false;
  u.path = [];
  s.dropUnit(u);
  // a transport's passengers die with it
  const lost = 1 + (u.kind === 'fighter' ? u.passengers.length : 0);
  if (u.kind === 'fighter') for (const p of u.passengers.splice(0)) p.alive = false;
  s.players[u.team].stats.unitsLost += lost;
  s.players[opponentOf(u.team)].stats.unitsKilled += lost;
  emitSeen(s, { e: 'unitDied', id: u.id, gx: u.gx, gy: u.gy, type: u.type }, u, u.team);
}

export function destroyBuilding(s: SimState, b: Building, sold = false): void {
  if (!b.alive) return;
  b.alive = false;
  s.dropBuilding(b);
  s.map.setFootprint(b.tx, b.ty, b.size, false);
  const name = BUILDINGS[b.type].name;
  if (!sold) {
    s.players[b.team].stats.buildingsLost++;
    s.players[opponentOf(b.team)].stats.buildingsDestroyed++;
  }
  for (const t of TEAMS) {
    // out of sight, the other side still sees it standing (its ghost) until it looks again
    if (t !== b.team && !inSight(s, t, b)) continue;
    s.ghosts[t].delete(b.id);
    emit(s, t, { e: 'buildingDestroyed', id: b.id, tx: b.tx, ty: b.ty, size: b.size, type: b.type, team: b.team, sold });
    if (!sold) toast(s, t, t === b.team ? 'buildingDestroyed' : 'enemyBuildingDestroyed', t === b.team ? `${name} destroyed` : `Enemy ${name} destroyed`);
  }
  for (const u of s.units.values()) if (u.kind === 'harvester' && u.home === b.id) onHomeLost(s, u);
  refresh(s);
}

/** A side is out when it has no buildings and no units left (the same for the human and the computer). */
export function checkGameOver(s: SimState): void {
  for (const t of TEAMS) {
    const out = !s.teamBuildings(t, false).length && !s.teamUnits(t).length;
    if (out) {
      s.winner = opponentOf(t);
      return;
    }
  }
}
