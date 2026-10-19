import Phaser from 'phaser';
import { DEPTH, TILE_W } from '../../config/game';
import type { Point } from '../../core/geometry';
import type { Flashable } from '../Impact';
import { FX, FX_SHEETS, ensureFxTextures } from '../fxTextures';
import type { Look } from './kit';

/**
 * The Spire's long-range artillery (world px and ms): the biggest gun in the game so far.
 *
 * It fires with a heavy launch: a big flash at the barrel, a thick burst of smoke rolling out ahead of it and
 * lingering, and a ring of dust kicked up on the ground round the vehicle. Its long barrel is nearly level, so the
 * shell leaves straight along it and flies a long, flat path, rising a little and dropping onto the target (a little
 * higher on a longer shot), a hot dot with a faint glowing trail; its small dark shadow runs along the ground from
 * under the gun to the target, growing sharper as the shell comes down.
 * Where it lands: a bright flash, a plume of fire, a shock ring and a ring of dust racing out over the ground, debris
 * and embers flung up, smoke rising and lingering, what it hits flashing hot, and a large scorch mark.
 */
const ARTY = {
  /** The barrel tip is about this high above the ground under it: the shell's shadow starts there. */
  gunHeight: 56,
  /** A shot this far (on the ground, px: about the gun's 6-tile range) is a long one; shorter shots scale down from it. */
  longShot: 6 * TILE_W * 0.75,
  /** Flight time, shortest to longest shot: slower than a tank's shell, it's a heavier round. */
  flightMs: [480, 780] as [number, number],
  /** How high the arc rises above the line between its ends, shortest to longest shot, and how much it varies: low, as the barrel is nearly level. */
  apex: [18, 60] as [number, number],
  apexJitter: 0.08,

  // --- the launch ---
  /** The flash at the barrel: its size, and a soft glow on the ground round the vehicle. */
  flashPx: 120,
  groundGlowPx: 260,
  /** The smoke from the barrel: how many puffs, how far they roll out (px), how big they grow (scale), how long they linger. */
  launchPuffs: 10,
  launchRoll: [30, 120] as [number, number],
  launchPuffScale: [0.14, 0.62] as [number, number],
  launchPuffMs: [2000, 3000] as [number, number],
  launchSmoke: 0xd2cabe,
  /** The ring of dust kicked up round the vehicle, and how far it spreads (px wide). */
  launchDustPx: 240,

  // --- in flight ---
  /** The shell: a hot core and its glow (px radius). */
  radius: 4.5,
  core: 0xfff4dc,
  glow: 0xffa040,
  /** Its glowing trail: how long a point of it lasts. And a faint wisp of smoke left every `wispPx`. */
  trailMs: 240,
  wispPx: 20,
  wispAlpha: 0.2,
  /** Its shadow on the ground: width (px) and darkness when the shell is highest, and as it lands. */
  shadowPx: [10, 30] as [number, number],
  shadowAlpha: [0.12, 0.55] as [number, number],

  // --- where it lands ---
  /** The flash: a white-hot core and an orange glow (px), and how long each lasts. */
  blastCorePx: 230,
  blastGlowPx: 420,
  blastCoreMs: 160,
  blastGlowMs: 420,
  /** The plume of fire: how big it gets (scale of the painted fire), and how long. */
  fireScale: 0.75,
  fireMs: 520,
  /** The shock ring (bright, quick) and the ring of dust (slower, softer): how far they race out (px wide). */
  shockPx: 360,
  shockMs: 360,
  dustRingPx: 300,
  dustRingMs: 820,
  dust: 0xb4a07e,
  /** Embers and bits of debris flung up. */
  embers: 34,
  debris: 9,
  /** Smoke rising from the blast: how many puffs, how high they rise (px), how long they linger. */
  smokePuffs: 6,
  smokeRise: [70, 140] as [number, number],
  smokeMs: [2200, 3200] as [number, number],
  /** What it hits glows white-hot for a moment. */
  hitFlashMs: 150,
  hitFlashAlpha: 0.85,
  /** The scorch mark: its width (px), darkness, how long it stays before fading out, and how hot it glows at first. */
  scorchPx: 140,
  scorchAlpha: 0.62,
  scorchMs: 8000,
  scorchFadeMs: 3000,
  scorchColour: 0x1a140e,
  molten: 0xff6a18,
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const between = ([a, b]: [number, number]) => rand(a, b);
const pick = (n: number) => Math.floor(Math.random() * n);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Shells' faint smoke wisps: one emitter per scene, made on the first shot (and again if the scene dropped it). */
const wisps = new WeakMap<Phaser.Scene, Phaser.GameObjects.Particles.ParticleEmitter>();

function wispEmitter(scene: Phaser.Scene): Phaser.GameObjects.Particles.ParticleEmitter {
  const had = wisps.get(scene);
  if (had && had.scene) return had;
  const soft = FX_SHEETS.impactSoft;
  const sheet = scene.textures.exists(soft.key);
  const e = scene.add.particles(0, 0, sheet ? soft.key : FX.smoke, {
    ...(sheet ? { frame: Array.from({ length: soft.frames }, (_, i) => i) } : {}),
    lifespan: { min: 500, max: 900 },
    scale: { start: 0.05, end: 0.16, ease: 'Quad.easeOut' },
    alpha: { start: ARTY.wispAlpha, end: 0, ease: 'Quad.easeIn' },
    rotate: { min: -180, max: 180 },
    speedX: { min: -6, max: 6 },
    speedY: { min: -10, max: 0 },
    tint: ARTY.launchSmoke,
    emitting: false,
  }).setDepth(DEPTH.ui - 7);
  wisps.set(scene, e);
  return e;
}

/** The Spire's shell: a heavy launch, a long flat flight along its barrel with its shadow under it, and a big blast on the ground. */
export const artilleryShell: Look = (kit, s) => {
  const scene = kit.scene;
  ensureFxTextures(scene);
  const a = ARTY;
  const end = s.ground ?? s.to;
  // the ground under the barrel: the shell starts at the barrel tip, `gunHeight` above it
  const start = { x: s.from.x, y: s.from.y + a.gunHeight };
  const dx = end.x - start.x, dy = end.y - start.y;
  const reach = Math.min(1, Math.hypot(dx, dy * 2) / a.longShot);
  const flight = lerp(a.flightMs[0], a.flightMs[1], reach);
  const apex = lerp(a.apex[0], a.apex[1], reach) * (1 + (Math.random() * 2 - 1) * a.apexJitter);
  /** How high above the ground the shell is a share `k` of the way: from the barrel's height down to 0, over the arc. */
  const height = (k: number) => a.gunHeight * (1 - k) + 4 * apex * k * (1 - k);
  const shadowAt = (k: number): Point => ({ x: start.x + dx * k, y: start.y + dy * k });
  const shellAt = (k: number): Point => {
    const p = shadowAt(k);
    return { x: p.x, y: p.y - height(k) };
  };

  if (s.flash) {
    // the flash and smoke go out along the barrel (the shot's line from its tip: the barrel is nearly level)
    const bx = s.to.x - s.from.x, by = s.to.y - s.from.y;
    const n = Math.hypot(bx, by) || 1;
    launch(scene, s.from, start, { x: bx / n, y: by / n });
  }

  const shadow = scene.add.image(start.x, start.y, FX.dot).setTint(0x000000).setAlpha(0).setDepth(DEPTH.scorch + 2);
  const trail: { x: number; y: number; age: number }[] = [];
  const wisp = wispEmitter(scene);
  const wispAt = { ...s.from };
  let age = 0;
  kit.add({
    step(ms, g) {
      age += ms;
      const k = Math.min(1, age / flight);
      const at = shellAt(k);
      // the trail: where it's been lately, fading
      for (const p of trail) p.age += ms;
      while (trail.length && trail[0].age > a.trailMs) trail.shift();
      trail.push({ x: at.x, y: at.y, age: 0 });
      for (let i = 1; i < trail.length; i++) {
        const p = trail[i - 1], q = trail[i];
        const f = 1 - p.age / a.trailMs;
        g.lineStyle(a.radius * 2.4 * f + 1, a.glow, 0.22 * f).lineBetween(p.x, p.y, q.x, q.y);
        g.lineStyle(a.radius * 0.8 * f + 0.5, a.core, 0.5 * f).lineBetween(p.x, p.y, q.x, q.y);
      }
      // faint smoke left behind, evenly spaced however fast it's going
      let gap = Math.hypot(at.x - wispAt.x, at.y - wispAt.y);
      while (gap >= a.wispPx) {
        wispAt.x += ((at.x - wispAt.x) / gap) * a.wispPx;
        wispAt.y += ((at.y - wispAt.y) / gap) * a.wispPx;
        wisp.emitParticleAt(wispAt.x, wispAt.y, 1);
        gap -= a.wispPx;
      }
      // the shell itself: a hot core in a flickering glow
      const fl = 0.85 + Math.random() * 0.3;
      g.fillStyle(a.glow, 0.35).fillCircle(at.x, at.y, a.radius * 2.8 * fl);
      g.fillStyle(a.core, 1).fillCircle(at.x, at.y, a.radius);
      // its shadow: larger and darker the lower it is
      const low = 1 - Math.min(1, height(k) / Math.max(apex, a.gunHeight));
      const sp = shadowAt(k);
      const w = lerp(a.shadowPx[0], a.shadowPx[1], low * low);
      // it fades in as the shell leaves, so it doesn't sit dark on the Spire's own shadow
      const leaving = Math.min(1, k / 0.2);
      shadow.setPosition(sp.x, sp.y).setDisplaySize(w, w * 0.5).setAlpha(lerp(a.shadowAlpha[0], a.shadowAlpha[1], low * low) * leaving);
      if (k < 1) return true;
      shadow.destroy();
      kit.landed(end);
      blast(scene, end, s.hit?.depth !== undefined ? s.hit.depth + 0.01 : DEPTH.ui - 6, s.hit?.targets);
      return false;
    },
  });
};

/**
 * The launch at the barrel tip `from` (over `ground`, the ground under it), the shell leaving along `dir`: a flash
 * pointing that way (`dir`, a unit vector), a glow on the ground, a burst of smoke rolling out and lingering, and a ring of dust round it.
 */
function launch(scene: Phaser.Scene, from: Point, ground: Point, dir: Point): void {
  const a = ARTY;
  const ux = dir.x, uy = dir.y;
  const angle = Math.atan2(uy, ux);
  const depth = DEPTH.ui - 5;

  // the flash: a long tongue of fire out of the barrel, a round flash and a star
  const tongue = scene.add.image(from.x + ux * a.flashPx * 0.3, from.y + uy * a.flashPx * 0.3, FX.dot).setTint(0xffc060)
    .setBlendMode(Phaser.BlendModes.ADD).setRotation(angle).setDisplaySize(a.flashPx * 1.1, a.flashPx * 0.36).setDepth(depth);
  scene.tweens.add({ targets: tongue, alpha: 0, scaleY: tongue.scaleY * 0.3, duration: 140, ease: 'Quad.easeOut', onComplete: () => tongue.destroy() });
  const fl = FX_SHEETS.impactFlash;
  const flash = scene.add.image(from.x, from.y, fl.key, pick(fl.frames)).setBlendMode(Phaser.BlendModes.ADD)
    .setScale((a.flashPx / 128) * 0.6).setRotation(rand(-Math.PI, Math.PI)).setDepth(depth + 1e-4);
  scene.tweens.add({ targets: flash, scale: (a.flashPx / 128) * 1.1, alpha: 0, duration: 180, ease: 'Quad.easeOut', onComplete: () => flash.destroy() });
  glow(scene, from.x, from.y, a.flashPx * 0.8, 0xfff4d8, 110, depth + 2e-4);
  // the ground round the vehicle lit for a moment
  glow(scene, ground.x, ground.y, a.groundGlowPx, 0xff9a40, 260, DEPTH.scorch + 1.5, 0.5);

  // the smoke: rolls out of the barrel, slows, swells and hangs there, drifting up as it thins
  const soft = FX_SHEETS.impactSoft;
  for (let i = 0; i < a.launchPuffs; i++) {
    const roll = between(a.launchRoll) * (i < 3 ? 1.2 : 1);
    const spread = rand(-0.55, 0.55);
    const rx = ux * Math.cos(spread) - uy * Math.sin(spread), ry = ux * Math.sin(spread) + uy * Math.cos(spread);
    const p = scene.add.image(from.x + ux * 10, from.y + uy * 10, soft.key, pick(soft.frames))
      .setTint(i % 3 === 0 ? 0xa8a096 : a.launchSmoke).setAlpha(0).setScale(a.launchPuffScale[0])
      .setRotation(rand(-Math.PI, Math.PI)).setDepth(DEPTH.ui - 7 - i * 1e-4);
    const ms = between(a.launchPuffMs);
    const rise = rand(18, 40);
    scene.tweens.add({ targets: p, alpha: rand(0.55, 0.8), duration: 60, delay: i * 12 });
    scene.tweens.add({
      targets: p, x: p.x + rx * roll, y: p.y + ry * roll * 0.8 - rise, scale: a.launchPuffScale[1] * rand(0.7, 1.1),
      rotation: p.rotation + rand(-0.8, 0.8), duration: ms, delay: i * 12, ease: 'Expo.easeOut',
    });
    scene.tweens.add({ targets: p, alpha: 0, delay: 350 + i * 12, duration: ms - 350, ease: 'Sine.easeIn', onComplete: () => p.destroy() });
  }

  // a ring of dust blown out over the ground round the vehicle, and a few puffs of it
  const ring = scene.add.image(ground.x, ground.y, soft.key, 2).setTint(a.dust).setAlpha(0.6)
    .setDisplaySize(a.launchDustPx * 0.25, a.launchDustPx * 0.125).setDepth(DEPTH.scorch + 1);
  scene.tweens.add({
    targets: ring, displayWidth: a.launchDustPx, displayHeight: a.launchDustPx * 0.5, alpha: 0, duration: 700, ease: 'Cubic.easeOut',
    onComplete: () => ring.destroy(),
  });
  dustPuffs(scene, ground, a.launchDustPx * 0.4, 5, 0.22, 0.5);
}

/** The shell landing at `at` on the ground: drawn at `depth` (just in front of what it hits), `targets` flashing hot. */
function blast(scene: Phaser.Scene, at: Point, depth: number, targets: Flashable[] = []): void {
  const a = ARTY;
  const { x, y } = at;
  hitFlash(scene, targets);

  // the scorch, with the ground still glowing hot where it struck
  const sc = FX_SHEETS.impactScorch;
  const px = a.scorchPx * rand(0.9, 1.15);
  const mark = scene.add.image(x, y, sc.key, pick(sc.frames)).setDisplaySize(px, px / 2).setFlipX(Math.random() < 0.5)
    .setTint(a.scorchColour).setAlpha(0).setDepth(DEPTH.scorch);
  scene.tweens.add({ targets: mark, alpha: a.scorchAlpha, duration: 100 });
  scene.tweens.add({ targets: mark, alpha: 0, delay: a.scorchMs, duration: a.scorchFadeMs, onComplete: () => mark.destroy() });
  const hot = scene.add.image(x, y, sc.key, mark.frame.name).setDisplaySize(px * 0.75, px * 0.375).setFlipX(mark.flipX)
    .setTint(a.molten).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.9).setDepth(DEPTH.scorch + 0.5);
  scene.tweens.add({ targets: hot, alpha: 0, duration: 1600, ease: 'Quad.easeIn', onComplete: () => hot.destroy() });

  // the flash: white-hot, then a wide orange glow, a star, and the ground lit round it
  glow(scene, x, y - 20, a.blastCorePx, 0xfff6e0, a.blastCoreMs, depth + 3e-4);
  glow(scene, x, y - 30, a.blastGlowPx, 0xff8a2a, a.blastGlowMs, depth + 2e-4, 0.8);
  glow(scene, x, y, a.blastGlowPx * 1.3, 0xff7020, 500, DEPTH.scorch + 1.5, 0.45);
  const fr = FX_SHEETS.impactFlare;
  const star = scene.add.image(x, y - 16, fr.key, pick(fr.frames)).setTint(0xfff0c8).setBlendMode(Phaser.BlendModes.ADD)
    .setScale(0.9).setRotation(rand(-Math.PI, Math.PI)).setDepth(depth + 4e-4);
  scene.tweens.add({ targets: star, scale: 2, alpha: 0, rotation: star.rotation + 0.4, duration: 220, ease: 'Quad.easeOut', onComplete: () => star.destroy() });

  // the fire: a ball blooming at the ground and a plume thrown up out of it
  const fi = FX_SHEETS.impactFire;
  const ball = scene.add.image(x, y - 10, fi.key, pick(fi.frames)).setScale(a.fireScale * 0.3).setRotation(rand(-Math.PI, Math.PI)).setDepth(depth + 1e-4);
  scene.tweens.add({ targets: ball, scale: a.fireScale, y: y - 30, rotation: ball.rotation + rand(-0.4, 0.4), duration: a.fireMs, ease: 'Cubic.easeOut' });
  scene.tweens.add({ targets: ball, alpha: 0, delay: a.fireMs * 0.45, duration: a.fireMs * 0.55, onComplete: () => ball.destroy() });
  const plume = scene.add.image(x, y - 20, fi.key, pick(fi.frames)).setBlendMode(Phaser.BlendModes.ADD)
    .setScale(a.fireScale * 0.25, a.fireScale * 0.4).setDepth(depth + 1.5e-4);
  scene.tweens.add({
    targets: plume, scaleX: a.fireScale * 0.55, scaleY: a.fireScale * 1.1, y: y - 110, alpha: 0, duration: a.fireMs * 1.1, ease: 'Cubic.easeOut',
    onComplete: () => plume.destroy(),
  });
  const fl = FX_SHEETS.impactFlash;
  const pop = scene.add.image(x, y - 14, fl.key, pick(fl.frames)).setBlendMode(Phaser.BlendModes.ADD).setScale(0.6)
    .setRotation(rand(-Math.PI, Math.PI)).setDepth(depth + 2.5e-4);
  scene.tweens.add({ targets: pop, scale: 1.4, alpha: 0, duration: 200, ease: 'Quad.easeOut', onComplete: () => pop.destroy() });

  // the shock ring racing out flat over the ground, a second fainter one behind it, then the dust
  const rg = FX_SHEETS.impactRing;
  for (const [delay, to, alpha] of [[0, a.shockPx, 0.9], [70, a.shockPx * 0.7, 0.5]] as const) {
    const ring = scene.add.image(x, y, rg.key, 0).setTint(0xfff0d0).setBlendMode(Phaser.BlendModes.ADD)
      .setDisplaySize(24, 12).setAlpha(delay ? 0 : alpha).setDepth(depth - 2e-4);
    if (delay) scene.tweens.add({ targets: ring, alpha, delay, duration: 1 });
    scene.tweens.add({
      targets: ring, displayWidth: to, displayHeight: to * 0.5, alpha: 0, delay, duration: a.shockMs, ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
  }
  const soft = FX_SHEETS.impactSoft;
  const dust = scene.add.image(x, y, soft.key, 2).setTint(a.dust).setAlpha(0.8).setDisplaySize(40, 20).setDepth(DEPTH.scorch + 1);
  scene.tweens.add({
    targets: dust, displayWidth: a.dustRingPx, displayHeight: a.dustRingPx * 0.5, alpha: 0, duration: a.dustRingMs, ease: 'Cubic.easeOut',
    onComplete: () => dust.destroy(),
  });
  dustPuffs(scene, at, a.dustRingPx * 0.42, 7, 0.3, 0.75);

  // embers and debris flung up
  const em = scene.add.particles(x, y - 12, FX.dot, {
    lifespan: { min: 500, max: 1100 },
    speed: { min: 160, max: 460 },
    angle: { min: 195, max: 345 },
    gravityY: 620,
    scale: { start: 0.13, end: 0.02 },
    alpha: { start: 1, end: 0 },
    color: [0xfff4c0, 0xffa030, 0xb02a08],
    blendMode: Phaser.BlendModes.ADD,
    emitting: false,
  }).setDepth(depth + 5e-4);
  em.explode(a.embers);
  const db = FX_SHEETS.impactDebris;
  const bits = scene.add.particles(x, y - 8, db.key, {
    frame: Array.from({ length: db.frames }, (_, i) => i),
    lifespan: { min: 650, max: 1050 },
    speed: { min: 140, max: 340 },
    angle: { min: 210, max: 330 },
    gravityY: 820,
    scale: { start: 0.17, end: 0.1 },
    rotate: { start: 0, end: 540 },
    alpha: { start: 1, end: 0.2 },
    tint: 0x2e2620,
    emitting: false,
  }).setDepth(depth + 1e-4);
  bits.explode(a.debris);
  scene.time.delayedCall(1300, () => { em.destroy(); bits.destroy(); });

  // smoke: dark and heavy, rising out of the fire and lingering
  const sm = FX_SHEETS.impactSmoke;
  for (let i = 0; i < a.smokePuffs; i++) {
    const p = scene.add.image(x + rand(-26, 26), y - rand(4, 24), sm.key, pick(sm.frames))
      .setScale(0.3).setAlpha(0).setRotation(rand(-Math.PI, Math.PI)).setDepth(depth - 1e-4 - i * 1e-5);
    const ms = between(a.smokeMs);
    const delay = 120 + i * 70;
    scene.tweens.add({ targets: p, alpha: rand(0.6, 0.8), delay, duration: 180 });
    scene.tweens.add({
      targets: p, scale: rand(0.8, 1.05), y: p.y - between(a.smokeRise), x: p.x + rand(-24, 30), rotation: p.rotation + rand(-0.7, 0.7),
      alpha: 0, delay: delay + 180, duration: ms, ease: 'Sine.easeOut', onComplete: () => p.destroy(),
    });
  }
}

/** Puffs of dust blown out along the ground round `at`, out to about `out` px. */
function dustPuffs(scene: Phaser.Scene, at: Point, out: number, n: number, scale0: number, scale1: number): void {
  const pf = FX_SHEETS.impactPuff;
  const turn = rand(0, Math.PI * 2);
  for (let i = 0; i < n; i++) {
    const ang = turn + (i / n) * Math.PI * 2 + rand(-0.3, 0.3);
    const cx = Math.cos(ang), cy = Math.sin(ang) * 0.5;
    const p = scene.add.image(at.x + cx * 10, at.y + cy * 10, pf.key, pick(pf.frames)).setTint(ARTY.dust).setAlpha(0.6)
      .setScale(scale0).setRotation(rand(-Math.PI, Math.PI)).setDepth(DEPTH.scorch + 1);
    const d = out * rand(0.7, 1.1);
    scene.tweens.add({
      targets: p, x: at.x + cx * d, y: at.y + cy * d - rand(6, 18), scaleX: scale1, scaleY: scale1 * 0.7, alpha: 0,
      duration: rand(900, 1300), ease: 'Cubic.easeOut', onComplete: () => p.destroy(),
    });
  }
}

/** A soft additive glow that swells and fades. */
function glow(scene: Phaser.Scene, x: number, y: number, px: number, colour: number, ms: number, depth: number, alpha = 0.9): void {
  const g = scene.add.image(x, y, FX.dot).setTint(colour).setBlendMode(Phaser.BlendModes.ADD).setDepth(depth).setDisplaySize(px, px * 0.8).setAlpha(alpha);
  scene.tweens.add({ targets: g, alpha: 0, scaleX: g.scaleX * 1.5, scaleY: g.scaleY * 1.5, duration: ms, ease: 'Quad.easeOut', onComplete: () => g.destroy() });
}

/** What it hits glows white-hot for a moment: a white copy of each of its sprites over it, fading out. */
function hitFlash(scene: Phaser.Scene, targets: Flashable[]): void {
  for (const s of targets) {
    if (!s.active || !s.visible) continue;
    const g = scene.add.image(s.x, s.y, s.texture.key, s.frame.name)
      .setOrigin(s.originX, s.originY).setScale(s.scaleX, s.scaleY).setFlip(s.flipX, s.flipY)
      .setDepth(s.depth + 1e-4).setTintFill(0xfff2d8).setAlpha(ARTY.hitFlashAlpha).setBlendMode(Phaser.BlendModes.ADD);
    scene.tweens.add({ targets: g, alpha: 0, duration: ARTY.hitFlashMs, ease: 'Quad.easeOut', onComplete: () => g.destroy() });
  }
}
