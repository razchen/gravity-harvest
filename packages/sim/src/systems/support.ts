// Support units: Medics heal their side's damaged soldiers, Engineers repair its damaged buildings, for free.
import { BUILDINGS, weapon, capabilitiesOf } from '@gravity-harvest/rules';
import { facing } from '../geometry.js';
import { ENGINE } from '../layout.js';
import { distTo, pos, isInfantryType, healOf, type Fighter, type Entity } from '../entities.js';
import type { SimState } from '../state.js';
import { approachPoint } from './combat.js';
import { toast, emitSeen } from './events.js';
import { goTo, stepAlong } from './movement.js';

/** A unit that mends rather than fights: no weapons that harm, and a heal (a Medic) or repairs (an Engineer). */
export function isSupport(u: Fighter): boolean {
  const c = capabilitiesOf(u.type);
  return !u.weapons.length && !!(c.heals || c.fixes);
}

/** Its part of every tick: its arms wind down, and a support unit sees to its side (true if it did, this tick). */
export function tendSide(s: SimState, u: Fighter, dt: number): boolean {
  if (u.work) u.work = Math.max(0, u.work - dt * 1000);
  return isSupport(u) && updateSupport(s, u, dt);
}

/**
 * A Medic or an Engineer sees to its side: the damaged unit (a Medic: soldiers and hovering units, not vehicles) or
 * building (an Engineer) it was sent to, else the nearest one it can see, unless it's on its way somewhere. It goes
 * there and, in reach, heals it a volley at a time (its heal's damage, at its fire rate) or repairs it steadily, for
 * free. Returns whether it saw to something this tick (else it moves or stands as any unit).
 */
function updateSupport(s: SimState, u: Fighter, dt: number): boolean {
  const heal = healOf(u.type);
  const needs = (e: Entity | undefined): e is Entity => !!e && e.alive && e.team === u.team && e.hp < e.maxHp
    && (heal ? e.cat === 'unit' && e.id !== u.id && isInfantryType(e.type) : e.cat === 'building' && e.built);
  const was = u.target !== null ? s.entity(u.target) : undefined;
  let t: Entity | undefined = was;
  if (!needs(t)) {
    // a building it was mending is whole again
    if (was?.cat === 'building' && was.alive && was.team === u.team && !heal) toast(s, u.team, 'repaired', `${BUILDINGS[was.type].name} repaired`);
    t = undefined;
    u.target = null;
    if (u.mode === 'attack') u.mode = 'idle';
  }
  if (!t && u.mode === 'idle' && u.scan <= 0) {
    u.scan = 500;
    const look = Math.max(u.sight, ENGINE.supportLook);
    let best: Entity | undefined;
    let bestD = look;
    const all: Entity[] = heal ? [...s.units.values()] : [...s.buildings.values()];
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
      const to = approachPoint(s, t, u);
      if (!to || !goTo(s, u, to.gx, to.gy)) {
        u.target = null;
        return false;
      }
    }
    stepAlong(s, u, dt);
    return true;
  }
  u.path = [];
  u.rest = { gx: u.gx, gy: u.gy };
  const at = pos(t);
  u.dir = facing(at.gx - u.gx, at.gy - u.gy, 16);
  if (heal) {
    if (u.cool > 0) return true;
    u.cool = weapon(heal).fireIntervalSec * 1000;
    emitSeen(s, { e: 'shot', from: u.id, to: t.id, at, p: weapon(heal).projectile ?? 'beam' }, u, u.team);
    t.hp = Math.min(t.maxHp, t.hp - weapon(heal).damage);
  } else {
    t.hp = Math.min(t.maxHp, t.hp + (t.maxHp / ENGINE.fixSecondsForFull) * dt);
    // a spark of its work now and then (the browser draws the welding at the building)
    if (u.cool <= 0) {
      u.cool = 700;
      emitSeen(s, { e: 'shot', from: u.id, to: t.id, at, p: 'repair' }, u, u.team);
    }
  }
  u.work = ENGINE.workMs;
  return true;
}
