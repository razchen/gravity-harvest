// Dev building page, Animation tab: units coming out of the building and coming to it, so its door and the units
// can be judged together. They're moved the way the match moves them (packages/sim/src/sim.ts: where they appear,
// their paths, backing onto the refinery's ramp) and drawn the way the game draws them (entities/UnitSprite.ts, and
// render/DoorExit.ts for coming out of a door).
import Phaser from 'phaser';
import { ECONOMY, UNITS, speedToTilesPerSec } from '@gravity-harvest/rules';
import { DOCK_FACING, ENGINE, Grid, MATCH_CATALOG, facing, findPath, refineryDock, serviceBayPad } from '@gravity-harvest/sim';
import type { GridPoint } from '@gravity-harvest/shared';
import { anchorOrigin, meta } from '../assets/manifest';
import { HARVESTER_DOCK_FACING, HARVESTER_UNLOAD_MS, INFANTRY_TURN_MS_PER_STEP, RUN_CYCLE_TILES } from '../config/game';
import { iso } from '../core/geometry';
import { BUILDING_ART, UNIT_ART } from '../data/art';
import { TEAMS } from '../data/teams';
import { DOOR_OPEN_MS, inFrontOf } from '../entities/BuildingSprite';
import { WHEEL_TURN_TILES, turnToward } from '../entities/UnitSprite';
import type { ConstructionView } from '../render/Construction';
import { DoorExit } from '../render/DoorExit';

/** Out of the building (it produces the unit), docking at it (a refinery) or on its pad to be repaired (a Service Bay). */
export type TripKind = 'out' | 'dock' | 'service';

export interface Trip {
  unit: string;
  kind: TripKind;
}

/** A unit stands where it stopped this long, then fades away (ms). */
const HOLD_MS = 1500;
const FADE_MS = 400;
/** A unit coming to the building starts this far out in front of it (tiles), and leaves to the front-right. */
const FROM_TILES = 4;
/** Service Bay: the vehicle comes in at this share of its health and is repaired to full, as the sim repairs. */
const ARRIVE_HEALTH = 0.8;

/** Every unit with art, in UNIT_ART's order. */
const WITH_ART = Object.keys(UNIT_ART).filter((u) => MATCH_CATALOG.units[u]);

/** What comes out of a building (the units it produces) and what comes to it. */
export function tripsFor(building: string): Trip[] {
  const out: Trip[] = WITH_ART.filter((u) => MATCH_CATALOG.units[u].producedAt.includes(building)).map((unit) => ({ unit, kind: 'out' }));
  if (building === 'refinery') out.push({ unit: 'harvester', kind: 'dock' });
  if (building === 'service_bay') {
    // the vehicles that use its pad in matches (not the harvester); the Jackal first, so it's the one shown
    const vehicles = WITH_ART.filter((u) => UNIT_ART[u].kind === 'vehicle').sort((a, b) => +(b === 'jackal') - +(a === 'jackal'));
    for (const u of vehicles) out.push({ unit: u, kind: 'service' });
  }
  return out;
}

/** The atlases a building's traffic draws from. */
export const tripAtlases = (trips: Trip[]): string[] => [...new Set(trips.flatMap((t) => {
  const key = UNIT_ART[t.unit].sprite;
  // the harvester also drives off empty, and tips its load out at a refinery's dock
  return UNIT_ART[t.unit].kind === 'harvester' ? [key, `${key}_empty`, `${key}_unload`] : [key];
}))];

/** Frame `f` of a cycle of `n` (counting backwards too). */
const cycle = (f: number, n: number) => ((Math.floor(f) % n) + n) % n;

/**
 * A unit drawn as the game draws it (entities/UnitSprite.ts) without a GameScene: the same atlases and frames, anchor,
 * scale and team colour, the wheels turning over a vehicle as it drives (backwards as it reverses), a soldier's run
 * cycle, turning a step at a time.
 */
class UnitLook {
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly wheels: Phaser.GameObjects.Sprite | null = null;
  private readonly kind: 'harvester' | 'vehicle' | 'infantry';
  private readonly key: string;
  private shown: number;
  private turnAt = 0;
  private wheel = 0;
  private runPhase = Math.random() * 12;
  /** The harvester: when it started tipping its load out (page ms, -1: not), and whether its bed is empty. */
  private unloadAt = -1;
  private empty = false;

  constructor(scene: Phaser.Scene, type: string, dir: number) {
    const art = UNIT_ART[type];
    this.kind = art.kind;
    this.key = art.sprite;
    const tint = TEAMS.player.tint;
    const m = this.meta();
    this.shown = dir % (m.directions ?? 16);
    const first = this.kind === 'infantry' ? `inf_${this.shown}_idle` : `${this.key}_${this.shown}`;
    this.sprite = scene.add.sprite(0, 0, this.key, first).setOrigin(...anchorOrigin(m)).setScale(1 / (m.res ?? 1));
    // the harvester isn't in team colours (as in the game)
    const tinted = tint !== null && this.kind !== 'harvester';
    if (tinted) this.sprite.setTint(tint);
    if (this.kind !== 'infantry' && m.wheel_frames) {
      this.wheels = scene.add.sprite(0, 0, this.key, `${this.key}_w${this.shown}_0`).setOrigin(...anchorOrigin(m)).setScale(1 / (m.res ?? 1)).setVisible(false);
      if (tinted) this.wheels.setTint(tint);
    }
  }

  private meta() {
    return meta(this.key);
  }

  /** Its sprites, body first. */
  get parts(): Phaser.GameObjects.Sprite[] {
    return this.wheels ? [this.sprite, this.wheels] : [this.sprite];
  }

  /** The harvester at the dock: tip its load out (as GameScene's HarvesterSprite), and drive off empty after. */
  unload(now: number): void {
    this.unloadAt = now;
  }

  unloaded(): void {
    this.unloadAt = -1;
    this.empty = true;
  }

  /** Face `dir` at once (coming out of a door). */
  snap(dir: number): void {
    this.shown = dir % (this.meta().directions ?? 16);
  }

  /**
   * Where it is, the way it faces (the sim's), how far it moved since the last draw (negative while it reverses), and
   * the clock (ms).
   */
  draw(gx: number, gy: number, dir: number, moved: number, now: number, depth: number, alpha: number): void {
    const p = iso(gx, gy);
    const n = this.meta().directions ?? 16;
    const target = ((dir % n) + n) % n;
    // vehicles (the harvester too) swing round a little slower than soldiers (as in the game)
    const stepMs = this.kind === 'infantry' ? INFANTRY_TURN_MS_PER_STEP : INFANTRY_TURN_MS_PER_STEP * 1.6;
    if (this.shown !== target && now >= this.turnAt) {
      this.shown = turnToward(this.shown, target, n);
      this.turnAt = now + stepMs;
    }
    const m = this.meta();
    if (this.kind === 'infantry') {
      const frames = m.run_frames ?? 12;
      this.runPhase += (Math.abs(moved) * frames) / RUN_CYCLE_TILES;
      this.sprite.setPosition(p.x, p.y).setDepth(depth + 0.4).setAlpha(alpha);
      this.sprite.setFrame(`inf_${this.shown}_${Math.abs(moved) > 1e-4 ? Math.floor(this.runPhase) % frames : 'idle'}`);
      return;
    }
    this.sprite.setPosition(p.x, p.y).setDepth(depth + 0.5).setAlpha(alpha);
    const unload = `${this.key}_unload`;
    if (this.unloadAt >= 0 && this.shown === HARVESTER_DOCK_FACING && this.sprite.scene.textures.exists(unload)) {
      const n = meta(unload).frames ?? 1;
      this.sprite.setTexture(unload, `${unload}_${Math.min(n - 1, Math.floor(((now - this.unloadAt) / HARVESTER_UNLOAD_MS) * n))}`);
      this.wheels?.setVisible(false);
      return;
    }
    const body = this.empty && this.sprite.scene.textures.exists(`${this.key}_empty`) ? `${this.key}_empty` : this.key;
    this.sprite.setTexture(body, `${body}_${this.shown}`);
    if (this.wheels) {
      const frames = m.wheel_frames ?? 6;
      this.wheel += (moved / WHEEL_TURN_TILES) * frames;
      this.wheels.setPosition(p.x, p.y).setDepth(depth + 0.501).setAlpha(alpha).setVisible(Math.abs(moved) > 1e-4);
      this.wheels.setFrame(`${this.key}_w${this.shown}_${cycle(this.wheel, frames)}`);
    }
  }

  destroy(): void {
    this.sprite.destroy();
    this.wheels?.destroy();
  }
}

/** A point on a path, as the sim's: `back`, it reverses there (still facing the way it faced). */
interface Waypoint extends GridPoint {
  back?: boolean;
}

/**
 * One step of a unit's trip: something happens as it starts, then it drives a path, or comes out of the door, or
 * waits, or fades away.
 */
interface Leg {
  start?: () => void;
  go?: () => Waypoint[];
  door?: DoorExit;
  ms?: number;
  fade?: boolean;
}

interface Mover {
  look: UnitLook;
  gx: number;
  gy: number;
  dir: number;
  speed: number;
  harvester: boolean;
  path: Waypoint[];
  legs: Leg[];
  leg: number;
  /** Time left on a waiting leg, and since the unit appeared (for fading in), in ms. */
  wait: number;
  age: number;
  fadeIn: boolean;
  fading: number;
}

/**
 * A building's traffic: one unit at a time coming out of it or coming to it, opening its door and setting it working
 * the way a match does. The page reads `doorOpen` and `working` each frame (over its own checkboxes).
 */
export class Traffic {
  doorOpen = false;
  working = false;
  /** How long nothing has been going on (ms), for the page's Repeat. */
  idleMs = 0;
  private mover: Mover | null = null;
  private clock = 0;
  private doorOpenedAt = 0;
  private doorCloseAt = -1;
  private readonly grid: Grid;

  /**
   * `b` is the building on the page's stand-in map (its footprint corner and size, in tiles), `view` the building
   * drawn: the page draws it at depth 0, so units sort against it as map.depthAt sorts them against a building
   * whose depth is its centre's y.
   */
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly b: { type: string; tx: number; ty: number; size: number },
    private readonly view: ConstructionView,
    mapSize: number,
  ) {
    this.grid = new Grid(mapSize, mapSize);
    this.grid.setFootprint(b.tx, b.ty, b.size, true);
  }

  get busy(): boolean {
    return !!this.mover;
  }

  /** Send a unit (the one before it, if any, is let go). */
  send(trip: Trip): void {
    this.clear();
    const { tx, ty, size } = this.b;
    const speed = speedToTilesPerSec(UNITS[trip.unit].speed);
    const harvester = UNIT_ART[trip.unit].kind === 'harvester';
    let legs: Leg[];
    let from: GridPoint;
    // as the sim's addUnit faces them: a harvester out of a dock, anything else towards the lower left
    let dir = harvester ? DOCK_FACING : 14;
    const away = this.free(tx + size + FROM_TILES, ty + size + 1);
    const fadeAway: Leg = { ms: FADE_MS, fade: true };
    if (trip.kind === 'out') {
      // sim.ts spawnFighter: on the free tile nearest the middle of the lower-left face, a tile straight on, then a
      // step or two further out
      const at = this.grid.nearestFree(Math.floor(tx + size / 2), ty + size) ?? { tx, ty: ty + size };
      const straight = { gx: at.tx + 0.5, gy: at.ty + 1.5 };
      // (in matches a harvester drives off to the nearest ore instead)
      const onward = () => this.goTo(at.tx + 0.5 + Phaser.Math.FloatBetween(-1, 1), at.ty + 1.5 + Math.random());
      const door = DoorExit.create(this.scene, this.view, BUILDING_ART[this.b.type]?.door, { ...this.b, depth: 0 });
      from = door ? { gx: door.gx, gy: door.gy } : { gx: at.tx + 0.5, gy: at.ty + 0.5 };
      if (door) dir = door.dir;
      legs = [
        // drawn coming out through the door (render/DoorExit.ts), or appearing outside it with no door
        door ? { start: () => this.unitOut(), door } : { start: () => this.unitOut(), go: () => [straight] },
        { start: () => this.doorClear(), go: onward },
        { ms: HOLD_MS },
        fadeAway,
      ];
    } else if (trip.kind === 'dock') {
      // sim.ts returnHome, arrive and updateHarvester: to in front of the ramp, backs straight up it onto the dock,
      // door opens, a full load unloads, door closes, then forward straight off the ramp and away
      const d = refineryDock(tx, ty);
      from = this.free(tx + size / 2 - 1, ty + size + FROM_TILES);
      legs = [
        { go: () => this.goTo(d.dock.gx, d.dock.gy, d.front) },
        { start: () => { this.mover!.dir = DOCK_FACING; this.doorOpen = true; this.mover!.look.unload(this.clock); }, ms: ENGINE.doorMs },
        { ms: ECONOMY.harvesterCapacity * ENGINE.unloadMsPerUnit },
        // sim.ts: the door closes, but it stays docked until its bed has tipped out (ENGINE.dockMinMs)
        { start: () => { this.doorOpen = false; }, ms: Math.max(ENGINE.doorMs, ENGINE.dockMinMs - ENGINE.doorMs - ECONOMY.harvesterCapacity * ENGINE.unloadMsPerUnit) },
        { start: () => this.mover!.look.unloaded(), go: () => this.goTo(away.gx, away.gy) },
        fadeAway,
      ];
    } else {
      // sim.ts toBay and updateService: to just out in front of the bay, backs straight onto its pad (nose out, as at a
      // refinery), is repaired to full, then drives straight off and away
      const { pad: spot, front } = serviceBayPad(tx, ty);
      from = this.free(tx + size / 2 - 1, ty + size + FROM_TILES);
      legs = [
        { go: () => [...this.goTo(front.gx, front.gy), { ...spot, back: true }] },
        { start: () => { this.working = true; }, ms: ((1 - ARRIVE_HEALTH) / ENGINE.repairSharePerSec) * 1000 },
        { start: () => { this.working = false; }, go: () => [front, ...this.goTo(away.gx, away.gy, null, front)] },
        fadeAway,
      ];
    }
    const look = new UnitLook(this.scene, trip.unit, dir);
    this.mover = {
      look, gx: from.gx, gy: from.gy, dir, speed, harvester,
      path: [], legs, leg: -1, wait: 0, age: 0, fadeIn: trip.kind !== 'out', fading: 0,
    };
    this.nextLeg();
    this.draw(0);
  }

  /** Take the unit away and leave the building as it was. */
  clear(): void {
    const u = this.mover;
    if (u) {
      u.legs[u.leg]?.door?.release(u.look.parts);
      u.look.destroy();
    }
    this.mover = null;
    this.doorOpen = false;
    this.working = false;
    this.doorCloseAt = -1;
    this.idleMs = 0;
  }

  /** Every frame; nothing moves while the page is paused (deltaMs 0). */
  update(deltaMs: number): void {
    if (!deltaMs) return;
    this.clock += deltaMs;
    if (this.doorCloseAt >= 0 && this.clock >= this.doorCloseAt) {
      this.doorOpen = false;
      this.doorCloseAt = -1;
    }
    const u = this.mover;
    if (!u) {
      this.idleMs += deltaMs;
      return;
    }
    u.age += deltaMs;
    const leg = u.legs[u.leg];
    let moved = 0;
    if (leg.door) {
      moved = leg.door.update(deltaMs, u.speed);
      u.gx = leg.door.gx;
      u.gy = leg.door.gy;
      if (leg.door.done) {
        this.draw(moved);
        leg.door.release(u.look.parts);
        this.nextLeg();
        return;
      }
    } else if (leg.go) {
      moved = this.stepAlong(u, deltaMs / 1000);
      if (!u.path.length) this.nextLeg();
    } else {
      u.wait -= deltaMs;
      if (leg.fade) u.fading = 1 - Math.max(0, u.wait) / FADE_MS;
      if (u.wait <= 0) this.nextLeg();
    }
    if (this.mover) this.draw(moved);
  }

  /** A unit came out: the door opens (BuildingSprite.unitOut). */
  private unitOut(): void {
    this.doorOpen = true;
    this.doorOpenedAt = this.clock;
    this.doorCloseAt = -1;
  }

  /** It's out of the doorway: the door closes, once it's been open DOOR_OPEN_MS. */
  private doorClear(): void {
    this.doorCloseAt = Math.max(this.clock, this.doorOpenedAt + DOOR_OPEN_MS);
  }

  private nextLeg(): void {
    const u = this.mover!;
    const leg = u.legs[++u.leg];
    if (!leg) {
      u.look.destroy();
      this.mover = null;
      this.idleMs = 0;
      return;
    }
    leg.start?.();
    if (leg.go) u.path = leg.go();
    if (leg.door) u.look.snap(leg.door.dir);
    u.wait = leg.ms ?? 0;
  }

  private draw(moved: number): void {
    const u = this.mover!;
    const alpha = Math.min(u.fadeIn ? u.age / FADE_MS : 1, 1 - u.fading);
    u.look.draw(u.gx, u.gy, u.dir, moved, this.clock, this.depthAt(u.gx, u.gy), alpha);
    u.legs[u.leg]?.door?.dress(u.look.parts);
  }

  /**
   * GameMap.depthAt with the building at depth 0: by its y, but within 3 tiles of the building over it in front of
   * its front sides (or a refinery's ramp) and under it anywhere else.
   */
  private depthAt(gx: number, gy: number): number {
    const d = iso(gx, gy).y - this.view.base.y;
    const { tx, ty, size } = this.b;
    const near = gx >= tx - 3 && gx < tx + size + 3 && gy >= ty - 3 && gy < ty + size + 3;
    if (!near) return d;
    return inFrontOf(this.b, gx, gy) ? Math.max(d, 1) : Math.min(d, -1);
  }

  /** The middle of the free tile nearest (gx, gy). */
  private free(gx: number, gy: number): GridPoint {
    const t = this.grid.nearestFree(Math.floor(gx), Math.floor(gy)) ?? { tx: Math.floor(gx), ty: Math.floor(gy) };
    return { gx: t.tx + 0.5, gy: t.ty + 0.5 };
  }

  /** sim.ts leadOut: a harvester on the refinery's ramp drives straight off it to in front of it first. */
  private leadOut(at: GridPoint): GridPoint | null {
    const u = this.mover!;
    if (!u.harvester || this.b.type !== 'refinery') return null;
    const d = refineryDock(this.b.tx, this.b.ty);
    return Math.hypot(at.gx - d.dock.gx, at.gy - d.dock.gy) < 0.5 ? d.front : null;
  }

  /**
   * sim.ts goTo: the path to (gx, gy) from where the unit is (or `from`); by way of `via` when the end is inside a
   * blocked tile, backing the last stretch from there (onto the refinery's ramp).
   */
  private goTo(gx: number, gy: number, via: GridPoint | null = null, from?: GridPoint): Waypoint[] {
    const u = this.mover!;
    const at = from ?? { gx: u.gx, gy: u.gy };
    let goal = via ? { tx: Math.floor(via.gx), ty: Math.floor(via.gy) } : { tx: Math.floor(gx), ty: Math.floor(gy) };
    if (!via && this.grid.isBlocked(goal.tx, goal.ty)) {
      goal = this.grid.nearestFree(goal.tx, goal.ty) ?? goal;
      gx = goal.tx + 0.5;
      gy = goal.ty + 0.5;
    }
    const lead = this.leadOut(at);
    let start = lead ? { tx: Math.floor(lead.gx), ty: Math.floor(lead.gy) } : { tx: Math.floor(at.gx), ty: Math.floor(at.gy) };
    if (this.grid.isBlocked(start.tx, start.ty)) start = this.grid.nearestFree(start.tx, start.ty) ?? start;
    const tiles = findPath(this.grid, start, goal) ?? [];
    const path: Waypoint[] = tiles.map((t) => ({ gx: t.tx + 0.5, gy: t.ty + 0.5 }));
    const end = via ?? { gx, gy };
    if (path.length) path[path.length - 1] = end;
    else path.push(end);
    if (via) path.push({ gx, gy, back: true });
    if (lead) path.unshift(lead);
    return path;
  }

  /**
   * sim.ts stepAlong: along the path at its speed, facing where it's heading (16 directions), or away from it while it
   * reverses. Returns how far it moved, negative reversing.
   */
  private stepAlong(u: Mover, dt: number): number {
    let step = u.speed * dt;
    let moved = 0;
    while (step > 0 && u.path.length) {
      const target = u.path[0];
      const dgx = target.gx - u.gx;
      const dgy = target.gy - u.gy;
      const dist = Math.hypot(dgx, dgy);
      if (dist > 1e-4) u.dir = target.back ? facing(-dgx, -dgy, 16) : facing(dgx, dgy, 16);
      const move = Math.min(step, dist);
      u.gx += (dgx / (dist || 1)) * move;
      u.gy += (dgy / (dist || 1)) * move;
      moved += target.back ? -move : move;
      step -= move;
      if (move >= dist) u.path.shift();
    }
    return moved;
  }
}
