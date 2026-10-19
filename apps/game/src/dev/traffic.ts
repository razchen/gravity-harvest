// Dev building page, Animation tab: units coming out of the building and coming to it, so its door and the units
// can be judged together. Each trip runs in a real match (trafficSim.ts: the sim moves them, as in matches) and is
// drawn the way the game draws it (entities/UnitSprite.ts, and render/DoorExit.ts for coming out of a door).
import Phaser from 'phaser';
import { TICK_MS, facing } from '@gravity-harvest/sim';
import type { GridPoint, TeamView } from '@gravity-harvest/shared';
import { anchorOrigin, meta } from '../assets/manifest';
import { HARVESTER_DOCK_FACING, HARVESTER_UNLOAD_MS, INFANTRY_TURN_MS_PER_STEP, RUN_CYCLE_TILES } from '../config/game';
import { iso } from '../core/geometry';
import { BUILDING_ART, UNIT_ART } from '../data/art';
import { SIDES } from '../data/teams';
import { DOOR_OPEN_MS, inFrontOf } from '../entities/BuildingSprite';
import { WHEEL_TURN_TILES, turnToward } from '../entities/UnitSprite';
import type { ConstructionView } from '../render/Construction';
import { DoorExit } from '../render/DoorExit';
import { TripRun, type Site, type Trip } from './trafficSim';

export { tripsFor, type Trip } from './trafficSim';

/** A unit stands where it stopped this long, then fades away (ms). */
const HOLD_MS = 1500;
const FADE_MS = 400;
/** Out of a door, it catches up with where the sim has it this much faster than it drives (as UnitSprite's CATCH_UP). */
const CATCH_UP = 1.5;

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
    const tint = SIDES.mine.tint;
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

/** The unit on its trip, as drawn. */
interface Visitor {
  look: UnitLook;
  /** Where it's drawn, and the sim's position before and after the latest tick (drawn between the two). */
  gx: number;
  gy: number;
  prev: GridPoint;
  next: GridPoint;
  /** The way the sim has it facing, and how fast it drives (tiles/s). */
  dir: number;
  speed: number;
  /** Coming out through the building's door (drawn there until it has caught up with the sim). */
  exit: DoorExit | null;
  /** Since it appeared, and standing once its trip is over (ms); how far it has faded out (0..1). */
  age: number;
  held: number;
  fading: number;
  fadeIn: boolean;
}

/**
 * A building's traffic: one unit at a time coming out of it or coming to it, opening its door and setting it working
 * as the match does. The page reads `doorOpen` and `working` each frame (over its own checkboxes).
 */
export class Traffic {
  doorOpen = false;
  working = false;
  /** How long nothing has been going on (ms), for the page's Repeat. */
  idleMs = 0;
  private run: TripRun | null = null;
  private visitor: Visitor | null = null;
  /** Page time not yet stepped through the sim (ms). */
  private pending = 0;
  private clock = 0;
  private doorOpenedAt = 0;
  private doorCloseAt = -1;

  /**
   * `b` is the building on the page's stand-in map (its footprint corner and size, in tiles), `view` the building
   * drawn: the page draws it at depth 0, so units sort against it as map.depthAt sorts them against a building
   * whose depth is its centre's y.
   */
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly b: Site,
    private readonly view: ConstructionView,
    private readonly mapSize: number,
  ) {}

  get busy(): boolean {
    return !!this.run;
  }

  /** Send a unit (the one before it, if any, is let go). */
  send(trip: Trip): void {
    this.clear();
    this.run = new TripRun(trip, this.b, this.mapSize);
    // one coming to the building is there from the start; one coming out appears when the sim produces it
    if (this.run.unit !== null) this.meet(this.run, true);
  }

  /** Take the unit away and leave the building as it was. */
  clear(): void {
    const v = this.visitor;
    if (v) {
      v.exit?.release(v.look.parts);
      v.look.destroy();
    }
    this.visitor = null;
    this.run = null;
    this.pending = 0;
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
    const run = this.run;
    if (!run) {
      this.idleMs += deltaMs;
      return;
    }
    // the sim steps at its fixed tick; once the unit is done it's left standing (nothing else happens on this map)
    this.pending += deltaMs;
    while (this.pending >= TICK_MS && run.stage !== 'done') {
      this.pending -= TICK_MS;
      this.tick(run);
    }
    const v = this.visitor;
    if (v) this.drawVisitor(run, v, deltaMs);
  }

  /** One sim tick, and what the page takes from it: the door, the building working, the unit's new position. */
  private tick(run: TripRun): void {
    if (this.visitor) this.visitor.prev = { ...this.visitor.next };
    const view: TeamView = run.step();
    this.working = !!view.buildings.find((x) => x.id === run.building)?.working;
    for (const e of view.events) {
      if (e.e === 'unitOut' && e.building === run.building) {
        this.unitOut();
        this.meet(run, false);
      } else if (e.e === 'door' && e.refinery === run.building) {
        this.doorOpen = e.open;
        if (e.open) this.visitor?.look.unload(this.clock);
      }
    }
    const u = run.unit !== null ? run.sim.units.get(run.unit) : undefined;
    const v = this.visitor;
    if (!u || !v) return;
    v.next = { gx: u.gx, gy: u.gy };
    v.dir = u.dir;
    // the harvester drives off its refinery's dock empty
    if (run.trip.kind === 'dock' && run.stage !== 'visit') v.look.unloaded();
  }

  /** The unit is there: drawn from now on, coming out through the door if it's just been produced and there is one. */
  private meet(run: TripRun, fadeIn: boolean): void {
    const u = run.sim.units.get(run.unit!);
    if (!u || this.visitor) return;
    const exit = fadeIn ? null : DoorExit.create(this.scene, this.view, BUILDING_ART[this.b.type]?.door, { ...this.b, depth: 0 });
    const at = { gx: u.gx, gy: u.gy };
    this.visitor = {
      look: new UnitLook(this.scene, u.type, exit?.dir ?? u.dir), gx: exit?.gx ?? at.gx, gy: exit?.gy ?? at.gy, prev: at, next: at,
      dir: u.dir, speed: u.speed, exit, age: 0, held: 0, fading: 0, fadeIn,
    };
    if (!fadeIn && !exit) this.doorClear();
    this.drawVisitor(run, this.visitor, 0);
  }

  /**
   * Where the unit is drawn this frame: between the sim's last two positions, or (out of a door) straight out of the
   * doorway and then after where the sim has it, as UnitSprite.tickExit does. Then, its trip over, it stands a while
   * (one that came out) and fades away.
   */
  private drawVisitor(run: TripRun, v: Visitor, deltaMs: number): void {
    v.age += deltaMs;
    const k = run.stage === 'done' ? 1 : this.pending / TICK_MS;
    const sim = { gx: v.prev.gx + (v.next.gx - v.prev.gx) * k, gy: v.prev.gy + (v.next.gy - v.prev.gy) * k };
    let moved: number;
    let dir = v.dir;
    const exit = v.exit;
    if (exit?.inside) {
      moved = exit.update(deltaMs, v.speed);
      v.gx = exit.gx;
      v.gy = exit.gy;
      dir = exit.dir;
    } else if (exit) {
      const dgx = sim.gx - v.gx;
      const dgy = sim.gy - v.gy;
      const dist = Math.hypot(dgx, dgy);
      moved = Math.min(dist, (v.speed * CATCH_UP * deltaMs) / 1000);
      if (dist > 1e-4) {
        v.gx += (dgx / dist) * moved;
        v.gy += (dgy / dist) * moved;
        dir = facing(dgx, dgy, 16);
      }
    } else {
      const dgx = sim.gx - v.gx;
      const dgy = sim.gy - v.gy;
      // reversing (backing onto a ramp or a pad) when it moves against the way it faces: its wheels turn backwards
      const a = (v.dir * Math.PI) / 8;
      moved = Math.hypot(dgx, dgy) * (dgx * Math.cos(a) - dgy * Math.sin(a) < -1e-9 ? -1 : 1);
      v.gx = sim.gx;
      v.gy = sim.gy;
    }
    if (run.stage === 'done' && !v.exit) {
      if (run.trip.kind === 'out' && v.held < HOLD_MS) v.held += deltaMs;
      else v.fading = Math.min(1, v.fading + deltaMs / FADE_MS);
    }
    const alpha = Math.min(v.fadeIn ? v.age / FADE_MS : 1, 1 - v.fading);
    v.look.draw(v.gx, v.gy, dir, moved, this.clock, this.depthAt(v.gx, v.gy), alpha);
    if (exit) {
      if (!exit.inside && Math.hypot(sim.gx - v.gx, sim.gy - v.gy) < 1e-3) {
        // caught up: as normal from here, and the door closes behind it
        exit.release(v.look.parts);
        v.exit = null;
        this.doorClear();
      } else exit.dress(v.look.parts);
    }
    if (v.fading >= 1) {
      v.look.destroy();
      this.visitor = null;
      this.run = null;
      this.working = false;
      this.idleMs = 0;
    }
  }

  /** A unit came out: the door opens, if it has one (BuildingSprite.unitOut). */
  private unitOut(): void {
    if (!this.view.hasDoor) return;
    this.doorOpen = true;
    this.doorOpenedAt = this.clock;
    this.doorCloseAt = -1;
  }

  /** It's out of the doorway: the door closes, once it's been open DOOR_OPEN_MS. */
  private doorClear(): void {
    if (this.doorOpen) this.doorCloseAt = Math.max(this.clock, this.doorOpenedAt + DOOR_OPEN_MS);
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
}
