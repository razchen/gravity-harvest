import Phaser from 'phaser';
import { meta, sprites, type ConstructionStage } from '../assets/manifest';
import { BuildingFx } from './BuildingFx';
import { FX, ensureFxTextures } from './fxTextures';
import type { ShadowLayer } from '../world/ShadowLayer';

export const CONSTRUCTION = {
  /** Build progress (0..1) at which each stage arrives. A building with a different number of stages spreads them evenly. */
  thresholds: [0, 0.2, 0.4, 0.65, 0.9],
  /** The new parts fade in over this long, so a stage doesn't pop in. */
  fadeMs: 300,
  /** Welding sites per arriving stage (each a flash and a burst of sparks), and the gap between them. */
  weldSites: [3, 4] as [number, number],
  weldGapMs: 180,
  sparksPerSite: [12, 19] as [number, number],
  /** Spark speed in art px per second, gravity pulling them back down, and streak width. */
  sparkSpeed: [70, 170] as [number, number],
  sparkGravity: 360,
  sparkWidth: 3,
  /** Weld flash and dust puff radius in art px. */
  flashRadius: 20,
  dustRadius: [8, 14] as [number, number],
  dustChance: 0.65,
};

/** The stage showing at a given build progress: 0-based, -1 before the first. */
export function stageAt(progress: number, count: number): number {
  const th = count === CONSTRUCTION.thresholds.length ? CONSTRUCTION.thresholds : Array.from({ length: count }, (_, i) => i / count);
  let stage = -1;
  for (let i = 0; i < count; i++) if (progress >= th[i]) stage = i;
  return stage;
}

interface Spark { x: number; y: number; vx: number; vy: number; age: number; life: number }
interface Puff { img: Phaser.GameObjects.Image; x: number; y: number; vx: number; vy: number; r: number; age: number; life: number; peak: number }

const rand = ([a, b]: [number, number]) => a + Math.random() * (b - a);

/**
 * A building going up: shows the stage for its build progress from a construction atlas (`<atlas>_stage_<n>` with
 * `<atlas>_new_<n>`), and when a new stage arrives fades its new parts in over the last stage, with welding sparks
 * along their edges and a little dust where they land. Every frame shares the building's anchor, so it never moves.
 * Each stage's shadow goes into the shared shadow layer (as finished buildings' do), so shadows never stack.
 */
export class ConstructionView {
  readonly stages: ConstructionStage[];
  /** Turrets only: how many directions the head turns to, and the one the stages show. */
  readonly turret: { directions: number; rest: number } | null;
  /** The turret head's direction while finished. */
  private heading = -1;
  /** Its animations (the Gravity Lab's gyroscope, the Barracks door...): each a layer of moving parts over the base. */
  private readonly anims: { name: string; when: 'always' | 'working' | 'door'; frames: number; fps: number; img: Phaser.GameObjects.Image; t: number; f: number; key: string }[] = [];
  /**
   * Its running animation is a whole-building video (`<atlas>_video`, loaded when it's in ATLASES) instead of layers.
   * (A video of just its door replaces the door layer instead.)
   */
  private readonly video: boolean;
  /** Its running effects (steam, flames, glows, lights, sparks). */
  private readonly fx: BuildingFx | null;
  private powered = true;
  private working = false;
  private doorOpen = false;
  /** The building as it stands (the game uses it for clicks and position). */
  readonly base: Phaser.GameObjects.Image;
  private readonly arriving: Phaser.GameObjects.Image;
  private tint: number | null = null;
  private readonly sparksGfx: Phaser.GameObjects.Graphics;
  private stage = -1;
  private fade = 0;
  private shadowStage = -1;
  private sparks: Spark[] = [];
  private flashes: Puff[] = [];
  private puffs: Puff[] = [];
  private timers: Phaser.Time.TimerEvent[] = [];
  private readonly ax: number;
  private readonly ay: number;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly atlas: string,
    private readonly x: number,
    private readonly y: number,
    depth: number,
    /** The shared shadow layer and this building's id in it. */
    private readonly shadow?: { layer: ShadowLayer; id: number },
  ) {
    const m = meta(atlas);
    this.stages = m.construction?.stages ?? [];
    this.turret = m.turret ?? null;

    this.ax = m.anchor.x;
    this.ay = m.anchor.y;
    const origin: [number, number] = [m.anchor.x / m.w, m.anchor.y / m.h];
    this.base = scene.add.image(x, y, atlas, `${atlas}_stage_1`).setOrigin(...origin).setDepth(depth).setVisible(false);
    this.arriving = scene.add.image(x, y, atlas, `${atlas}_new_1`).setOrigin(...origin).setDepth(depth + 0.01).setVisible(false);
    this.sparksGfx = scene.add.graphics().setDepth(depth + 0.03);
    ensureFxTextures(scene);
    const video = sprites[`${atlas}_video`]?.video;
    this.video = !!video?.frames;
    const key = `${atlas}_video`;
    const door = video?.door && { name: 'door', when: 'door' as const, frames: video.door.frames, fps: video.fps, key };
    const anims = video?.frames
      ? [{ name: 'video', when: 'always' as const, frames: video.frames, fps: video.fps, key }]
      : [...(m.anims ?? []).filter((a) => !(door && a.when === 'door')).map((a) => ({ ...a, key: atlas })), ...(door ? [door] : [])];
    for (const a of anims) {
      const img = scene.add.image(x, y, a.key, `${atlas}_${a.name}_0`).setOrigin(...origin).setDepth(depth + 0.005).setVisible(false);
      this.anims.push({ ...a, img, t: 0, f: 0 });
    }
    this.fx = m.effects?.length ? new BuildingFx(scene, m.effects, (fx, fy) => ({ x: this.wx(fx), y: this.wy(fy) }), depth) : null;
  }

  /** It has power: animations that run "always" run, and its effects show (off: they stop where they are). */
  setIdle(on: boolean): void {
    this.powered = on;
    this.fx?.setPowered(on);
  }

  /** Busy (producing, repairing, building): its "working" animations and effects run. */
  setWorking(on: boolean): void {
    this.working = on;
    this.fx?.setWorking(on);
  }

  /** Its door opens (a unit is coming out) or closes. */
  setDoor(open: boolean): void {
    this.doorOpen = open;
  }

  get hasDoor(): boolean {
    return this.anims.some((a) => a.when === 'door');
  }

  /**
   * Its door layer (render/DoorExit.ts measures the doorway from it): the texture, its closed and fully open frames,
   * how long it takes to open, and the building's anchor the layer is drawn at. Null without a door.
   */
  get door(): { key: string; closed: string; open: string; ms: number; anchor: { x: number; y: number } } | null {
    const a = this.anims.find((x) => x.when === 'door');
    if (!a) return null;
    return { key: a.key, closed: `${this.atlas}_${a.name}_0`, open: `${this.atlas}_${a.name}_${a.frames - 1}`, ms: (a.frames / a.fps) * 1000, anchor: { x: this.ax, y: this.ay } };
  }

  /** Its door is all the way open (it opens only while the finished building is showing). */
  get doorOpened(): boolean {
    const a = this.anims.find((x) => x.when === 'door');
    return !!a && a.img.visible && a.f === a.frames - 1;
  }

  /** Finished, the building is its base (without the moving parts) with each animation's layer over it. */
  private showIdle(): void {
    const on = this.finished && this.base.visible;
    if (this.video) {
      // the video is the whole building: the base stays (for clicks and flashes) but unseen under it
      this.base.setAlpha(on ? 0 : 1);
      for (const a of this.anims) a.img.setVisible(on);
    } else if (this.anims.length) {
      // (a building whose only animation is a video door has no base without moving parts: its last stage is it)
      if (on && this.scene.textures.get(this.atlas).has(`${this.atlas}_anim_base`)) this.base.setFrame(`${this.atlas}_anim_base`);
      else if (this.finished && this.base.frame.name === `${this.atlas}_anim_base`) this.base.setFrame(`${this.atlas}_stage_${this.stage + 1}`);
      for (const a of this.anims) a.img.setVisible(on);
    }
    this.fx?.setOn(on);
  }

  get stageIndex(): number {
    return this.stage;
  }

  /** Show the building at this build progress (0..1). With `animate`, a stage that arrives plays its effects. */
  setProgress(progress: number, animate = true): void {
    const s = stageAt(progress, this.stages.length);
    if (s === this.stage) return;
    const forward = s === this.stage + 1;
    this.stage = s;
    this.clearEffects();
    if (s < 0) {
      this.base.setVisible(false);
      this.arriving.setVisible(false);
      this.showShadow(-1);
      this.showIdle();
      return;
    }
    if (animate && forward) {
      // the new parts fade in over the stage before; then the full stage takes over
      if (s > 0) this.base.setFrame(`${this.atlas}_stage_${s}`).setVisible(true);
      else this.base.setVisible(false);
      this.arriving.setFrame(`${this.atlas}_new_${s + 1}`).setAlpha(0).setVisible(true);
      this.fade = 0;
      this.weld(this.stages[s]);
    } else {
      this.base.setFrame(`${this.atlas}_stage_${s + 1}`).setVisible(true);
      this.arriving.setVisible(false);
      this.fade = -1;
      this.showShadow(s);
      this.showHeading();
    }
    this.showIdle();
  }

  /** Team colour (null: none), on the building and its arriving parts. */
  setTint(tint: number | null): void {
    this.tint = tint;
    for (const img of [this.base, this.arriving, ...this.anims.map((a) => a.img)]) {
      if (tint === null) img.clearTint();
      else img.setTint(tint);
    }
  }

  /** A short white flash when it's hit. */
  flash(ms = 60): void {
    this.base.setTintFill(0xffffff);
    for (const a of this.anims) a.img.setTintFill(0xffffff);
    this.scene.time.delayedCall(ms, () => this.base.active && this.setTint(this.tint));
  }

  /**
   * Turrets: turn the head to direction `dir` (0 = world +X, counter-clockwise, as the units). It shows once the
   * building is finished; until then the stages show it at rest.
   */
  face(dir: number): void {
    if (!this.turret) return;
    const n = this.turret.directions;
    this.heading = ((Math.round(dir) % n) + n) % n;
    this.showHeading();
  }

  private get finished(): boolean {
    return this.stage === this.stages.length - 1 && this.fade < 0;
  }

  private showHeading(): void {
    if (!this.turret || this.heading < 0 || !this.finished) return;
    this.base.setFrame(`${this.atlas}_turn_${this.heading}`);
    if (!this.shadow) return;
    this.shadowStage = -2 - this.heading;
    this.shadow.layer.set(this.shadow.id, { key: this.atlas, frame: `${this.atlas}_turnshadow_${this.heading}`, x: this.x, y: this.y, anchor: { x: this.ax, y: this.ay } });
  }

  /** Show a stage (0-based; -1 for nothing) at once, without effects: destruction steps down through them. */
  showStage(stage: number): void {
    this.clearEffects();
    this.stage = stage;
    this.arriving.setVisible(false);
    this.base.setVisible(stage >= 0);
    if (stage >= 0) this.base.setFrame(`${this.atlas}_stage_${stage + 1}`);
    this.showShadow(stage);
    this.showHeading();
    this.showIdle();
  }

  update(deltaMs: number): void {
    const dt = deltaMs / 1000;
    this.stepAnims(deltaMs);
    this.fx?.update(deltaMs);
    if (this.fade >= 0) {
      this.fade += deltaMs;
      this.arriving.setAlpha(Math.min(1, this.fade / CONSTRUCTION.fadeMs));
      // the new parts' shadow comes in when they're half there
      if (this.fade >= CONSTRUCTION.fadeMs / 2) this.showShadow(this.stage);
      if (this.fade >= CONSTRUCTION.fadeMs) {
        this.fade = -1;
        this.base.setFrame(`${this.atlas}_stage_${this.stage + 1}`).setVisible(true);
        this.arriving.setVisible(false);
        this.dust(this.stages[this.stage]);
        this.showHeading();
        this.showIdle();
      }
    }
    // weld flashes and dust: soft dots that grow and fade
    for (const list of [this.flashes, this.puffs]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.age += dt;
        const k = p.age / p.life;
        if (k >= 1) {
          p.img.destroy();
          list.splice(i, 1);
          continue;
        }
        const grow = list === this.flashes ? 1 + 0.6 * k : 1 + 2.5 * k;
        p.img.setPosition(this.wx(p.x + p.vx * p.age), this.wy(p.y + p.vy * p.age)).setScale((p.r * grow) / 32).setAlpha(p.peak * (1 - k));
      }
    }
    // sparks: short streaks thrown up and out, falling back and cooling from yellow to red
    const g = this.sparksGfx.clear();
    this.sparks = this.sparks.filter((p) => (p.age += dt) < p.life);
    for (const p of this.sparks) {
      if (p.age < 0) continue;
      const k = p.age / p.life;
      const vy = p.vy + CONSTRUCTION.sparkGravity * p.age;
      const x = p.x + p.vx * p.age;
      const y = p.y + p.vy * p.age + 0.5 * CONSTRUCTION.sparkGravity * p.age * p.age;
      const color = Phaser.Display.Color.GetColor(255, Math.round(210 - 90 * k), Math.round(120 - 100 * k));
      g.lineStyle(CONSTRUCTION.sparkWidth, color, 1 - k).lineBetween(this.wx(x - p.vx * 0.05), this.wy(y - vy * 0.05), this.wx(x), this.wy(y));
    }
  }

  destroy(): void {
    this.clearEffects();
    this.showShadow(-1);
    this.base.destroy();
    this.arriving.destroy();
    for (const a of this.anims) a.img.destroy();
    this.fx?.destroy();
    this.sparksGfx.destroy();
  }

  /**
   * Animations: "always" loops while powered, "working" while busy too (when it stops, it finishes its loop and
   * rests), and a door plays towards open or closed.
   */
  private stepAnims(deltaMs: number): void {
    for (const a of this.anims) {
      if (!a.img.visible) continue;
      const step = 1000 / a.fps;
      if (a.when === 'door') {
        const target = this.doorOpen ? a.frames - 1 : 0;
        if (a.f === target) continue;
        a.t += deltaMs;
        while (a.t >= step && a.f !== target) {
          a.t -= step;
          a.f += Math.sign(target - a.f);
        }
      } else {
        const run = this.powered && (a.when === 'always' || this.working);
        if (!run && a.f === 0) continue;       // at rest
        if (!this.powered) continue;           // frozen where it was
        a.t += deltaMs;
        while (a.t >= step) {
          a.t -= step;
          a.f = (a.f + 1) % a.frames;
          if (!run && a.f === 0) break;        // finished its loop: rest
        }
      }
      a.img.setFrame(`${this.atlas}_${a.name}_${a.f}`);
    }
  }

  private showShadow(stage: number): void {
    if (!this.shadow || stage === this.shadowStage) return;
    this.shadowStage = stage;
    if (stage < 0) this.shadow.layer.remove(this.shadow.id);
    else this.shadow.layer.set(this.shadow.id, { key: this.atlas, frame: `${this.atlas}_shadow_${stage + 1}`, x: this.x, y: this.y, anchor: { x: this.ax, y: this.ay } });
  }

  /** Frame pixel -> world. */
  private wx(fx: number): number {
    return this.x + fx - this.ax;
  }

  private wy(fy: number): number {
    return this.y + fy - this.ay;
  }

  private weld(stage: ConstructionStage | undefined): void {
    if (!stage?.welds.length) return;
    const sites = Math.round(rand(CONSTRUCTION.weldSites));
    for (let s = 0; s < sites; s++) {
      const [x, y] = stage.welds[Math.floor(Math.random() * stage.welds.length)];
      const start = s * CONSTRUCTION.weldGapMs + Math.random() * 100;
      this.timers.push(this.scene.time.delayedCall(start, () => {
        const img = this.dot(0xffd890, Phaser.BlendModes.ADD);
        this.flashes.push({ img, x, y, vx: 0, vy: 0, r: CONSTRUCTION.flashRadius, age: 0, life: 0.28, peak: 0.95 });
        for (let i = 0, n = Math.round(rand(CONSTRUCTION.sparksPerSite)); i < n; i++) {
          const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
          const v = rand(CONSTRUCTION.sparkSpeed);
          this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: -Math.random() * 0.12, life: 0.35 + Math.random() * 0.35 });
        }
      }));
    }
  }

  private dust(stage: ConstructionStage | undefined): void {
    for (const [x, y] of stage?.dust ?? []) {
      if (Math.random() > CONSTRUCTION.dustChance) continue;
      const img = this.dot(0x96805f, Phaser.BlendModes.NORMAL);
      this.puffs.push({ img, x: x + (Math.random() - 0.5) * 12, y: y + (Math.random() - 0.5) * 6, vx: (Math.random() - 0.5) * 15, vy: -9 - Math.random() * 12,
        r: rand(CONSTRUCTION.dustRadius), age: 0, life: 0.8 + Math.random() * 0.5, peak: 0.4 });
    }
  }

  private dot(tint: number, blend: Phaser.BlendModes): Phaser.GameObjects.Image {
    return this.scene.add.image(this.x, this.y, FX.dot).setTint(tint).setBlendMode(blend).setDepth(this.arriving.depth + 0.01).setAlpha(0);
  }

  private clearEffects(): void {
    for (const t of this.timers) t.remove();
    this.timers = [];
    for (const p of [...this.flashes, ...this.puffs]) p.img.destroy();
    this.flashes = [];
    this.puffs = [];
    this.sparks = [];
    this.sparksGfx.clear();
    this.fade = -1;
  }
}
