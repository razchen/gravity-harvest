import Phaser from 'phaser';
import { DEPTH } from '../../config/game';
import type { Point } from '../../core/geometry';
import { FX, FX_SHEETS, ensureFxTextures } from '../fxTextures';
import type { Flashable } from '../Impact';
import type { Look } from './kit';

/**
 * The Breaker's column of light (world px and ms). First the charge: a targeting circle of runes on the ground at the
 * target, tightening and spinning, while the unit's nose gathers light and a faint thread flickers down from the sky.
 * Then it strikes: a tall thick beam slams down from out of sight above onto the target, the same width all the way up
 * (a soft wide glow round a white-hot core, in its side's colour), shimmering, with light flooding the ground, motes
 * rising up inside it, a shock ring and dust racing out, the camera jolting and the target bathed in light. It holds,
 * then narrows away to a thread and is gone, leaving a molten scorch that cools from white to its colour to dark.
 */
export const COLUMN = {
  /** The charge: how long, and the targeting circle's width at the start and end (an ellipse half as tall). */
  chargeMs: 320,
  sigilPx: [170, 64] as [number, number],
  /** Rune marks round the circle, and how fast the circle turns (radians a second; the inner ring turns the other way). */
  runes: 10,
  sigilSpin: 2.2,
  /** The thread from the sky flickers in after this share of the charge. */
  threadFrom: 0.5,
  /** The glow at the nose at the end of the charge. */
  nosePx: 40,
  /** The strike: the beam comes down in `dropMs`, holds `holdMs`, then narrows away over `fadeMs`. */
  dropMs: 60,
  holdMs: 400,
  fadeMs: 320,
  /** How tall it is (well out of sight above). */
  height: 2600,
  /** Its bands, outside in: width, strength, and how far towards white (0 its colour, 1 white). */
  bands: [
    { width: 190, alpha: 0.4, whiten: 0 },
    { width: 84, alpha: 0.8, whiten: 0.15 },
    { width: 36, alpha: 1, whiten: 0.65 },
    { width: 12, alpha: 1, whiten: 1 },
  ],
  /** As it lands it's this much wider for a moment (`slamMs`): the hit. */
  slam: 0.35,
  slamMs: 140,
  /** How much its width shimmers, and what's left of it as it narrows away (a share of its width). */
  shimmer: 0.07,
  thinTo: 0.05,
  /** Where it meets the ground: a white-hot foot, and light flooding the ground round it. */
  footPx: 120,
  floodPx: 360,
  /** The strike's flash, its shock ring (how wide, how quick), and dust thrown out. */
  flashPx: 240,
  ringPx: 300,
  ringMs: 480,
  dust: 6,
  dustTint: 0xb4a07e,
  /** Motes rising up inside it: how many a second, how fast, how long each lasts. */
  motesPerSec: 80,
  moteSpeed: [380, 950] as [number, number],
  moteLifeMs: [260, 560] as [number, number],
  /** Hot sparks splashing out from its foot as it lands. */
  sparks: 14,
  /** What it hits glows in its light while it holds. */
  hitAlpha: 0.7,
  /** A small jolt of the camera as it lands, if it's on screen (0: none). */
  shakeMs: 110,
  shake: 0,
  /** The scorch: size, darkness and how long it stays and fades; the molten glow in it, and how long it takes to cool. */
  scorchPx: 84,
  scorchAlpha: 0.65,
  scorchMs: 6500,
  scorchFadeMs: 3000,
  scorchTint: 0x140e0a,
  coolMs: 1800,
  cooled: 0x4a0804,
};

const between = ([a, b]: [number, number]) => a + Math.random() * (b - a);
const pick = (n: number) => Math.floor(Math.random() * n);

/** `a` blended `k` of the way to `b` (0xRRGGBB colours). */
function mix(a: number, b: number, k: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  /** Sparks fall back; motes float up. */
  spark: boolean;
}

/** The column: the charge, the strike, the fade. */
export const lightColumn: Look = (kit, s) => {
  const scene = kit.scene;
  ensureFxTextures(scene);
  const c = COLUMN;
  const glow = s.glow ?? 0xff2a1a;
  const white = mix(glow, 0xffffff, 0.75);
  const at = s.ground ?? s.to;
  const top = at.y - c.height;
  const end = c.chargeMs + c.dropMs + c.holdMs + c.fadeMs;
  const add = (x: number, y: number, key: string, tint: number, depth: number) =>
    scene.add.image(x, y, key).setTint(tint).setBlendMode(Phaser.BlendModes.ADD).setDepth(depth);

  // the charge: the runes on the ground (under the units), and the glow gathering at the nose
  const sigil = scene.add.graphics().setDepth(DEPTH.scorch + 0.7).setBlendMode(Phaser.BlendModes.ADD);
  const nose = [add(s.from.x, s.from.y, FX.dot, glow, DEPTH.ui - 5), add(s.from.x, s.from.y, FX.dot, white, DEPTH.ui - 5)];
  for (const n of nose) n.setDisplaySize(1, 1);

  // the strike's parts, made when it lands
  let bands: Phaser.GameObjects.Image[] = [];
  let foot: Phaser.GameObjects.Image[] = [];
  let flood: Phaser.GameObjects.Image | null = null;
  let lit: { copy: Phaser.GameObjects.Image; of: Flashable }[] = [];
  const motes: Mote[] = [];
  let moteDue = 0;
  let age = 0;

  const strike = () => {
    kit.landed(at);
    // the nose lets go: a flash, then out
    for (const n of nose) {
      n.setDisplaySize(c.nosePx * 1.4, c.nosePx * 1.4);
      scene.tweens.add({ targets: n, scale: n.scale * 0.2, alpha: 0, duration: 160, ease: 'Quad.easeOut', onComplete: () => n.destroy() });
    }
    sigil.destroy();
    // the beam: FX.beam bands stood upright, from the ground up
    bands = c.bands.map((b) => scene.add.image(at.x, top, FX.beam).setOrigin(0, 0.5).setRotation(-Math.PI / 2)
      .setTint(mix(glow, 0xffffff, b.whiten)).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.ui - 5).setDisplaySize(1, 1));
    foot = [add(at.x, at.y, FX.dot, glow, DEPTH.ui - 5), add(at.x, at.y, FX.dot, 0xffffff, DEPTH.ui - 5)];
    flood = add(at.x, at.y, FX.dot, glow, DEPTH.scorch + 0.6);
    // what it hits, bathed in its light
    lit = (s.hit?.targets ?? []).filter((t) => t.active && t.visible).map((t) => ({
      of: t,
      copy: scene.add.image(t.x, t.y, t.texture.key, t.frame.name).setOrigin(t.originX, t.originY).setScale(t.scaleX, t.scaleY)
        .setFlip(t.flipX, t.flipY).setDepth(t.depth + 1e-4).setTintFill(mix(glow, 0xffffff, 0.6)).setBlendMode(Phaser.BlendModes.ADD),
    }));
    landing(scene, at, glow, white);
    scorch(scene, at, glow);
    for (let i = 0; i < c.sparks; i++) {
      const a = Math.PI + Math.random() * Math.PI;
      const v = between([160, 420]);
      motes.push({ x: at.x, y: at.y - 6, vx: Math.cos(a) * v * 1.4, vy: Math.sin(a) * v * 0.7, age: 0, life: between([300, 520]), spark: true });
    }
    const cam = scene.cameras.main;
    if (c.shake > 0 && cam.worldView.contains(at.x, at.y)) cam.shake(c.shakeMs, c.shake);
  };

  kit.add({
    step(ms, g) {
      const was = age;
      age += ms;
      if (age < c.chargeMs) {
        charge(sigil, g, nose, s.from, at, top, age, glow, white);
        return true;
      }
      if (was < c.chargeMs) strike();
      const t = age - c.chargeMs;
      if (age >= end) {
        for (const o of [...bands, ...foot, ...lit.map((l) => l.copy)]) o.destroy();
        flood?.destroy();
        return false;
      }

      // how far down it's come, how wide it is (the slam as it lands, narrowing away at the end), how bright
      const drop = Math.min(1, t / c.dropMs);
      const bottom = top + (at.y - top) * drop * drop;
      const out = Math.max(0, (t - c.dropMs - c.holdMs) / c.fadeMs);
      const slam = 1 + c.slam * Math.max(0, 1 - Math.max(0, t - c.dropMs) / c.slamMs);
      const narrow = 1 - (1 - c.thinTo) * (1 - Math.pow(1 - Math.min(1, out * 1.5), 3));
      const bright = out < 0.6 ? 1 : 1 - (out - 0.6) / 0.4;
      const w = slam * narrow;
      bands.forEach((im, i) => {
        const b = c.bands[i];
        const sh = 1 + c.shimmer * (Math.sin(t / 21 + i * 1.9) * 0.6 + (Math.random() - 0.5) * 0.8);
        im.setPosition(at.x, bottom).setDisplaySize(Math.max(1, bottom - top), b.width * w * sh).setAlpha(b.alpha * bright);
      });
      const pulse = 0.9 + 0.1 * Math.sin(t / 17) + Math.random() * 0.06;
      const landed = drop >= 1 ? 1 : 0;
      foot[0].setDisplaySize(c.footPx * 1.8 * w * pulse, c.footPx * 0.9 * w * pulse).setAlpha(0.8 * bright * landed);
      foot[1].setDisplaySize(c.footPx * w * pulse, c.footPx * 0.5 * w * pulse).setAlpha(bright * landed);
      const fl = c.floodPx * (0.92 + 0.08 * pulse) * (0.5 + 0.5 * narrow);
      flood!.setDisplaySize(fl, fl / 2).setAlpha(0.85 * bright * landed);
      for (const l of lit) {
        if (!l.of.active) { l.copy.setVisible(false); continue; }
        l.copy.setPosition(l.of.x, l.of.y).setTexture(l.of.texture.key, l.of.frame.name).setFlip(l.of.flipX, l.of.flipY)
          .setAlpha(c.hitAlpha * bright * (out > 0 ? 1 - out : 0.8 + 0.2 * Math.sin(t / 28)) * (t < c.dropMs + 90 ? 1.4 : 1));
      }

      // motes rising up inside it while it holds; sparks splashing out of its foot
      if (landed && out < 0.5) {
        moteDue += (c.motesPerSec * ms) / 1000;
        for (; moteDue >= 1; moteDue--) {
          const spread = c.bands[2].width * w * 0.6;
          motes.push({
            x: at.x + (Math.random() - 0.5) * spread, y: at.y - Math.random() * 40, vx: 0, vy: -between(c.moteSpeed),
            age: 0, life: between(c.moteLifeMs), spark: false,
          });
        }
      }
      const dt = ms / 1000;
      for (let i = motes.length - 1; i >= 0; i--) {
        const m = motes[i];
        m.age += ms;
        if (m.age >= m.life) { motes.splice(i, 1); continue; }
        if (m.spark) m.vy += 900 * dt;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        const k = m.age / m.life;
        const a = (1 - k) * (m.spark ? 1 : Math.min(1, k * 5));
        const len = m.spark ? 0.025 : 0.018;
        g.lineStyle(m.spark ? 2 : 2.5, m.spark ? mix(white, glow, k) : 0xffffff, a).lineBetween(m.x - m.vx * len, m.y - m.vy * len, m.x, m.y);
      }
      return true;
    },
  });
};

/** The charge, `age` ms in: the targeting circle tightening and turning, the nose gathering light, the thread from the sky. */
function charge(sigil: Phaser.GameObjects.Graphics, g: Phaser.GameObjects.Graphics, nose: Phaser.GameObjects.Image[], from: Point, at: Point, top: number, age: number, glow: number, white: number): void {
  const c = COLUMN;
  const k = age / c.chargeMs;
  const e = k * k * (3 - 2 * k);
  const w = c.sigilPx[0] + (c.sigilPx[1] - c.sigilPx[0]) * e;
  const turn = (age / 1000) * c.sigilSpin;
  const a = 0.25 + 0.75 * k;
  // an ellipse point at angle `t`, `r` of the circle's half-width out
  const p = (t: number, r: number) => ({ x: at.x + Math.cos(t) * (w / 2) * r, y: at.y + Math.sin(t) * (w / 4) * r });
  sigil.clear();
  sigil.lineStyle(3, glow, 0.7 * a).strokeEllipse(at.x, at.y, w, w / 2);
  sigil.lineStyle(1.5, white, 0.6 * a).strokeEllipse(at.x, at.y, w * 1.08, w * 0.54);
  // rune marks round the outside: short ticks turning with the circle, every other one doubled
  for (let i = 0; i < c.runes; i++) {
    const t = turn + (i / c.runes) * Math.PI * 2;
    const p1 = p(t, 1.12), p2 = p(t, i % 2 ? 1.24 : 1.32);
    sigil.lineStyle(2.5, white, 0.85 * a).lineBetween(p1.x, p1.y, p2.x, p2.y);
    if (i % 2 === 0) {
      const q1 = p(t + 0.08, 1.14), q2 = p(t + 0.08, 1.24);
      sigil.lineStyle(1.5, glow, 0.8 * a).lineBetween(q1.x, q1.y, q2.x, q2.y);
    }
  }
  // the inner ring, broken into arcs, turning the other way
  for (let i = 0; i < 4; i++) {
    const t0 = -turn * 1.6 + (i / 4) * Math.PI * 2;
    const pts = Array.from({ length: 7 }, (_, j) => p(t0 + (j / 6) * 1.1, 0.62));
    sigil.lineStyle(2, glow, 0.75 * a).strokePoints(pts);
  }
  // the centre, brightening
  sigil.fillStyle(glow, 0.35 * a).fillEllipse(at.x, at.y, w * 0.4, w * 0.2);
  sigil.fillStyle(white, 0.5 * k * k).fillEllipse(at.x, at.y, w * 0.16, w * 0.08);

  // the nose: a glow swelling and flickering, with specks of light drawn into it
  const f = (0.3 + 0.7 * e) * (0.88 + Math.random() * 0.24);
  nose[0].setDisplaySize(c.nosePx * 1.6 * f, c.nosePx * 1.6 * f).setAlpha(0.7);
  nose[1].setDisplaySize(c.nosePx * 0.6 * f, c.nosePx * 0.6 * f);
  for (let i = 0; i < 6; i++) {
    const ph = (age / 200 + i / 6) % 1;
    const t = (i / 6) * Math.PI * 2 + age / 400;
    const r = 34 * (1 - ph);
    g.fillStyle(white, ph * 0.9).fillCircle(from.x + Math.cos(t) * r, from.y + Math.sin(t) * r * 0.7, 1.8);
  }

  // the thread from the sky: faint, thin, flickering
  if (k > c.threadFrom && Math.random() < 0.8) {
    const ta = ((k - c.threadFrom) / (1 - c.threadFrom)) * (0.5 + Math.random() * 0.5);
    g.lineStyle(6, glow, 0.15 * ta).lineBetween(at.x, top, at.x, at.y);
    g.lineStyle(1.5, white, 0.45 * ta).lineBetween(at.x, top, at.x, at.y);
  }
}

/** The moment it lands: a flash, a shock ring and a fainter wider one racing out over the ground, dust thrown out. */
function landing(scene: Phaser.Scene, at: Point, glow: number, white: number): void {
  const c = COLUMN;
  const glowAt = (px: number, tint: number, ms: number, depth: number, squash = 1) => {
    const im = scene.add.image(at.x, at.y - (squash < 1 ? 0 : 24), FX.dot).setTint(tint).setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(depth).setDisplaySize(px, px * squash);
    scene.tweens.add({ targets: im, scaleX: im.scaleX * 1.5, scaleY: im.scaleY * 1.5, alpha: 0, duration: ms, ease: 'Quad.easeOut', onComplete: () => im.destroy() });
  };
  glowAt(c.flashPx * 0.5, 0xffffff, 140, DEPTH.ui - 4.9);
  glowAt(c.flashPx, glow, 320, DEPTH.ui - 5);
  glowAt(c.floodPx * 1.4, white, 260, DEPTH.scorch + 0.6, 0.5);

  const ri = FX_SHEETS.impactRing;
  const ring = (frame: number, tint: number, toPx: number, ms: number, alpha: number) => {
    const im = scene.add.image(at.x, at.y, ri.key, frame).setTint(tint).setBlendMode(Phaser.BlendModes.ADD).setAlpha(alpha)
      .setDepth(DEPTH.scorch + 0.8).setScale(24 / 128, 12 / 128);
    scene.tweens.add({
      targets: im, scaleX: toPx / 128, scaleY: toPx / 256, alpha: 0, duration: ms, ease: 'Cubic.easeOut', onComplete: () => im.destroy(),
    });
  };
  ring(1, white, c.ringPx, c.ringMs, 1);
  ring(0, glow, c.ringPx * 1.5, c.ringMs * 1.4, 0.6);

  const pf = FX_SHEETS.impactPuff;
  for (let i = 0; i < c.dust; i++) {
    const a = (i / c.dust) * Math.PI * 2 + Math.random() * 0.6;
    const p = scene.add.image(at.x, at.y, pf.key, pick(pf.frames)).setTint(c.dustTint).setAlpha(0.6).setScale(0.14)
      .setRotation(Math.random() * Math.PI * 2).setDepth(DEPTH.scorch + 1);
    scene.tweens.add({
      targets: p, x: at.x + Math.cos(a) * 80, y: at.y + Math.sin(a) * 40 - 12, scaleX: 0.42, scaleY: 0.3, alpha: 0,
      duration: between([800, 1100]), ease: 'Cubic.easeOut', onComplete: () => p.destroy(),
    });
  }
}

/** The scorch it burns: dark, with a molten glow in it that cools from white-hot through its colour to a dull red; a wisp of smoke after. */
function scorch(scene: Phaser.Scene, at: Point, glow: number): void {
  const c = COLUMN;
  const sc = FX_SHEETS.impactScorch;
  const px = c.scorchPx * between([0.9, 1.1]);
  const frame = pick(sc.frames);
  const flip = Math.random() < 0.5;
  const mark = scene.add.image(at.x, at.y, sc.key, frame).setDisplaySize(px, px / 2).setTint(c.scorchTint).setFlipX(flip).setAlpha(0).setDepth(DEPTH.scorch);
  scene.tweens.add({ targets: mark, alpha: c.scorchAlpha, duration: 200 });
  scene.tweens.add({ targets: mark, alpha: 0, delay: c.scorchMs, duration: c.scorchFadeMs, onComplete: () => mark.destroy() });
  const hot = scene.add.image(at.x, at.y, sc.key, frame).setDisplaySize(px * 0.75, px * 0.375).setFlipX(flip)
    .setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.scorch + 0.5).setTint(0xffffff);
  const melt = scene.add.image(at.x, at.y, FX.dot).setDisplaySize(px * 0.5, px * 0.25).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.scorch + 0.5);
  // it stays white-hot while the beam holds, then cools
  const hold = c.dropMs + c.holdMs;
  const cool = { k: 0 };
  const tint = (k: number) => (k < 0.35 ? mix(0xfff4e8, glow, k / 0.35) : mix(glow, c.cooled, (k - 0.35) / 0.65));
  scene.tweens.add({
    targets: cool, k: 1, delay: hold, duration: c.coolMs, ease: 'Sine.easeOut',
    onUpdate: () => {
      const col = tint(cool.k);
      hot.setTint(col).setAlpha(1 - cool.k * cool.k);
      melt.setTint(col).setAlpha(0.8 * (1 - cool.k));
    },
    onComplete: () => { hot.destroy(); melt.destroy(); },
  });
  // a wisp of dark smoke curling up off it once the beam's gone
  const so = FX_SHEETS.impactSoft;
  for (let i = 0; i < 2; i++) {
    const p = scene.add.image(at.x + (Math.random() - 0.5) * 16, at.y - 6, so.key, pick(so.frames)).setTint(0x3a3430)
      .setScale(0.1).setAlpha(0).setRotation(Math.random() * Math.PI * 2).setDepth(DEPTH.scorch + 1);
    const delay = hold + c.fadeMs * 0.5 + i * 160;
    scene.tweens.add({ targets: p, alpha: 0.55, delay, duration: 200 });
    scene.tweens.add({
      targets: p, scale: 0.4, y: p.y - between([40, 70]), x: p.x + (Math.random() - 0.5) * 24, alpha: 0,
      delay: delay + 200, duration: between([1200, 1600]), ease: 'Sine.easeOut', onComplete: () => p.destroy(),
    });
  }
}
