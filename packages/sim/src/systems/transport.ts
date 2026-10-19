// Transports: soldiers walk to a side door and board, passengers ride off the map, the doors open and shut, and they
// come out one at a time.
import type { GridPoint } from '@gravity-harvest/shared';
import { distance, facing } from '../geometry.js';
import { ENGINE, doorSide, viewerSide } from '../layout.js';
import type { Fighter } from '../entities.js';
import type { SimState } from '../state.js';
import { emitSeen } from './events.js';
import { goTo, stepAlong } from './movement.js';

/** Where the foot of a transport's door on `side` is (on the ground, `ENGINE.transportDoorTiles` out to that side). */
function doorFoot(t: Fighter, side: 1 | -1): GridPoint {
  const v = doorSide(t.dir, side);
  return { gx: t.gx + v.gx * ENGINE.transportDoorTiles, gy: t.gy + v.gy * ENGINE.transportDoorTiles };
}

/**
 * Infantry boarding: walk to the transport's nearer side door (after it, if it moves), wait there for the doors, and
 * go in when it's their turn. A transport that's full when they get there leaves them standing by it.
 */
export function updateBoarding(s: SimState, u: Fighter, dt: number): void {
  const b = u.board;
  const t = b ? s.units.get(b.transport) : undefined;
  if (!b || t?.kind !== 'fighter' || !t.alive || t.team !== u.team) return stopBoarding(u);
  const sides: (1 | -1)[] = b.atDoor ? [b.side] : [1, -1];
  const doors = sides.map((side) => ({ side, ...doorFoot(t, side) }));
  const door = doors.reduce((a, c) => (distance(u, c) < distance(u, a) ? c : a));
  const reach = distance(u, door);
  if (!t.path.length && (reach < 0.3 || (!u.path.length && reach <= ENGINE.boardReachTiles))) {
    if (t.passengers.length >= t.seats) return stopBoarding(u);
    Object.assign(b, { atDoor: true, side: door.side });
    u.path = [];
    u.dir = facing(t.gx - u.gx, t.gy - u.gy, 16);
    if (t.hatch === 'open' && t.gap <= 0) getIn(s, u, t, door.side);
    return;
  }
  b.atDoor = false;
  const end = u.path[u.path.length - 1];
  if (u.repath <= 0 && (!end || distance(end, door) > 0.5)) {
    u.repath = 500;
    if (!goTo(s, u, door.gx, door.gy)) return stopBoarding(u);
  }
  stepAlong(s, u, dt);
}

function stopBoarding(u: Fighter): void {
  Object.assign(u, { mode: 'idle', board: null, path: [] });
}

/** A soldier at its door goes in: off the map, kept (with his health) until he comes out. */
function getIn(s: SimState, u: Fighter, t: Fighter, side: 1 | -1): void {
  s.dropUnit(u);
  Object.assign(u, { path: [], moving: false, mode: 'idle', target: null, resume: null, board: null, post: null, mission: null });
  t.passengers.push(u);
  t.gap = ENGINE.boardGapMs;
  t.hatchTimer = ENGINE.hatchHoldMs;
  emitSeen(s, { e: 'boarded', unit: u.id, type: u.type, transport: t.id, gx: u.gx, gy: u.gy, side }, t, t.team);
}

function setHatch(s: SimState, t: Fighter, open: boolean, ms: number = ENGINE.hatchMs): void {
  t.hatch = open ? 'opening' : 'closing';
  t.hatchTimer = ms;
  emitSeen(s, { e: 'hatch', unit: t.id, open }, t, t.team);
}

/**
 * A transport's doors: they open for someone waiting at them or to let its passengers out (it stops for that, and
 * holds still meanwhile), stay open a moment after the last one, and shut when it drives off. Returns true while it
 * holds still.
 */
export function updateHatch(s: SimState, t: Fighter, ms: number): boolean {
  const ordered = t.path.length > 0 || t.mode !== 'idle';
  if (ordered) t.unloading = false; // sent elsewhere
  if (t.unloading && !t.passengers.length) t.unloading = false;
  const waiting = !ordered && [...s.units.values()].some((o) => o.kind === 'fighter' && o.board?.transport === t.id && o.board.atDoor);
  const want = t.unloading || waiting;
  t.hatchTimer -= ms;
  t.gap -= ms;
  switch (t.hatch) {
    case 'closed':
      if (want) setHatch(s, t, true);
      break;
    case 'opening':
      if (ordered) setHatch(s, t, false, ENGINE.hatchMs - Math.max(0, t.hatchTimer));
      else if (t.hatchTimer <= 0) Object.assign(t, { hatch: 'open', hatchTimer: ENGINE.hatchHoldMs, gap: 0 });
      break;
    case 'open':
      if (t.unloading && t.gap <= 0) {
        t.gap = ENGINE.boardGapMs; // no room by its doors: it tries again after a moment
        if (letOut(s, t)) t.hatchTimer = ENGINE.hatchHoldMs;
      }
      if (ordered || (!want && t.hatchTimer <= 0)) setHatch(s, t, false);
      break;
    case 'closing':
      if (t.hatchTimer <= 0) t.hatch = 'closed';
      else if (want) setHatch(s, t, true, ENGINE.hatchMs - t.hatchTimer);
      break;
  }
  return !ordered && want;
}

/**
 * Its first passenger comes out of the door on the camera's side (the other if there's no room there): down the
 * ramp, then onto the nearest free tile by it. False if there's no room by either door.
 */
function letOut(s: SimState, t: Fighter): boolean {
  const p = t.passengers[0];
  if (!p) return false;
  const first = viewerSide(t.dir);
  for (const side of [first, -first as 1 | -1]) {
    const foot = doorFoot(t, side);
    const fx = Math.floor(foot.gx), fy = Math.floor(foot.gy);
    // where someone stands, or is heading (the one let out just before is still walking off the ramp)
    const at = (q: GridPoint | undefined, x: number, y: number) => !!q && Math.floor(q.gx) === x && Math.floor(q.gy) === y;
    const taken = (x: number, y: number) => s.map.isBlocked(x, y) || [...s.units.values()].some((o) => at(o, x, y) || at(o.path[o.path.length - 1], x, y));
    let best: { tx: number; ty: number } | null = null;
    let bestD = Infinity;
    for (let x = fx - 2; x <= fx + 2; x++) {
      for (let y = fy - 2; y <= fy + 2; y++) {
        const d = Math.hypot(x + 0.5 - foot.gx, y + 0.5 - foot.gy);
        if (d < bestD && !taken(x, y)) {
          best = { tx: x, ty: y };
          bestD = d;
        }
      }
    }
    if (!best) continue;
    t.passengers.shift();
    const from = s.map.isBlocked(fx, fy) ? { gx: best.tx + 0.5, gy: best.ty + 0.5 } : foot;
    const v = doorSide(t.dir, side);
    Object.assign(p, { gx: from.gx, gy: from.gy, dir: facing(v.gx, v.gy, 16), path: [], moving: false, mode: 'idle', target: null, resume: null, rest: null, board: null, scan: 0 });
    s.putUnit(p);
    if (distance(from, { gx: best.tx + 0.5, gy: best.ty + 0.5 }) > 0.05 && goTo(s, p, best.tx + 0.5, best.ty + 0.5)) p.mode = 'move';
    emitSeen(s, { e: 'disembarked', unit: p.id, transport: t.id, side }, t, t.team);
    return true;
  }
  return false;
}
