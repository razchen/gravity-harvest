import Phaser from 'phaser';
import { DEPTH } from '../../config/game';
import type { Point } from '../../core/geometry';
import type { Flashable } from '../Impact';
import { FX, FX_SHEETS, ensureFxTextures } from '../fxTextures';
import type { Look } from './kit';

/**
 * The Ram's battle cannon (world px and ms): a heavy round, clearly bigger than the Jackal's (shots/lightShell.ts).
 * A big star of flame bursts from the barrel and a ring of smoke is blown out of it, with puffs that drift and linger;
 * a heavy glowing shell flies to the target with a short orange trail; where it lands, a blast of fire, smoke, dirt
 * and embers, what it hits flashes hot, and on open ground a dust ring races out and a scorch is left that cools.
 */
export const BATTLE_SHELL = {
  /** How fast the shell flies (slower than the Jackal's: it reads heavier). */
  speed: 2500,
  /** The shell: a hot core and an orange glow round it (radii, px). */
  core: 0xfff6dc,
  coreRadius: 4.2,
  glow: 0xffa040,
  glowRadius: 11,
  /** Its trail: `trail` px long, from `trailHot` at the shell cooling to `trailCool`; it fades out over `trailFadeMs` after it lands. */
  trail: 90,
  trailWidth: 7,
  trailHot: 0xffb050,
  trailCool: 0xa02808,
  trailFadeMs: 140,
  /**
   * The muzzle flash: a star of flame thrown forward along the barrel (`forward` px), out to each side from the muzzle
   * brake (`side`) and on the diagonals between (`diagonal`), there for `flashMs`, flickering; over a glow `flashGlow` px wide.
   */
  flashMs: 110,
  forward: 72,
  side: 34,
  diagonal: 44,
  flashOuter: 0xff8a24,
  flashInner: 0xfff2c0,
  flashGlow: 120,
  flashGlowColour: 0xffa850,
  /**
   * The smoke ring blown out of the barrel: it moves `ringPush` px forward, grows from `ringPx[0]` to `ringPx[1]` across
   * and fades over `ringMs`, seen edge-on or face-on depending on where the barrel points.
   */
  ringPush: 46,
  ringPx: [16, 74] as [number, number],
  ringMs: 1300,
  ringAlpha: 0.55,
  /**
   * Smoke puffs blown out round the ring and forward: `puffs` of them, slowed by the air (`drag`, per s), then drifting
   * up (`rise`, px/s²) and with the wind (`wind`); how long they linger and how big they grow (of a 128 px puff).
   */
  puffs: 9,
  ringSpeed: 150,
  pushSpeed: 200,
  drag: 5,
  rise: 70,
  wind: 30,
  puffMs: [1500, 2300] as [number, number],
  puffScale: [0.07, 0.34] as [number, number],
  puffAlpha: 0.5,
  smoke: 0xd2ccc2,
  /** The blast where it lands: a flash and a white-hot core star (of a 128 px sheet), a glow, and fire (two painted flames). */
  blastFlash: [0.24, 0.62] as [number, number],
  blastMs: 200,
  blastGlow: 170,
  blastGlowColour: 0xffa040,
  fireScale: [0.2, 0.58] as [number, number],
  fireMs: 520,
  /** Dark smoke rising from the blast: puffs, and how long they hang. */
  smokePuffs: 3,
  smokeMs: [1500, 2100] as [number, number],
  /** Embers flung out, and bits of debris (dirt on open ground, dark metal off a building). */
  embers: 16,
  debris: 6,
  dirt: 0x3a2e22,
  metal: 0x2a2826,
  /** What it hits glows hot for a moment. */
  hitFlashMs: 150,
  hitFlashAlpha: 0.8,
  hitFlashColour: 0xffe2b0,
  /** On open ground: a dust ring racing out (`dustRingPx` across), dust puffs, and a scorch that glows as it cools, stays, then fades. */
  dust: 0xb4a07e,
  dustRingPx: 170,
  scorchPx: 74,
  scorchAlpha: 0.55,
  scorchMs: 7000,
  scorchFadeMs: 3000,
  scorchColour: 0x1c1610,
  molten: 0xff7a20,
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = (n: number) => Math.floor(Math.random() * n);

type Emitter = Phaser.GameObjects.Particles.ParticleEmitter;
type Emitters = { smoke: Emitter; embers: Emitter; debris: Emitter };

/** Each scene's emitters for this look: muzzle smoke, embers and debris. Made on its first shot, again if destroyed. */
const EMITTERS = new WeakMap<Phaser.Scene, Emitters>();

function emitters(scene: Phaser.Scene): Emitters {
  const had = EMITTERS.get(scene);
  if (had && had.smoke.scene && had.embers.scene && had.debris.scene) return had;
  if (had) for (const e of [had.smoke, had.embers, had.debris]) e.destroy();
  const c = BATTLE_SHELL;
  const soft = FX_SHEETS.impactSoft;
  const sheet = scene.textures.exists(soft.key);
  const made: Emitters = {
    // blown out fast, slowed by the air, then drifting up and downwind: each puff's velocity is set as it's emitted
    smoke: scene.add.particles(0, 0, sheet ? soft.key : FX.smoke, {
      ...(sheet ? { frame: [0, 1] } : {}),
      lifespan: { min: c.puffMs[0], max: c.puffMs[1] },
      scale: { start: c.puffScale[0], end: c.puffScale[1], ease: 'Cubic.easeOut' },
      alpha: { start: c.puffAlpha, end: 0, ease: 'Quad.easeIn' },
      rotate: { min: -180, max: 180 },
      speed: 0,
      accelerationX: { onEmit: () => 0, onUpdate: (p) => -p.velocityX * c.drag + c.wind },
      accelerationY: { onEmit: () => 0, onUpdate: (p) => -p.velocityY * c.drag - c.rise },
      tint: c.smoke,
      emitting: false,
    }).setDepth(DEPTH.ui - 7),
    embers: scene.add.particles(0, 0, FX.dot, {
      lifespan: { min: 420, max: 900 },
      speed: { min: 140, max: 380 },
      angle: { min: 200, max: 340 },
      gravityY: 560,
      scale: { start: 0.11, end: 0.02 },
      alpha: { start: 1, end: 0 },
      color: [0xfff4c0, 0xffa030, 0xb02a08],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }).setDepth(DEPTH.ui - 5.5),
    debris: scene.add.particles(0, 0, FX_SHEETS.impactDebris.key, {
      frame: [0, 1, 2],
      lifespan: { min: 550, max: 850 },
      speed: { min: 110, max: 260 },
      angle: { min: 215, max: 325 },
      gravityY: 720,
      scale: { start: 0.13, end: 0.08 },
      rotate: { min: -180, max: 180 },
      alpha: { start: 0.95, end: 0 },
      tint: c.dirt,
      emitting: false,
    }).setDepth(DEPTH.ui - 6.5),
  };
  EMITTERS.set(scene, made);
  return made;
}

/** A colour `k` of the way from `a` to `b`. */
function mix(a: number, b: number, k: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** The muzzle flash: a star of flame along the barrel (`u`), out to the sides and on the diagonals, as `t` runs from 1 to 0. */
function star(g: Phaser.GameObjects.Graphics, at: Point, u: Point, t: number): void {
  const c = BATTLE_SHELL;
  const base = Math.atan2(u.y, u.x);
  // [turn off the barrel, length, half-width at the root]
  const spikes: [number, number, number][] = [
    [0, c.forward, 9], [Math.PI / 2, c.side, 6], [-Math.PI / 2, c.side, 6],
    [0.55, c.diagonal, 5], [-0.55, c.diagonal, 5], [Math.PI, c.side * 0.35, 5],
  ];
  const grow = 0.6 + 0.4 * Math.sqrt(t);
  for (const [layer, colour, alpha] of [[1, c.flashOuter, 0.7], [0.55, c.flashInner, 1]] as const) {
    g.fillStyle(colour, alpha * t);
    for (const [turn, len, w] of spikes) {
      const a = base + turn + rand(-0.06, 0.06);
      const dx = Math.cos(a), dy = Math.sin(a);
      const l = len * layer * grow * rand(0.8, 1.15), hw = w * layer;
      g.fillTriangle(at.x - dy * hw, at.y + dx * hw, at.x + dy * hw, at.y - dx * hw, at.x + dx * l, at.y + dy * l);
    }
    g.fillCircle(at.x + u.x * 6, at.y + u.y * 6, 13 * layer * grow);
  }
}

/** A soft additive glow that swells a little and fades. */
function glow(scene: Phaser.Scene, at: Point, px: number, colour: number, ms: number, depth: number): void {
  const im = scene.add.image(at.x, at.y, FX.dot).setTint(colour).setBlendMode(Phaser.BlendModes.ADD).setDepth(depth).setDisplaySize(px, px).setAlpha(0.9);
  scene.tweens.add({ targets: im, alpha: 0, scale: im.scale * 1.5, duration: ms, ease: 'Quad.easeOut', onComplete: () => im.destroy() });
}

/**
 * The smoke blown out of the barrel: a ring that pushes forward and spreads, and puffs thrown out round it and forward
 * that slow, then drift and linger. The ring lies across the barrel, so it's seen nearly edge-on when the barrel points
 * across the screen and face-on when it points at or away from the viewer.
 */
function muzzleSmoke(scene: Phaser.Scene, at: Point, u: Point): void {
  const c = BATTLE_SHELL;
  // the barrel on the ground (the screen squashes it to half height), and how much it points at the viewer
  const gx = u.x, gy = u.y * 2;
  const gl = Math.hypot(gx, gy) || 1;
  const facing = Math.max(0.22, (Math.abs(gy) / gl) * 0.87);
  const soft = FX_SHEETS.impactSoft;
  if (scene.textures.exists(soft.key)) {
    const ring = scene.add.image(at.x, at.y, soft.key, 2).setTint(c.smoke).setRotation(Math.atan2(u.y, u.x))
      .setDisplaySize(c.ringPx[0] * facing, c.ringPx[0]).setAlpha(c.ringAlpha).setDepth(DEPTH.ui - 6.9);
    scene.tweens.add({
      targets: ring, x: at.x + u.x * c.ringPush, y: at.y + u.y * c.ringPush - 6,
      displayWidth: c.ringPx[1] * facing, displayHeight: c.ringPx[1], duration: c.ringMs, ease: 'Cubic.easeOut',
    });
    scene.tweens.add({ targets: ring, alpha: 0, duration: c.ringMs, ease: 'Quad.easeIn', onComplete: () => ring.destroy() });
  }
  // round the ring: across the barrel on the ground (the screen's perpendicular, squashed) and straight up
  const px = -gy / gl, py = (gx / gl) * 0.5;
  const smoke = emitters(scene).smoke;
  // most round the ring, the last three blown straight on out of the barrel
  for (let i = 0; i < c.puffs; i++) {
    const p = smoke.emitParticleAt(at.x + u.x * 4, at.y + u.y * 4, 1);
    if (!p) break;
    const round = i < c.puffs - 3;
    const a = (i / c.puffs) * Math.PI * 2 + rand(-0.3, 0.3);
    const out = round ? c.ringSpeed * rand(0.8, 1.15) : c.ringSpeed * 0.3;
    const push = round ? c.pushSpeed * rand(0.7, 1) : c.pushSpeed * rand(1.4, 1.9);
    p.velocityX = u.x * push + px * Math.cos(a) * out;
    p.velocityY = u.y * push + py * Math.cos(a) * out - Math.sin(a) * out * 0.87;
  }
}

/** The shell in flight: its trail, cooling from the shell back, then the glowing shell itself. */
function drawShell(g: Phaser.GameObjects.Graphics, u: Point, travelled: number, head: Point, fade: number): void {
  const c = BATTLE_SHELL;
  const tail = Math.min(c.trail, travelled);
  const steps = 6;
  for (let i = 0; i < steps; i++) {
    const k0 = i / steps, k1 = (i + 1) / steps;
    const d0 = tail * (1 - k0), d1 = tail * (1 - k1);
    g.lineStyle(c.trailWidth * (0.3 + 0.7 * k1), mix(c.trailCool, c.trailHot, k1), 0.85 * k1 * fade)
      .lineBetween(head.x - u.x * d0, head.y - u.y * d0, head.x - u.x * d1, head.y - u.y * d1);
  }
  if (fade < 1) return;
  const hot = Math.min(24, travelled);
  g.lineStyle(2.4, c.core, 0.9).lineBetween(head.x - u.x * hot, head.y - u.y * hot, head.x, head.y);
  g.fillStyle(c.glow, 0.45).fillCircle(head.x, head.y, c.glowRadius);
  g.fillStyle(c.core, 1).fillCircle(head.x, head.y, c.coreRadius);
}

/** What it hits glows hot for a moment: a tinted copy of each of its sprites over it, fading out. */
function hitFlash(scene: Phaser.Scene, targets: Flashable[] = []): void {
  const c = BATTLE_SHELL;
  for (const s of targets) {
    if (!s.active || !s.visible) continue;
    const im = scene.add.image(s.x, s.y, s.texture.key, s.frame.name)
      .setOrigin(s.originX, s.originY).setScale(s.scaleX, s.scaleY).setFlip(s.flipX, s.flipY)
      .setDepth(s.depth + 1e-4).setTintFill(c.hitFlashColour).setAlpha(c.hitFlashAlpha).setBlendMode(Phaser.BlendModes.ADD);
    scene.tweens.add({ targets: im, alpha: 0, duration: c.hitFlashMs, ease: 'Quad.easeOut', onComplete: () => im.destroy() });
  }
}

/** On open ground: a dust ring racing out, dust puffs, and a scorch that glows as it cools, stays a while, then fades. */
function groundMarks(scene: Phaser.Scene, at: Point, depth: number): void {
  const c = BATTLE_SHELL;
  const sc = FX_SHEETS.impactScorch;
  const px = c.scorchPx * rand(0.9, 1.15);
  const mark = scene.add.image(at.x, at.y, sc.key, pick(sc.frames)).setDisplaySize(px, px / 2).setFlipX(Math.random() < 0.5)
    .setTint(c.scorchColour).setAlpha(0).setDepth(DEPTH.scorch);
  scene.tweens.add({ targets: mark, alpha: c.scorchAlpha, duration: 120 });
  scene.tweens.add({ targets: mark, alpha: 0, delay: c.scorchMs, duration: c.scorchFadeMs, onComplete: () => mark.destroy() });
  const hot = scene.add.image(at.x, at.y, sc.key, mark.frame.name).setDisplaySize(px * 0.65, px * 0.32).setFlipX(mark.flipX)
    .setTint(c.molten).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.9).setDepth(DEPTH.scorch + 0.5);
  scene.tweens.add({ targets: hot, alpha: 0, duration: 1200, ease: 'Quad.easeIn', onComplete: () => hot.destroy() });
  const soft = FX_SHEETS.impactSoft;
  const ring = scene.add.image(at.x, at.y, soft.key, 2).setTint(c.dust).setAlpha(0.75).setDisplaySize(20, 10).setDepth(depth - 2e-4);
  scene.tweens.add({
    targets: ring, displayWidth: c.dustRingPx, displayHeight: c.dustRingPx / 2, alpha: 0, duration: 480, ease: 'Cubic.easeOut',
    onComplete: () => ring.destroy(),
  });
  const pf = FX_SHEETS.impactPuff;
  for (let i = 0; i < 3; i++) {
    const puff = scene.add.image(at.x + rand(-16, 16), at.y + rand(-4, 4), pf.key, pick(pf.frames))
      .setTint(c.dust).setAlpha(0.6).setScale(0.2).setRotation(rand(-Math.PI, Math.PI)).setDepth(DEPTH.scorch + 1);
    scene.tweens.add({
      targets: puff, scaleX: 0.6, scaleY: 0.4, x: puff.x + rand(-34, 34), y: puff.y - rand(10, 28), alpha: 0,
      duration: rand(800, 1200), ease: 'Cubic.easeOut', onComplete: () => puff.destroy(),
    });
  }
}

/** Where the shell lands: a flash and a hot core, fire, dark smoke, embers and debris, and marks on open ground. */
function blast(scene: Phaser.Scene, at: Point, depth: number, targets?: Flashable[], ground?: Point): void {
  const c = BATTLE_SHELL;
  hitFlash(scene, targets);
  glow(scene, at, c.blastGlow, c.blastGlowColour, 300, depth);
  const fl = FX_SHEETS.impactFlare;
  const core = scene.add.image(at.x, at.y, fl.key, 0).setBlendMode(Phaser.BlendModes.ADD).setTint(0xfff4dc)
    .setScale(0.5).setRotation(rand(-0.2, 0.2)).setDepth(depth + 3e-4);
  scene.tweens.add({ targets: core, scale: 0.85, alpha: 0, duration: 140, ease: 'Quad.easeOut', onComplete: () => core.destroy() });
  const fs = FX_SHEETS.impactFlash;
  const flash = scene.add.image(at.x, at.y, fs.key, pick(fs.frames)).setBlendMode(Phaser.BlendModes.ADD)
    .setScale(c.blastFlash[0]).setRotation(rand(-Math.PI, Math.PI)).setDepth(depth + 2e-4);
  scene.tweens.add({ targets: flash, scale: c.blastFlash[1], alpha: 0, duration: c.blastMs, ease: 'Quad.easeOut', onComplete: () => flash.destroy() });
  // fire: two painted flames billowing up and burning out
  const fi = FX_SHEETS.impactFire;
  for (let i = 0; i < 2; i++) {
    const k = i === 0 ? 1 : 0.75;
    const fire = scene.add.image(at.x + rand(-8, 8), at.y + rand(-4, 4), fi.key, pick(fi.frames))
      .setScale(c.fireScale[0] * k).setRotation(rand(-Math.PI, Math.PI)).setDepth(depth + 1e-4);
    scene.tweens.add({
      targets: fire, scale: c.fireScale[1] * k, y: fire.y - rand(10, 22), x: fire.x + rand(-10, 10), rotation: fire.rotation + rand(-0.5, 0.5),
      duration: c.fireMs, ease: 'Cubic.easeOut',
    });
    scene.tweens.add({ targets: fire, alpha: 0, delay: c.fireMs * 0.35 + i * 60, duration: c.fireMs * 0.65, onComplete: () => fire.destroy() });
  }
  // dark smoke rolling up out of the fire and hanging a while
  const sm = FX_SHEETS.impactSmoke;
  for (let i = 0; i < c.smokePuffs; i++) {
    const p = scene.add.image(at.x + rand(-12, 12), at.y + rand(-8, 2), sm.key, pick(sm.frames))
      .setScale(0.22).setAlpha(0).setRotation(rand(-Math.PI, Math.PI)).setDepth(depth - 1e-4);
    scene.tweens.add({ targets: p, alpha: 0.8, duration: 160, delay: 80 + 70 * i });
    scene.tweens.add({
      targets: p, scale: rand(0.6, 0.75), y: p.y - rand(45, 70), x: p.x + rand(-14, 20), rotation: p.rotation + rand(-0.6, 0.6),
      alpha: 0, delay: 240 + 70 * i, duration: rand(c.smokeMs[0], c.smokeMs[1]), ease: 'Sine.easeOut', onComplete: () => p.destroy(),
    });
  }
  const e = emitters(scene);
  e.embers.emitParticleAt(at.x, at.y, c.embers);
  e.debris.setParticleTint(ground ? c.dirt : c.metal).emitParticleAt(at.x, at.y, c.debris);
  if (ground) {
    // a fountain of dirt thrown up off the ground as well
    e.debris.setParticleTint(c.dirt).emitParticleAt(ground.x, ground.y - 4, Math.ceil(c.debris / 2));
    groundMarks(scene, ground, depth);
  }
}

/** The Ram's battle cannon: a heavy shell. */
export const battleShell: Look = (kit, s) => {
  const c = BATTLE_SHELL;
  const scene = kit.scene;
  ensureFxTextures(scene);
  const { from, to } = s;
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const u = { x: (to.x - from.x) / len, y: (to.y - from.y) / len };
  const flight = (len / c.speed) * 1000;
  const depth = s.hit?.depth !== undefined ? s.hit.depth + 0.01 : DEPTH.ui - 6;
  if (s.flash) {
    glow(scene, { x: from.x + u.x * 12, y: from.y + u.y * 12 }, c.flashGlow, c.flashGlowColour, 200, DEPTH.ui - 5);
    muzzleSmoke(scene, from, u);
  }
  let age = 0;
  let landed = false;
  kit.add({
    step(ms, g) {
      age += ms;
      if (s.flash && age < c.flashMs) star(g, from, u, 1 - age / c.flashMs);
      const k = Math.min(1, age / flight);
      const head = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
      const fade = landed ? 1 - (age - flight) / c.trailFadeMs : 1;
      if (fade > 0) drawShell(g, u, len * k, head, fade);
      if (!landed && k >= 1) {
        landed = true;
        kit.landed('shell', to);
        blast(scene, to, depth, s.hit?.targets, s.ground);
      }
      return !landed || age < Math.max(c.flashMs, flight + c.trailFadeMs);
    },
  });
};
