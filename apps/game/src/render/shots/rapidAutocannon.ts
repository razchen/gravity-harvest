import Phaser from 'phaser';
import { DEPTH } from '../../config/game';
import type { Point } from '../../core/geometry';
import { FX, FX_SHEETS, ensureFxTextures } from '../fxTextures';
import type { Look } from './kit';

/**
 * How the Skimmer's rapid autocannon looks (world px and ms): a quick, nervous stream of small orange tracers, each
 * with a flickering muzzle flash. The rounds spread a little around the aim point; a few fly past and kick up dust on
 * the ground beyond the target, the rest hit with a few sparks. The server decides hits and damage; this is only the look.
 */
export const RAPID = {
  /** Rounds per shot, and the gap between them. */
  rounds: 5,
  gapMs: 55,
  /** Speed of a round, the length of its streak, and the widths of its bright core and its soft glow. */
  speed: 3000,
  streak: 30,
  coreWidth: 2.6,
  glowWidth: 7,
  core: 0xffe2a0,
  glow: 0xff7a18,
  /** Rounds land this far around the aim point (less up and down: the ground is foreshortened). */
  spread: 12,
  /** Share of rounds that miss (at a unit only): they fly past and land on the ground this far beyond it. */
  missShare: 0.25,
  missPast: [30, 90] as [number, number],
  /**
   * The muzzle flash, per round: a few soft dots of random size (so it flickers) and a short tongue of fire out of
   * the barrel that jumps about for `tongueMs`.
   */
  flashDots: 3,
  flashScale: [0.12, 0.42] as [number, number],
  flashMs: [40, 80] as [number, number],
  flashColours: [0xffffff, 0xffd060, 0xff8a20],
  tongue: 16,
  tongueMs: 45,
  /** Sparks where a round hits: how many, how fast, how long they last. */
  sparks: 4,
  sparkSpeed: [70, 230] as [number, number],
  sparkMs: [120, 260] as [number, number],
  sparkColours: [0xfff2c0, 0xffb040, 0xff7020],
  /** A miss: a puff or two of dust where it lands and a few specks of grit thrown up. */
  dust: 0xa08a68,
  dustPuffs: 2,
  grit: 3,
};

/** The emitters every Skimmer shot shares, one set per scene (made on the first shot, again if the scene restarts). */
interface Emitters {
  flash: Phaser.GameObjects.Particles.ParticleEmitter;
  sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  dust: Phaser.GameObjects.Particles.ParticleEmitter;
  grit: Phaser.GameObjects.Particles.ParticleEmitter;
}

const EMITTERS = new WeakMap<Phaser.Scene, Emitters>();

const between = ([a, b]: [number, number]) => a + Math.random() * (b - a);
const pickOf = <T>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];

function emitters(scene: Phaser.Scene): Emitters {
  const had = EMITTERS.get(scene);
  if (had && Object.values(had).every((e) => e.active && e.scene)) return had;
  if (had) for (const e of Object.values(had)) if (e.scene) e.destroy();
  ensureFxTextures(scene);
  const add = Phaser.BlendModes.ADD;
  const flash = scene.add.particles(0, 0, FX.dot, {
    lifespan: { min: RAPID.flashMs[0], max: RAPID.flashMs[1] },
    scale: { min: RAPID.flashScale[0], max: RAPID.flashScale[1] },
    alpha: { start: 1, end: 0 },
    blendMode: add,
    emitting: false,
  }).setDepth(DEPTH.ui - 5);
  const sparks = scene.add.particles(0, 0, FX.dot, {
    lifespan: { min: RAPID.sparkMs[0], max: RAPID.sparkMs[1] },
    speed: { min: RAPID.sparkSpeed[0], max: RAPID.sparkSpeed[1] },
    angle: { min: 0, max: 360 },
    gravityY: 600,
    scale: { start: 0.1, end: 0 },
    alpha: { start: 1, end: 0.2 },
    blendMode: add,
    emitting: false,
  }).setDepth(DEPTH.ui - 5);
  const puff = FX_SHEETS.impactPuff;
  const sheet = scene.textures.exists(puff.key);
  const dust = scene.add.particles(0, 0, sheet ? puff.key : FX.smoke, {
    ...(sheet ? { frame: Array.from({ length: puff.frames }, (_, i) => i) } : {}),
    lifespan: { min: 380, max: 620 },
    scale: { start: 0.06, end: 0.2, ease: 'Quad.easeOut' },
    alpha: { start: 0.6, end: 0, ease: 'Quad.easeIn' },
    rotate: { min: -180, max: 180 },
    speedX: { min: -14, max: 14 },
    speedY: { min: -36, max: -12 },
    tint: RAPID.dust,
    emitting: false,
  }).setDepth(DEPTH.ui - 6);
  const grit = scene.add.particles(0, 0, FX.dot, {
    lifespan: { min: 260, max: 420 },
    speed: { min: 50, max: 120 },
    angle: { min: 235, max: 305 },
    gravityY: 520,
    scale: { start: 0.07, end: 0.04 },
    alpha: { start: 0.9, end: 0 },
    tint: 0x5a4a36,
    emitting: false,
  }).setDepth(DEPTH.ui - 6);
  const made = { flash, sparks, dust, grit };
  EMITTERS.set(scene, made);
  return made;
}

interface Round {
  to: Point;
  /** ms since it left; negative until it does. */
  age: number;
  flight: number;
  miss: boolean;
  /** Its muzzle flash has gone off, and it has landed. */
  fired: boolean;
  landed: boolean;
}

/**
 * The Skimmer's rapid autocannon: a quick stream of small orange tracers, `RAPID.gapMs` apart, each with a flicker
 * at the muzzle; most hit with a few sparks, some miss and kick up dust on the ground beyond the target.
 */
export const rapidAutocannon: Look = (kit, s) => {
  const fx = emitters(kit.scene);
  const from = s.from;
  const ground = s.ground;
  const rounds: Round[] = [];
  for (let i = 0; i < RAPID.rounds; i++) {
    const miss = ground !== undefined && Math.random() < RAPID.missShare;
    const j = () => (Math.random() * 2 - 1) * RAPID.spread;
    let to: Point = { x: s.to.x + j(), y: s.to.y + j() * 0.6 };
    if (miss && ground) {
      // past the target, on the ground beyond it
      const len = Math.hypot(ground.x - from.x, ground.y - from.y) || 1;
      const past = between(RAPID.missPast);
      to = { x: ground.x + ((ground.x - from.x) / len) * past + j(), y: ground.y + ((ground.y - from.y) / len) * past * 0.5 + j() * 0.4 };
    }
    const flight = (Math.hypot(to.x - from.x, to.y - from.y) / RAPID.speed) * 1000;
    rounds.push({ to, age: -i * RAPID.gapMs, flight, miss, fired: false, landed: false });
  }
  // the way the barrel points, for the tongue of fire
  const aim = Math.atan2(s.to.y - from.y, s.to.x - from.x);
  const ux = Math.cos(aim), uy = Math.sin(aim);

  kit.add({
    step(ms, g) {
      let busy = false;
      for (const r of rounds) {
        if (r.landed) continue;
        busy = true;
        r.age += ms;
        if (r.age < 0) continue;
        if (!r.fired) {
          r.fired = true;
          if (s.flash) {
            for (let i = 0; i < RAPID.flashDots; i++) {
              const ahead = i * 4;
              fx.flash.setParticleTint(RAPID.flashColours[i % RAPID.flashColours.length]).emitParticleAt(from.x + ux * ahead, from.y + uy * ahead, 1);
            }
          }
        }
        // the tongue of fire out of the barrel, a different length every frame
        if (s.flash && r.age < RAPID.tongueMs) {
          const a = 1 - r.age / RAPID.tongueMs;
          const len = RAPID.tongue * (0.5 + Math.random() * 0.7);
          g.lineStyle(5, RAPID.glow, 0.5 * a).lineBetween(from.x, from.y, from.x + ux * len, from.y + uy * len);
          g.lineStyle(2, RAPID.core, a).lineBetween(from.x, from.y, from.x + ux * len * 0.7, from.y + uy * len * 0.7);
        }
        const k = Math.min(1, r.age / r.flight);
        const dx = r.to.x - from.x, dy = r.to.y - from.y;
        const len = Math.hypot(dx, dy) || 1;
        const t = Math.max(0, k - RAPID.streak / len);
        const hx = from.x + dx * k, hy = from.y + dy * k;
        const tx = from.x + dx * t, ty = from.y + dy * t;
        g.lineStyle(RAPID.glowWidth, RAPID.glow, 0.4).lineBetween(tx, ty, hx, hy);
        g.lineStyle(RAPID.coreWidth, RAPID.core, 1).lineBetween(tx, ty, hx, hy);
        g.fillStyle(0xffffff, 0.9).fillCircle(hx, hy, RAPID.coreWidth * 0.8);
        if (k < 1) continue;
        r.landed = true;
        if (r.miss) {
          fx.dust.emitParticleAt(r.to.x, r.to.y, RAPID.dustPuffs);
          fx.grit.emitParticleAt(r.to.x, r.to.y, RAPID.grit);
        } else {
          kit.landed(r.to);
          fx.flash.setParticleTint(RAPID.sparkColours[0]).emitParticleAt(r.to.x, r.to.y, 1);
          for (let i = 0; i < RAPID.sparks; i++) fx.sparks.setParticleTint(pickOf(RAPID.sparkColours)).emitParticleAt(r.to.x, r.to.y, 1);
        }
      }
      return busy;
    },
  });
};
