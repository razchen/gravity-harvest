// Collisions and steering: units keep apart, go round each other, get unstuck, and a group sent to one point spreads
// over a tile each around it.
import { capabilitiesOf } from '@gravity-harvest/rules';
import type { GridPoint } from '@gravity-harvest/shared';
import { distance, type Tile } from '../geometry.js';
import { ENGINE } from '../layout.js';
import { isInfantryType, type Unit } from '../entities.js';
import type { SimState } from '../state.js';
import { arrive } from './harvesting.js';
import { goTo, rePath, straight, tileOf, stopped } from './movement.js';

/** The eight tiles around one. */
const NEIGHBOURS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Soldiers on their way into a transport file through the others (they queue at its door, as before collisions). */
function ghost(u: Unit): boolean {
  return u.kind === 'fighter' && u.mode === 'board';
}

/** Its body's radius in tiles: vehicles are about a tile across, soldiers less (by type, worked out once). */
function radius(u: Unit): number {
  let r = RADIUS.get(u.type);
  if (r === undefined) RADIUS.set(u.type, (r = capabilitiesOf(u.type).hover ? ENGINE.hoverRadius : isInfantryType(u.type) ? ENGINE.infantryRadius : ENGINE.vehicleRadius));
  return r;
}
const RADIUS = new Map<string, number>();
/** The biggest body: two units further apart than twice this along either axis can't touch. */
const MAX_RADIUS = Math.max(ENGINE.hoverRadius, ENGINE.infantryRadius, ENGINE.vehicleRadius);

/**
 * Destinations for a group sent to one point: a tile each around it, as compact as the ground allows, each unit
 * keeping its place in the group where it can (a group spread wider than `ENGINE.formationSpread` closes up). Tiles
 * that are blocked, cut off from the point, or where others stand or are heading are skipped.
 */
export function formation(s: SimState, units: Unit[], at: GridPoint): GridPoint[] {
  const n = units.length;
  const mid = { gx: units.reduce((s, u) => s + u.gx, 0) / n, gy: units.reduce((s, u) => s + u.gy, 0) / n };
  const spread = Math.max(...units.map((u) => distance(u, mid)));
  const k = Math.min(1, (ENGINE.formationSpread * Math.sqrt(n)) / (spread || 1));
  const want = units.map((u) => ({ gx: at.gx + (u.gx - mid.gx) * k, gy: at.gy + (u.gy - mid.gy) * k }));
  const taken = claimedTiles(s, new Set(units.map((u) => u.id)));
  const free = freeTiles(s, tileOf(at), n * 3 + 8, (key) => taken.has(key));
  const used = new Set<number>();
  const out: GridPoint[] = units.map(() => at);
  // the middle of the group first, so it fills in round the point; the outer ones take the tiles left nearest them
  const order = units.map((_, i) => i).sort((a, b) => distance(want[a], at) - distance(want[b], at) || units[a].id - units[b].id);
  for (const i of order) {
    let best = -1;
    let bestD = Infinity;
    free.forEach((t, j) => {
      const d = Math.hypot(t.tx + 0.5 - want[i].gx, t.ty + 0.5 - want[i].gy);
      if (!used.has(j) && d < bestD - 1e-9) {
        best = j;
        bestD = d;
      }
    });
    if (best < 0) continue;
    used.add(best);
    out[i] = { gx: free[best].tx + 0.5, gy: free[best].ty + 0.5 };
  }
  return out;
}

/** Tiles others stand on, or are heading to (the end of their path), which nobody else should be sent to. */
export function claimedTiles(s: SimState, except: Set<number>): Set<number> {
  const keys = new Set<number>();
  for (const o of s.units.values()) {
    if (except.has(o.id)) continue;
    const at = o.path.length ? o.path[o.path.length - 1] : o;
    keys.add(s.map.key(Math.floor(at.gx), Math.floor(at.gy)));
  }
  return keys;
}

/** Up to `count` open tiles nearest `from` (itself included) that can be driven to from it, skipping `taken` ones. */
export function freeTiles(s: SimState, from: Tile, count: number, taken: (key: number) => boolean): Tile[] {
  const start = s.map.isBlocked(from.tx, from.ty) ? s.map.nearestFree(from.tx, from.ty) : from;
  if (!start) return [];
  const out: Tile[] = [];
  const seen = new Set([s.map.key(start.tx, start.ty)]);
  const queue: Tile[] = [start];
  for (let i = 0; i < queue.length && out.length < count && i < 2000; i++) {
    const t = queue[i];
    if (!taken(s.map.key(t.tx, t.ty))) out.push(t);
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = t.tx + dx, ny = t.ty + dy;
      if (s.map.isBlocked(nx, ny) || seen.has(s.map.key(nx, ny))) continue;
      if (dx && dy && (s.map.isBlocked(nx, t.ty) || s.map.isBlocked(t.tx, ny))) continue;
      seen.add(s.map.key(nx, ny));
      queue.push({ tx: nx, ty: ny });
    }
  }
  return out;
}

/** Whether someone other than `self` stands at `p`, or is heading there. */
export function spotTaken(s: SimState, p: GridPoint, self: Unit): boolean {
  for (const o of s.units.values()) {
    if (o === self) continue;
    const r = radius(o) + radius(self);
    const end = o.path[o.path.length - 1];
    if (distance(o, p) < r || (end && distance(end, p) < r)) return true;
  }
  return false;
}

/**
 * Units that hold their place whatever bumps into them: on a ramp or a pad (or backing onto one, or driving off a
 * Service Bay's), unloading at a refinery, letting passengers in or out, or a soldier at a transport's door.
 */
function anchored(s: SimState, u: Unit): boolean {
  if (s.map.isBlocked(Math.floor(u.gx), Math.floor(u.gy))) return true;
  if (u.path.length && u.path.length <= 2 && u.path[u.path.length - 1].back) return true;
  if (u.kind === 'harvester') return u.state === 'docking' || u.state === 'unload' || u.state === 'closing';
  return !!u.service?.leaving || u.hatch !== 'closed' || !!u.board?.atDoor;
}

/** How readily a unit gives way when bodies overlap: not at all (anchored), a little at work or on the move, most when idle. */
function give(s: SimState, u: Unit): number {
  if (anchored(s, u)) return 0;
  if (u.path.length) return 0.25;
  const busy = u.kind === 'harvester' ? u.state === 'harvest' : u.target !== null;
  return busy ? 0.15 : 1;
}

/**
 * Units keep apart. Overlapping bodies are eased apart, the one that gives way more moving more (an idle unit is
 * nudged aside by one driving through, one at work hardly), and a unit driving into another also steps to its
 * right, so two meeting head on pass each other. Nobody is pushed into a blocked tile; one pushed off its line is
 * given a new path.
 */
export function separate(s: SimState): void {
  const list = [...s.units.values()];
  const push = list.map(() => ({ gx: 0, gy: 0 }));
  const gives = list.map((u) => give(s, u));
  const index = new Map(list.map((u, i) => [u, i]));
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (ghost(a)) continue;
    // each pair once, in the order of the list: only those near enough to touch (the grid's are in that order too)
    for (const b of s.grid.near(a.gx, a.gy, 2 * MAX_RADIUS)) {
      const j = index.get(b)!;
      if (j <= i || ghost(b)) continue;
      const r = radius(a) + radius(b);
      const dx = b.gx - a.gx, dy = b.gy - a.gy;
      if (Math.abs(dx) >= r || Math.abs(dy) >= r) continue;
      const d = Math.hypot(dx, dy);
      const total = gives[i] + gives[j];
      if (d >= r || !total) continue;
      // right on top of each other: apart in a direction from their ids, so it's the same every run
      const ang = ((a.id * 7 + b.id * 3) % 16) * (Math.PI / 8);
      const nx = d > 1e-6 ? dx / d : Math.cos(ang), ny = d > 1e-6 ? dy / d : Math.sin(ang);
      const ease = (r - d) / 2;
      push[i].gx -= (nx * ease * gives[i]) / total;
      push[i].gy -= (ny * ease * gives[i]) / total;
      push[j].gx += (nx * ease * gives[j]) / total;
      push[j].gy += (ny * ease * gives[j]) / total;
      for (const [k, sx, sy] of [[i, nx, ny], [j, -nx, -ny]] as const) {
        const u = list[k];
        const next = u.path[0];
        if (!next || !gives[k] || sameWay(list[i], list[j])) continue;
        const hx = next.gx - u.gx, hy = next.gy - u.gy, hl = Math.hypot(hx, hy);
        if (hl < 1e-6 || (hx * sx + hy * sy) / hl < 0.5) continue;
        push[k].gx += (-hy / hl) * ease * 0.5;
        push[k].gy += (hx / hl) * ease * 0.5;
      }
    }
  }
  list.forEach((u, k) => {
    let { gx: px, gy: py } = push[k];
    const len = Math.hypot(px, py);
    if (len < 1e-6) return;
    if (len > ENGINE.pushTilesPerTick) {
      px *= ENGINE.pushTilesPerTick / len;
      py *= ENGINE.pushTilesPerTick / len;
    }
    // along a wall, it slides
    const from = { gx: u.gx, gy: u.gy };
    const to = [{ gx: u.gx + px, gy: u.gy + py }, { gx: u.gx + px, gy: u.gy }, { gx: u.gx, gy: u.gy + py }].find((p) => straight(s, from, p));
    if (!to) return;
    u.gx = to.gx;
    u.gy = to.gy;
    s.grid.moved(u);
    const next = u.path[0];
    if (next && (Math.floor(to.gx) !== Math.floor(from.gx) || Math.floor(to.gy) !== Math.floor(from.gy)) && !straight(s, u, next)) rePath(s, u);
  });
}

/**
 * A step that would drive into someone who won't give way (on the move too, at work, or held in place) turns to the
 * right of them instead, so it goes round; behind one going the same way, it just keeps its distance. An idle unit
 * is driven into and nudged aside (separate()).
 */
export function steer(s: SimState, u: Unit, mx: number, my: number): [number, number] {
  if (anchored(s, u) || ghost(u)) return [mx, my];
  for (const o of s.grid.near(u.gx, u.gy, radius(u) + MAX_RADIUS + 0.5)) {
    if (o === u || ghost(o)) continue;
    const r = radius(u) + radius(o);
    const dx = o.gx - u.gx, dy = o.gy - u.gy;
    if (Math.abs(dx) > r + 0.5 || Math.abs(dy) > r + 0.5) continue;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6 || Math.hypot(dx - mx, dy - my) >= Math.min(r, d) || give(s, o) >= 1) continue; // no contact, or parting
    const ux = dx / d, uy = dy / d;
    const into = mx * ux + my * uy;
    if (into <= 0) continue;
    mx -= ux * into;
    my -= uy * into;
    if (sameWay(u, o)) continue;
    mx -= uy * into;
    my += ux * into;
  }
  return [mx, my];
}

/** Both on the move, heading roughly the same way (one following the other, or side by side in a group). */
function sameWay(a: Unit, b: Unit): boolean {
  const p = a.path[0], q = b.path[0];
  if (!p || !q) return false;
  const ax = p.gx - a.gx, ay = p.gy - a.gy, bx = q.gx - b.gx, by = q.gy - b.gy;
  return ax * bx + ay * by > 0.3 * Math.hypot(ax, ay) * Math.hypot(bx, by);
}

/** Tiles where others stand in a unit's way (still, held in place, or stuck themselves): to path round them. */
function standing(s: SimState, self: Unit): (tx: number, ty: number) => boolean {
  const keys = new Set<number>();
  for (const o of s.grid.near(self.gx, self.gy, 6)) {
    if (o === self || distance(o, self) > 6) continue;
    if (!o.path.length || o.stuck > 0 || anchored(s, o)) keys.add(s.map.key(Math.floor(o.gx), Math.floor(o.gy)));
  }
  return (tx, ty) => keys.has(s.map.key(tx, ty));
}

/**
 * A unit that makes no headway along its path (others are in its way) goes round them; after `ENGINE.detours` tries,
 * or once it's nearly there, it settles (settle()). So a crowd in a choke point waits its turn rather than shoving
 * back and forth.
 */
export function unstick(s: SimState, before: Map<number, GridPoint>, dt: number): void {
  const ms = dt * 1000;
  for (const u of [...s.units.values()]) {
    const was = before.get(u.id);
    const next = u.path[0];
    if (!next) u.detours = 0;
    if (!was || !next || anchored(s, u) || ghost(u)) {
      u.stuck = 0;
      continue;
    }
    const hx = next.gx - was.gx, hy = next.gy - was.gy, hl = Math.hypot(hx, hy);
    const ahead = hl > 1e-6 ? ((u.gx - was.gx) * hx + (u.gy - was.gy) * hy) / hl : Infinity;
    if (ahead >= 0.3 * u.speed * dt * s.fast[u.team]) {
      u.stuck = Math.max(0, u.stuck - ms);
      continue;
    }
    if ((u.stuck += ms) < ENGINE.stuckMs) continue;
    u.stuck = 0;
    if (distance(u, u.path[u.path.length - 1]) <= ENGINE.settleTiles || u.detours >= ENGINE.detours) settle(s, u);
    else {
      u.detours++;
      rePath(s, u, standing(s, u));
    }
  }
}

/**
 * A unit that can get no nearer to where it's going. Sent somewhere, it settles on the nearest free tile to it (it
 * drives there, once) or where it is; a harvester near its ore or its refinery's queue spot carries on from there.
 * Units going onto a ramp or a pad, or after a target, keep trying (their goal is theirs, or moves).
 */
function settle(s: SimState, u: Unit): void {
  const end = u.path[u.path.length - 1];
  const near = distance(u, end) <= ENGINE.settleTiles;
  const keepAt = () => {
    u.detours = 0;
    rePath(s, u, standing(s, u));
  };
  if (u.kind === 'harvester') {
    if (u.state === 'toOre' || u.state === 'toWait') {
      if (!near) return keepAt();
      u.path = [];
      return arrive(s, u);
    }
    if (u.state !== 'move') return keepAt();
  } else if (u.mode === 'attack' || u.mode === 'service') {
    if (u.mode === 'attack' || !u.service?.waiting) return keepAt();
    if (near) u.path = []; // by the bay: it waits from here
    return;
  }
  const halt = () => {
    u.path = [];
    if (u.kind === 'harvester') u.state = 'idle';
    else if (u.mode === 'move' || u.mode === 'idle') stopped(u);
  };
  if (u.detours > ENGINE.detours) return halt(); // already on its way to the free tile
  u.detours = ENGINE.detours + 1;
  const taken = claimedTiles(s, new Set([u.id]));
  const spot = freeTiles(s, tileOf(end), 1, (k) => taken.has(k))[0];
  const at = spot && { gx: spot.tx + 0.5, gy: spot.ty + 0.5 };
  if (!at || distance(u, at) < 0.75 || !goTo(s, u, at.gx, at.gy, null, standing(s, u))) halt();
}
