import Phaser from 'phaser';
import { DEPTH } from '../../config/game';
import type { Point } from '../../core/geometry';
import { FX, FX_SHEETS, ensureFxTextures } from '../fxTextures';
import type { Flashable } from '../Impact';
import type { Kit, Live, Look, Shot } from './kit';

/**
 * The Grenadier's fragmentation grenade (world px and ms). A small dark charge, lobbed from the unit's nose on a low
 * arc, tumbling, with a light blinking in its side's colour and its shadow sliding along the ground under it. It lands
 * a little short, hops and skids the rest of the way, sits for a beat with its light blinking fast, then bursts: a
 * sharp flash, a puff of dark smoke, shrapnel streaking out on all sides (some skipping off the ground), dust, a scorch
 * peppered with pits, and what it hits flashes. The server has already decided the hit: this is only the look.
 */
export const FRAG = {
  /** Its speed over the ground, and the shortest and longest a throw takes. */
  speed: 640,
  flightMs: [380, 820] as [number, number],
  /** How high it's thrown: this share of the distance, but at least `minLift`. */
  lift: 0.3,
  minLift: 46,
  /** How high the thrower's nose is above the ground (where the throw starts, and where its shadow starts). */
  height: 54,
  /** The grenade: its radius, body, rim and the glint on it; how fast it tumbles (radians a second). */
  radius: 4.5,
  body: 0x2a2724,
  rim: 0x0c0b0a,
  shine: 0xbab3a6,
  spin: 16,
  /** Its light: blinks this many times a second in the air, faster once it's down; its size and glow. */
  blinkHz: 5,
  fuseBlinkHz: 20,
  light: 1.8,
  lightGlow: 7,
  /** It first touches down this far short of where it ends up, then hops `hopPx` high for `hopMs` and skids there. */
  shortPx: 20,
  hopPx: 8,
  hopMs: 150,
  /** The beat on the ground before it bursts. */
  fuseMs: [150, 250] as [number, number],
  /** The burst, this high off the ground: a white flash, a hot flare and a wider orange glow, and a flash over the ground. */
  burstHeight: 8,
  flashPx: 64,
  glowPx: 140,
  groundFlashPx: 190,
  hot: 0xfff4dc,
  fire: 0xffa040,
  /** Shrapnel: how many, how fast out and up, how long each flies, gravity, how much a bounce keeps, streak length (ms of travel). */
  shards: 26,
  shardSpeed: [400, 820] as [number, number],
  shardUp: [-120, 260] as [number, number],
  shardLifeMs: [200, 420] as [number, number],
  gravity: 1500,
  bounce: 0.35,
  streakMs: 20,
  shardHot: 0xfff2c8,
  shardCool: 0xff6a1a,
  /** Dark bits of casing flung out with it (fewer, slower, they tumble and settle). */
  chunks: 6,
  chunkSpeed: [120, 300] as [number, number],
  chunkLifeMs: [450, 750] as [number, number],
  /** Dark smoke: how many puffs, their colour and how thick. */
  smoke: 3,
  smokeTint: 0x2a2622,
  smokeAlpha: 0.8,
  /** Dust thrown out low along the ground. */
  dust: 5,
  dustTint: 0xb4a07e,
  /** The scorch: size, darkness, how long it stays and fades; how many shrapnel pits round it. */
  scorchPx: 60,
  scorchAlpha: 0.6,
  scorchMs: 6000,
  scorchFadeMs: 3000,
  scorchTint: 0x1a1410,
  pits: 7,
  /** What it hits glows white-hot for a moment. */
  hitMs: 130,
  hitAlpha: 0.8,
};

const between = ([a, b]: [number, number]) => a + Math.random() * (b - a);
const pick = (n: number) => Math.floor(Math.random() * n);

/** `a` blended `k` of the way to `b` (0xRRGGBB colours). */
function mix(a: number, b: number, k: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** The grenade: thrown, bounced, a beat, then the burst. */
export const fragGrenade: Look = (kit, s) => {
  const scene = kit.scene;
  ensureFxTextures(scene);
  const f = FRAG;
  const glow = s.glow ?? 0xff2a1a;
  const land = s.ground ?? s.to;
  // the ground under the thrower's nose, and where it first touches down (a little short)
  const start = { x: s.from.x, y: s.from.y + f.height };
  const dx = land.x - start.x, dy = land.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  const short = Math.min(f.shortPx, len * 0.3);
  const touch = { x: land.x - (dx / len) * short, y: land.y - (dy / len) * short };
  const flightLen = Math.hypot(touch.x - start.x, touch.y - start.y);
  const flightMs = Phaser.Math.Clamp((flightLen / f.speed) * 1000, f.flightMs[0], f.flightMs[1]);
  const lift = Math.max(f.minLift, flightLen * f.lift);
  const fuseMs = between(f.fuseMs);
  const hopEnd = flightMs + f.hopMs;
  const burstAt = hopEnd + fuseMs;

  const body = scene.add.graphics().setDepth(DEPTH.ui - 5.1);
  const shadow = scene.add.graphics().setDepth(DEPTH.scorch + 1);
  if (s.flash) toss(scene, s.from, glow);

  let age = 0;
  let spin = Math.random() * Math.PI * 2;
  let spinRate = f.spin * (Math.random() < 0.5 ? -1 : 1);
  let touched = false;
  kit.add({
    step(ms, g) {
      age += ms;
      if (age >= burstAt) {
        body.destroy();
        shadow.destroy();
        burst(kit, s, land, glow);
        return false;
      }
      let at: Point, h: number, hz = f.blinkHz;
      if (age < flightMs) {
        // on its arc: from the nose's height, up and over, down onto the ground
        const k = age / flightMs;
        at = { x: start.x + (touch.x - start.x) * k, y: start.y + (touch.y - start.y) * k };
        h = f.height * (1 - k) + 4 * k * (1 - k) * lift;
      } else if (age < hopEnd) {
        // touched down: a little hop and a skid the rest of the way, slowing
        if (!touched) {
          touched = true;
          puff(scene, touch, 0.07, 380);
        }
        const k = (age - flightMs) / f.hopMs;
        const e = 1 - (1 - k) * (1 - k);
        at = { x: touch.x + (land.x - touch.x) * e, y: touch.y + (land.y - touch.y) * e };
        h = 4 * k * (1 - k) * f.hopPx;
        spinRate *= Math.pow(0.2, ms / 1000);
      } else {
        // down, rattling a touch as the fuse runs
        at = { x: land.x + (Math.random() - 0.5) * 0.8, y: land.y };
        h = 0;
        hz = f.fuseBlinkHz;
        spinRate *= Math.pow(0.02, ms / 1000);
      }
      spin += (spinRate * ms) / 1000;

      // its shadow: smaller and fainter the higher it is
      const up = Math.min(1, h / (lift + f.height));
      const sw = f.radius * 3.2 * (1 - up * 0.45);
      shadow.clear().fillStyle(0x000000, 0.45 * (1 - up * 0.65)).fillEllipse(at.x, at.y, sw, sw * 0.5);

      // the grenade: a dark ball with a rim, its fuse lever and glint turning as it tumbles
      const r = f.radius;
      const x = at.x, y = at.y - h - r * 0.8;
      const cx = Math.cos(spin), cy = Math.sin(spin);
      body.clear()
        .fillStyle(f.rim, 1).fillCircle(x, y, r + 1)
        .lineStyle(2, f.rim, 1).lineBetween(x, y, x + cx * r * 1.6, y + cy * r * 1.6)
        .fillStyle(f.body, 1).fillCircle(x, y, r)
        .fillStyle(f.shine, 0.75).fillCircle(x - cy * r * 0.45, y + cx * r * 0.45, r * 0.32);

      // its light, on the far side of the lever, blinking
      const on = ((age / 1000) * hz) % 1 < 0.5;
      if (on) {
        const lx = x - cx * r * 0.5, ly = y - cy * r * 0.5;
        g.fillStyle(glow, 0.35).fillCircle(lx, ly, f.lightGlow);
        g.fillStyle(glow, 0.8).fillCircle(lx, ly, f.light * 1.8);
        g.fillStyle(mix(glow, 0xffffff, 0.7), 1).fillCircle(lx, ly, f.light);
      }
      return true;
    },
  });
};

/** The throw: a small soft pop at the nose in its side's colour. */
function toss(scene: Phaser.Scene, at: Point, glow: number): void {
  const p = scene.add.image(at.x, at.y, FX.dot).setTint(glow).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.ui - 5).setDisplaySize(22, 22);
  scene.tweens.add({ targets: p, scale: p.scale * 0.3, alpha: 0, duration: 140, ease: 'Quad.easeOut', onComplete: () => p.destroy() });
}

/** A small dust puff kicked up off the ground. */
function puff(scene: Phaser.Scene, at: Point, scale: number, ms: number, drift: Point = { x: 0, y: -12 }): void {
  const pf = FX_SHEETS.impactPuff;
  const p = scene.add.image(at.x, at.y, pf.key, pick(pf.frames)).setTint(FRAG.dustTint).setAlpha(0.6).setScale(scale)
    .setRotation(Math.random() * Math.PI * 2).setDepth(DEPTH.scorch + 1);
  scene.tweens.add({
    targets: p, scaleX: scale * 2.6, scaleY: scale * 1.8, x: at.x + drift.x, y: at.y + drift.y, alpha: 0, duration: ms,
    ease: 'Cubic.easeOut', onComplete: () => p.destroy(),
  });
}

/** A flying bit: its place on the ground (x, y), its height (z) and velocities, in world px. */
interface Bit {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  bounces: number;
}

/** A bit flung out from `at` in a random direction over the ground (half as fast in y, for the isometric view). */
function fling(at: Point, z: number, speed: [number, number], up: [number, number], life: [number, number], bounces: number): Bit {
  const a = Math.random() * Math.PI * 2;
  const v = between(speed);
  return { x: at.x, y: at.y, z, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5, vz: between(up), age: 0, life: between(life), bounces };
}

/** Moves a bit on by `dt` seconds; when it hits the ground it skips off (if it has a bounce left) or slides. Returns true when it bounced. */
function move(b: Bit, dt: number): boolean {
  b.vz -= FRAG.gravity * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;
  if (b.z > 0 || b.vz >= 0) return false;
  b.z = 0;
  if (b.bounces-- > 0) {
    b.vz = -b.vz * FRAG.bounce;
    b.vx *= 0.55;
    b.vy *= 0.55;
    return true;
  }
  b.vz = 0;
  b.vx *= 0.8;
  b.vy *= 0.8;
  return false;
}

/** The burst where it lies: flash, smoke, shrapnel, dust, the scorch, and what it hits flashes. */
function burst(kit: Kit, s: Shot, land: Point, glow: number): void {
  const scene = kit.scene;
  const f = FRAG;
  const depth = s.hit?.depth !== undefined ? s.hit.depth + 0.01 : DEPTH.ui - 6;
  const c = { x: land.x, y: land.y - f.burstHeight };
  kit.landed(land);
  hitFlash(scene, s.hit?.targets);

  // the flash: a hard white pop, a jagged flare, a wider orange glow, a quick ring with a hint of its side's colour,
  // and the ground lit up round it
  const add = (key: string, frame: number | undefined, tint: number, d: number) =>
    scene.add.image(c.x, c.y, key, frame).setTint(tint).setBlendMode(Phaser.BlendModes.ADD).setDepth(d);
  const pop = add(FX.dot, undefined, 0xffffff, depth + 3e-4).setDisplaySize(f.flashPx, f.flashPx);
  scene.tweens.add({ targets: pop, scale: pop.scale * 1.5, alpha: 0, duration: 90, ease: 'Quad.easeOut', onComplete: () => pop.destroy() });
  const fl = FX_SHEETS.impactFlare;
  const flare = add(fl.key, pick(fl.frames), f.hot, depth + 2e-4).setScale(0.32).setRotation(Math.random() * Math.PI * 2);
  scene.tweens.add({ targets: flare, scale: 0.5, alpha: 0, duration: 130, ease: 'Quad.easeOut', onComplete: () => flare.destroy() });
  const fire = add(FX.dot, undefined, f.fire, depth + 1e-4).setDisplaySize(f.glowPx, f.glowPx).setAlpha(0.85);
  scene.tweens.add({ targets: fire, scale: fire.scale * 1.3, alpha: 0, duration: 260, ease: 'Quad.easeOut', onComplete: () => fire.destroy() });
  const ri = FX_SHEETS.impactRing;
  const ring = add(ri.key, 0, mix(glow, 0xffffff, 0.6), depth + 1e-4).setPosition(land.x, land.y).setScale(0.08, 0.04).setAlpha(0.8);
  scene.tweens.add({ targets: ring, scaleX: 0.75, scaleY: 0.375, alpha: 0, duration: 240, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
  const lit = scene.add.image(land.x, land.y, FX.dot).setTint(f.fire).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.scorch + 0.5)
    .setDisplaySize(f.groundFlashPx, f.groundFlashPx / 2).setAlpha(0.8);
  scene.tweens.add({ targets: lit, alpha: 0, duration: 300, ease: 'Quad.easeOut', onComplete: () => lit.destroy() });

  // a puff of dark smoke that billows up and thins out
  const so = FX_SHEETS.impactSoft;
  for (let i = 0; i < f.smoke; i++) {
    const p = scene.add.image(c.x + (Math.random() - 0.5) * 14, c.y - Math.random() * 6, so.key, pick(so.frames)).setTint(f.smokeTint)
      .setScale(0.1).setAlpha(f.smokeAlpha).setRotation(Math.random() * Math.PI * 2).setDepth(depth - 1e-4);
    scene.tweens.add({
      targets: p, scale: between([0.34, 0.46]), x: p.x + (Math.random() - 0.5) * 30, y: p.y - between([22, 42]), rotation: p.rotation + (Math.random() - 0.5),
      alpha: 0, delay: 30 * i, duration: between([900, 1300]), ease: 'Cubic.easeOut', onComplete: () => p.destroy(),
    });
  }

  // dust thrown out low along the ground, and a dust ring racing out
  for (let i = 0; i < f.dust; i++) {
    const a = (i / f.dust) * Math.PI * 2 + Math.random() * 0.8;
    puff(scene, land, 0.12, between([700, 1000]), { x: Math.cos(a) * 46, y: Math.sin(a) * 23 - 14 });
  }
  const dr = scene.add.image(land.x, land.y, so.key, 2).setTint(f.dustTint).setAlpha(0.7).setDisplaySize(18, 9).setDepth(DEPTH.scorch + 1);
  scene.tweens.add({ targets: dr, displayWidth: 130, displayHeight: 65, alpha: 0, duration: 380, ease: 'Cubic.easeOut', onComplete: () => dr.destroy() });

  scorch(scene, land);

  // shrapnel streaking out on all sides (some straight into the ground, skipping off it), and dark bits of casing
  const shards = Array.from({ length: f.shards }, () => fling(land, f.burstHeight, f.shardSpeed, f.shardUp, f.shardLifeMs, 1));
  const chunks = Array.from({ length: f.chunks }, () => fling(land, f.burstHeight, f.chunkSpeed, [120, 320], f.chunkLifeMs, 2));
  const sparks: { x: number; y: number; age: number }[] = [];
  const bits = scene.add.graphics().setDepth(depth + 1e-4);
  kit.add({
    step(ms, g) {
      const dt = ms / 1000;
      let alive = false;
      for (const b of shards) {
        if (b.age >= b.life) continue;
        b.age += ms;
        alive = true;
        if (move(b, dt)) sparks.push({ x: b.x, y: b.y, age: 0 });
        const k = Math.min(1, b.age / b.life);
        const t = f.streakMs / 1000;
        const hx = b.x, hy = b.y - b.z;
        const tx = hx - b.vx * t, ty = hy + b.vz * t - b.vy * t;
        g.lineStyle(2, mix(f.shardHot, f.shardCool, k), 1 - k * k).lineBetween(tx, ty, hx, hy);
      }
      bits.clear();
      for (const b of chunks) {
        if (b.age >= b.life) continue;
        b.age += ms;
        alive = true;
        move(b, dt);
        const k = b.age / b.life;
        bits.fillStyle(f.rim, 0.9 * (1 - k * k)).fillRect(b.x - 1.5, b.y - b.z - 1.5, 3, 3);
      }
      // a tiny spark where a shard skips off the ground
      for (const p of sparks) {
        if ((p.age += ms) >= 90) continue;
        alive = true;
        const a = 1 - p.age / 90;
        g.fillStyle(f.shardHot, a).fillCircle(p.x, p.y, 2.5);
        g.fillStyle(f.fire, 0.4 * a).fillCircle(p.x, p.y, 6);
      }
      if (!alive) bits.destroy();
      return alive;
    },
  } satisfies Live);
}

/** The scorch: a dark mark peppered with shrapnel pits, glowing hot for a moment, staying a while and fading. */
function scorch(scene: Phaser.Scene, at: Point): void {
  const f = FRAG;
  const sc = FX_SHEETS.impactScorch;
  const px = f.scorchPx * between([0.9, 1.15]);
  const mark = scene.add.image(at.x, at.y, sc.key, pick(sc.frames)).setDisplaySize(px, px / 2).setTint(f.scorchTint)
    .setFlipX(Math.random() < 0.5).setAlpha(0).setDepth(DEPTH.scorch);
  const pits = scene.add.graphics().setDepth(DEPTH.scorch).setAlpha(0);
  for (let i = 0; i < f.pits; i++) {
    const a = Math.random() * Math.PI * 2, d = between([px * 0.35, px * 0.75]);
    const r = between([1.2, 2.4]);
    pits.fillStyle(f.scorchTint, 0.7).fillEllipse(at.x + Math.cos(a) * d, at.y + Math.sin(a) * d * 0.5, r * 2, r);
  }
  scene.tweens.add({ targets: mark, alpha: f.scorchAlpha, duration: 80 });
  scene.tweens.add({ targets: pits, alpha: 1, duration: 80 });
  scene.tweens.add({
    targets: [mark, pits], alpha: 0, delay: f.scorchMs, duration: f.scorchFadeMs,
    onComplete: () => { mark.destroy(); pits.destroy(); },
  });
  const hot = scene.add.image(at.x, at.y, sc.key, mark.frame.name).setDisplaySize(px * 0.6, px * 0.3).setFlipX(mark.flipX)
    .setTint(f.fire).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.85).setDepth(DEPTH.scorch + 0.5);
  scene.tweens.add({ targets: hot, alpha: 0, duration: 650, ease: 'Quad.easeIn', onComplete: () => hot.destroy() });
}

/** What it hits glows white-hot for a moment: a white copy of each of its sprites over it, fading out. */
function hitFlash(scene: Phaser.Scene, targets: Flashable[] = []): void {
  for (const t of targets) {
    if (!t.active || !t.visible) continue;
    const c = scene.add.image(t.x, t.y, t.texture.key, t.frame.name)
      .setOrigin(t.originX, t.originY).setScale(t.scaleX, t.scaleY).setFlip(t.flipX, t.flipY)
      .setDepth(t.depth + 1e-4).setTintFill(0xfff2d8).setAlpha(FRAG.hitAlpha).setBlendMode(Phaser.BlendModes.ADD);
    scene.tweens.add({ targets: c, alpha: 0, duration: FRAG.hitMs, ease: 'Quad.easeOut', onComplete: () => c.destroy() });
  }
}
