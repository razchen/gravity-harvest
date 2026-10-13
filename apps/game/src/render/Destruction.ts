import Phaser from 'phaser';
import { meta } from '../assets/manifest';
import type { ConstructionView } from './Construction';
import { FX, FX_SHEETS, ensureFxTextures } from './fxTextures';

/**
 * Look and timing of a building being damaged and destroyed. Sizes in art px (1 = one sprite pixel). The fire and
 * smoke values were tuned on /dev/fire.html (its "Copy settings" gives them in the same terms).
 */
export const DESTRUCTION = {
  /** Smoke drifts with the wind, this many art px per second to the right. */
  wind: 23,
  /** A building smokes below this share of its health, and burns below this one. */
  damagedBelow: 0.5,
  burningBelow: 0.25,
  /** Roof spots that smoke when damaged, and that burn when badly damaged. */
  smokeSpots: 2,
  fireSpots: 4,
  /** A burning spot: one looping flame flipbook (glowing), a ground glow and a few embers. */
  fire: { scale: 0.36, sizeVariety: 0.2, spread: 1, fps: 26, glow: 0.32, embersPerSec: 5 },
  /** Its smoke, starting this far above the flame's base and drawn behind it; each puff plays the smoke flipbook. */
  smoke: { startAbove: 37, perSec: 6.8, lifeS: 2.2, rise: 62, startScale: 0.18, endScale: 1.38, alpha: 0.8, fadeIn: 0.15, tint: 0x4a4440, spin: 65 },
  /** A damaged (not yet burning) spot: the same smoke, lighter and thinner. */
  damagedSmoke: { perSec: 4, alpha: 0.55, tint: 0x8a8178 },
  /** Destroyed: a cluster of this many explosions across the building, this far apart (ms); under the first flash the
   *  building is gone, leaving only its scorch mark. */
  blasts: 4,
  blastGapMs: 110,
};

const SMOKE_COLORS = [0x4a433d, 0x2c2825];
export const FLAME_ANIM = 'fx_flame_loop';
const SMOKE_ANIM = 'fx_smoke_puff';
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** The flipbook animations (their sheets are loaded with the other assets: fxTextures.loadFxSheets). */
export function ensureAnims(scene: Phaser.Scene): void {
  const make = (key: string, sheet: { key: string; frames: number }, frameRate: number, repeat: number) => {
    if (!scene.textures.exists(sheet.key)) throw new Error(`Fire and smoke flipbook "${sheet.key}" isn't loaded: call loadFxSheets(scene) in preload`);
    if (!scene.anims.exists(key)) scene.anims.create({ key, frames: scene.anims.generateFrameNumbers(sheet.key, { start: 0, end: sheet.frames - 1 }), frameRate, repeat });
  };
  make(FLAME_ANIM, FX_SHEETS.flame, DESTRUCTION.fire.fps, -1);
  make(SMOKE_ANIM, FX_SHEETS.smoke, FX_SHEETS.smoke.frames / DESTRUCTION.smoke.lifeS, 0);
}

/** A spot that smokes, or burns and smokes. */
class Blaze {
  private readonly smoke: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly flame?: Phaser.GameObjects.Sprite;
  private readonly embers?: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly glow?: Phaser.GameObjects.Image;
  private t = Math.random() * 10;

  constructor(scene: Phaser.Scene, x: number, y: number, depth: number, readonly burning: boolean) {
    ensureAnims(scene);
    const F = DESTRUCTION.fire;
    const S = DESTRUCTION.smoke;
    const D = DESTRUCTION.damagedSmoke;
    const peak = burning ? S.alpha : D.alpha;
    const life = S.lifeS * 1000;
    this.smoke = scene.add.particles(x, y - (burning ? S.startAbove : 0), FX_SHEETS.smoke.key, {
      anim: SMOKE_ANIM,
      lifespan: { min: life * 0.85, max: life * 1.15 },
      speedX: { min: DESTRUCTION.wind * 0.4, max: DESTRUCTION.wind * 1.6 },
      speedY: { min: -S.rise * 1.3, max: -S.rise * 0.7 },
      scale: { start: S.startScale, end: S.endScale },
      // each puff fades in, then thins out
      alpha: { onUpdate: (_p: Phaser.GameObjects.Particles.Particle, _k: string, t: number) => (t < S.fadeIn ? (t / S.fadeIn) * peak : peak * (1 - (t - S.fadeIn) / (1 - S.fadeIn))) },
      tint: burning ? S.tint : D.tint,
      rotate: { min: -S.spin, max: S.spin },
      frequency: 1000 / (burning ? S.perSec : D.perSec),
    }).setDepth(depth + 0.4);                  // behind the flame
    if (!burning) return;
    this.glow = scene.add.image(x, y, FX.dot).setTint(0xff6a1c).setBlendMode(Phaser.BlendModes.ADD).setDepth(depth + 0.45).setScale(1.2, 0.75).setAlpha(F.glow);
    this.flame = scene.add.sprite(x + rand(-F.spread, F.spread), y, FX_SHEETS.flame.key)
      .setOrigin(0.5, 0.94).setScale(F.scale * (1 + rand(-1, 1) * F.sizeVariety)).setFlipX(Math.random() < 0.5)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(depth + 0.5);
    this.flame.play({ key: FLAME_ANIM, startFrame: Math.floor(Math.random() * FX_SHEETS.flame.frames) });
    const flameTop = FX_SHEETS.flame.frameHeight * F.scale;
    this.embers = scene.add.particles(x, y - flameTop * 0.3, FX.dot, {
      lifespan: { min: 900, max: 1700 },
      speedX: { min: -18, max: 18 + DESTRUCTION.wind },
      speedY: { min: -110, max: -40 },
      scale: { start: 0.07, end: 0.02 },
      alpha: { start: 1, end: 0 },
      color: [0xfff0a0, 0xff7a20, 0xa02008],
      blendMode: Phaser.BlendModes.ADD,
      frequency: 1000 / F.embersPerSec,
    }).setDepth(depth + 0.55);
  }

  update(deltaMs: number): void {
    if (!this.glow) return;
    this.t += deltaMs / 1000;
    const flicker = 0.8 + 0.12 * Math.sin(this.t * 13) + 0.08 * Math.sin(this.t * 29 + 1);
    this.glow.setAlpha(DESTRUCTION.fire.glow * flicker);
  }

  /** Stop making smoke and fire; what's in the air drifts off, then it's gone. */
  stop(): void {
    this.smoke.stop();
    this.embers?.stop();
    this.flame?.destroy();
    this.glow?.destroy();
    const left = [this.smoke, this.embers];
    this.smoke.scene.time.delayedCall(4000, () => left.forEach((o) => o?.destroy()));
  }

  destroy(): void {
    this.smoke.destroy();
    this.flame?.destroy();
    this.embers?.destroy();
    this.glow?.destroy();
  }
}

/** How damaged a building looks at this share of its health: 0 fine, 1 smoking, 2 burning. */
export const damageLevel = (hpShare: number): 0 | 1 | 2 =>
  hpShare < DESTRUCTION.burningBelow ? 2 : hpShare < DESTRUCTION.damagedBelow ? 1 : 0;

/**
 * A building's damage and destruction: smoke from its roof when damaged, fire when badly damaged, and when it's
 * destroyed a cluster of explosions under which it disappears (the game leaves a scorch mark where it stood).
 */
export class BuildingDamage {
  private blazes: Blaze[] = [];
  private timers: Phaser.Time.TimerEvent[] = [];
  private readonly spots: [number, number][];
  private readonly ax: number;
  private readonly ay: number;

  constructor(private readonly scene: Phaser.Scene, atlas: string, private readonly x: number, private readonly y: number, private readonly depth: number) {
    ensureFxTextures(scene);
    const m = meta(atlas);
    this.spots = m.damage?.spots ?? [];
    this.ax = m.anchor.x;
    this.ay = m.anchor.y;
  }

  /** 0 intact, 1 damaged (smoking), 2 badly damaged (burning). */
  setLevel(level: 0 | 1 | 2): void {
    for (const b of this.blazes) b.stop();
    this.blazes = [];
    if (level === 0 || !this.spots.length) return;
    // the same spots every time: smoke first, then those and more catch fire
    const order = [...this.spots].sort((a, b) => ((a[0] * 7 + a[1] * 13) % 11) - ((b[0] * 7 + b[1] * 13) % 11));
    const n = level === 1 ? DESTRUCTION.smokeSpots : DESTRUCTION.fireSpots;
    for (const [fx, fy] of order.slice(0, n)) this.blazes.push(new Blaze(this.scene, this.wx(fx), this.wy(fy), this.depth, level === 2));
  }

  /** Blow the building up: a cluster of explosions over it, and under the first flash it's gone. `onDone` then. */
  collapse(view: ConstructionView, onDone?: () => void): void {
    this.clear();
    const centre = this.spots.length ? this.spots[Math.floor(this.spots.length / 2)] : [this.ax, this.ay - 60];
    this.explode(centre[0], centre[1], 1.4);
    // the rest go off around the roof, spread over the building
    const spread = [...this.spots].sort(() => Math.random() - 0.5);
    for (let b = 1; b < DESTRUCTION.blasts; b++) {
      const [fx, fy] = spread.length ? spread[b % spread.length] : centre;
      this.later(b * DESTRUCTION.blastGapMs, () => this.explode(fx, fy, rand(0.85, 1.15)));
    }
    this.later(60, () => {
      view.showStage(-1);
      onDone?.();
    });
  }

  /** An explosion at a frame pixel: flash, fireball, smoke and embers. `size` 1 = a typical blast. */
  explode(fx: number, fy: number, size = 1): void {
    const x = this.wx(fx);
    const y = this.wy(fy);
    const s = this.scene;
    const flash = s.add.image(x, y, FX.dot).setTint(0xffd890).setBlendMode(Phaser.BlendModes.ADD).setDepth(this.depth + 0.7).setScale(1.7 * size).setAlpha(0.85);
    s.tweens.add({ targets: flash, alpha: 0, scale: 2.6 * size, duration: 220, onComplete: () => flash.destroy() });
    const fire = s.add.particles(x, y, FX.dot, {
      lifespan: { min: 380, max: 720 },
      speed: { min: 25 * size, max: 120 * size },
      scale: { start: 0.95 * size, end: 0.25 * size },
      alpha: { start: 1, end: 0 },
      color: [0xfff6d8, 0xffb040, 0xff5212, 0x4a1206],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }).setDepth(this.depth + 0.65);
    fire.explode(Math.round(16 * size));
    const smoke = s.add.particles(x, y - 6, FX.smoke, {
      lifespan: { min: 1800, max: 3000 },
      speed: { min: 12 * size, max: 55 * size },
      gravityY: -26,
      speedX: { min: 0, max: DESTRUCTION.wind },
      scale: { start: 0.45 * size, end: 1.9 * size },
      alpha: { start: 0.7, end: 0 },
      color: SMOKE_COLORS,
      rotate: { min: 0, max: 360 },
      emitting: false,
    }).setDepth(this.depth + 0.6);
    this.later(70, () => smoke.explode(Math.round(9 * size)));
    const embers = s.add.particles(x, y, FX.dot, {
      lifespan: { min: 600, max: 1300 },
      speed: { min: 60 * size, max: 200 * size },
      angle: { min: 200, max: 340 },
      gravityY: 220,
      scale: { start: 0.08, end: 0.02 },
      alpha: { start: 1, end: 0 },
      color: [0xfff0a0, 0xff8020, 0xa02008],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }).setDepth(this.depth + 0.66);
    embers.explode(Math.round(14 * size));
    this.later(3500, () => [fire, smoke, embers].forEach((e) => e.destroy()));
    s.cameras.main.shake(140 + 60 * size, 0.0025 * size);
  }

  update(deltaMs: number): void {
    for (const b of this.blazes) b.update(deltaMs);
  }

  /** Back to intact: stops every effect at once. */
  clear(): void {
    for (const t of this.timers) t.remove();
    this.timers = [];
    for (const b of this.blazes) b.destroy();
    this.blazes = [];
  }

  destroy(): void {
    this.clear();
  }

  private later(ms: number, fn: () => void): void {
    this.timers.push(this.scene.time.delayedCall(ms, fn));
  }

  private wx(fx: number): number {
    return this.x + fx - this.ax;
  }

  private wy(fy: number): number {
    return this.y + fy - this.ay;
  }
}
