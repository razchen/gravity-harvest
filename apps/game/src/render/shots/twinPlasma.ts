import Phaser from 'phaser';
import { DEPTH } from '../../config/game';
import type { Point } from '../../core/geometry';
import type { Flashable } from '../Impact';
import { FX, FX_SHEETS, ensureFxTextures } from '../fxTextures';
import type { Live, Look, Shot } from './kit';

/**
 * The Hound's twin plasma: one ball from each side pod, `gapMs` apart. Each pod glints as it charges (`chargeMs`),
 * then lets go of a ball: a white-hot core in a glow of its side's colour, wobbling a little and pulsing as it flies,
 * with a short smeared tail fading behind it. Where it lands it sizzles: a hot flash, a ring of its colour racing
 * out, droplets flung off that fall and cool, specks popping for a moment, and (on open ground) a glowing scorch that
 * cools to a faint mark. All of it is drawn into the shared additive Graphics except what it hits flashing and the
 * scorch, so a pack of Hounds firing stays cheap. World px and ms.
 */
export const TWIN_PLASMA = {
  /** Gap between the two pods' balls, and how long each pod glints before it lets go. */
  gapMs: 45,
  chargeMs: 50,
  /** The glint at the pod: how big it swells. */
  glintPx: 13,
  /** Flight speed. */
  speed: 1500,
  /** The ball: white core, a paler middle and the coloured glow round it (radii). */
  core: 3.6,
  mid: 6.5,
  halo: 14,
  /** It pulses this much (share of its size), this many times a second. */
  pulse: 0.18,
  pulseHz: 22,
  /** It wobbles off its line this far (px), this many times a second (none as it leaves and lands). */
  wobble: 3,
  wobbleHz: 14,
  /** Its smeared tail: how long, and how many blobs it's drawn with. */
  tail: 34,
  tailBlobs: 5,
  /** The two balls land this far apart on the target, so their splashes don't sit on each other. */
  spread: 7,
  /** The splash: how long, how big its flash and ring get. */
  splashMs: 230,
  flashPx: 22,
  ringPx: 40,
  /** Droplets flung off where it lands: how many, how fast, how long they last, and how hard they fall. */
  drops: 6,
  dropSpeed: [90, 230] as [number, number],
  dropMs: [180, 320] as [number, number],
  dropGravity: 700,
  /** Specks popping round where it landed while it sizzles: how many a second, and how far out. */
  pops: 60,
  popPx: 12,
  /** What it hits glows in its colour (this much of the way to white) for a moment. */
  hitFlashMs: 120,
  hitFlashAlpha: 0.7,
  hitWhiten: 0.45,
  /** On open ground: a glowing scorch (`scorchPx` wide) that cools over `glowMs`; a faint dark mark stays `markMs`. */
  scorchPx: 30,
  glowMs: 650,
  markMs: 1600,
  markAlpha: 0.35,
  markColour: 0x1c1610,
  /** Its colour when the shot doesn't bring one (Sable's red). */
  glow: 0xff2a1a,
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

interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

export const twinPlasma: Look = (kit, s) => {
  const guns = s.guns.length ? s.guns : [s.from];
  let sounded = false;
  guns.forEach((gun, i) => {
    // each ball lands a little off the aim point, sideways to the line it came in on
    const dx = s.to.x - gun.x, dy = s.to.y - gun.y;
    const len = Math.hypot(dx, dy) || 1;
    const side = guns.length > 1 ? (i - (guns.length - 1) / 2) * TWIN_PLASMA.spread : rand(-0.5, 0.5) * TWIN_PLASMA.spread;
    const to = { x: s.to.x + (-dy / len) * side, y: s.to.y + (dx / len) * side * 0.6 };
    kit.add(ball(kit.scene, s, gun, to, -i * TWIN_PLASMA.gapMs, () => {
      // one sound for the pair
      if (!sounded) kit.landed('bullet', to);
      sounded = true;
    }));
  });
};

/** One ball from `gun` to `to`, starting `age` ms in (negative: it waits). */
function ball(scene: Phaser.Scene, s: Shot, gun: Point, to: Point, age: number, onLand: () => void): Live {
  const P = TWIN_PLASMA;
  const colour = s.glow ?? P.glow;
  const pale = whiten(colour, 0.55);
  const dx = to.x - gun.x, dy = to.y - gun.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const flight = (len / P.speed) * 1000;
  const phase = rand(0, Math.PI * 2);
  const landAt = P.chargeMs + flight;
  let landed = false;
  const drops: Drop[] = [];
  let scorch: { glow: Phaser.GameObjects.Image; mark: Phaser.GameObjects.Image } | null = null;
  const end = landAt + Math.max(P.splashMs, P.dropMs[1], s.ground ? P.markMs : 0);

  /** Where the ball is `t` ms into its flight (0..flight), wobbling off its line. */
  const at = (t: number): Point => {
    const k = Phaser.Math.Clamp(t / flight, 0, 1);
    const w = P.wobble * Math.sin((t / 1000) * P.wobbleHz * Math.PI * 2 + phase) * 4 * k * (1 - k);
    return { x: gun.x + dx * k - uy * w, y: gun.y + dy * k + ux * w };
  };

  const land = () => {
    landed = true;
    onLand();
    for (let i = 0; i < P.drops; i++) {
      // flung back up and out, mostly away from the side it came in on
      const a = Math.atan2(-uy, -ux) + rand(-1.6, 1.6);
      const v = between(P.dropSpeed);
      drops.push({ x: to.x, y: to.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7 - rand(40, 120), life: between(P.dropMs) });
    }
    hitFlash(scene, s.hit?.targets, whiten(colour, P.hitWhiten));
    if (s.ground) scorch = scorchAt(scene, s.ground, colour);
  };

  return {
    step(ms, g) {
      age += ms;
      if (age < 0) return true;
      if (age < P.chargeMs) {
        // the pod glints as it charges: a glow swelling round a white pinpoint, a quick cross of light
        const k = age / P.chargeMs;
        const r = P.glintPx * (0.4 + 0.6 * k);
        if (s.flash) {
          g.fillStyle(colour, 0.35 * k).fillCircle(gun.x, gun.y, r);
          g.fillStyle(pale, 0.7 * k).fillCircle(gun.x, gun.y, r * 0.45);
          g.lineStyle(1.2, 0xffffff, 0.8 * k).lineBetween(gun.x - r * 1.2, gun.y, gun.x + r * 1.2, gun.y).lineBetween(gun.x, gun.y - r * 0.6, gun.x, gun.y + r * 0.6);
        }
        g.fillStyle(0xffffff, k).fillCircle(gun.x, gun.y, P.core * 0.6 * k);
        return true;
      }
      const t = age - P.chargeMs;
      if (t < flight) {
        // the release: the glint snaps bright and shrinks away as the ball leaves
        if (s.flash && t < 70) {
          const k = 1 - t / 70;
          g.fillStyle(colour, 0.5 * k).fillCircle(gun.x, gun.y, P.glintPx * (1 + 0.4 * (1 - k)));
          g.fillStyle(0xffffff, 0.8 * k).fillCircle(gun.x, gun.y, P.core * 1.4 * k);
        }
        const head = at(t);
        const pulse = 1 + P.pulse * Math.sin((t / 1000) * P.pulseHz * Math.PI * 2 + phase);
        // the tail: blobs back along where it has been, shrinking and fading, over a soft smear
        const tailMs = (P.tail / P.speed) * 1000;
        const back = at(Math.max(0, t - tailMs));
        g.lineStyle(P.mid * 1.6, colour, 0.22).lineBetween(back.x, back.y, head.x, head.y);
        for (let b = P.tailBlobs; b >= 1; b--) {
          const kb = b / (P.tailBlobs + 1);
          const p = at(Math.max(0, t - tailMs * kb));
          g.fillStyle(colour, 0.32 * (1 - kb)).fillCircle(p.x, p.y, P.mid * (1 - kb * 0.6));
        }
        // the ball: a wide glow, a paler middle and the white-hot core
        g.fillStyle(colour, 0.28).fillCircle(head.x, head.y, P.halo * pulse);
        g.fillStyle(colour, 0.55).fillCircle(head.x, head.y, P.mid * pulse);
        g.fillStyle(pale, 0.85).fillCircle(head.x, head.y, (P.core + 1.6) * pulse);
        g.fillStyle(0xffffff, 1).fillCircle(head.x, head.y, P.core * pulse);
        return true;
      }
      if (!landed) land();
      const st = age - landAt;
      // the splash: a hot flash, a ring racing out (flat, it's round the target), then the sizzle
      if (st < P.splashMs) {
        const k = st / P.splashMs;
        const f = Math.max(0, 1 - k * 2.5);
        if (f > 0) {
          g.fillStyle(colour, 0.5 * f).fillCircle(to.x, to.y, P.flashPx * (0.7 + 0.6 * (1 - f)));
          g.fillStyle(0xffffff, 0.9 * f).fillCircle(to.x, to.y, P.flashPx * 0.35 * (0.6 + 0.4 * f));
        }
        const ring = Phaser.Math.Easing.Cubic.Out(k);
        g.lineStyle(2.5 * (1 - k) + 0.5, pale, 0.8 * (1 - k)).strokeEllipse(to.x, to.y, P.ringPx * ring, P.ringPx * ring * 0.5);
        g.fillStyle(colour, 0.25 * (1 - k)).fillCircle(to.x, to.y, P.flashPx * 0.6);
        // specks popping as it sizzles
        const due = (P.pops * ms) / 1000;
        const n = Math.floor(due) + (Math.random() < due % 1 ? 1 : 0);
        for (let i = 0; i < n; i++) {
          const a = rand(0, Math.PI * 2), r = rand(2, P.popPx);
          const x = to.x + Math.cos(a) * r, y = to.y + Math.sin(a) * r * 0.7;
          g.fillStyle(colour, 0.6 * (1 - k)).fillCircle(x, y, 3);
          g.fillStyle(0xffffff, 1 - k).fillCircle(x, y, 1.1);
        }
      }
      // droplets: fly off, fall and cool, a streak behind each
      const dt = ms / 1000;
      for (const d of drops) {
        if (st >= d.life) continue;
        d.vy += P.dropGravity * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        const a = 1 - st / d.life;
        g.lineStyle(2.4, colour, 0.75 * a).lineBetween(d.x - d.vx * 0.03, d.y - d.vy * 0.03, d.x, d.y);
        g.fillStyle(pale, a).fillCircle(d.x, d.y, 1.3);
      }
      // the scorch cools: the glow fades fast, the dark mark slowly
      if (scorch) {
        const { glow, mark } = scorch;
        glow.setAlpha(Math.max(0, 0.9 * (1 - st / P.glowMs)));
        const fadeIn = Math.min(1, st / 120);
        mark.setAlpha(P.markAlpha * fadeIn * Math.min(1, Math.max(0, (P.markMs - st) / (P.markMs * 0.5))));
      }
      if (age < end) return true;
      if (scorch) {
        scorch.glow.destroy();
        scorch.mark.destroy();
      }
      return false;
    },
  };
}

/** A small scorch where it landed on open ground: a faint dark mark under a glow of its colour (faded by the ball's step). */
function scorchAt(scene: Phaser.Scene, ground: Point, colour: number) {
  ensureFxTextures(scene);
  const P = TWIN_PLASMA;
  const sc = FX_SHEETS.impactScorch;
  const sheet = scene.textures.exists(sc.key);
  const px = P.scorchPx * rand(0.85, 1.15);
  const frame = sheet ? Math.floor(Math.random() * sc.frames) : undefined;
  const key = sheet ? sc.key : FX.dot;
  const flip = Math.random() < 0.5;
  const mark = scene.add.image(ground.x, ground.y, key, frame).setDisplaySize(px, px / 2).setFlipX(flip)
    .setTint(P.markColour).setAlpha(0).setDepth(DEPTH.scorch);
  const glow = scene.add.image(ground.x, ground.y, key, frame).setDisplaySize(px * 0.8, px * 0.4).setFlipX(flip)
    .setTint(whiten(colour, 0.15)).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.9).setDepth(DEPTH.scorch + 0.5);
  return { glow, mark };
}

/** What it hits glows in `colour` for a moment: a tinted copy of each of its sprites over it, fading out. */
function hitFlash(scene: Phaser.Scene, targets: Flashable[] = [], colour: number): void {
  for (const t of targets) {
    if (!t.active || !t.visible) continue;
    const glow = scene.add.image(t.x, t.y, t.texture.key, t.frame.name)
      .setOrigin(t.originX, t.originY).setScale(t.scaleX, t.scaleY).setFlip(t.flipX, t.flipY)
      .setDepth(t.depth + 1e-4).setTintFill(colour).setAlpha(TWIN_PLASMA.hitFlashAlpha).setBlendMode(Phaser.BlendModes.ADD);
    scene.tweens.add({ targets: glow, alpha: 0, duration: TWIN_PLASMA.hitFlashMs, ease: 'Quad.easeOut', onComplete: () => glow.destroy() });
  }
}
