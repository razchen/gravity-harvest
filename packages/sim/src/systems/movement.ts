// Movement: paths to where a unit is sent (backing onto a ramp or pad at the end, driving off one first) and driving
// along them. Who is in the way is collisions.ts's business.
import type { GridPoint } from '@gravity-harvest/shared';
import { distance, facing, type Tile } from '../geometry.js';
import { refineryDock, serviceBayPad } from '../layout.js';
import { findPath } from '../pathfinder.js';
import type { Fighter, Unit } from '../entities.js';
import type { SimState } from '../state.js';
import { steer } from './collisions.js';
import { cancelHarvester } from './harvesting.js';
import { bayUnder } from './service.js';

/**
 * A harvester on its refinery's ramp (at the dock), or a vehicle on a Service Bay's pad, drives straight off it to
 * here before anything else.
 */
export function leadOut(s: SimState, u: Unit): GridPoint | null {
  if (u.kind === 'fighter') {
    const bay = bayUnder(s, u);
    return bay ? serviceBayPad(bay.tx, bay.ty).front : null;
  }
  if (u.home === null) return null;
  const home = s.buildings.get(u.home);
  if (!home) return null;
  const d = refineryDock(home.tx, home.ty);
  return distance(u, d.dock) < 0.5 ? d.front : null;
}

/** Tile to path from (units standing inside a blocked tile, e.g. on a ramp, step out first). */
function startTile(s: SimState, u: Unit): Tile | null {
  const t = { tx: Math.floor(u.gx), ty: Math.floor(u.gy) };
  if (!s.map.isBlocked(t.tx, t.ty)) return t;
  const lead = leadOut(s, u);
  if (lead) return { tx: Math.floor(lead.gx), ty: Math.floor(lead.gy) }; // leaving a ramp
  return s.map.nearestFree(t.tx, t.ty);
}

/**
 * Path to (gx, gy). `via` is driven to first when the destination is inside a blocked tile: from there it backs
 * the last stretch in a straight line (up a ramp, nose out). `avoid`: tiles to go round (others in the way).
 */
export function goTo(s: SimState, u: Unit, gx: number, gy: number, via: GridPoint | null = null, avoid?: (tx: number, ty: number) => boolean): boolean {
  let goal: Tile | null = via ? { tx: Math.floor(via.gx), ty: Math.floor(via.gy) } : { tx: Math.floor(gx), ty: Math.floor(gy) };
  if (!via && s.map.isBlocked(goal.tx, goal.ty)) {
    goal = s.map.nearestFree(goal.tx, goal.ty);
    if (!goal) return false;
    gx = goal.tx + 0.5;
    gy = goal.ty + 0.5;
  }
  const tiles = findPath(s.map, startTile(s, u), goal, undefined, avoid);
  if (!tiles) return false;
  u.path = tiles.map((t) => ({ gx: t.tx + 0.5, gy: t.ty + 0.5 }));
  const end = via ?? { gx, gy };
  if (u.path.length) u.path[u.path.length - 1] = end;
  else u.path = [end];
  if (via) u.path.push({ gx, gy, back: true });
  const lead = leadOut(s, u);
  if (lead) u.path.unshift(lead);
  return true;
}

/** Advance along the path; returns the distance moved. */
export function stepAlong(s: SimState, u: Unit, dt: number): number {
  let step = u.speed * dt * s.fast[u.team];
  let moved = 0;
  const steps = 16;
  while (step > 0 && u.path.length) {
    const target = u.path[0];
    const dgx = target.gx - u.gx;
    const dgy = target.gy - u.gy;
    const dist = Math.hypot(dgx, dgy);
    if (dist > 1e-4) u.dir = target.back ? facing(-dgx, -dgy, steps) : facing(dgx, dgy, steps);
    const move = Math.min(step, dist);
    const mx = (dgx / (dist || 1)) * move, my = (dgy / (dist || 1)) * move;
    const [sx, sy] = steer(s, u, mx, my);
    if (sx !== mx || sy !== my) {
      // someone in the way: round them this tick (or wait, if there's no room)
      const to = { gx: u.gx + sx, gy: u.gy + sy };
      if (straight(s, u, to)) {
        u.gx = to.gx;
        u.gy = to.gy;
        s.grid.moved(u);
        moved += Math.hypot(sx, sy);
      }
      break;
    }
    u.gx += mx;
    u.gy += my;
    s.grid.moved(u);
    moved += move;
    step -= move;
    if (move >= dist) u.path.shift();
  }
  u.moving = moved > 0;
  return moved;
}

/** `fight`: an attack-move (armed units only; the rest just move). */
export function moveUnit(s: SimState, u: Unit, gx: number, gy: number, fight = false): void {
  if (u.kind === 'harvester') {
    cancelHarvester(s, u);
    u.parked = true; // it waits there for orders
    if (goTo(s, u, gx, gy)) u.state = 'move';
    return;
  }
  u.target = null;
  u.resume = null;
  u.rest = null;
  u.mode = goTo(s, u, gx, gy) ? 'move' : 'idle';
  u.attackMove = fight && u.mode === 'move' && u.weapons.length ? { gx, gy } : null;
}

/** A fresh path to where it was going (backing onto a ramp or pad at the end, if it was); the old one if there's none. */
export function rePath(s: SimState, u: Unit, avoid?: (tx: number, ty: number) => boolean): boolean {
  const end = u.path[u.path.length - 1];
  if (!end) return false;
  const via = end.back ? u.path[u.path.length - 2] ?? null : null;
  const old = u.path;
  if (goTo(s, u, end.gx, end.gy, via, avoid)) return true;
  u.path = old;
  return false;
}

/** Whether a unit can drive straight from `a` to `b`, a tile over at most, without cutting a blocked corner. */
export function straight(s: SimState, a: GridPoint, b: GridPoint): boolean {
  const ax = Math.floor(a.gx), ay = Math.floor(a.gy), bx = Math.floor(b.gx), by = Math.floor(b.gy);
  if (Math.abs(ax - bx) > 1 || Math.abs(ay - by) > 1) return false;
  if (ax === bx && ay === by) return true;
  if (s.map.isBlocked(bx, by)) return false;
  return ax === bx || ay === by || (!s.map.isBlocked(bx, ay) && !s.map.isBlocked(ax, by));
}

export function tileOf(p: GridPoint): Tile {
  return { tx: Math.floor(p.gx), ty: Math.floor(p.gy) };
}

/** A move is over: it stays here (and comes back here if a unit passing nudges it off). */
export function stopped(u: Fighter): void {
  u.mode = 'idle';
  u.attackMove = null;
  u.rest = { gx: u.gx, gy: u.gy };
}
