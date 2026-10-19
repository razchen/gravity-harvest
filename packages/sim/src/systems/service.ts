// Service Bays and repairs: vehicles back onto a bay's pad (or wait their turn by it) and are repaired there; buildings
// being repaired heal. Both pay as they go.
import { BUILDINGS, ECONOMY, UNITS } from '@gravity-harvest/rules';
import type { GridPoint } from '@gravity-harvest/shared';
import { ENGINE, serviceBayPad } from '../layout.js';
import type { Building, Fighter } from '../entities.js';
import type { SimState } from '../state.js';
import { claimedTiles, freeTiles } from './collisions.js';
import { toast } from './events.js';
import { goTo, stepAlong, tileOf } from './movement.js';
import { slowdown } from './power.js';

/** The vehicle parked on a Service Bay's pad being repaired (not still backing on, nor driving off), if any. */
export function onPad(s: SimState, bay: Building): Fighter | null {
  const u = bay.occupant !== null ? s.units.get(bay.occupant) : undefined;
  if (u?.kind !== 'fighter' || !u.alive || !u.service || u.service.waiting || u.service.leaving || u.path.length) return null;
  return u.hp < u.maxHp ? u : null;
}

/** The Service Bay whose footprint a unit stands in (on its pad), if any. */
export function bayUnder(s: SimState, u: GridPoint): Building | undefined {
  const tx = Math.floor(u.gx), ty = Math.floor(u.gy);
  for (const b of s.buildings.values()) {
    if (b.type === 'service_bay' && b.alive && tx >= b.tx && tx < b.tx + b.size && ty >= b.ty && ty < b.ty + b.size) return b;
  }
  return undefined;
}

/**
 * Send a vehicle to a Service Bay: it backs onto the pad (nose out) if it's free, or waits by the bay and takes the pad
 * when it comes free. On the pad it's repaired to full (repair()), or
 * until its side runs out of money, then it drives straight off.
 */
export function toBay(s: SimState, u: Fighter, bay: Building): void {
  leaveBay(s, u);
  Object.assign(u, { target: null, resume: null, attackMove: null, rest: null, mode: 'service', service: { bay: bay.id, waiting: false, leaving: false } });
  if (!claimPad(s, u, bay)) {
    // each waits on a tile of its own by the bay, off the pad's way in and out
    const d = serviceBayPad(bay.tx, bay.ty);
    const keep = new Set([...d.apron, tileOf(d.front)].map((t) => s.map.key(t.tx, t.ty)));
    const taken = claimedTiles(s, new Set([u.id]));
    const spot = freeTiles(s, tileOf(d.wait), 1, (k) => taken.has(k) || keep.has(k))[0];
    const w = !spot || (spot.tx === Math.floor(d.wait.gx) && spot.ty === Math.floor(d.wait.gy)) ? d.wait : { gx: spot.tx + 0.5, gy: spot.ty + 0.5 };
    u.service!.waiting = true;
    if (!goTo(s, u, w.gx, w.gy)) leaveBay(s, u, true);
  }
}

/** Take the bay's pad if it's free (or already ours) and head onto it. */
function claimPad(s: SimState, u: Fighter, bay: Building): boolean {
  const occ = bay.occupant !== null ? s.units.get(bay.occupant) : undefined;
  if (occ?.alive && occ.id !== u.id) return false;
  const d = serviceBayPad(bay.tx, bay.ty);
  if (!goTo(s, u, d.pad.gx, d.pad.gy, d.front)) return false;
  bay.occupant = u.id;
  u.service!.waiting = false;
  return true;
}

/** Done with a Service Bay (or sent elsewhere): the pad is free again; with `idle`, it stops where it is. */
export function leaveBay(s: SimState, u: Fighter, idle = false): void {
  if (u.service) {
    const bay = s.buildings.get(u.service.bay);
    if (bay?.occupant === u.id) bay.occupant = null;
  }
  u.service = null;
  if (idle) Object.assign(u, { mode: 'idle', path: [], rest: null });
}

export function updateService(s: SimState, u: Fighter, dt: number): void {
  const visit = u.service;
  const bay = visit ? s.buildings.get(visit.bay) : undefined;
  if (!visit || !bay?.alive || !bay.built) {
    // the bay is gone: it stays where it is
    leaveBay(s, u, true);
    return;
  }
  if (u.path.length) {
    stepAlong(s, u, dt);
    if (!u.path.length && visit.leaving) leaveBay(s, u, true);
    return;
  }
  const done = u.hp >= u.maxHp || s.players[u.team].credits < 1;
  if (visit.waiting) {
    // by the bay, waiting for the pad
    if (done) leaveBay(s, u, true);
    else claimPad(s, u, bay);
    return;
  }
  // on the pad: repaired until it's full or its side can't pay, then straight off it, nose first
  if (done) {
    visit.leaving = true;
    u.path = [serviceBayPad(bay.tx, bay.ty).front];
  }
}

/**
 * Repairs: buildings being repaired heal steadily, and Service Bays repair the vehicle parked on their
 * pad. Both pay as they heal (a full repair costs the spreadsheet's share of the price), stop when the money runs
 * out, and go at half speed on low power.
 */
export function repair(s: SimState, dt: number): void {
  for (const b of s.buildings.values()) {
    if (!b.repairing) continue;
    const p = s.players[b.team];
    const hp = Math.min(b.maxHp - b.hp, (b.maxHp / ENGINE.repairSecondsForFull) * dt / slowdown(s, b.team));
    const cost = (hp / b.maxHp) * BUILDINGS[b.type].cost * ECONOMY.structureFullRepairFraction;
    if (p.credits < cost) {
      b.repairing = false;
      toast(s, b.team, 'repairNoCredits', `Not enough money to repair the ${BUILDINGS[b.type].name}`);
      continue;
    }
    p.credits -= cost;
    b.hp += hp;
    if (b.hp >= b.maxHp) {
      b.repairing = false;
      toast(s, b.team, 'repaired', `${BUILDINGS[b.type].name} repaired`);
    }
  }
  for (const bay of s.buildings.values()) {
    if (bay.type !== 'service_bay' || !bay.built) continue;
    // only the vehicle parked on the pad: the ones waiting by the bay get nothing until it's their turn
    const u = onPad(s, bay);
    if (!u) continue;
    const hp = Math.min(u.maxHp - u.hp, (u.maxHp * ENGINE.repairSharePerSec * dt) / slowdown(s, bay.team));
    const cost = (hp / u.maxHp) * UNITS[u.type].cost * ECONOMY.unitFullRepairFraction;
    if (s.players[u.team].credits < cost) continue;
    s.players[u.team].credits -= cost;
    u.hp += hp;
  }
}
