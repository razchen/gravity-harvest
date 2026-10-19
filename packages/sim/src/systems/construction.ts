// Construction and production: placing buildings (and an Assembler deploying), building them up, the production
// queue's lanes, and units coming out of their factory.
import { BUILDINGS, UNITS, canBuild, missingRequirements, capabilitiesOf } from '@gravity-harvest/rules';
import { TEAMS, type GridPoint, type TeamId } from '@gravity-harvest/shared';
import { distance } from '../geometry.js';
import { ASSUME_OWNED, ENGINE, ROSTER, checkPlacement, footprint } from '../layout.js';
import { centre, isHarvesterType, type Building, type Unit, type QueueItem } from '../entities.js';
import { MATCH_CATALOG, laneOf, type ProductionLane } from '../catalog.js';
import type { SimState } from '../state.js';
import { emit, toast, emitSeen } from './events.js';
import { nearestRefinery, autoHarvest, spawnHarvester } from './harvesting.js';
import { addBuilding, addUnit } from './lifecycle.js';
import { moveUnit } from './movement.js';
import { refresh, slowdown } from './power.js';
import { onPad } from './service.js';

/** A defence (it shoots): built one at a time alongside one other building (each has its own build slot). */
const isDefence = (type: string) => BUILDINGS[type].weapons.length > 0;

/** A side has somewhere its buildings go up from (an Assembly Yard). */
function canConstruct(s: SimState, team: TeamId): boolean {
  return [...ASSUME_OWNED].some((id) => capabilitiesOf(id).constructs) || s.teamBuildings(team).some((b) => capabilitiesOf(b.type).constructs);
}

/** A unit that deploys (an Assembler) unpacks into its building (an Assembly Yard) centred where it stands, if the ground there is clear. */
export function deploy(s: SimState, team: TeamId, id: number): void {
  const u = s.units.get(id);
  const into = u && capabilitiesOf(u.type).deploysInto;
  if (!u || u.team !== team || !into) return;
  const n = footprint(into);
  const tx = Math.round(u.gx - n / 2), ty = Math.round(u.gy - n / 2);
  const world = placementWorld(s, team);
  // it doesn't need to be near the base (that's the point), and it isn't in its own way
  const check = checkPlacement(into, tx, ty, { ...world, unitOn: (x, y) => s.grid.on(x, y).some((o) => o.id !== u.id && Math.floor(o.gx) === x && Math.floor(o.gy) === y), ownBuildings: [{ tx, ty, size: n }] });
  if (check.problem) return toast(s, team, 'cantDeploy', `Can't deploy here: ${check.problem.toLowerCase()}`);
  u.alive = false;
  s.dropUnit(u);
  const b = addBuilding(s, into, team, tx, ty, false);
  b.boost = BUILDINGS[into].buildTimeSec / ENGINE.deploySec;
  s.players[team].stats.buildingsBuilt++;
  refresh(s);
}

/** Name the first thing missing before `id` can be built, or null if nothing is. */
function missing(s: SimState, team: TeamId, id: string): string | null {
  const miss = missingRequirements(MATCH_CATALOG, id, s.ownedTypes(team), { assumeOwned: ASSUME_OWNED });
  if (!miss.length) return null;
  return miss[0].map((m) => BUILDINGS[m]?.name ?? m).join(' or ');
}

export function place(s: SimState, team: TeamId, type: string, tx: number, ty: number): void {
  const def = BUILDINGS[type];
  const p = s.players[team];
  if (!def || !(ROSTER.buildings as readonly string[]).includes(type)) return;
  if (!canBuild(MATCH_CATALOG, type, p.faction, s.ownedTypes(team), { assumeOwned: ASSUME_OWNED })) {
    return toast(s, team, 'needPrerequisite', `Build a ${missing(s, team, type) ?? 'prerequisite'} first`);
  }
  // buildings go up from an Assembly Yard, one at a time (and one defence at a time beside it)
  if (!canConstruct(s, team)) return toast(s, team, 'needAssemblyYard', 'Needs an Assembly Yard');
  const busy = underConstruction(s, team, isDefence(type));
  if (busy) return toast(s, team, 'alreadyBuilding', `Already building a ${BUILDINGS[busy.type].name}`);
  const check = checkPlacement(type, tx, ty, placementWorld(s, team));
  if (check.problem) return toast(s, team, 'cantPlace', check.problem);
  if (p.credits < def.cost) return toast(s, team, 'needCredits', `Need $${Math.ceil(def.cost - p.credits).toLocaleString('en-US')} more`);
  p.credits -= def.cost;
  addBuilding(s, type, team, tx, ty, false);
  p.stats.buildingsBuilt++;
}

/**
 * The building (`defence`: the defence) a side has going up, if any: each side builds one of each at a time. A yard an
 * Assembler unpacked doesn't count (that's the Assembler's doing, not the yard's).
 */
export function underConstruction(s: SimState, team: TeamId, defence: boolean): Building | null {
  for (const b of s.teamBuildingMap[team].values()) if (!b.built && b.boost === 1 && isDefence(b.type) === defence) return b;
  return null;
}

export function placementWorld(s: SimState, team: TeamId) {
  return {
    isBlocked: (x: number, y: number) => s.map.isBlocked(x, y),
    hasOre: (x: number, y: number) => s.ore.hasOre(x, y),
    unitOn: (x: number, y: number) => s.grid.on(x, y).some((u) => Math.floor(u.gx) === x && Math.floor(u.gy) === y),
    ownBuildings: s.teamBuildings(team, false),
  };
}

export function train(s: SimState, team: TeamId, unit: string, near?: GridPoint): void {
  const def = UNITS[unit];
  const p = s.players[team];
  if (!def || !(ROSTER.units as readonly string[]).includes(unit)) return;
  if (!canBuild(MATCH_CATALOG, unit, p.faction, s.ownedTypes(team), { assumeOwned: ASSUME_OWNED })) {
    return toast(s, team, 'needPrerequisite', `Build a ${missing(s, team, unit) ?? 'prerequisite'} first`);
  }
  if (s.armySize(team) + p.queue.length >= ENGINE.unitCap) return toast(s, team, 'unitCap', 'Unit cap reached');
  const lane = laneOf(unit);
  if (p.queue.filter((q) => laneOf(q.unit) === lane).length >= ENGINE.queueMax) return toast(s, team, 'queueFull', 'Production queue is full');
  if (p.credits < def.cost) return toast(s, team, 'needCredits', `Need $${Math.ceil(def.cost - p.credits).toLocaleString('en-US')} more`);
  p.credits -= def.cost;
  p.queue.push({ unit, progress: 0, near });
}

export function construct(s: SimState, dt: number): void {
  const yard = new Set(TEAMS.filter((t) => canConstruct(s, t)));
  for (const b of s.buildings.values()) {
    if (b.built) continue;
    // with no Assembly Yard left, what's going up stops until there's one again (an unpacking yard goes on)
    if (!yard.has(b.team) && b.boost === 1) continue;
    b.progress = Math.min(1, b.progress + (dt * s.fast[b.team] * b.boost) / BUILDINGS[b.type].buildTimeSec / slowdown(s, b.team));
    if (b.progress < 1) continue;
    b.built = true;
    emit(s, b.team, { e: 'buildingDone', id: b.id });
    toast(s, b.team, 'buildingReady', `${BUILDINGS[b.type].name} ready`);
    if (capabilitiesOf(b.type).refinery && b.constructed) spawnHarvester(s, b); // refinery completion grants one
  }
}

/** The unit each lane is building: the first one queued in it. */
function laneHeads(queue: readonly QueueItem[]): QueueItem[] {
  const seen = new Set<ProductionLane>();
  return queue.filter((q) => {
    const lane = laneOf(q.unit);
    if (seen.has(lane)) return false;
    seen.add(lane);
    return true;
  });
}

export function produce(s: SimState, dt: number): void {
  for (const t of TEAMS) {
    const p = s.players[t];
    for (const item of laneHeads(p.queue)) produceItem(s, t, item, dt);
  }
}

function produceItem(s: SimState, t: TeamId, item: QueueItem, dt: number): void {
  const p = s.players[t];
  const producers = s.teamBuildings(t).filter((b) => MATCH_CATALOG.units[item.unit].producedAt.includes(b.type));
  if (!producers.length) return; // stalls until a producer exists again
  item.progress = Math.min(1, item.progress + (dt * s.fast[t]) / UNITS[item.unit].buildTimeSec / slowdown(s, t));
  if (item.progress < 1) return;
  p.queue.splice(p.queue.indexOf(item), 1);
  const near = item.near;
  const from = near ? producers.reduce((a, b) => (distance(centre(a), near) <= distance(centre(b), near) ? a : b)) : producers[0];
  const u = isHarvesterType(item.unit) && capabilitiesOf(from.type).refinery ? spawnHarvester(s, from, item.unit) : spawnFighter(s, item.unit, from);
  emitSeen(s, { e: 'unitOut', building: from.id, unit: u.id }, centre(from), from.team);
  emit(s, t, { e: 'unitReady', id: u.id, type: u.type });
  toast(s, t, 'unitReady', `${UNITS[u.type].name} ready`);
}

/** A unit out of a building's front (its entrance, the lower-left face); a harvester then goes to work. */
function spawnFighter(s: SimState, type: string, from: Building): Unit {
  const at = s.map.nearestFree(Math.floor(from.tx + from.size / 2), from.ty + from.size) ?? { tx: from.tx, ty: from.ty + from.size };
  const u = addUnit(s, type, from.team, at.tx + 0.5, at.ty + 0.5);
  if (u.kind === 'harvester') {
    u.home = nearestRefinery(s, u.gx, u.gy, u.team)?.id ?? null;
    autoHarvest(s, u, true);
  } else moveUnit(s, u, at.tx + 0.5 + s.rng.range(-1, 1), at.ty + 1.5 + s.rng.range(0, 1));
  // straight out of the door first, a tile clear of the building, then it turns towards where it's going
  const out = { gx: at.tx + 0.5, gy: at.ty + 1.5 };
  const first = u.path[0];
  if (first && !s.map.isBlocked(at.tx, at.ty + 1) && (first.gx !== out.gx || first.gy !== out.gy)) u.path.unshift(out);
  return u;
}

/**
 * Busy right now (for its animations): producing, (a Service Bay) repairing a vehicle that's on its pad, or (an
 * Assembly Yard) its side building something.
 */
export function isWorking(s: SimState, b: Building): boolean {
  if (capabilitiesOf(b.type).repairsVehicles) return onPad(s, b) !== null;
  if (capabilitiesOf(b.type).constructs) return s.teamBuildings(b.team, false).some((o) => !o.built);
  return laneHeads(s.players[b.team].queue).some((q) => MATCH_CATALOG.units[q.unit]?.producedAt.includes(b.type));
}
