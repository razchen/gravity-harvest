// Harvesting: harvesters mine ore, queue at and dock with refineries, unload for credits, and find work again; ore
// grows back on the spreadsheet's growth tick.
import { ECONOMY, creditsFor, capabilitiesOf } from '@gravity-harvest/rules';
import type { GridPoint, TeamId } from '@gravity-harvest/shared';
import { facing } from '../geometry.js';
import { DOCK_FACING, ENGINE, TICK_MS, refineryDock } from '../layout.js';
import type { OreChange, OreTile } from '../ore.js';
import { centre, type Building, type Harvester } from '../entities.js';
import type { SimState } from '../state.js';
import { emit, emitSeen, emitOre } from './events.js';
import { addUnit } from './lifecycle.js';
import { goTo, stepAlong } from './movement.js';
import { slowdown } from './power.js';

/** How often an idle harvester with no orders looks for work again (ms). */
const HARVESTER_RETRY_MS = 3000;

export function nearestRefinery(s: SimState, gx: number, gy: number, team: TeamId): Building | null {
  let best: Building | null = null;
  let bestD = Infinity;
  for (const b of s.buildings.values()) {
    if (!capabilitiesOf(b.type).refinery || !b.built || b.team !== team) continue;
    const d = Math.hypot(b.tx + 2 - gx, b.ty + 2 - gy);
    if (d < bestD) {
      best = b;
      bestD = d;
    }
  }
  return best;
}

export function cancelHarvester(s: SimState, h: Harvester): void {
  h.path = [];
  h.timer = 0;
  const home = h.home !== null ? s.buildings.get(h.home) : undefined;
  if (home?.occupant === h.id) {
    if (h.state === 'docking' || h.state === 'unload') emitSeen(s, { e: 'door', refinery: home.id, open: false }, centre(home), home.team);
    home.occupant = null;
  }
  h.state = 'idle';
}

/** A harvester goes to work; `choose`: on the field nearest its base that its side has seen (a new harvester). */
export function autoHarvest(s: SimState, h: Harvester, choose = false): void {
  if (choose) {
    const b = harvesterBase(s, h);
    h.field = s.ore.fieldFor(b.gx, b.gy, seenOre(s, h.team));
  }
  const t = nextOre(s, h);
  if (t) harvest(s, h, t);
}

/** Where a harvester's trips start and end: its refinery (else where it is). */
function harvesterBase(s: SimState, h: Harvester): GridPoint {
  const home = h.home !== null ? s.buildings.get(h.home) : undefined;
  return home ? centre(home) : { gx: h.gx, gy: h.gy };
}

/** Ore a side's harvesters may go for of their own accord: what that side has seen (not under unexplored fog). */
function seenOre(s: SimState, team: TeamId): (t: OreTile) => boolean {
  return (t) => s.fog[team].isExplored(t.tx, t.ty, 1);
}

/** The tile a harvester mines next (ore.pickFor): its field, else the nearest one to its base that its side has seen. */
function nextOre(s: SimState, h: Harvester): OreTile | null {
  return s.ore.pickFor(h.gx, h.gy, h.field, harvesterBase(s, h), seenOre(s, h.team));
}

export function harvest(s: SimState, h: Harvester, tile: OreTile): void {
  h.parked = false;
  h.field = tile.field; // works this field from now on
  h.oreKey = h.lastOreKey = s.map.key(tile.tx, tile.ty);
  h.state = goTo(s, h, tile.tx + 0.5, tile.ty + 0.5) ? 'toOre' : 'idle';
}

export function returnHome(s: SimState, h: Harvester, refinery?: Building): void {
  h.timer = 0;
  h.parked = false;
  const current = h.home !== null ? s.buildings.get(h.home) : undefined;
  const ref = refinery ?? (current?.alive && current.built ? current : nearestRefinery(s, h.gx, h.gy, h.team));
  if (!ref) {
    h.state = 'idle';
    return;
  }
  h.home = ref.id;
  const d = refineryDock(ref.tx, ref.ty);
  const occ = ref.occupant !== null ? s.units.get(ref.occupant) : undefined;
  if (occ && occ.id !== h.id && occ.alive) {
    h.state = goTo(s, h, d.wait.gx, d.wait.gy) ? 'toWait' : 'idle';
    return;
  }
  ref.occupant = h.id;
  if (goTo(s, h, d.dock.gx, d.dock.gy, d.front)) h.state = 'toDock';
  else {
    ref.occupant = null;
    h.state = 'idle';
  }
}

function leaveDock(s: SimState, h: Harvester): void {
  const home = h.home !== null ? s.buildings.get(h.home) : undefined;
  if (home?.occupant === h.id) home.occupant = null;
  const last = h.lastOreKey !== null ? s.ore.tiles.get(h.lastOreKey) : undefined;
  const from = last?.rocks.length ? last : nextOre(s, h);
  if (from) harvest(s, h, from);
  else h.state = 'idle';
}

export function updateHarvester(s: SimState, h: Harvester, dt: number): void {
  const ms = dt * 1000;
  h.moving = false;
  const home = h.home !== null ? s.buildings.get(h.home) : undefined;
  switch (h.state) {
    case 'move':
    case 'toOre':
    case 'toDock':
    case 'toWait':
      stepAlong(s, h, dt);
      if (!h.path.length) arrive(s, h);
      return;
    case 'harvest': {
      h.timer -= ms;
      while (h.timer <= 0 && h.state === 'harvest') {
        h.timer += ENGINE.harvestMsPerUnit;
        if (h.cargo >= ECONOMY.harvesterCapacity) return returnHome(s, h);
        const tile = h.oreKey !== null ? s.ore.tiles.get(h.oreKey) : undefined;
        const changes: OreChange[] = [];
        const rock = tile ? s.ore.mine(tile, changes) : null;
        emitOre(s, changes);
        if (!rock) {
          const next = nextOre(s, h);
          if (next) return harvest(s, h, next);
          if (h.cargo) return returnHome(s, h);
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
        const occ = home?.occupant != null ? s.units.get(home.occupant) : undefined;
        if (!home?.alive || !occ?.alive) returnHome(s, h);
      }
      return;
    case 'docking':
      h.timer -= ms;
      if (h.timer > 0) return;
      if (!home?.alive) return cancelHarvester(s, h);
      h.state = 'unload';
      h.timer = ENGINE.unloadMsPerUnit * slowdown(s, h.team);
      h.unloaded = 0;
      return;
    case 'unload': {
      if (!home?.alive) return cancelHarvester(s, h);
      h.timer -= ms;
      const p = s.players[h.team];
      while (h.timer <= 0 && h.cargo > 0) {
        h.cargo -= 1;
        const credits = creditsFor(1, 'common'); // no storage cap: all of it becomes credits
        p.credits += credits;
        p.stats.creditsEarned += credits;
        h.unloaded += credits;
        h.timer += ENGINE.unloadMsPerUnit * slowdown(s, h.team); // re-read power for every unit
      }
      if (h.cargo > 0) return;
      emit(s, h.team, { e: 'unloaded', refinery: home.id, credits: h.unloaded });
      emitSeen(s, { e: 'door', refinery: home.id, open: false }, centre(home), home.team);
      h.state = 'closing';
      // the door closes, but not before its bed has finished tipping out (ENGINE.dockMinMs since it docked)
      h.timer = Math.max(ENGINE.doorMs, ENGINE.dockMinMs - (s.timeMs - (h.dockedAt ?? s.timeMs)));
      return;
    }
    case 'closing':
      h.timer -= ms;
      if (h.timer <= 0) leaveDock(s, h);
      return;
    case 'idle':
      // with nothing to do (no ore it knows of, no refinery), it looks again now and then: fields grow back
      if (h.parked || (h.retry -= ms) > 0) return;
      h.retry = HARVESTER_RETRY_MS;
      if (h.cargo >= ECONOMY.harvesterCapacity) return returnHome(s, h);
      if (nextOre(s, h)) return autoHarvest(s, h);
      if (h.cargo) returnHome(s, h);
      return;
  }
}

export function arrive(s: SimState, h: Harvester): void {
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
      const home = h.home !== null ? s.buildings.get(h.home) : undefined;
      h.dir = DOCK_FACING;
      if (!home?.alive) return cancelHarvester(s, h);
      if (!h.cargo) return leaveDock(s, h);
      h.state = 'docking';
      h.timer = ENGINE.doorMs;
      h.dockedAt = s.timeMs;
      emitSeen(s, { e: 'door', refinery: home.id, open: true }, centre(home), home.team);
      return;
    }
    default:
      h.state = 'idle';
  }
}

/** Its refinery was destroyed: find another, or keep mining. */
export function onHomeLost(s: SimState, h: Harvester): void {
  const was = h.state;
  cancelHarvester(s, h);
  h.home = nearestRefinery(s, h.gx, h.gy, h.team)?.id ?? null;
  if (h.home === null) return;
  if (was === 'unload' || was === 'docking' || was === 'wait' || was === 'toWait' || was === 'toDock' || h.cargo >= ECONOMY.harvesterCapacity) returnHome(s, h);
  else leaveDock(s, h);
}

/** A harvester out of a refinery, at its queue spot, off to work: the one it comes with (`grants`), or one it made. */
export function spawnHarvester(s: SimState, ref: Building, type = capabilitiesOf(ref.type).refinery!.grants): Harvester {
  const d = refineryDock(ref.tx, ref.ty);
  const h = addUnit(s, type, ref.team, d.wait.gx, d.wait.gy) as Harvester;
  h.home = ref.id;
  autoHarvest(s, h, true);
  return h;
}

/**
 * Every growth tick (spreadsheet): partly harvested tiles grow back, the field's roots regrow from empty, and emptied
 * tiles next to well-filled ones start growing again. Gravity vents seed their own fields (always on).
 */
export function growOre(s: SimState): void {
  if ((s.growTimer += TICK_MS) < ECONOMY.resourceGrowthIntervalSec * 1000) return;
  s.growTimer = 0;
  const changes: OreChange[] = [];
  if (ECONOMY.resourceRegrowth) {
    s.ore.grow(s.rng, () => s.nextId++, changes);
    s.ore.regrowRoots(s.rng, () => s.nextId++, changes);
  }
  if (ECONOMY.resourceSpread) s.ore.spread(s.rng, () => s.nextId++, changes);
  s.ore.feedVents(s.rng, () => s.nextId++, changes);
  emitOre(s, changes);
}
