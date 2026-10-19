import Phaser from 'phaser';
import { DEPTH } from '../../config/game';
import type { Point } from '../../core/geometry';
import type { Flashable } from '../Impact';
import { FX, FX_SHEETS, ensureFxTextures } from '../fxTextures';
import type { Look } from './kit';

/**
 * The Jackal's light cannon (world px and ms): one quick, sharp round. A crisp white flash at the barrel with a wisp
 * of smoke, a short white-hot streak racing to the target, and a small bright pop where it lands: a star flash, a
 * spray of sparks, a puff of smoke and, on open ground, a little dirt and a small scorch. Light and snappy next to
 * the Ram's battle cannon (shots/battleShell.ts).
 */
export const LIGHT_SHELL = {
  /** How fast the round flies, and the length of its streak. */
  speed: 3800,
  streak: 38,
  /** The streak: a white-hot core and a pale glow round it (widths in px). */
  core: 0xffffff,
  coreWidth: 2.6,
  glow: 0xfff0c8,
  glowWidth: 8,
  /**
   * The muzzle flash: a small star thrown forward along the barrel (`forward` px long, `side` px across), there for
   * `flashMs`, over a soft glow `flashGlow` px wide.
   */
  flashMs: 60,
  forward: 30,
  side: 12,
  flashGlow: 44,
  flashColour: 0xfff8ec,
  /** A wisp of smoke left at the barrel: puffs, how long they last and how big they grow (of a 128 px puff). */
  wisps: 2,
  wispMs: [500, 750] as [number, number],
  wispScale: [0.05, 0.16] as [number, number],
  wispAlpha: 0.35,
  wispColour: 0xd8d4cc,
  /** Where it lands: a white star flash (of a 128 px flare) and a warm glow behind it. */
  popScale: [0.26, 0.44] as [number, number],
  popMs: 120,
  popGlow: 70,
  popGlowColour: 0xffe2a8,
  /** Sparks flung out (they fall and cool), and one small puff of smoke. */
  sparks: 9,
  smokeScale: [0.1, 0.3] as [number, number],
  smokeMs: 900,
  smokeColour: 0x7a746c,
  /** What it hits flashes white for a moment. */
  hitFlashMs: 90,
  hitFlashAlpha: 0.6,
  hitFlashColour: 0xffffff,
  /** On open ground: a few clods of dirt, two dust puffs and a small scorch that fades. */
  dirt: 2,
  dust: 0xb4a07e,
  scorchPx: 34,
  scorchAlpha: 0.45,
  scorchMs: 5000,
  scorchFadeMs: 2500,
  scorchColour: 0x1c1610,
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = (n: number) => Math.floor(Math.random() * n);

type Emitter = Phaser.GameObjects.Particles.ParticleEmitter;

/** Each scene's emitters for this look: barrel wisps, hit sparks and dirt. Made on its first shot, again if destroyed. */
const EMITTERS = new WeakMap<Phaser.Scene, { wisp: Emitter; sparks: Emitter; dirt: Emitter }>();

function emitters(scene: Phaser.Scene): { wisp: Emitter; sparks: Emitter; dirt: Emitter } {
  const had = EMITTERS.get(scene);
  if (had && had.wisp.scene && had.sparks.scene && had.dirt.scene) return had;
  if (had) for (const e of [had.wisp, had.sparks, had.dirt]) e.destroy();
  const c = LIGHT_SHELL;
  const soft = FX_SHEETS.impactSoft;
  const sheet = scene.textures.exists(soft.key);
  const made = {
    wisp: scene.add.particles(0, 0, sheet ? soft.key : FX.smoke, {
      ...(sheet ? { frame: [0, 1] } : {}),
      lifespan: { min: c.wispMs[0], max: c.wispMs[1] },
      scale: { start: c.wispScale[0], end: c.wispScale[1], ease: 'Quad.easeOut' },
      alpha: { start: c.wispAlpha, end: 0, ease: 'Quad.easeIn' },
      rotate: { min: -180, max: 180 },
      speed: 0,
      tint: c.wispColour,
      emitting: false,
    }).setDepth(DEPTH.ui - 7),
    sparks: scene.add.particles(0, 0, FX.dot, {
      lifespan: { min: 180, max: 380 },
      speed: { min: 140, max: 360 },
      angle: { min: 190, max: 350 },
      gravityY: 700,
      scale: { start: 0.08, end: 0.01 },
      alpha: { start: 1, end: 0 },
      color: [0xffffff, 0xfff0b0, 0xffa040],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }).setDepth(DEPTH.ui - 5.5),
    dirt: scene.add.particles(0, 0, FX_SHEETS.impactDebris.key, {
      frame: [0, 1, 2],
      lifespan: { min: 380, max: 600 },
      speed: { min: 70, max: 160 },
      angle: { min: 225, max: 315 },
      gravityY: 700,
      scale: { start: 0.08, end: 0.05 },
      rotate: { min: -180, max: 180 },
      alpha: { start: 0.9, end: 0 },
      tint: 0x3a3026,
      emitting: false,
    }).setDepth(DEPTH.ui - 6.5),
  };
  EMITTERS.set(scene, made);
  return made;
}

/** The muzzle flash: a small star thrown forward along the barrel (`u`), shrinking as `t` runs from 1 to 0. */
function star(g: Phaser.GameObjects.Graphics, at: Point, u: Point, t: number): void {
  const c = LIGHT_SHELL;
  const k = (0.55 + 0.45 * t) * rand(0.85, 1.15);
  const spikes: [number, number, number][] = [[0, c.forward, 4], [Math.PI / 2, c.side, 2.5], [-Math.PI / 2, c.side, 2.5]];
  for (const [layer, colour, alpha] of [[1, c.glow, 0.6], [0.55, c.flashColour, 1]] as const) {
    g.fillStyle(colour, alpha * t);
    for (const [turn, len, w] of spikes) {
      const a = Math.atan2(u.y, u.x) + turn;
      const dx = Math.cos(a), dy = Math.sin(a);
      const l = len * k * layer, hw = w * layer * 1.4;
      g.fillTriangle(at.x - dy * hw, at.y + dx * hw, at.x + dy * hw, at.y - dx * hw, at.x + dx * l, at.y + dy * l);
    }
    g.fillCircle(at.x, at.y, 5 * layer * k);
  }
}

/** A soft additive glow that swells a little and fades. */
function glow(scene: Phaser.Scene, at: Point, px: number, colour: number, ms: number, depth: number): void {
  const im = scene.add.image(at.x, at.y, FX.dot).setTint(colour).setBlendMode(Phaser.BlendModes.ADD).setDepth(depth).setDisplaySize(px, px);
  scene.tweens.add({ targets: im, alpha: 0, scale: im.scale * 1.4, duration: ms, ease: 'Quad.easeOut', onComplete: () => im.destroy() });
}

/** What it hits glows white for a moment: a white copy of each of its sprites over it, fading out. */
function hitFlash(scene: Phaser.Scene, targets: Flashable[] = []): void {
  const c = LIGHT_SHELL;
  for (const s of targets) {
    if (!s.active || !s.visible) continue;
    const im = scene.add.image(s.x, s.y, s.texture.key, s.frame.name)
      .setOrigin(s.originX, s.originY).setScale(s.scaleX, s.scaleY).setFlip(s.flipX, s.flipY)
      .setDepth(s.depth + 1e-4).setTintFill(c.hitFlashColour).setAlpha(c.hitFlashAlpha).setBlendMode(Phaser.BlendModes.ADD);
    scene.tweens.add({ targets: im, alpha: 0, duration: c.hitFlashMs, ease: 'Quad.easeOut', onComplete: () => im.destroy() });
  }
}

/** On open ground: a small scorch mark that stays a while and fades, and two dust puffs. */
function groundMarks(scene: Phaser.Scene, at: Point): void {
  const c = LIGHT_SHELL;
  const sc = FX_SHEETS.impactScorch;
  const px = c.scorchPx * rand(0.85, 1.15);
  const mark = scene.add.image(at.x, at.y, sc.key, pick(sc.frames)).setDisplaySize(px, px / 2).setFlipX(Math.random() < 0.5)
    .setTint(c.scorchColour).setAlpha(0).setDepth(DEPTH.scorch);
  scene.tweens.add({ targets: mark, alpha: c.scorchAlpha, duration: 100 });
  scene.tweens.add({ targets: mark, alpha: 0, delay: c.scorchMs, duration: c.scorchFadeMs, onComplete: () => mark.destroy() });
  const pf = FX_SHEETS.impactPuff;
  for (let i = 0; i < 2; i++) {
    const puff = scene.add.image(at.x + rand(-8, 8), at.y + rand(-3, 3), pf.key, pick(pf.frames))
      .setTint(c.dust).setAlpha(0.5).setScale(0.1).setRotation(rand(-Math.PI, Math.PI)).setDepth(DEPTH.scorch + 1);
    scene.tweens.add({
      targets: puff, scaleX: 0.3, scaleY: 0.2, x: puff.x + rand(-16, 16), y: puff.y - rand(6, 14), alpha: 0,
      duration: rand(500, 750), ease: 'Cubic.easeOut', onComplete: () => puff.destroy(),
    });
  }
}

/** Where the round lands: a white star flash, sparks, a little smoke, and dirt and a scorch on open ground. */
function pop(scene: Phaser.Scene, at: Point, depth: number, targets?: Flashable[], ground?: Point): void {
  const c = LIGHT_SHELL;
  hitFlash(scene, targets);
  glow(scene, at, c.popGlow, c.popGlowColour, 160, depth);
  const fl = FX_SHEETS.impactFlare;
  const flare = scene.add.image(at.x, at.y, fl.key, 1).setBlendMode(Phaser.BlendModes.ADD).setTint(0xffffff)
    .setScale(c.popScale[0]).setRotation(rand(-0.3, 0.3)).setDepth(depth + 2e-4);
  scene.tweens.add({ targets: flare, scale: c.popScale[1], alpha: 0, duration: c.popMs, ease: 'Quad.easeOut', onComplete: () => flare.destroy() });
  const fs = FX_SHEETS.impactFlash;
  const flash = scene.add.image(at.x, at.y, fs.key, pick(fs.frames)).setBlendMode(Phaser.BlendModes.ADD).setTint(0xfff6e0)
    .setScale(0.12).setRotation(rand(-Math.PI, Math.PI)).setDepth(depth + 1e-4);
  scene.tweens.add({ targets: flash, scale: 0.26, alpha: 0, duration: c.popMs + 30, ease: 'Quad.easeOut', onComplete: () => flash.destroy() });
  // one grey puff that rises and thins out
  const so = FX_SHEETS.impactSoft;
  const puff = scene.add.image(at.x, at.y - 4, so.key, pick(2)).setTint(c.smokeColour).setScale(c.smokeScale[0]).setAlpha(0)
    .setRotation(rand(-Math.PI, Math.PI)).setDepth(depth - 1e-4);
  scene.tweens.add({ targets: puff, alpha: 0.6, duration: 90 });
  scene.tweens.add({
    targets: puff, scale: c.smokeScale[1], y: puff.y - rand(18, 28), x: puff.x + rand(-6, 8), rotation: puff.rotation + rand(-0.5, 0.5),
    alpha: 0, delay: 90, duration: c.smokeMs, ease: 'Sine.easeOut', onComplete: () => puff.destroy(),
  });
  const e = emitters(scene);
  e.sparks.emitParticleAt(at.x, at.y, c.sparks);
  if (ground) {
    e.dirt.emitParticleAt(ground.x, ground.y - 4, c.dirt);
    groundMarks(scene, ground);
  }
}

/** The Jackal's light cannon: one quick, sharp round. */
export const lightShell: Look = (kit, s) => {
  const c = LIGHT_SHELL;
  const scene = kit.scene;
  ensureFxTextures(scene);
  const { from, to } = s;
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const u = { x: (to.x - from.x) / len, y: (to.y - from.y) / len };
  const flight = (len / c.speed) * 1000;
  const depth = s.hit?.depth !== undefined ? s.hit.depth + 0.01 : DEPTH.ui - 6;
  if (s.flash) {
    glow(scene, from, c.flashGlow, c.flashColour, 90, DEPTH.ui - 5);
    const wisp = emitters(scene).wisp;
    for (let i = 0; i < c.wisps; i++) {
      const p = wisp.emitParticleAt(from.x + u.x * 6, from.y + u.y * 6, 1);
      if (p) {
        const v = rand(25, 55);
        p.velocityX = u.x * v + rand(-8, 8);
        p.velocityY = u.y * v - rand(6, 16);
      }
    }
  }
  let age = 0;
  let landed = false;
  kit.add({
    step(ms, g) {
      age += ms;
      if (s.flash && age < c.flashMs) star(g, from, u, 1 - age / c.flashMs);
      if (!landed) {
        const k = Math.min(1, age / flight);
        const head = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
        const t = Math.max(0, k - c.streak / len);
        const tail = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
        g.lineStyle(c.glowWidth, c.glow, 0.35).lineBetween(tail.x, tail.y, head.x, head.y);
        g.lineStyle(c.coreWidth, c.core, 1).lineBetween(tail.x, tail.y, head.x, head.y);
        g.fillStyle(c.core, 1).fillCircle(head.x, head.y, c.coreWidth);
        if (k >= 1) {
          landed = true;
          kit.landed('shell', to);
          pop(scene, to, depth, s.hit?.targets, s.ground);
        }
      }
      return !landed || age < c.flashMs;
    },
  });
};
