import Phaser from 'phaser';
import { DEPTH } from '../config/game';
import type { Point } from '../core/geometry';
import { FX, FX_SHEETS, ensureFxTextures } from './fxTextures';

/**
 * What a shell or fireball bursts into where it lands, in one of a few looks (compared on /dev/fx.html):
 * - `painted`: Kenney's painted fire, flash and smoke puffs (CC0), with embers and debris flung out.
 * - `shockwave`: a quick bright flash, a ring of dust racing out along the ground, sparks and a soft smoke puff.
 * - `plasma`: a white-cyan core, a sharp ring racing out over the ground, crackling arcs, cyan sparks, a violet haze.
 * - `ion`: jagged lightning crawling over what it hits, a hard lens flare, the arcs flickering.
 * - `gravity`: sparks and a swirl sucked inwards, then a pop with a flare and a ring.
 * - `railgun`: a white-hot star with beam spikes shooting out, molten slag and a dust ring.
 * The sci-fi shapes are from Kenney's particle pack (CC0). Whatever the look, what it hits flashes for a moment (in the
 * look's colour), the burst sorts with the target (things in front of it cover it), and on open ground it kicks up
 * dust and leaves a scorch mark that fades.
 */
export type ImpactStyle = 'painted' | 'shockwave' | 'plasma' | 'ion' | 'gravity' | 'railgun';

export const IMPACT_STYLES: readonly ImpactStyle[] = ['painted', 'shockwave', 'plasma', 'ion', 'gravity', 'railgun'];

/** Each look's colours: what it hits flashes `hit`; a scorch glows `molten` for a moment as it cools (if any). */
const LOOK: Record<ImpactStyle, { hit: number; molten?: number }> = {
  painted: { hit: 0xfff2d8 },
  shockwave: { hit: 0xfff2d8 },
  plasma: { hit: 0xb8f4ff, molten: 0x38c8ff },
  ion: { hit: 0xd8e4ff },
  gravity: { hit: 0xe8c8ff, molten: 0xa040ff },
  railgun: { hit: 0xffffff, molten: 0xff7a20 },
};

/** A sprite or image that can flash white-hot. */
export type Flashable = Phaser.GameObjects.Sprite | Phaser.GameObjects.Image;

export interface ImpactAt {
  /** Where it bursts (world px): on the target's body. */
  x: number;
  y: number;
  /** How big: 1 is a tank shell's. */
  size: number;
  /** Drawn at this depth (just in front of what it hits); over everything when absent. */
  depth?: number;
  /** The target's sprites: they flash hot for a moment. */
  targets?: Flashable[];
  /** On open ground (not a building): the ground point under it, for dust and a scorch mark. */
  ground?: Point;
}

/** Tuning. Times in ms, sizes in world px at size 1. */
export const IMPACT = {
  /** How long the target glows white-hot, and how strongly. */
  hitFlashMs: 110,
  hitFlashAlpha: 0.75,
  /** Scorch marks: how big, how dark, how long they stay before fading out over `scorchFadeMs`. */
  scorchPx: 46,
  scorchAlpha: 0.5,
  scorchMs: 6000,
  scorchFadeMs: 3000,
  scorchColour: 0x1c1610,
  dustColour: 0xb4a07e,
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = (n: number) => Math.floor(Math.random() * n);

/** A shell or fireball bursting at `at`, in `style`. */
export function impact(scene: Phaser.Scene, style: ImpactStyle, at: ImpactAt): void {
  ensureFxTextures(scene);
  const depth = at.depth ?? DEPTH.ui - 6;
  const look = LOOK[style];
  // the gravity look pops after it has pulled in: what it hits flashes then
  scene.time.delayedCall(style === 'gravity' ? GRAVITY_PULL_MS : 0, () => hitFlash(scene, at.targets, look.hit));
  if (at.ground) groundMarks(scene, at.ground, at.size, look.molten);
  BURSTS[style](scene, at, depth);
}

const BURSTS: Record<ImpactStyle, (scene: Phaser.Scene, at: ImpactAt, depth: number) => void> = {
  painted: (s, a, d) => painted(s, a, d),
  shockwave: (s, a, d) => shockwave(s, a, d),
  plasma: (s, a, d) => plasma(s, a, d),
  ion: (s, a, d) => ion(s, a, d),
  gravity: (s, a, d) => gravity(s, a, d),
  railgun: (s, a, d) => railgun(s, a, d),
};

/** The target glows white-hot for a moment: a white copy of each of its sprites over it, fading out. */
function hitFlash(scene: Phaser.Scene, targets: Flashable[] = [], colour = 0xfff2d8): void {
  for (const s of targets) {
    if (!s.active || !s.visible) continue;
    const glow = scene.add.image(s.x, s.y, s.texture.key, s.frame.name)
      .setOrigin(s.originX, s.originY).setScale(s.scaleX, s.scaleY).setFlip(s.flipX, s.flipY)
      .setDepth(s.depth + 1e-4).setTintFill(colour).setAlpha(IMPACT.hitFlashAlpha).setBlendMode(Phaser.BlendModes.ADD);
    scene.tweens.add({ targets: glow, alpha: 0, duration: IMPACT.hitFlashMs, ease: 'Quad.easeOut', onComplete: () => glow.destroy() });
  }
}

/** On open ground: a dust puff kicked up, and a scorch mark that stays a while and fades. */
function groundMarks(scene: Phaser.Scene, g: Point, size: number, molten?: number): void {
  const sc = FX_SHEETS.impactScorch;
  const px = IMPACT.scorchPx * size * rand(0.85, 1.2);
  const mark = scene.add.image(g.x, g.y, sc.key, pick(sc.frames))
    .setDisplaySize(px, px / 2).setRotation(0).setTint(IMPACT.scorchColour).setAlpha(0).setDepth(DEPTH.scorch);
  mark.setFlipX(Math.random() < 0.5);
  scene.tweens.add({ targets: mark, alpha: IMPACT.scorchAlpha, duration: 120 });
  scene.tweens.add({ targets: mark, alpha: 0, delay: IMPACT.scorchMs, duration: IMPACT.scorchFadeMs, onComplete: () => mark.destroy() });
  if (molten !== undefined) {
    // still glowing hot where it struck, cooling over a second
    const hot = scene.add.image(g.x, g.y, sc.key, mark.frame.name).setDisplaySize(px * 0.7, px * 0.35).setFlipX(mark.flipX)
      .setTint(molten).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.9).setDepth(DEPTH.scorch + 0.5);
    scene.tweens.add({ targets: hot, alpha: 0, duration: 1100, ease: 'Quad.easeIn', onComplete: () => hot.destroy() });
  }
  const pf = FX_SHEETS.impactPuff;
  for (let i = 0; i < 3; i++) {
    const puff = scene.add.image(g.x + rand(-14, 14) * size, g.y + rand(-4, 4) * size, pf.key, pick(pf.frames))
      .setTint(IMPACT.dustColour).setAlpha(0.55).setScale(0.18 * size).setRotation(rand(-Math.PI, Math.PI)).setDepth(DEPTH.scorch + 1);
    scene.tweens.add({
      targets: puff, scaleX: 0.5 * size, scaleY: 0.34 * size, x: puff.x + rand(-26, 26) * size, y: puff.y - rand(8, 22) * size,
      alpha: 0, duration: rand(700, 1100), ease: 'Cubic.easeOut', onComplete: () => puff.destroy(),
    });
  }
}

/** A soft additive glow that swells and fades. */
function glow(scene: Phaser.Scene, x: number, y: number, px: number, colour: number, ms: number, depth: number): void {
  const g = scene.add.image(x, y, FX.dot).setTint(colour).setBlendMode(Phaser.BlendModes.ADD).setDepth(depth).setDisplaySize(px, px).setAlpha(0.9);
  scene.tweens.add({ targets: g, alpha: 0, scale: g.scale * 1.6, duration: ms, ease: 'Quad.easeOut', onComplete: () => g.destroy() });
}

/** Hot embers flung out that arc and fall, cooling as they go. */
function embers(scene: Phaser.Scene, x: number, y: number, size: number, n: number, depth: number, colours = [0xfff4c0, 0xffa030, 0xb02a08]): void {
  const e = scene.add.particles(x, y, FX.dot, {
    lifespan: { min: 380, max: 820 },
    speed: { min: 110 * size, max: 300 * size },
    angle: { min: 200, max: 340 },
    gravityY: 520,
    scale: { start: 0.09 * Math.sqrt(size), end: 0.02 },
    alpha: { start: 1, end: 0 },
    color: colours,
    blendMode: Phaser.BlendModes.ADD,
    emitting: false,
  }).setDepth(depth + 2e-4);
  e.explode(n);
  scene.time.delayedCall(1000, () => e.destroy());
}

/** Dark bits of debris thrown up that fall back. */
function debris(scene: Phaser.Scene, x: number, y: number, size: number, depth: number): void {
  const d = FX_SHEETS.impactDebris;
  const e = scene.add.particles(x, y, d.key, {
    frame: [0, 1, 2],
    lifespan: { min: 500, max: 800 },
    speed: { min: 90 * size, max: 220 * size },
    angle: { min: 215, max: 325 },
    gravityY: 700,
    scale: { start: 0.11 * size, end: 0.07 * size },
    rotate: { min: -180, max: 180 },
    alpha: { start: 0.9, end: 0 },
    tint: 0x2e2620,
    emitting: false,
  }).setDepth(depth + 1e-4);
  e.explode(3);
  scene.time.delayedCall(1000, () => e.destroy());
}

/** Dark smoke puffs that rise, spread and thin out. */
function smoke(scene: Phaser.Scene, x: number, y: number, size: number, n: number, depth: number, key = FX_SHEETS.impactSmoke, tint = 0x6a625a): void {
  for (let i = 0; i < n; i++) {
    const p = scene.add.image(x + rand(-8, 8) * size, y + rand(-6, 2) * size, key.key, pick(key.frames))
      .setScale(0.2 * size).setAlpha(0).setRotation(rand(-Math.PI, Math.PI)).setDepth(depth - 1e-4);
    if (key === FX_SHEETS.impactSoft) p.setTint(tint);
    const ms = rand(1100, 1600);
    scene.tweens.add({ targets: p, alpha: 0.75, duration: 140, delay: 60 * i });
    scene.tweens.add({
      targets: p, scale: 0.52 * size, y: p.y - rand(30, 50) * size, x: p.x + rand(-10, 14) * size, rotation: p.rotation + rand(-0.6, 0.6),
      alpha: 0, delay: 200 + 60 * i, duration: ms, ease: 'Sine.easeOut', onComplete: () => p.destroy(),
    });
  }
}

/** Kenney's painted flash, fire and smoke, with embers and debris. */
function painted(scene: Phaser.Scene, at: ImpactAt, depth: number): void {
  const { x, y, size } = at;
  const fl = FX_SHEETS.impactFlash;
  const flash = scene.add.image(x, y, fl.key, pick(fl.frames)).setBlendMode(Phaser.BlendModes.ADD).setScale(0.22 * size)
    .setRotation(rand(-Math.PI, Math.PI)).setDepth(depth + 1e-4);
  scene.tweens.add({ targets: flash, scale: 0.42 * size, alpha: 0, duration: 160, ease: 'Quad.easeOut', onComplete: () => flash.destroy() });
  const fi = FX_SHEETS.impactFire;
  const fire = scene.add.image(x, y, fi.key, pick(fi.frames)).setScale(0.16 * size).setRotation(rand(-Math.PI, Math.PI)).setDepth(depth);
  scene.tweens.add({ targets: fire, scale: 0.4 * size, rotation: fire.rotation + rand(-0.5, 0.5), y: y - 8 * size, duration: 360, ease: 'Cubic.easeOut' });
  scene.tweens.add({ targets: fire, alpha: 0, delay: 160, duration: 260, onComplete: () => fire.destroy() });
  smoke(scene, x, y - 4 * size, size, 2, depth);
  embers(scene, x, y, size, 10, depth);
  debris(scene, x, y, size, depth);
}

/** A bright pop, a dust ring racing out along the ground, sparks and a soft puff. */
function shockwave(scene: Phaser.Scene, at: ImpactAt, depth: number): void {
  const { x, y, size } = at;
  glow(scene, x, y, 70 * size, 0xfff0c0, 130, depth + 1e-4);
  glow(scene, x, y, 120 * size, 0xff8a2a, 260, depth);
  const soft = FX_SHEETS.impactSoft;
  const g = at.ground ?? { x, y: y + 14 * size };
  const ring = scene.add.image(g.x, g.y, soft.key, 2).setTint(IMPACT.dustColour).setAlpha(0.8).setDisplaySize(16 * size, 8 * size).setDepth(depth - 2e-4);
  scene.tweens.add({ targets: ring, displayWidth: 110 * size, displayHeight: 55 * size, alpha: 0, duration: 420, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
  const fi = FX_SHEETS.impactFire;
  const fire = scene.add.image(x, y, fi.key, pick(fi.frames)).setBlendMode(Phaser.BlendModes.ADD).setScale(0.12 * size).setDepth(depth);
  scene.tweens.add({ targets: fire, scale: 0.3 * size, alpha: 0, duration: 240, ease: 'Quad.easeOut', onComplete: () => fire.destroy() });
  smoke(scene, x, y - 4 * size, size, 2, depth, FX_SHEETS.impactSoft);
  embers(scene, x, y, size, 16, depth);
}

// --- the sci-fi looks ------------------------------------------------------------------------------------------------

/** The gravity look pulls in for this long before it pops. */
const GRAVITY_PULL_MS = 200;

type Sheet = (typeof FX_SHEETS)[keyof typeof FX_SHEETS];

/** One additive shape from a sheet that swells (or shrinks) to `to` and fades over `ms`. */
function shape(scene: Phaser.Scene, sheet: Sheet, frame: number, x: number, y: number, o: {
  from: number; to: number; ms: number; colour: number; depth: number; delay?: number; spin?: number; alpha?: number; squash?: number; ease?: string;
}): Phaser.GameObjects.Image {
  const sq = o.squash ?? 1;
  const im = scene.add.image(x, y, sheet.key, frame).setTint(o.colour).setBlendMode(Phaser.BlendModes.ADD)
    .setScale(o.from, o.from * sq).setAlpha(o.delay ? 0 : o.alpha ?? 1).setRotation(o.spin === undefined ? 0 : rand(-Math.PI, Math.PI)).setDepth(o.depth);
  if (o.delay) scene.tweens.add({ targets: im, alpha: o.alpha ?? 1, delay: o.delay, duration: 1 });
  scene.tweens.add({
    targets: im, scaleX: o.to, scaleY: o.to * sq, rotation: im.rotation + (o.spin ?? 0), alpha: 0, delay: o.delay ?? 0, duration: o.ms,
    ease: o.ease ?? 'Cubic.easeOut', onComplete: () => im.destroy(),
  });
  return im;
}

/** A ring racing out flat over the ground under the burst. */
function groundRing(scene: Phaser.Scene, at: ImpactAt, colour: number, frame: number, toPx: number, ms: number, depth: number, delay = 0): void {
  const g = at.ground ?? { x: at.x, y: at.y + 14 * at.size };
  const r = FX_SHEETS.impactRing;
  shape(scene, r, frame, g.x, g.y, { from: (12 * at.size) / 128, to: (toPx * at.size) / 128, ms, colour, depth: depth - 2e-4, squash: 0.5, delay });
}

/** Jagged lightning from (x, y) out to random points around it, flickering twice. */
function bolts(scene: Phaser.Scene, x: number, y: number, size: number, colour: number, depth: number): void {
  for (const at of [0, 70, 150]) {
    scene.time.delayedCall(at, () => {
      const g = scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD).setDepth(depth + 3e-4);
      for (let b = 0; b < 3; b++) {
        const a = rand(0, Math.PI * 2);
        const len = rand(24, 46) * size;
        const pts: Point[] = [{ x, y }];
        for (let i = 1; i <= 6; i++) {
          const k = i / 6;
          pts.push({ x: x + Math.cos(a) * len * k + rand(-6, 6) * size, y: y + Math.sin(a) * len * k * 0.6 + rand(-6, 6) * size });
        }
        g.lineStyle(5 * size, colour, 0.35).strokePoints(pts);
        g.lineStyle(1.6 * size, 0xffffff, 1).strokePoints(pts);
      }
      scene.tweens.add({ targets: g, alpha: 0, duration: 110, onComplete: () => g.destroy() });
    });
  }
}

/** A white-cyan core, a sharp ring racing out over the ground, crackling arcs, cyan sparks and a violet haze. */
function plasma(scene: Phaser.Scene, at: ImpactAt, depth: number): void {
  const { x, y, size } = at;
  const cyan = 0x40d8ff;
  glow(scene, x, y, 56 * size, 0xe8fcff, 140, depth + 2e-4);
  shape(scene, FX_SHEETS.impactEnergy, pick(3), x, y, { from: 0.12 * size, to: 0.42 * size, ms: 320, colour: cyan, depth: depth + 1e-4, spin: 0.8 });
  shape(scene, FX_SHEETS.impactArc, pick(4), x, y, { from: 0.3 * size, to: 0.5 * size, ms: 220, colour: 0x9ef0ff, depth: depth + 1e-4, spin: 0.3 });
  shape(scene, FX_SHEETS.impactArc, pick(4), x, y, { from: 0.3 * size, to: 0.55 * size, ms: 220, colour: 0x9ef0ff, depth: depth + 1e-4, spin: 0.3, delay: 110 });
  groundRing(scene, at, cyan, 1, 120, 380, depth);
  embers(scene, x, y, size, 14, depth, [0xffffff, 0x80e8ff, 0x2070ff]);
  smoke(scene, x, y - 4 * size, size, 2, depth, FX_SHEETS.impactSoft, 0x5a3a8a);
}

/** Jagged lightning crawling over what it hits, a hard lens flare, the arcs flickering. */
function ion(scene: Phaser.Scene, at: ImpactAt, depth: number): void {
  const { x, y, size } = at;
  const blue = 0x6a9cff;
  shape(scene, FX_SHEETS.impactFlare, pick(4), x, y, { from: 0.5 * size, to: 0.8 * size, ms: 200, colour: 0xe0ecff, depth: depth + 2e-4 });
  glow(scene, x, y, 90 * size, blue, 300, depth);
  for (let i = 0; i < 3; i++) {
    shape(scene, FX_SHEETS.impactArc, pick(4), x, y, { from: 0.42 * size, to: 0.5 * size, ms: 90, colour: 0xb0c8ff, depth: depth + 1e-4, spin: 0, delay: i * 80 });
  }
  bolts(scene, x, y, size, blue, depth);
  groundRing(scene, at, blue, 0, 70, 260, depth);
  embers(scene, x, y, size, 8, depth, [0xffffff, 0xa0c0ff, 0x4060ff]);
}

/** Sparks and a swirl sucked inwards, then a pop with a flare and a ring. */
function gravity(scene: Phaser.Scene, at: ImpactAt, depth: number): void {
  const { x, y, size } = at;
  const violet = 0xb060ff;
  // the pull: a swirl spinning down to nothing, and specks drawn in from all round
  shape(scene, FX_SHEETS.impactTwirl, pick(3), x, y, { from: 0.55 * size, to: 0.05 * size, ms: GRAVITY_PULL_MS, colour: violet, depth, spin: 4, alpha: 0.9, ease: 'Quad.easeIn' });
  for (let i = 0; i < 14; i++) {
    const a = rand(0, Math.PI * 2), r = rand(40, 70) * size;
    const p = scene.add.image(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.6, FX.dot).setTint(0xe0b0ff).setBlendMode(Phaser.BlendModes.ADD)
      .setScale(0.06 * size).setDepth(depth + 1e-4);
    scene.tweens.add({ targets: p, x, y, scale: 0.02, duration: GRAVITY_PULL_MS, ease: 'Quad.easeIn', onComplete: () => p.destroy() });
  }
  // the pop
  scene.time.delayedCall(GRAVITY_PULL_MS, () => {
    // a dark core for a moment: the hole it opened
    const core = scene.add.image(x, y, FX.dot).setTint(0x12001e).setDisplaySize(34 * size, 34 * size).setAlpha(0.85).setDepth(depth);
    scene.tweens.add({ targets: core, alpha: 0, scale: core.scale * 0.3, duration: 260, ease: 'Quad.easeIn', onComplete: () => core.destroy() });
    shape(scene, FX_SHEETS.impactFlare, 4 + pick(2), x, y, { from: 0.4 * size, to: 0.75 * size, ms: 240, colour: 0xf0d8ff, depth: depth + 2e-4, spin: 0.4 });
    shape(scene, FX_SHEETS.impactRing, 2, x, y, { from: 0.1 * size, to: 0.7 * size, ms: 340, colour: violet, depth: depth + 1e-4 });
    groundRing(scene, at, violet, 1, 110, 420, depth);
    embers(scene, x, y, size, 12, depth, [0xffffff, 0xd090ff, 0x6020c0]);
  });
}

/** A white-hot star with beam spikes shooting out, molten slag and a dust ring. */
function railgun(scene: Phaser.Scene, at: ImpactAt, depth: number): void {
  const { x, y, size } = at;
  shape(scene, FX_SHEETS.impactFlare, pick(2), x, y, { from: 0.55 * size, to: 0.9 * size, ms: 170, colour: 0xffffff, depth: depth + 2e-4 });
  glow(scene, x, y, 60 * size, 0xffe0a0, 200, depth + 1e-4);
  // beam spikes: streaks shot outwards from the point it struck
  const tr = FX_SHEETS.impactTrace;
  for (let i = 0; i < 6; i++) {
    const a = rand(0, Math.PI * 2);
    const len = rand(30, 50) * size;
    const im = scene.add.image(x, y, tr.key, pick(tr.frames)).setTint(0xffd890).setBlendMode(Phaser.BlendModes.ADD)
      .setRotation(a + Math.PI / 2).setScale(0.12 * size, 0.08 * size).setDepth(depth + 1e-4);
    scene.tweens.add({
      targets: im, x: x + Math.cos(a) * len, y: y + Math.sin(a) * len * 0.6, scaleY: 0.32 * size, alpha: 0, duration: 200, ease: 'Cubic.easeOut',
      onComplete: () => im.destroy(),
    });
  }
  embers(scene, x, y, size, 18, depth, [0xffffff, 0xffb040, 0xc03a08]);
  debris(scene, x, y, size, depth);
  groundRing(scene, at, IMPACT.dustColour, 0, 90, 380, depth);
  smoke(scene, x, y - 4 * size, size, 1, depth, FX_SHEETS.impactSoft);
}
