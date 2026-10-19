import Phaser from 'phaser';
import type { Point } from '../../core/geometry';
import type { Flashable } from '../Impact';
import type { Live, Look } from './kit';

/**
 * The Operator's discharge: a jagged bolt of electricity in its side's colour leaps from its nose gun to the target
 * in an instant. A wide glow, a coloured body and a white-hot core, with a couple of thinner forks splitting off it.
 * It re-forms `flickers` times (a new jagged shape, a little brighter or dimmer each time) every `flickerMs`, then
 * holds and fades out over the rest of `ms`. Flashes at both ends; what it hits glows in its colour and keeps
 * crackling with tiny arcs for a moment after (`crackleMs`). Everything but the target's glow is drawn into the shared
 * additive Graphics: it fires three times a second, so each bolt is brief and makes almost nothing. World px and ms.
 */
export const ARC_BOLT = {
  /** How long the bolt is there in all, and how it flickers: re-forming this often, this many times, before it fades. */
  ms: 150,
  flickerMs: 35,
  flickers: 2,
  /** How jagged: the first kink is this share of its length off the line (at most `maxKink` px), halving each split; `splits` deep. */
  kink: 0.13,
  maxKink: 34,
  splits: 5,
  /** Widths of its glow, body and core (px). */
  glowWidth: 11,
  bodyWidth: 4,
  coreWidth: 1.6,
  /** The forks: how many, how long (share of the bolt's length left past where they split, at most `forkMaxPx`), how far they bend off (radians). */
  forks: 2,
  forkLength: [0.18, 0.32] as [number, number],
  forkMaxPx: 110,
  forkAngle: [0.35, 0.8] as [number, number],
  /** Flashes: at the gun, and (bigger) where it strikes. */
  muzzlePx: 13,
  strikePx: 22,
  flashMs: 110,
  /** What it hits crackles after: tiny arcs re-forming every `crackleEveryMs`, `crackleArcs` at once, up to `cracklePx` long, within `crackleSpread` of where it struck. */
  crackleMs: 260,
  crackleEveryMs: 45,
  crackleArcs: 2,
  cracklePx: 22,
  crackleSpread: 16,
  /** What it hits glows in its colour (this much of the way to white) for a moment. */
  hitFlashMs: 100,
  hitFlashAlpha: 0.65,
  hitWhiten: 0.5,
  /** Its colour when the shot doesn't bring one. */
  glow: 0xa04cff,
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const between = (r: [number, number]) => rand(r[0], r[1]);

/** `c` taken `k` of the way to white. */
function whiten(c: number, k: number): number {
  const ch = (s: number) => {
    const v = (c >> s) & 0xff;
    return Math.round(v + (255 - v) * k) << s;
  };
  return ch(16) | ch(8) | ch(0);
}

/**
 * A jagged line from `a` to `b`: each segment's middle pushed off sideways (by `kink` px at first, halving each time)
 * and split again, `splits` times over.
 */
function jag(a: Point, b: Point, kink: number, splits: number): Point[] {
  let pts: Point[] = [a, b];
  let k = kink;
  for (let s = 0; s < splits; s++) {
    const next: Point[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i];
      const dx = q.x - p.x, dy = q.y - p.y;
      const l = Math.hypot(dx, dy) || 1;
      const off = rand(-1, 1) * k;
      next.push({ x: (p.x + q.x) / 2 - (dy / l) * off, y: (p.y + q.y) / 2 + (dx / l) * off }, q);
    }
    pts = next;
    k *= 0.5;
  }
  return pts;
}

interface Shape {
  main: Point[];
  forks: Point[][];
  /** How bright this flicker is. */
  bright: number;
}

/** A new jagged shape for the bolt from `from` to `to`, with its forks. */
function shape(from: Point, to: Point): Shape {
  const A = ARC_BOLT;
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  const main = jag(from, to, Math.min(len * A.kink, A.maxKink), A.splits);
  const forks: Point[][] = [];
  for (let f = 0; f < A.forks; f++) {
    // split off somewhere along its middle, bending away to one side of the way it's heading
    const i = Math.floor(rand(0.2, 0.75) * (main.length - 1));
    const p = main[i];
    const heading = Math.atan2(to.y - p.y, to.x - p.x) + (Math.random() < 0.5 ? -1 : 1) * between(A.forkAngle);
    const fl = Math.min(A.forkMaxPx, Math.hypot(to.x - p.x, to.y - p.y) * between(A.forkLength));
    const end = { x: p.x + Math.cos(heading) * fl, y: p.y + Math.sin(heading) * fl };
    forks.push(jag(p, end, fl * 0.2, 3));
  }
  return { main, forks, bright: rand(0.75, 1) };
}

/** A tiny arc crawling over the target near `at`. */
function crackle(at: Point): Point[] {
  const A = ARC_BOLT;
  const a = rand(0, Math.PI * 2), r = rand(0, A.crackleSpread);
  const p = { x: at.x + Math.cos(a) * r, y: at.y + Math.sin(a) * r * 0.7 };
  const h = rand(0, Math.PI * 2), l = rand(0.4, 1) * A.cracklePx;
  return jag(p, { x: p.x + Math.cos(h) * l, y: p.y + Math.sin(h) * l * 0.7 }, l * 0.35, 2);
}

export const arcBolt: Look = (kit, s) => {
  const A = ARC_BOLT;
  const colour = s.glow ?? A.glow;
  const body = whiten(colour, 0.3);
  const pale = whiten(colour, 0.6);
  const from = s.from, to = s.to;
  let bolt = shape(from, to);
  let flicked = 0;
  let arcs: Point[][] = [];
  let nextCrackle = 0;
  let age = 0;
  kit.landed('bullet', to);
  hitFlash(kit.scene, s.hit?.targets, whiten(colour, A.hitWhiten));

  const live: Live = {
    step(ms, g) {
      age += ms;
      // the bolt: re-forms a couple of times, then holds and fades
      if (age < A.ms) {
        while (flicked < A.flickers && age >= (flicked + 1) * A.flickerMs) {
          bolt = shape(from, to);
          flicked++;
        }
        const holdFrom = A.flickers * A.flickerMs;
        const fade = age < holdFrom ? 1 : 1 - (age - holdFrom) / (A.ms - holdFrom);
        const a = fade * bolt.bright;
        g.lineStyle(A.glowWidth, colour, 0.22 * a).strokePoints(bolt.main);
        g.lineStyle(A.bodyWidth, body, 0.7 * a).strokePoints(bolt.main);
        g.lineStyle(A.coreWidth * (0.6 + 0.4 * fade), 0xffffff, a).strokePoints(bolt.main);
        // the forks: thinner, and gone sooner
        const af = a * a;
        for (const f of bolt.forks) {
          g.lineStyle(A.glowWidth * 0.5, colour, 0.2 * af).strokePoints(f);
          g.lineStyle(A.coreWidth * 0.7, pale, 0.9 * af).strokePoints(f);
        }
      }
      // flashes at both ends
      if (age < A.flashMs) {
        const k = 1 - age / A.flashMs;
        if (s.flash) {
          g.fillStyle(colour, 0.45 * k).fillCircle(from.x, from.y, A.muzzlePx * (1.2 - 0.4 * k));
          g.fillStyle(0xffffff, 0.9 * k).fillCircle(from.x, from.y, A.muzzlePx * 0.3 * k);
        }
        g.fillStyle(colour, 0.4 * k).fillCircle(to.x, to.y, A.strikePx * (1.3 - 0.5 * k));
        g.fillStyle(pale, 0.7 * k).fillCircle(to.x, to.y, A.strikePx * 0.45);
        g.fillStyle(0xffffff, k).fillCircle(to.x, to.y, A.strikePx * 0.2 * k + 1);
        // a quick star of light where it strikes
        const r = A.strikePx * (0.9 + 0.5 * (1 - k));
        g.lineStyle(1.4, 0xffffff, 0.8 * k).lineBetween(to.x - r, to.y, to.x + r, to.y).lineBetween(to.x, to.y - r * 0.55, to.x, to.y + r * 0.55);
      }
      // the target keeps crackling: tiny arcs re-forming over it, a faint glow under them
      if (age < A.crackleMs) {
        if (age >= nextCrackle) {
          arcs = Array.from({ length: A.crackleArcs }, () => crackle(to));
          nextCrackle += A.crackleEveryMs * rand(0.7, 1.3);
        }
        const k = 1 - age / A.crackleMs;
        g.fillStyle(colour, 0.18 * k).fillCircle(to.x, to.y, A.crackleSpread * 1.2);
        for (const p of arcs) {
          g.lineStyle(3, colour, 0.5 * k).strokePoints(p);
          g.lineStyle(1, 0xffffff, 0.9 * k).strokePoints(p);
        }
      }
      return age < Math.max(A.ms, A.flashMs, A.crackleMs);
    },
  };
  kit.add(live);
};

/** What it hits glows in `colour` for a moment: a tinted copy of each of its sprites over it, fading out. */
function hitFlash(scene: Phaser.Scene, targets: Flashable[] = [], colour: number): void {
  for (const t of targets) {
    if (!t.active || !t.visible) continue;
    const glow = scene.add.image(t.x, t.y, t.texture.key, t.frame.name)
      .setOrigin(t.originX, t.originY).setScale(t.scaleX, t.scaleY).setFlip(t.flipX, t.flipY)
      .setDepth(t.depth + 1e-4).setTintFill(colour).setAlpha(ARC_BOLT.hitFlashAlpha).setBlendMode(Phaser.BlendModes.ADD);
    scene.tweens.add({ targets: glow, alpha: 0, duration: ARC_BOLT.hitFlashMs, ease: 'Quad.easeOut', onComplete: () => glow.destroy() });
  }
}
