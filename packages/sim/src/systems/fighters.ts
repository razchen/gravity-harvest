// A fighter's tick: every unit that isn't a harvester. Each mechanic it has (a transport's doors, a Service Bay visit,
// boarding, mending its side) takes it over for the tick when it applies, in that order; otherwise it follows its
// orders: keeps or picks a target, fights and moves.
import { opponentOf } from '@gravity-harvest/shared';
import { distance } from '../geometry.js';
import { ENGINE, TURRET_UNITS } from '../layout.js';
import { distTo, pos, type Entity, type Fighter } from '../entities.js';
import type { SimState } from '../state.js';
import { spotTaken } from './collisions.js';
import { acquireRange, aimTurret, approachPoint, findEnemy, fire, nearestBuilding, range, reload, weaponAt } from './combat.js';
import { goTo, stepAlong, stopped } from './movement.js';
import { quitBay, updateService } from './service.js';
import { tendSide } from './support.js';
import { updateBoarding, updateHatch } from './transport.js';

export function updateFighter(s: SimState, u: Fighter, dt: number): void {
  const ms = dt * 1000;
  u.moving = false;
  reload(u, ms);
  u.scan -= ms;
  u.repath -= ms;
  // a transport holds still while it lets its passengers out, or while someone is at its door
  if (u.seats && updateHatch(s, u, ms)) return;
  if (u.mode === 'service') return updateService(s, u, dt);
  if (u.mode === 'board') return updateBoarding(s, u, dt);
  u.board = null;
  // given another order at a Service Bay: it lets the pad go (and drives off it first if it's on it)
  if (u.service) quitBay(s, u);
  // Medics heal their side's damaged units, Engineers repair its damaged buildings
  if (tendSide(s, u, dt)) return;
  followOrders(s, u, dt);
}

/** Its orders: what it shoots at (kept, or looked for), where it goes, and doing it. */
function followOrders(s: SimState, u: Fighter, dt: number): void {
  let target = keepTarget(s, u);
  // Look for something to shoot. On the move, only enemies already within weapon range (the unit stops to fight,
  // then carries on, unless its turret turns on its own: that fires on the move); otherwise anything within
  // acquire range, which it moves in on. On an attack-move it looks as far as an idle unit, buildings too, and
  // always stops to fight; while it shoots a building it keeps looking, for units that turn up.
  const firesOnTheMove = TURRET_UNITS.has(u.type) && u.mode === 'move' && !u.attackMove;
  target = chooseTarget(s, u, target, firesOnTheMove);
  u.target = target?.id ?? null;
  if (target) u.rest = null;
  else backToRest(s, u);
  aimTurret(u, target);
  engage(s, u, target, firesOnTheMove, dt);
}

/** The target it had, if it's still there to shoot; once it's gone, it carries on with a move the fight interrupted. */
function keepTarget(s: SimState, u: Fighter): Entity | undefined {
  let target = u.target !== null ? s.entity(u.target) : undefined;
  if (target && (!target.alive || !weaponAt(u.weapons, target))) target = undefined;
  if (!target && u.target !== null) {
    // target gone: look for the next one straight away, or carry on with an interrupted move
    u.target = null;
    u.scan = 0;
    if (u.mode === 'attack') u.mode = 'idle';
  }
  if (!target && u.mode === 'idle' && u.resume && u.scan > 0) {
    const to = u.resume;
    u.resume = null;
    u.mode = goTo(s, u, to.gx, to.gy) ? 'move' : 'idle';
    if (u.mode === 'idle') u.attackMove = null;
  }
  return target;
}

/** What it goes for this tick: an enemy it spots, within its leashes (a guard's post, an attack-move's reach), or its objective. */
function chooseTarget(s: SimState, u: Fighter, target: Entity | undefined, firesOnTheMove: boolean): Entity | undefined {
  if (u.scan <= 0 && (!target || target.id === u.mission || (u.attackMove && target.cat === 'building')) && u.weapons.length) {
    u.scan = 300;
    const moving = u.mode === 'move';
    const seen = findEnemy(s, u, moving && !u.attackMove ? range(u) : acquireRange(u), !!u.attackMove);
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
  if (u.attackMove && target && target.id !== u.mission && distTo(u, target) > acquireRange(u)) {
    target = undefined;
    u.path = [];
    u.mode = 'idle';
    u.resume ??= u.attackMove;
  }
  if (!target && u.post && !u.path.length && distance(u, u.post) > 0.6) goTo(s, u, u.post.gx, u.post.gy);
  // Raiders with nothing in sight march on their objective
  if (!target && u.mission !== null) {
    let m = s.entity(u.mission);
    if (!m?.alive) {
      m = nearestBuilding(s, u.gx, u.gy, opponentOf(u.team), u.team) ?? undefined;
      u.mission = m?.id ?? null;
    }
    target = m;
  }
  return target;
}

/** Nudged off where it stopped: back there once the spot is free, or it stays where it is now. */
function backToRest(s: SimState, u: Fighter): void {
  if (!u.rest || u.mode !== 'idle' || u.post || u.path.length || u.repath > 0 || distance(u, u.rest) <= ENGINE.restSlack) return;
  u.repath = 1000;
  if (spotTaken(s, u.rest, u) || !goTo(s, u, u.rest.gx, u.rest.gy)) u.rest = { gx: u.gx, gy: u.gy };
}

/** Shoot the target if it's in range, else close in on it; with no target, carry on along its path. */
function engage(s: SimState, u: Fighter, target: Entity | undefined, firesOnTheMove: boolean, dt: number): void {
  if (target && u.weapons.length && firesOnTheMove) {
    // keeps to its path, shooting what it passes; what falls out of range is let go
    if (distTo(u, target) <= range(u, target)) {
      fire(s, u, target);
    } else {
      u.target = null;
      u.aim = -1;
    }
    stepAlong(s, u, dt);
    if (!u.path.length) stopped(u);
  } else if (target && u.weapons.length) {
    if (distTo(u, target) <= range(u, target)) {
      u.path = [];
      fire(s, u, target);
    } else {
      if (u.repath <= 0 || !u.path.length) {
        u.repath = 1200;
        const t = approachPoint(s, target, u);
        if (t) goTo(s, u, t.gx, t.gy);
      }
      stepAlong(s, u, dt);
    }
  } else if (u.path.length) {
    stepAlong(s, u, dt);
    if (!u.path.length && u.mode === 'move') stopped(u);
  } else if (u.mode === 'move') stopped(u);
}
