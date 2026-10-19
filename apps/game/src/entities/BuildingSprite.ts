import Phaser from 'phaser';
import type { BuildingView, TeamId } from '@gravity-harvest/shared';
import { serviceBayPad } from '@gravity-harvest/sim/layout';
import { DEPTH } from '../config/game';
import { iso } from '../core/geometry';
import { BUILDING_ART, type BuildingArt } from '../data/art';
import { TEAMS } from '../data/teams';
import { getCatalog } from '../systems/availability';
import { ConstructionView } from '../render/Construction';
import { BuildingDamage, damageLevel } from '../render/Destruction';
import { DoorExit } from '../render/DoorExit';
import type { GameScene } from '../scenes/GameScene';
import type { Occluder } from '../world/GameMap';
import type { UnitSprite } from './UnitSprite';

/** A defence's head turns one of its directions this often (32 directions: a half turn in about 0.4 s). */
const HEAD_TURN_MS = 25;

/** A door stays open at least this long for a unit coming out (longer while one is still in the doorway). */
export const DOOR_OPEN_MS = 1600;

/** How long a destroyed building's explosions and smoke keep going before its effects are removed. */
const AFTERMATH_MS = 4500;

/**
 * Whether a point at (gx, gy) draws over a building: in front of its two front sides, on a refinery's ramp, or on a
 * Service Bay's pad (or backing onto it).
 */
export function inFrontOf(b: { type: string; tx: number; ty: number; size: number }, gx: number, gy: number): boolean {
  const front = gx >= b.tx + b.size || gy >= b.ty + b.size;
  if (b.type === 'refinery') return front || (gy > b.ty + b.size - 1 && gx > b.tx && gx < b.tx + b.size);
  if (b.type === 'service_bay') {
    const pad = serviceBayPad(b.tx, b.ty).pad;
    return front || (Math.abs(gx - pad.gx) < 0.75 && gy > pad.gy - 0.75);
  }
  return front;
}

/**
 * A Service Bay's roof arms reach down over a vehicle on its pad: the depth that draws them (and their sparks) just
 * over it, for a building drawn at `depth` whose sprite sits at world y `y` (units sort against it as GameMap.depthAt).
 */
export function armsDepth(b: { type: string; tx: number; ty: number }, depth: number, y: number): number | null {
  if (b.type !== 'service_bay') return null;
  const pad = serviceBayPad(b.tx, b.ty).pad;
  return depth + Math.max(iso(pad.gx, pad.gy).y - y, 1) + 0.6;
}

/**
 * A building as the server reports it: assembles itself stage by stage while it's built (render/Construction.ts),
 * smokes and burns as it's damaged and blows up when destroyed (render/Destruction.ts). Its stage frames all share
 * one anchor, so it never moves; its shadow is in the shared shadow layer.
 */
export class BuildingSprite implements Occluder {
  readonly cat = 'building' as const;
  readonly id: number;
  readonly type: string;
  readonly team: TeamId;
  readonly tx: number;
  readonly ty: number;
  readonly size: number;
  readonly depth: number;
  readonly art: BuildingArt;
  /** The building as it stands: clicks and positions use it. */
  readonly sprite: Phaser.GameObjects.Image;
  hp: number;
  maxHp: number;
  progress: number;
  built = false;
  /** Busy (producing, a Service Bay repairing the vehicle on its pad): its working sound plays. */
  working = false;
  powered = true;
  alive = true;
  private readonly view: ConstructionView;
  private readonly damage: BuildingDamage;
  private level: 0 | 1 | 2 = 0;
  private buildBar: Phaser.GameObjects.Graphics | null = null;
  /** The blinking lightning bolt over one of your buildings that's short of power. */
  private noPower: Phaser.GameObjects.Graphics | null = null;
  /** Being repaired (yours only), and the wrench that shows it. */
  repairing = false;
  private wrench: Phaser.GameObjects.Graphics | null = null;
  private doorTimer: Phaser.Time.TimerEvent | null = null;
  /** When its door last opened for a unit, and how many units are still coming out of it. */
  private doorOpenedAt = 0;
  private comingOut = 0;
  /** A defence: where the server says its head points, and where it's drawn (it turns a step at a time). */
  private aim = -1;
  private heading = -1;
  private turnT = 0;

  constructor(private readonly world: GameScene, v: BuildingView) {
    this.id = v.id;
    this.type = v.type;
    this.team = v.team;
    this.tx = v.tx;
    this.ty = v.ty;
    this.size = v.size;
    this.hp = v.hp;
    this.maxHp = v.maxHp;
    this.progress = v.progress;
    this.art = BUILDING_ART[v.type];
    const c = iso(this.gx, this.gy);
    this.depth = c.y;
    this.view = new ConstructionView(world, this.art.sprite, c.x, c.y, this.depth, { layer: world.shadows, id: this.id });
    this.damage = new BuildingDamage(world, this.art.sprite, c.x, c.y, this.depth);
    const lift = armsDepth(v, this.depth, c.y);
    if (lift !== null) this.view.liftMoving(lift);
    this.sprite = this.view.base.setInteractive({ pixelPerfect: true });
    this.sprite.setData('entity', this);
    this.view.setTint(TEAMS[this.team].tint);
    // one already part-built (seen for the first time, or a loaded save) shows its stage without the arrival effects
    if (v.built) this.finish(false);
    else this.showProgress(false);
    this.setPowered(v.powered);
  }

  get gx(): number {
    return this.tx + this.size / 2;
  }

  get gy(): number {
    return this.ty + this.size / 2;
  }

  /** Update from the latest view. */
  apply(v: BuildingView): void {
    if (v.hp < this.hp) this.view.flash();
    this.hp = v.hp;
    this.maxHp = v.maxHp;
    this.progress = v.progress;
    if (v.built && !this.built) this.finish(true);
    else if (!this.built) this.showProgress(true);
    this.setPowered(v.powered);
    if (this.built) this.showDamage();
    if (v.facing !== undefined) this.aim = v.facing;
    this.setRepairing(!!v.repairing);
    this.working = !!v.working;
    this.view.setWorking(this.working);
  }

  /** A blinking badge above the building (the power bolt, the repair wrench); `slot` places it left or right. */
  private badge(draw: (g: Phaser.GameObjects.Graphics) => void, slot: number): Phaser.GameObjects.Graphics {
    const top = this.sprite.getTopCenter();
    const g = this.world.add.graphics({ x: (top.x ?? this.sprite.x) + slot * 30, y: (top.y ?? this.sprite.y) + 18 }).setDepth(DEPTH.ui - 3);
    g.fillStyle(0x1a1406, 0.85).fillCircle(0, 0, 27);
    g.lineStyle(3, 0xffd34d, 1).strokeCircle(0, 0, 27);
    draw(g);
    this.world.tweens.add({ targets: g, alpha: 0.25, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    return g;
  }

  private dropBadge(g: Phaser.GameObjects.Graphics | null): null {
    if (g) {
      this.world.tweens.killTweensOf(g);
      g.destroy();
    }
    return null;
  }

  private setRepairing(on: boolean): void {
    this.repairing = on && this.alive;
    if (this.repairing && !this.wrench) {
      this.wrench = this.badge((g) => {
        g.fillStyle(0xffd34d, 1).fillCircle(-7, -7, 8);
        g.fillStyle(0x1a1406, 1).fillCircle(-10, -10, 4);
        g.lineStyle(7, 0xffd34d, 1).lineBetween(-4, -4, 12, 12);
      }, this.noPower ? 1 : 0);
    } else if (!this.repairing) this.wrench = this.dropBadge(this.wrench);
  }

  /** Where a defence's shots come from: its head, about the middle of its height. */
  muzzle(): { x: number; y: number } {
    return { x: this.sprite.x, y: this.sprite.y - 30 * this.size - 10 };
  }

  /** Every frame: the arrival effects, smoke and fire, and a defence's head turning towards its aim. */
  tick(deltaMs: number): void {
    const t = this.view.turret;
    if (t && this.aim >= 0) {
      if (this.heading < 0) this.heading = t.rest;
      this.turnT += deltaMs;
      while (this.turnT >= HEAD_TURN_MS && this.heading !== this.aim) {
        this.turnT -= HEAD_TURN_MS;
        const diff = ((this.aim - this.heading + t.directions * 1.5) % t.directions) - t.directions / 2;
        this.heading = (this.heading + Math.sign(diff || 1) + t.directions) % t.directions;
      }
      if (this.heading === this.aim) this.turnT = 0;
      this.view.face(this.heading);
    }
    this.view.update(deltaMs);
    this.damage.update(deltaMs);
  }

  private showProgress(animate: boolean): void {
    this.view.setProgress(this.progress, animate);
    const p = this.progress;
    const top = iso(this.gx, this.gy);
    this.buildBar ??= this.world.add.graphics().setDepth(DEPTH.ui - 2);
    this.buildBar.clear().fillStyle(0x000000, 0.7).fillRect(top.x - 80, top.y - 40, 160, 14)
      .fillStyle(0xf5b301, 1).fillRect(top.x - 78, top.y - 38, 156 * p, 10);
  }

  private finish(animate: boolean): void {
    this.built = true;
    this.buildBar?.destroy();
    this.buildBar = null;
    this.view.setProgress(1, animate);
    this.showDamage();
  }

  /** Smoke, then fire, as its health drops (and none once repaired). */
  private showDamage(): void {
    const level = damageLevel(this.maxHp ? this.hp / this.maxHp : 1);
    if (level === this.level) return;
    this.level = level;
    this.damage.setLevel(level);
  }

  /**
   * Low power: your finished buildings that use power show a blinking lightning bolt (they work at half speed, and
   * the radar and the defences that need power stop).
   */
  setPowered(on: boolean): void {
    this.powered = on;
    this.view.setIdle(on); // an idle animation (the Gravity Lab's gyroscope) stops without power
    const show = !on && this.built && this.alive && this.team === 'player' && (getCatalog().buildings[this.type]?.power ?? 0) < 0;
    if (show && !this.noPower) {
      const bolt = [{ x: 4, y: -22 }, { x: -12, y: 3 }, { x: -1, y: 3 }, { x: -6, y: 22 }, { x: 12, y: -4 }, { x: 1, y: -4 }];
      this.noPower = this.badge((g) => g.fillStyle(0xffd34d, 1).fillPoints(bolt, true), this.wrench ? -1 : 0);
    } else if (!show) this.noPower = this.dropBadge(this.noPower);
  }

  /** Its door (if the model has one): open while a harvester docks, say, or closed. */
  door(open: boolean): void {
    this.view.setDoor(open);
  }

  /** A unit came out: the door opens, the unit (if we see it) drives out through it, and the door closes behind it. */
  unitOut(unit?: UnitSprite): void {
    if (!this.view.hasDoor) return;
    this.view.setDoor(true);
    this.doorOpenedAt = this.world.time.now;
    const exit = unit && DoorExit.create(this.world, this.view, this.art.door, this);
    if (exit) {
      this.comingOut++;
      unit.comeOut(exit, () => {
        this.comingOut--;
        this.closeDoor();
      });
    }
    this.closeDoor();
  }

  /** Close the door once nothing is coming out, and it's been open DOOR_OPEN_MS. */
  private closeDoor(): void {
    this.doorTimer?.remove();
    if (this.comingOut) return;
    const wait = Math.max(0, this.doorOpenedAt + DOOR_OPEN_MS - this.world.time.now);
    this.doorTimer = this.world.time.delayedCall(wait, () => this.alive && !this.comingOut && this.view.setDoor(false));
  }

  /** Things in front of its two front sides draw over the building; anything else around it draws under. */
  inFront(gx: number, gy: number): boolean {
    return inFrontOf(this, gx, gy);
  }

  /** Destroyed: it blows up (it's gone under the first flash), then its effects are cleared away. */
  explode(): void {
    this.retire();
    this.damage.collapse(this.view);
    this.world.time.delayedCall(AFTERMATH_MS, () => this.clearAway());
  }

  /** Gone without a fight (sold, or out of sight): fades out. */
  dispose(): void {
    this.retire();
    this.damage.clear();
    this.world.tweens.add({ targets: this.sprite, alpha: 0, duration: 500, onComplete: () => this.clearAway() });
  }

  private retire(): void {
    this.alive = false;
    this.setPowered(true);
    this.setRepairing(false);
    this.sprite.disableInteractive();
    this.buildBar?.destroy();
    this.buildBar = null;
  }

  private clearAway(): void {
    this.damage.destroy();
    this.view.destroy();
  }
}
