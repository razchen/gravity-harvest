// A fighter's tick: every unit that isn't a harvester. Each mechanic it has (a transport's doors, a Service Bay visit,
// boarding, mending its side) goes first when it applies; otherwise it follows its orders, fights and moves.
import { opponentOf } from '@gravity-harvest/shared';
import { distance, facing } from '../geometry.js';
import { ENGINE, FIXERS, TURRET_UNITS } from '../layout.js';
import { distTo, pos, healOf, type Fighter } from '../entities.js';
import type { SimState } from '../state.js';
import { spotTaken } from './collisions.js';
import { range, weaponAt, acquireRange, findEnemy, approachPoint, nearestBuilding, fire, TURRET_DIRECTIONS } from './combat.js';
import { leadOut, goTo, stepAlong, stopped } from './movement.js';
import { leaveBay, updateService } from './service.js';
import { updateSupport } from './support.js';
import { updateBoarding, updateHatch } from './transport.js';

export function updateFighter(s: SimState, u: Fighter, dt: number): void {
  const ms = dt * 1000;
  u.moving = false;
  u.cool -= ms;
  for (let i = 0; i < u.cools.length; i++) u.cools[i] -= ms;
  u.scan -= ms;
  u.repath -= ms;
  // a transport holds still while it lets its passengers out, or while someone is at its door
  if (u.seats && updateHatch(s, u, ms)) return;
  if (u.mode === 'service') return updateService(s, u, dt);
  if (u.mode === 'board') return updateBoarding(s, u, dt);
  u.board = null;
  // given another order at a Service Bay: let the pad go, and drive off it first if it's on it
  if (u.service) {
    leaveBay(s, u);
    const lead = leadOut(s, u);
    if (lead && !u.path.length) u.path = [lead];
  }
  // Medics heal their side's damaged units, Engineers repair its damaged buildings
  if (u.work) u.work = Math.max(0, u.work - ms);
  if (!u.weapons.length && (healOf(u.type) || FIXERS.has(u.type)) && updateSupport(s, u, dt)) return;
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
  // Look for something to shoot. On the move, only enemies already within weapon range (the unit stops to fight,
  // then carries on, unless its turret turns on its own: that fires on the move); otherwise anything within
  // acquire range, which it moves in on. On an attack-move it looks as far as an idle unit, buildings too, and
  // always stops to fight; while it shoots a building it keeps looking, for units that turn up.
  const firesOnTheMove = TURRET_UNITS.has(u.type) && u.mode === 'move' && !u.attackMove;
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
  u.target = target?.id ?? null;
  if (target) u.rest = null;
  else if (u.rest && u.mode === 'idle' && !u.post && !u.path.length && u.repath <= 0 && distance(u, u.rest) > ENGINE.restSlack) {
    // nudged off where it stopped: back there once the spot is free, or it stays where it is now
    u.repath = 1000;
    if (spotTaken(s, u.rest, u) || !goTo(s, u, u.rest.gx, u.rest.gy)) u.rest = { gx: u.gx, gy: u.gy };
  }
  if (TURRET_UNITS.has(u.type)) {
    const at = target && u.weapons.length ? pos(target) : null;
    u.aim = at ? facing(at.gx - u.gx, at.gy - u.gy, TURRET_DIRECTIONS) : -1;
  }
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
