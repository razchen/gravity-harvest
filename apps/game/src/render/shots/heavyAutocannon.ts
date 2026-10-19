import Phaser from 'phaser';
import { DEPTH } from '../../config/game';
import type { Point } from '../../core/geometry';
import type { Flashable } from '../Impact';
import { FX, FX_SHEETS, ensureFxTextures } from '../fxTextures';
import type { Look } from './kit';

/**
 * How the Carrier's heavy autocannon looks (world px and ms): three slow, fat yellow-white rounds, `gapMs` apart, a
 * steady thump-thump-thump next to the Skimmer's rattle. Each leaves with a star-shaped flash and a small puff of
 * grey smoke at the barrel, and pops where it hits: a flash, a little burst of fire and sparks, and what it hits glows
 * for a moment. Bigger than a bullet's spark, smaller than a tank shell's burst. The server decides hits and damage.
 */
export const HEAVY_AC = {
  /** Rounds per shot, and the gap between them. */
  rounds: 3,
  gapMs: 200,
  /** Speed of a round; its soft halo and bright core (diameter and radius), and its short tail. */
  speed: 1400,
  halo: 26,
  coreRadius: 4.5,
  tail: 20,
  core: 0xfffbe8,
  glow: 0xffd860,
  /** Rounds land this far around the aim point (they all hit: it's slow and steady, not spraying). */
  spread: 6,
  /**
   * The muzzle flash: a star (long spike forward, shorter ones back and to the sides) `star` px across its long
   * spike, pointing along the barrel, held a moment then shrinking away over `starMs`.
   */
  star: 64,
  starMs: 110,
  starColour: 0xfff2c0,
  /** Grey smoke at the barrel per round: puffs that drift up and thin out. */
  smokePuffs: 2,
  smoke: 0xb4aea6,
  smokeMs: [600, 950] as [number, number],
  /** The pop where it hits: a white-hot glow and a painted flash (px across), and sparks flung out. */
  popGlow: 52,
  popFlash: [26, 48] as [number, number],
  popMs: 150,
  popColour: 0xfff0b0,
  sparks: 7,
  sparkColours: [0xffffff, 0xffd060, 0xff8a20],
  /** What it hits glows this strongly, for this long. */
  hitFlashAlpha: 0.45,
  hitFlashMs: 90,
};

/** The star texture (drawn in code once per game, white so it tints). Its core sits `STAR_CORE` across from the left. */
const STAR = 'fx_shot_star';
const STAR_W = 128;
const STAR_H = 64;
const STAR_CORE = 40;

function ensureStar(scene: Phaser.Scene): void {
  if (scene.textures.exists(STAR)) return;
  const tex = scene.textures.createCanvas(STAR, STAR_W, STAR_H);
  if (!tex) return;
  const ctx = tex.context;
  const cx = STAR_CORE, cy = STAR_H / 2;
  // spikes: thin, bright at the root and fading to the tip
  const spike = (angle: number, len: number, width: number) => {
    const ex = cx + Math.cos(angle) * len, ey = cy + Math.sin(angle) * len;
    const nx = -Math.sin(angle) * width, ny = Math.cos(angle) * width;
    const grad = ctx.createLinearGradient(cx, cy, ex, ey);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.moveTo(cx + nx, cy + ny); ctx.lineTo(ex, ey); ctx.lineTo(cx - nx, cy - ny); ctx.closePath(); ctx.fill();
  };
  spike(0, STAR_W - STAR_CORE - 2, 6);
  spike(Math.PI, STAR_CORE - 6, 4.5);
  spike(Math.PI / 2, cy - 2, 4.5);
  spike(-Math.PI / 2, cy - 2, 4.5);
  for (const a of [Math.PI / 4, -Math.PI / 4]) spike(a, 30, 3.5);
  for (const a of [(Math.PI * 3) / 4, (-Math.PI * 3) / 4]) spike(a, 18, 3);
  // a hot round core
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, 16);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.4, 'rgba(255,255,255,0.7)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = core;
  ctx.fillRect(cx - 16, cy - 16, 32, 32);
  tex.refresh();
}

/** The emitters every Carrier shot shares, one set per scene (made on the first shot, again if the scene restarts). */
interface Emitters {
  smoke: Phaser.GameObjects.Particles.ParticleEmitter;
  sparks: Phaser.GameObjects.Particles.ParticleEmitter;
}

const EMITTERS = new WeakMap<Phaser.Scene, Emitters>();

const pickOf = <T>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];

function emitters(scene: Phaser.Scene): Emitters {
  const had = EMITTERS.get(scene);
  if (had && Object.values(had).every((e) => e.active && e.scene)) return had;
  if (had) for (const e of Object.values(had)) if (e.scene) e.destroy();
  ensureFxTextures(scene);
  const soft = FX_SHEETS.impactSoft;
  const sheet = scene.textures.exists(soft.key);
  const smoke = scene.add.particles(0, 0, sheet ? soft.key : FX.smoke, {
    ...(sheet ? { frame: Array.from({ length: soft.frames }, (_, i) => i) } : {}),
    lifespan: { min: HEAVY_AC.smokeMs[0], max: HEAVY_AC.smokeMs[1] },
    scale: { start: 0.07, end: 0.24, ease: 'Quad.easeOut' },
    alpha: { start: 0.55, end: 0, ease: 'Quad.easeIn' },
    rotate: { min: -180, max: 180 },
    speedX: { min: -10, max: 10 },
    speedY: { min: -26, max: -8 },
    tint: HEAVY_AC.smoke,
    emitting: false,
  }).setDepth(DEPTH.ui - 6);
  const sparks = scene.add.particles(0, 0, FX.dot, {
    lifespan: { min: 200, max: 380 },
    speed: { min: 90, max: 260 },
    angle: { min: 0, max: 360 },
    gravityY: 600,
    scale: { start: 0.13, end: 0 },
    alpha: { start: 1, end: 0.2 },
    blendMode: Phaser.BlendModes.ADD,
    emitting: false,
  }).setDepth(DEPTH.ui - 5);
  const made = { smoke, sparks };
  EMITTERS.set(scene, made);
  return made;
}

/** An image that swells (or shrinks) from `from` to `to` (display px) and fades out over `ms`, after holding for `holdMs`. */
interface Fade {
  im: Phaser.GameObjects.Image;
  age: number;
  ms: number;
  holdMs: number;
  from: number;
  to: number;
  /** Height against width. */
  squash: number;
  alpha: number;
}

interface Round {
  to: Point;
  /** ms since it left; negative until it does. */
  age: number;
  flight: number;
  halo?: Phaser.GameObjects.Image;
  landed: boolean;
}

/** The target glows for a moment: a tinted copy of each of its sprites over it, fading out. */
function hitFlash(scene: Phaser.Scene, targets: Flashable[] = [], add: (f: Fade) => void): void {
  for (const t of targets) {
    if (!t.active || !t.visible) continue;
    const im = scene.add.image(t.x, t.y, t.texture.key, t.frame.name)
      .setOrigin(t.originX, t.originY).setScale(t.scaleX, t.scaleY).setFlip(t.flipX, t.flipY)
      .setDepth(t.depth + 1e-4).setTintFill(HEAVY_AC.popColour).setBlendMode(Phaser.BlendModes.ADD);
    // keep its own size (from/to of 0 leave the scale alone)
    add({ im, age: 0, ms: HEAVY_AC.hitFlashMs, holdMs: 0, from: 0, to: 0, squash: 1, alpha: HEAVY_AC.hitFlashAlpha });
  }
}

/**
 * The Carrier's heavy autocannon: three slow, fat yellow-white rounds, each leaving with a star-shaped flash and a
 * puff of grey smoke, each popping where it hits.
 */
export const heavyAutocannon: Look = (kit, s) => {
  const scene = kit.scene;
  ensureFxTextures(scene);
  ensureStar(scene);
  const fx = emitters(scene);
  const from = s.from;
  const aim = Math.atan2(s.to.y - from.y, s.to.x - from.x);
  const ux = Math.cos(aim), uy = Math.sin(aim);
  const popDepth = s.hit?.depth !== undefined ? s.hit.depth + 0.01 : DEPTH.ui - 6;
  const rounds: Round[] = [];
  for (let i = 0; i < HEAVY_AC.rounds; i++) {
    const j = () => (Math.random() * 2 - 1) * HEAVY_AC.spread;
    const to = { x: s.to.x + j(), y: s.to.y + j() * 0.6 };
    const flight = (Math.hypot(to.x - from.x, to.y - from.y) / HEAVY_AC.speed) * 1000;
    rounds.push({ to, age: -i * HEAVY_AC.gapMs, flight, landed: false });
  }
  const fades: Fade[] = [];
  const fade = (f: Fade) => fades.push(f);
  const glowImage = (at: Point, tint: number, depth: number) => scene.add.image(at.x, at.y, FX.dot).setTint(tint)
    .setBlendMode(Phaser.BlendModes.ADD).setDepth(depth);

  /** A round leaves: the star at the barrel, a soft glow behind it, and a puff of smoke drifting off ahead. */
  const leave = () => {
    const star = scene.add.image(from.x, from.y, STAR).setOrigin(STAR_CORE / STAR_W, 0.5).setRotation(aim + (Math.random() * 2 - 1) * 0.12)
      .setTint(HEAVY_AC.starColour).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.ui - 5);
    const size = HEAVY_AC.star * (0.85 + Math.random() * 0.3);
    fade({ im: star, age: 0, ms: HEAVY_AC.starMs, holdMs: 35, from: size, to: size * 0.4, squash: STAR_H / STAR_W, alpha: 1 });
    fade({ im: glowImage(from, HEAVY_AC.glow, DEPTH.ui - 5.1), age: 0, ms: 140, holdMs: 0, from: 34, to: 44, squash: 1, alpha: 0.8 });
    for (let i = 0; i < HEAVY_AC.smokePuffs; i++) {
      const ahead = 6 + i * 9;
      fx.smoke.emitParticleAt(from.x + ux * ahead + (Math.random() * 2 - 1) * 3, from.y + uy * ahead + (Math.random() * 2 - 1) * 3, 1);
    }
  };

  /** A round hits: a white-hot glow, a little painted flash of fire, sparks, and the target glows. */
  const pop = (at: Point) => {
    kit.landed('bullet', at);
    fade({ im: glowImage(at, HEAVY_AC.popColour, popDepth + 2e-4), age: 0, ms: HEAVY_AC.popMs * 0.8, holdMs: 0, from: HEAVY_AC.popGlow, to: HEAVY_AC.popGlow * 1.4, squash: 1, alpha: 0.95 });
    fade({ im: glowImage(at, 0xff9a30, popDepth), age: 0, ms: HEAVY_AC.popMs * 1.6, holdMs: 0, from: HEAVY_AC.popGlow * 1.2, to: HEAVY_AC.popGlow * 1.8, squash: 1, alpha: 0.5 });
    const fl = FX_SHEETS.impactFlash;
    if (scene.textures.exists(fl.key)) {
      const im = scene.add.image(at.x, at.y, fl.key, Math.floor(Math.random() * fl.frames)).setBlendMode(Phaser.BlendModes.ADD)
        .setRotation(Math.random() * Math.PI * 2).setDepth(popDepth + 1e-4);
      fade({ im, age: 0, ms: HEAVY_AC.popMs, holdMs: 0, from: HEAVY_AC.popFlash[0], to: HEAVY_AC.popFlash[1], squash: 1, alpha: 1 });
    }
    for (let i = 0; i < HEAVY_AC.sparks; i++) fx.sparks.setParticleTint(pickOf(HEAVY_AC.sparkColours)).emitParticleAt(at.x, at.y, 1);
    fx.smoke.emitParticleAt(at.x, at.y - 4, 1);
    hitFlash(scene, s.hit?.targets, fade);
  };

  kit.add({
    step(ms, g) {
      for (const r of rounds) {
        if (r.landed) continue;
        r.age += ms;
        if (r.age < 0) continue;
        if (!r.halo) {
          if (s.flash) leave();
          r.halo = glowImage(from, HEAVY_AC.glow, DEPTH.ui - 5.05).setDisplaySize(HEAVY_AC.halo, HEAVY_AC.halo).setAlpha(0.85);
        }
        const k = Math.min(1, r.age / r.flight);
        const dx = r.to.x - from.x, dy = r.to.y - from.y;
        const len = Math.hypot(dx, dy) || 1;
        const t = Math.max(0, k - HEAVY_AC.tail / len);
        const hx = from.x + dx * k, hy = from.y + dy * k;
        const tx = from.x + dx * t, ty = from.y + dy * t;
        const pulse = 0.9 + Math.random() * 0.2;
        r.halo.setPosition(hx, hy).setDisplaySize(HEAVY_AC.halo * pulse, HEAVY_AC.halo * pulse);
        g.lineStyle(HEAVY_AC.coreRadius * 2.2, HEAVY_AC.glow, 0.35).lineBetween(tx, ty, hx, hy);
        g.lineStyle(HEAVY_AC.coreRadius * 1.1, HEAVY_AC.core, 0.8).lineBetween(tx, ty, hx, hy);
        g.fillStyle(HEAVY_AC.core, 1).fillCircle(hx, hy, HEAVY_AC.coreRadius);
        if (k < 1) continue;
        r.landed = true;
        r.halo.destroy();
        pop(r.to);
      }
      for (let i = fades.length - 1; i >= 0; i--) {
        const f = fades[i];
        f.age += ms;
        if (f.age >= f.holdMs + f.ms) {
          f.im.destroy();
          fades.splice(i, 1);
          continue;
        }
        const k = Math.max(0, f.age - f.holdMs) / f.ms;
        const e = 1 - (1 - k) * (1 - k);
        if (f.from > 0) {
          const w = f.from + (f.to - f.from) * e;
          f.im.setDisplaySize(w, w * f.squash);
        }
        f.im.setAlpha(f.alpha * (1 - k));
      }
      return fades.length > 0 || rounds.some((r) => !r.landed);
    },
  });
};
