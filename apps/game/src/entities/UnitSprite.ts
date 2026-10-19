import Phaser from 'phaser';
import type { HarvesterActivity, TeamId, UnitView } from '@gravity-harvest/shared';
import { facing } from '@gravity-harvest/sim/layout';
import { anchorOrigin, meta } from '../assets/manifest';
import { HARVESTER_DOCK_FACING, HARVESTER_UNLOAD_MS, HOVER, INFANTRY_TURN_MS_PER_STEP, RAMP_TILES_PER_SEC, RUN_CYCLE_TILES, TILE_W, TURRET_TURN_MS_PER_STEP } from '../config/game';
import { alongBarrel, iso, type Point } from '../core/geometry';
import { FX, ensureFxTextures } from '../render/fxTextures';
import { colourOf, factionOfTeam } from '../data/teams';
import { UNIT_ART, unitArt } from '../data/art';
import { rampOf } from '../render/Boarding';
import type { DoorExit } from '../render/DoorExit';
import type { GameScene } from '../scenes/GameScene';

/** Catching up after coming out of a door: this much faster than the server moves it, or this fast before it's seen moving. */
const CATCH_UP = 1.5;
const CATCH_UP_TILES_PER_SEC = 2;

/**
 * A unit as the server reports it. Views arrive every few ticks; the sprite glides from where it is drawn
 * now to the newest reported position over one view interval, so movement stays smooth.
 */
export abstract class UnitSprite {
  readonly cat = 'unit' as const;
  readonly id: number;
  readonly type: string;
  readonly team: TeamId;
  abstract readonly sprite: Phaser.GameObjects.Sprite;
  gx: number;
  gy: number;
  dir: number;
  /** A turret that turns on its own: where the server has it aiming (of its directions), or -1 along the hull. */
  aim = -1;
  hp: number;
  maxHp: number;
  selected = false;
  alive = true;
  /** Reported as moving by the server. */
  moving = false;
  /** Your transports: how many ride in it, and how many can. */
  passengers = 0;
  seats = 0;
  /** A Medic or Engineer healing or repairing right now (its arms work). */
  working = false;
  private from = { gx: 0, gy: 0 };
  private to = { gx: 0, gy: 0 };
  private t0 = 0;
  private lastNow: number;
  /**
   * Coming out of a building's door (render/DoorExit.ts): drawn there, not where the server says, until it's out and
   * has caught up. `speed` is how fast the server is moving it (tiles/s), `dir` the way the server has it facing.
   */
  private exit: { door: DoorExit; cleared: () => void; speed: number; dir: number } | null = null;
  /**
   * Coming down a transport's ramp (downRamp): drawn from its doorway (world px) to where the server has it, fading in,
   * over `ms`, in front of or behind the transport (`depth`).
   */
  private ramp: { from: Point; t: number; ms: number; tiles: number; depth: number } | null = null;

  constructor(protected readonly world: GameScene, v: UnitView, now: number) {
    this.id = v.id;
    this.type = v.type;
    this.team = v.team;
    this.gx = v.gx;
    this.gy = v.gy;
    this.dir = v.dir;
    this.aim = v.aim ?? -1;
    this.hp = v.hp;
    this.maxHp = v.maxHp;
    this.from = this.to = { gx: v.gx, gy: v.gy };
    this.t0 = this.lastNow = now;
  }

  apply(v: UnitView, now: number): void {
    const x = this.exit;
    if (x) {
      const d = Math.hypot(v.gx - this.to.gx, v.gy - this.to.gy);
      if (d > 0 && now > this.t0) x.speed = Math.max(x.speed, d / ((now - this.t0) / 1000));
      x.dir = v.dir;
    } else this.dir = v.dir;
    this.aim = v.aim ?? -1;
    this.from = { gx: this.gx, gy: this.gy };
    this.to = { gx: v.gx, gy: v.gy };
    this.t0 = now;
    this.hp = v.hp;
    this.maxHp = v.maxHp;
    this.moving = v.moving;
    this.passengers = v.passengers ?? 0;
    this.seats = v.seats ?? 0;
    this.working = !!v.work;
  }

  /** Advance the drawn position; returns the distance moved this frame. */
  tick(now: number, viewMs: number): number {
    const deltaMs = now - this.lastNow;
    this.lastNow = now;
    if (this.exit) return this.tickExit(now, deltaMs);
    const a = Phaser.Math.Clamp((now - this.t0) / viewMs, 0, 1);
    const gx = this.from.gx + (this.to.gx - this.from.gx) * a;
    const gy = this.from.gy + (this.to.gy - this.from.gy) * a;
    let moved = Math.hypot(gx - this.gx, gy - this.gy);
    const back = backing(gx - this.gx, gy - this.gy, this.dir);
    this.gx = gx;
    this.gy = gy;
    const r = this.ramp;
    if (r) {
      // down the ramp: its legs keep going while it does
      r.t += deltaMs;
      moved = Math.max(moved, (r.tiles * deltaMs) / r.ms);
    }
    this.refresh(back ? -moved : moved);
    if (r) this.dressRamp(r);
    return moved;
  }

  /** It came out of transport `t` through its door on `side`: drawn coming down the ramp (it can't be clicked meanwhile). */
  downRamp(t: VehicleSprite, side: 1 | -1): void {
    const ramp = rampOf(this.world, t, side);
    const near = ramp.foot.y > t.sprite.y;
    this.ramp = { from: ramp.door, t: 0, ms: (ramp.tiles / RAMP_TILES_PER_SEC) * 1000, tiles: ramp.tiles, depth: t.sprite.depth + (near ? 0.01 : -0.01) };
    this.sprite.disableInteractive();
    this.dressRamp(this.ramp);
  }

  private dressRamp(r: NonNullable<UnitSprite['ramp']>): void {
    const k = Math.min(1, r.t / r.ms);
    const p = iso(this.gx, this.gy);
    for (const s of this.parts()) {
      s.setPosition(r.from.x + (p.x - r.from.x) * k, r.from.y + (p.y - r.from.y) * k).setAlpha(k);
      if (k < 1) s.setDepth(r.depth);
    }
    if (k < 1) return;
    this.ramp = null;
    if (this.alive) this.sprite.setInteractive();
  }

  /** `moved`: how far it went this frame (tiles), negative while it reverses (backing onto a refinery's ramp). */
  protected abstract refresh(moved: number): void;

  /** Turn its drawn direction straight to `dir`, without turning through the ones between. */
  protected abstract snapFacing(dir: number): void;

  /** Its sprites, body first (a vehicle's wheels and turret are layers over it). */
  parts(): Phaser.GameObjects.Sprite[] {
    return [this.sprite];
  }

  /** The sprites a hit flashes: itself, not what's on the ground under it (a hovering one's shadow and glow). */
  hitParts(): Phaser.GameObjects.Sprite[] {
    return this.parts();
  }

  /** It came out of a building through its door: drawn coming out (it can't be clicked until it's out), then as normal. */
  comeOut(door: DoorExit, cleared: () => void): void {
    this.exit = { door, cleared, speed: 0, dir: this.dir };
    this.gx = door.gx;
    this.gy = door.gy;
    this.dir = door.dir;
    this.snapFacing(door.dir);
    this.sprite.disableInteractive();
    this.refresh(0);
    door.dress(this.parts());
  }

  /** Still in the doorway of the building it came out of. */
  get inside(): boolean {
    return !!this.exit?.door.inside || !!this.ramp;
  }

  /** Coming out: straight out of the door, then after where the server has it by now, a little faster than it drives. */
  private tickExit(now: number, deltaMs: number): number {
    const x = this.exit!;
    const speed = x.speed || CATCH_UP_TILES_PER_SEC;
    let moved: number;
    if (x.door.inside) {
      moved = x.door.update(deltaMs, speed);
      this.gx = x.door.gx;
      this.gy = x.door.gy;
    } else {
      const dgx = this.to.gx - this.gx;
      const dgy = this.to.gy - this.gy;
      const dist = Math.hypot(dgx, dgy);
      moved = Math.min(dist, (speed * CATCH_UP * deltaMs) / 1000);
      if (dist > 1e-4) {
        this.gx += (dgx / dist) * moved;
        this.gy += (dgy / dist) * moved;
        this.dir = facing(dgx, dgy, 16);
      }
    }
    this.refresh(moved);
    if (!x.door.inside && Math.hypot(this.to.gx - this.gx, this.to.gy - this.gy) < 1e-3) {
      // caught up: as normal from here
      this.endExit();
      this.from = { gx: this.gx, gy: this.gy };
      this.t0 = now;
    } else x.door.dress(this.parts());
    return moved;
  }

  private endExit(): void {
    const x = this.exit;
    if (!x) return;
    this.exit = null;
    x.door.release(this.parts());
    this.dir = x.dir;
    if (this.alive) this.sprite.setInteractive();
    x.cleared();
  }

  destroy(): void {
    this.alive = false;
    this.endExit();
    this.sprite.destroy();
  }
}

/**
 * The harvester (render_vehicle.py, from its rig): 16 directions with its wheels turning in a layer over it while it
 * drives, its front drums turning (the `harvest` clip, its own atlas) while it scoops ore, its bed empty while it
 * carries nothing (`v_harvester_empty`), and tipping its load out at a refinery's dock (`v_harvester_unload`).
 */
export class HarvesterSprite extends UnitSprite {
  readonly sprite: Phaser.GameObjects.Sprite;
  cargo = 0;
  capacity = 0;
  activity: HarvesterActivity = 'idle';
  private readonly key = UNIT_ART.harvester.sprite;
  private readonly wheels: Phaser.GameObjects.Sprite;
  private wheelPhase = 0;
  /** How far through the drums' turning it is (frames of the harvest clip). */
  private drumPhase = 0;
  /** When it started tipping its load out at the dock (scene ms), or -1. */
  private unloadAt = -1;
  /** The direction drawn: it turns step by step towards `dir` (turning round in front of a refinery's ramp, say). */
  private shown: number;
  private turnAt = 0;

  constructor(world: GameScene, v: UnitView, now: number) {
    super(world, v, now);
    const m = meta(this.key);
    this.shown = v.dir;
    this.sprite = world.add.sprite(0, 0, this.key, `${this.key}_${this.shown}`)
      .setOrigin(...anchorOrigin(m))
      .setScale(1 / (m.res ?? 1))
      .setInteractive({ pixelPerfect: true, useHandCursor: true });
    this.sprite.setData('entity', this);
    this.wheels = world.add.sprite(0, 0, this.key, `${this.key}_w${this.shown}_0`)
      .setOrigin(...anchorOrigin(m)).setScale(1 / (m.res ?? 1)).setVisible(false);
    this.apply(v, now);
    this.refresh(0);
  }

  override apply(v: UnitView, now: number): void {
    super.apply(v, now);
    this.cargo = v.cargo ?? 0;
    this.capacity = v.capacity ?? 0;
    this.activity = v.activity ?? 'idle';
  }

  override destroy(): void {
    super.destroy();
    this.wheels.destroy();
  }

  override parts(): Phaser.GameObjects.Sprite[] {
    return [this.sprite, this.wheels];
  }

  protected snapFacing(dir: number): void {
    this.shown = dir;
  }

  protected refresh(moved: number): void {
    const m = meta(this.key);
    const now = this.world.time.now;
    if (this.shown !== this.dir && now >= this.turnAt) {
      this.shown = turnToward(this.shown, ((this.dir % 16) + 16) % 16, 16);
      this.turnAt = now + INFANTRY_TURN_MS_PER_STEP * 1.6; // as vehicles turn
    }
    const p = iso(this.gx, this.gy);
    const depth = this.world.map.depthAt(this.gx, this.gy) + 0.5;
    this.sprite.setPosition(p.x, p.y).setDepth(depth);
    // at the dock, facing out: its bed tips its load out, then stays empty until it drives off
    const unload = `${this.key}_unload`;
    if (this.activity === 'unload' && this.shown === HARVESTER_DOCK_FACING && this.world.textures.exists(unload)) {
      if (this.unloadAt < 0) this.unloadAt = now;
      const n = meta(unload).frames ?? 1;
      this.sprite.setTexture(unload, `${unload}_${Math.min(n - 1, Math.floor(((now - this.unloadAt) / HARVESTER_UNLOAD_MS) * n))}`);
      this.wheels.setVisible(false);
      return;
    }
    this.unloadAt = -1;
    const scooping = this.activity === 'harvest';
    const clip = `${this.key}_harvest`;
    if (scooping && this.world.textures.exists(clip)) {
      // the whole harvester with its drums turning (its wheels creep along with it, inside the clip's frames)
      const c = meta(clip);
      this.drumPhase += (this.world.game.loop.delta / 1000) * (c.fps ?? 12);
      this.sprite.setTexture(clip, `${clip}_${this.shown}_${cycle(this.drumPhase, c.frames ?? 12)}`);
      this.wheels.setVisible(false);
      return;
    }
    // nothing in its bed: the empty one (same canvas and wheels)
    const empty = `${this.key}_empty`;
    const body = this.cargo <= 0 && this.world.textures.exists(empty) ? empty : this.key;
    this.sprite.setTexture(body, `${body}_${this.shown}`);
    const frames = m.wheel_frames ?? 6;
    this.wheelPhase += (moved / WHEEL_TURN_TILES) * frames; // backwards while it reverses
    this.wheels.setPosition(p.x, p.y).setDepth(depth + 0.001).setVisible(Math.abs(moved) > 1e-4);
    this.wheels.setFrame(`${this.key}_w${this.shown}_${cycle(this.wheelPhase, frames)}`);
  }
}

export class InfantrySprite extends UnitSprite {
  readonly sprite: Phaser.GameObjects.Sprite;
  /** Its atlas (UNIT_ART): every soldier's has the same frames. */
  private readonly key: string;
  private runPhase = Math.random() * 12;
  private running = false;
  /** The direction drawn: it turns step by step towards `dir` (the server's) instead of snapping. */
  private shown: number;
  private turnAt = 0;

  constructor(world: GameScene, v: UnitView, now: number) {
    super(world, v, now);
    this.key = unitArt(v.type, factionOfTeam(v.team))?.sprite ?? 'rifleman';
    const m = meta(this.key);
    this.shown = v.dir;
    this.sprite = world.add.sprite(0, 0, this.key, `inf_${v.dir}_idle`)
      .setOrigin(...anchorOrigin(m))
      .setScale(1 / (m.res ?? 1))
      .setInteractive({ useHandCursor: true });
    const tint = colourOf(v.team).tint;
    if (tint !== null) this.sprite.setTint(tint);
    this.sprite.setData('entity', this);
    this.refresh(0);
  }

  protected snapFacing(dir: number): void {
    this.shown = dir % (meta(this.key).directions ?? 16);
  }

  protected refresh(moved: number): void {
    moved = Math.abs(moved);
    const m = meta(this.key);
    const n = m.directions ?? 16;
    const frames = m.run_frames ?? 12;
    this.running = moved > 1e-4;
    this.runPhase += (moved * frames) / RUN_CYCLE_TILES;
    // turn the short way round, a step at a time
    const now = this.world.time.now;
    const target = ((this.dir % n) + n) % n;
    if (this.shown !== target && now >= this.turnAt) {
      this.shown = turnToward(this.shown, target, n);
      this.turnAt = now + INFANTRY_TURN_MS_PER_STEP;
    }
    const p = iso(this.gx, this.gy);
    this.sprite.setPosition(p.x, p.y).setDepth(this.world.map.depthAt(this.gx, this.gy) + 0.4);
    this.sprite.setFrame(`inf_${this.shown}_${this.running ? Math.floor(this.runPhase) % frames : 'idle'}`);
  }

  /** Rifle muzzle in world pixels (idle stance), for tracers and flashes. */
  muzzle(): Point {
    const m = meta(this.key);
    const mz = m.muzzle?.[this.shown] ?? m.anchor;
    const k = 1 / (m.res ?? 1);
    return { x: this.sprite.x + (mz.x - m.anchor.x) * k, y: this.sprite.y + (mz.y - m.anchor.y) * k };
  }
}

/** A vehicle's wheels make a whole turn every this many tiles driven (their sheets have a turn's frames). */
export const WHEEL_TURN_TILES = 0.55;

/** Frame `f` of a cycle of `n` (counting backwards too). */
const cycle = (f: number, n: number) => ((Math.floor(f) % n) + n) % n;

/** Moving (dgx, dgy) while facing `dir` (of 16) is reversing. */
function backing(dgx: number, dgy: number, dir: number): boolean {
  const a = (dir * Math.PI) / 8;
  return dgx * Math.cos(a) - dgy * Math.sin(a) < -1e-9;
}

/** Turn a drawn direction one step towards `target` (the short way round), at most every TURN ms. */
export function turnToward(shown: number, target: number, n: number): number {
  if (shown === target) return shown;
  const diff = ((target - shown + n + n / 2) % n) - n / 2;
  return (shown + Math.sign(diff || 1) + n) % n;
}

/**
 * A vehicle (everything with an engine but the harvester): 16 directions, turning through the in-between ones,
 * in its team's colour.
 */
export class VehicleSprite extends UnitSprite {
  readonly sprite: Phaser.GameObjects.Sprite;
  /** Its atlas (its side's design, for the units each side builds its own way). */
  readonly key: string;
  private shown: number;
  private turnAt = 0;
  /** Its wheels turning while it drives (a layer over it), and how far round they are. */
  private readonly wheels: Phaser.GameObjects.Sprite | null;
  private wheelPhase = 0;
  /** A turret that turns on its own (a layer over the hull), the direction it's drawn in, and when it turns next. */
  private readonly turret: Phaser.GameObjects.Sprite | null;
  private turretShown = 0;
  private turretTurnAt = 0;
  /** A transport's side doors (its `<key>_door` clip, closed → open), if it has them. */
  readonly doorKey: string | null;
  /** How far open they're drawn (frames of the clip), and whether they're opening or shutting. */
  private doorPhase = 0;
  private doorOpen = false;
  /** A hovering one: its shadow on the ground (it bobs over it), the glow of its lights under it, and its bob's phase. */
  private readonly shadow: Phaser.GameObjects.Sprite | null;
  private readonly glow: Phaser.GameObjects.Sprite | null;
  private readonly bobAt = Math.random() * HOVER.periodMs;
  /** Which of its guns fires next (one without a turret, `meta.muzzles`). */
  private gun = 0;
  /** Its working clip (UNIT_ART `clip`: a Medic's arms healing, an Engineer's arm at work), and how far through it. */
  private readonly clipKey: string | null;
  private clipPhase = 0;

  constructor(world: GameScene, v: UnitView, now: number) {
    super(world, v, now);
    const art = unitArt(v.type, factionOfTeam(v.team))!;
    this.key = art.sprite;
    this.clipKey = art.clip && world.textures.exists(`${this.key}_${art.clip}`) ? `${this.key}_${art.clip}` : null;
    this.doorKey = world.textures.exists(`${this.key}_door`) ? `${this.key}_door` : null;
    const m = meta(this.key);
    this.shown = v.dir % (m.directions ?? 16);
    this.sprite = world.add.sprite(0, 0, this.key, this.hullFrame())
      .setOrigin(...anchorOrigin(m))
      .setScale(1 / (m.res ?? 1))
      .setInteractive({ pixelPerfect: true, useHandCursor: true });
    const tint = colourOf(v.team).tint;
    if (tint !== null) this.sprite.setTint(tint);
    this.sprite.setData('entity', this);
    this.wheels = m.wheel_frames
      ? world.add.sprite(0, 0, this.key, `${this.key}_w${this.shown}_0`).setOrigin(...anchorOrigin(m)).setScale(1 / (m.res ?? 1)).setVisible(false)
      : null;
    if (this.wheels && tint !== null) this.wheels.setTint(tint);
    const tl = m.turret_layer;
    this.turretShown = tl ? this.alongHull(tl.directions) : 0;
    this.turret = tl
      ? world.add.sprite(0, 0, this.key, `${this.key}_t${this.turretShown}`).setOrigin(...anchorOrigin(m)).setScale(1 / (m.res ?? 1))
      : null;
    if (this.turret && tint !== null) this.turret.setTint(tint);
    const hv = m.hover;
    if (hv) ensureFxTextures(world);
    this.shadow = hv
      ? world.add.sprite(0, 0, this.key, `${this.key}_s${this.shown}`).setOrigin(...anchorOrigin(m)).setScale(1 / (m.res ?? 1))
      : null;
    this.glow = hv
      ? world.add.sprite(0, 0, FX.dot).setBlendMode(Phaser.BlendModes.ADD)
        .setTint(Phaser.Display.Color.GetColor(...hv.glow.map((c) => Math.round(255 * Math.min(1, c))) as [number, number, number]))
        .setDisplaySize(TILE_W * HOVER.glowTiles, TILE_W * HOVER.glowTiles * 0.5)
      : null;
    this.refresh(0);
  }

  override destroy(): void {
    super.destroy();
    this.wheels?.destroy();
    this.turret?.destroy();
    this.shadow?.destroy();
    this.glow?.destroy();
  }

  override parts(): Phaser.GameObjects.Sprite[] {
    return [this.sprite, ...(this.wheels ? [this.wheels] : []), ...(this.turret ? [this.turret] : []),
      ...(this.shadow ? [this.shadow] : []), ...(this.glow ? [this.glow] : [])];
  }

  override hitParts(): Phaser.GameObjects.Sprite[] {
    return this.parts().filter((s) => s !== this.shadow && s !== this.glow);
  }

  /** It hovers (render_vehicle.py `hover`): it takes the soldiers' place, boarding transports as they do. */
  get hovering(): boolean {
    return !!meta(this.key).hover;
  }

  /** The direction it's drawn facing. */
  get shownDir(): number {
    return this.shown;
  }

  /** Its side doors open (played forwards) or shut (backwards), for passengers going in or out. */
  hatch(open: boolean): void {
    this.doorOpen = open;
  }

  /** The hull's frame: without its turret when that's a layer of its own. */
  private hullFrame(): string {
    return meta(this.key).turret_layer ? `${this.key}_h${this.shown}` : `${this.key}_${this.shown}`;
  }

  /** The turret direction (of `n`) that points along the hull as drawn. */
  private alongHull(n: number): number {
    return Math.round((this.shown * n) / (meta(this.key).directions ?? 16)) % n;
  }

  protected snapFacing(dir: number): void {
    this.shown = dir % (meta(this.key).directions ?? 16);
    const tl = meta(this.key).turret_layer;
    if (tl) this.turretShown = this.alongHull(tl.directions);
  }

  protected refresh(moved: number): void {
    const n = meta(this.key).directions ?? 16;
    const now = this.world.time.now;
    if (now >= this.turnAt) {
      const next = turnToward(this.shown, ((this.dir % n) + n) % n, n);
      if (next !== this.shown) {
        this.shown = next;
        this.turnAt = now + INFANTRY_TURN_MS_PER_STEP * 1.6; // vehicles swing round a little slower than soldiers
      }
    }
    const p = iso(this.gx, this.gy);
    const depth = this.world.map.depthAt(this.gx, this.gy) + 0.5;
    this.sprite.setPosition(p.x, p.y).setDepth(depth);
    if (this.shadow && this.glow) {
      // hovering: it bobs over its shadow, and its lights pulse on the ground under it, brightest when it's lowest
      const s = Math.sin(((now + this.bobAt) / HOVER.periodMs) * Math.PI * 2);
      this.sprite.y -= (s + 1) * 0.5 * HOVER.bob;
      this.shadow.setPosition(p.x, p.y).setDepth(depth - 0.002).setFrame(`${this.key}_s${this.shown}`);
      this.glow.setPosition(p.x, p.y).setDepth(depth - 0.001).setAlpha(HOVER.glowMin + (HOVER.glowMax - HOVER.glowMin) * (1 - s) * 0.5);
    }
    const dk = this.doorKey;
    if (dk) {
      const dm = meta(dk);
      const step = (this.world.game.loop.delta / 1000) * (dm.fps ?? 16);
      this.doorPhase = Phaser.Math.Clamp(this.doorPhase + (this.doorOpen ? step : -step), 0, (dm.frames ?? 8) - 1);
    }
    // its doors (the clip is the whole vehicle, on the same canvas) while they're anything but shut
    const ck = this.clipKey;
    if (ck && this.working) {
      // its arms at work: the clip (the whole unit, on the same canvas) loops while it heals or repairs
      const cm = meta(ck);
      this.clipPhase += (this.world.game.loop.delta / 1000) * (cm.fps ?? 10);
      this.sprite.setTexture(ck, `${ck}_${this.shown}_${cycle(this.clipPhase, cm.frames ?? 12)}`);
    } else if (dk && (this.doorOpen || this.doorPhase > 0)) this.sprite.setTexture(dk, `${dk}_${this.shown}_${Math.round(this.doorPhase)}`);
    else this.sprite.setTexture(this.key, this.hullFrame());
    if (this.wheels) {
      const frames = meta(this.key).wheel_frames ?? 6;
      this.wheelPhase += (moved / WHEEL_TURN_TILES) * frames; // backwards while it reverses
      this.wheels.setPosition(p.x, p.y).setDepth(depth + 0.001).setVisible(Math.abs(moved) > 1e-4);
      this.wheels.setFrame(`${this.key}_w${this.shown}_${cycle(this.wheelPhase, frames)}`);
    }
    const tl = meta(this.key).turret_layer;
    if (this.turret && tl) {
      // it turns a step at a time towards its target, or back along the hull
      const target = this.aim >= 0 ? this.aim % tl.directions : this.alongHull(tl.directions);
      if (this.turretShown !== target && now >= this.turretTurnAt) {
        this.turretShown = turnToward(this.turretShown, target, tl.directions);
        this.turretTurnAt = now + TURRET_TURN_MS_PER_STEP;
      }
      const at = this.turretAt();
      this.turret.setPosition(at.x, at.y).setDepth(depth + 0.002).setFrame(`${this.key}_t${this.turretShown}`);
    }
  }

  /** Where the turret's anchor sits: over its pivot on the hull as drawn. */
  private turretAt(): Point {
    const m = meta(this.key);
    const pv = m.turret_layer!.pivot[this.shown] ?? { x: 0, y: 0 };
    const k = 1 / (m.res ?? 1);
    return { x: this.sprite.x + pv.x * k, y: this.sprite.y + pv.y * k };
  }

  /**
   * A shot at `at` (world px): from the barrel tip straight along the barrel, landing where that line passes `at`. A
   * turret snaps onto its aim to fire; without one, it's from the top of the hull straight to `at`.
   */
  fireLine(at: Point): { from: Point; to: Point } {
    const tl = meta(this.key).turret_layer;
    if (!this.turret || !tl) return { from: this.muzzle(), to: at };
    if (this.aim >= 0 && this.turretShown !== this.aim % tl.directions) {
      this.turretShown = this.aim % tl.directions;
      this.turret.setFrame(`${this.key}_t${this.turretShown}`);
    }
    const from = this.muzzle();
    return { from, to: alongBarrel(from, this.turretShown, tl.directions, at) };
  }

  /** Where its gun fires from: the turret's barrel tip, or about the top of its hull. */
  /** All its guns' tips (world px), for weapons that fire from every one at once; else its one muzzle. */
  guns(): Point[] {
    const m = meta(this.key);
    const guns = m.muzzles?.[this.shown];
    if (!guns?.length) return [this.muzzle()];
    const k = 1 / (m.res ?? 1);
    return guns.map((g) => ({ x: this.sprite.x + g.x * k, y: this.sprite.y + g.y * k }));
  }

  muzzle(): Point {
    const m = meta(this.key);
    const guns = m.muzzles?.[this.shown];
    if (guns?.length) {
      // its guns take turns
      const g = guns[this.gun++ % guns.length];
      const k = 1 / (m.res ?? 1);
      return { x: this.sprite.x + g.x * k, y: this.sprite.y + g.y * k };
    }
    if (!m.turret_layer) return { x: this.sprite.x, y: this.sprite.y - 34 };
    const at = this.turretAt();
    const mz = m.turret_layer.muzzle[this.turretShown] ?? { x: 0, y: -34 * (m.res ?? 1) };
    const k = 1 / (m.res ?? 1);
    return { x: at.x + mz.x * k, y: at.y + mz.y * k };
  }
}

/** How long a fallen soldier lies there before fading away (ms). */
const BODY_MS = 6000;

/**
 * A soldier shot dead: he's thrown back and falls (his type's `<atlas>_death`), facing the way he last faced, in his
 * team's colour; he lies there a while, then fades.
 */
export function fallDead(world: GameScene, type: string, gx: number, gy: number, dir: number, team: TeamId): void {
  const atlas = `${UNIT_ART[type]?.sprite ?? 'rifleman'}_death`;
  const m = meta(atlas);
  const n = m.death_frames ?? 10;
  const nd = m.directions ?? 16;
  const d = ((dir % nd) + nd) % nd;
  const key = `${atlas}_${d}`;
  if (!world.anims.exists(key)) {
    world.anims.create({ key, frames: Array.from({ length: n }, (_, i) => ({ key: atlas, frame: `inf_${d}_die_${i}` })), frameRate: m.fps ?? 8 });
  }
  const p = iso(gx, gy);
  const body = world.add.sprite(p.x, p.y, atlas, `inf_${d}_die_0`)
    .setOrigin(...anchorOrigin(m))
    .setScale(1 / (m.res ?? 1))
    .setDepth(world.map.depthAt(gx, gy) + 0.4);
  const tint = colourOf(team).tint;
  if (tint !== null) body.setTint(tint);
  body.play(key);
  world.tweens.add({ targets: body, alpha: 0, delay: (n / (m.fps ?? 8)) * 1000 + BODY_MS, duration: 1000, onComplete: () => body.destroy() });
}

/** Whether it can get into a transport: a soldier, or a hovering unit (they took the soldiers' place). */
export function canBoard(u: UnitSprite): boolean {
  return u instanceof InfantrySprite || (u instanceof VehicleSprite && u.hovering);
}

/** Sprite class for a unit type. */
export function createUnitSprite(world: GameScene, v: UnitView, now: number): UnitSprite {
  const kind = UNIT_ART[v.type]?.kind;
  if (kind === 'harvester') return new HarvesterSprite(world, v, now);
  if (kind === 'vehicle') return new VehicleSprite(world, v, now);
  return new InfantrySprite(world, v, now);
}
