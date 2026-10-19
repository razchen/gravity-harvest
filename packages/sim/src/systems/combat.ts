// Combat: weapons and what they reach, finding something to shoot, firing (units and defences), damage and fighting
// back.
import { BUILDINGS, volleyDamage, weapon, weaponFor, layerOf, canHit, capabilitiesOf } from '@gravity-harvest/rules';
import { TEAMS, opponentOf, type GridPoint, type TeamId } from '@gravity-harvest/shared';
import { distance, facing } from '../geometry.js';
import { ENGINE } from '../layout.js';
import { distTo, centre, pos, type Building, type Fighter, type Entity } from '../entities.js';
import type { SimState } from '../state.js';
import { emit } from './events.js';
import { killUnit, destroyBuilding } from './lifecycle.js';
import { inSight } from './visibility.js';

/** Defence heads and vehicle turrets aim in this many directions (their sprites have as many: render_construction.py `turret`, render_vehicle.py). */
export const TURRET_DIRECTIONS = 32;

/** Its reloads tick down: each weapon's, and a Medic's or Engineer's between heals or sparks. */
export function reload(u: Fighter, ms: number): void {
  u.cool -= ms;
  for (let i = 0; i < u.cools.length; i++) u.cools[i] -= ms;
}

/** A turret that turns on its own points at what the unit is shooting at, or back along the hull. */
export function aimTurret(u: Fighter, target: Entity | undefined): void {
  if (!capabilitiesOf(u.type).turret) return;
  const at = target && u.weapons.length ? pos(target) : null;
  u.aim = at ? facing(at.gx - u.gx, at.gy - u.gy, TURRET_DIRECTIONS) : -1;
}

/** How far it shoots: at this target, with the weapon it would use on it; otherwise its longest reach. */
export function range(u: Fighter, target?: Entity): number {
  if (target) {
    const w = weaponAt(u.weapons, target);
    return w ? weapon(w).rangeTiles : 0;
  }
  return Math.max(0, ...u.weapons.map((w) => weapon(w).rangeTiles));
}

/** The weapon used on a target: the first that reaches it (an anti-air missile never fires at the ground). */
export function weaponAt(weapons: readonly string[], target: Entity): string | null {
  return weaponFor(weapons, target.cat === 'unit' ? layerOf(target.type) : 'ground');
}

/** How far an idle unit looks for a fight: its sight, or its weapon range plus a margin, whichever is larger. */
export function acquireRange(u: Fighter): number {
  return Math.max(u.sight, range(u) + ENGINE.acquireMargin);
}

/**
 * Closest hostile unit within range that its side can see; computer soldiers also consider buildings their side has
 * discovered (they raid bases), and so does a unit on an attack-move (`buildings`) when no hostile unit is in range.
 */
export function findEnemy(s: SimState, u: Fighter, reach: number, buildings = false): Entity | null {
  let best: Entity | null = null;
  let bestD = reach;
  for (const o of s.grid.near(u.gx, u.gy, reach)) {
    if (!o.alive || o.team === u.team) continue;
    if (Math.abs(o.gx - u.gx) > reach || Math.abs(o.gy - u.gy) > reach) continue;
    if (!weaponAt(u.weapons, o) || !inSight(s, u.team, o)) continue;
    const d = Math.hypot(o.gx - u.gx, o.gy - u.gy);
    if (d <= bestD) {
      best = o;
      bestD = d;
    }
  }
  if (!s.players[u.team].human || (buildings && !best)) {
    for (const b of s.teamBuildingMap[opponentOf(u.team)].values()) {
      if (!weaponAt(u.weapons, b) || !b.seenBy.has(u.team)) continue;
      const d = distTo(u, b);
      if (d < bestD) {
        best = b;
        bestD = d;
      }
    }
  }
  return best;
}

/** Where to walk to engage: the target itself, or the nearest open tile around a building. */
export function approachPoint(s: SimState, t: Entity, from: GridPoint): GridPoint | null {
  if (t.cat === 'unit') return { gx: t.gx, gy: t.gy };
  let best: GridPoint | null = null;
  let bestD = Infinity;
  for (let x = t.tx - 1; x <= t.tx + t.size; x++) {
    for (let y = t.ty - 1; y <= t.ty + t.size; y++) {
      const edge = x === t.tx - 1 || y === t.ty - 1 || x === t.tx + t.size || y === t.ty + t.size;
      if (!edge || s.map.isBlocked(x, y)) continue;
      const d = Math.hypot(x + 0.5 - from.gx, y + 0.5 - from.gy);
      if (d < bestD) {
        bestD = d;
        best = { gx: x + 0.5, gy: y + 0.5 };
      }
    }
  }
  return best;
}

/** `team`'s building nearest a point; `knownTo`: only those that side has discovered. */
export function nearestBuilding(s: SimState, gx: number, gy: number, team: TeamId, knownTo?: TeamId): Building | null {
  let best: Building | null = null;
  let bestD = Infinity;
  for (const b of s.teamBuildingMap[team].values()) {
    if (knownTo && !b.seenBy.has(knownTo)) continue;
    const d = distance(centre(b), { gx, gy });
    if (d < bestD) {
      best = b;
      bestD = d;
    }
  }
  return best;
}

export function fire(s: SimState, u: Fighter, target: Entity): void {
  const at = pos(target);
  // a turret aims on its own (updateFighter); otherwise the whole vehicle turns to fire
  if (!capabilitiesOf(u.type).turret && weaponAt(u.weapons, target)) u.dir = facing(at.gx - u.gx, at.gy - u.gy, 16);
  volley(s, u, u.weapons, u.cools, target);
}

/**
 * Every weapon that's reloaded, reaches the target's layer and is in range fires, each on its own reload (the
 * rules' damage per second counts them all). Seen by the two sides and whoever has the shooter or target in sight.
 */
function volley(s: SimState, from: Building | Fighter, weapons: readonly string[], cools: number[], target: Entity): void {
  const layer = target.cat === 'unit' ? layerOf(target.type) : 'ground';
  const at = pos(target);
  const d = from.cat === 'building' ? distTo(pos(target), from) : distTo(from, target);
  weapons.forEach((w, i) => {
    if (cools[i] > 0 || !canHit(w, layer) || d > weapon(w).rangeTiles || !target.alive) return;
    cools[i] = weapon(w).fireIntervalSec * 1000;
    for (const t of TEAMS) {
      if (t === from.team || t === target.team || inSight(s, t, from) || inSight(s, t, target)) emit(s, t, { e: 'shot', from: from.id, to: target.id, at, p: weapon(w).projectile ?? undefined });
    }
    damage(s, target, volleyDamage(w, target.armor), from);
  });
}

function damage(s: SimState, target: Entity, amount: number, attacker?: Entity): void {
  if (!target.alive) return;
  target.hp = Math.min(target.maxHp, target.hp - amount);
  if (target.hp <= 0) {
    if (target.cat === 'building') destroyBuilding(s, target);
    else killUnit(s, target);
    return;
  }
  // fight back unless already busy with a chosen target (a unit on the move stops, then carries on afterwards; one
  // whose turret turns on its own fires back on the move)
  if (target.cat === 'unit' && target.kind === 'fighter' && target.weapons.length && attacker?.alive && attacker.team !== target.team && (target.target === null || target.target === target.mission)) {
    if (target.mode === 'move' && (!capabilitiesOf(target.type).turret || target.attackMove)) {
      target.resume = target.path[target.path.length - 1] ?? null;
      target.path = [];
      target.mode = 'idle';
    }
    target.target = attacker.id;
  }
}

/** Defences shoot the nearest enemy unit in range (those that need power stop when it's low), turning to face it. */
export function defend(s: SimState, dt: number): void {
  for (const b of s.buildings.values()) {
    const def = BUILDINGS[b.type];
    if (!b.built || !def.weapons.length) continue;
    for (let i = 0; i < b.cools.length; i++) b.cools[i] -= dt * 1000;
    if (def.requiresPower && s.power[b.team].low) continue;
    const range = Math.max(...def.weapons.map((w) => weapon(w).rangeTiles));
    // it only fires on what its side can see
    let target = b.target !== null ? s.units.get(b.target) : undefined;
    if (!target?.alive || distTo(target, b) > range || !inSight(s, b.team, target)) {
      target = undefined;
      let best = range;
      // only units within range of its footprint can be closer than `range`
      for (const u of s.grid.within(b.tx - range, b.ty - range, b.tx + b.size + range, b.ty + b.size + range)) {
        if (!u.alive || u.team === b.team || !weaponAt(def.weapons, u) || !inSight(s, b.team, u)) continue;
        const d = distTo(u, b);
        if (d <= best) {
          best = d;
          target = u;
        }
      }
    }
    b.target = target?.id ?? null;
    if (!target) continue;
    const c = { gx: b.tx + b.size / 2, gy: b.ty + b.size / 2 };
    b.dir = facing(target.gx - c.gx, target.gy - c.gy, TURRET_DIRECTIONS);
    volley(s, b, def.weapons, b.cools, target);
  }
}
