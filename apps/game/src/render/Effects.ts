import Phaser from 'phaser';
import { DEPTH } from '../config/game';
import { diamond, iso, type Point } from '../core/geometry';
import { impact, type Flashable, type ImpactStyle } from './Impact';

/** How rifle fire looks (world px and ms). The server decides hits and damage; this is only the look. */
export const BULLETS = {
  /** Rounds per shot, and the gap between them. */
  rounds: 3,
  gapMs: 70,
  /** Speed of a round, and the length of its glowing streak. */
  speed: 4200,
  streak: 28,
  /** Rounds land this far around the aim point. */
  spread: 9,
  /** Share of rounds that miss: they fly past and kick up dust on the ground beyond the target. */
  missShare: 0.25,
  missPast: [25, 70] as [number, number],
  core: 0xfff4d2,
  glow: 0xffb84a,
  sparks: 4,
  sparkSpeed: [60, 160] as [number, number],
  sparkLifeMs: 180,
  dust: 0x9a8466,
};

/** The defences' heavier weapons (the rules' projectiles other than bullets). */
export const HEAVY = {
  shell: { speed: 3000, streak: 44, core: 0xfff0c8, glow: 0xffa040, blast: 0.45 },
  fireball: { speed: 700, radius: 9, core: 0xfff1a8, glow: 0xff7a1a, blast: 0.7 },
  discharge: { ms: 160, segments: 9, jitter: 14, core: 0xfff0d0, glow: 0xff9a30 },
};

type RoundKind = 'bullet' | 'shell' | 'fireball';

interface Bolt {
  points: Point[];
  age: number;
}

interface Round {
  kind: RoundKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** ms since fired; negative until it leaves the muzzle */
  age: number;
  flight: number;
  miss: boolean;
  /** Shells and fireballs: what they hit, for the burst (render/Impact.ts). */
  hit?: ShotHit;
  ground?: Point;
}

/** What a shell or fireball hits: its sprites flash, and the burst is drawn just in front of them. */
export interface ShotHit {
  depth?: number;
  targets?: Flashable[];
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
}

const between = ([a, b]: [number, number]) => a + Math.random() * (b - a);

/** Short-lived visuals: bullets, muzzle flashes, explosions, floating text, order markers. */
export class Effects {
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly marker: Phaser.GameObjects.Graphics;
  private rounds: Round[] = [];
  private sparks: Spark[] = [];
  private bolts: Bolt[] = [];
  /** How shells and fireballs burst (render/Impact.ts). */
  impactStyle: ImpactStyle = 'painted';

  constructor(private readonly scene: Phaser.Scene) {
    this.gfx = scene.add.graphics().setDepth(DEPTH.ui - 5).setBlendMode(Phaser.BlendModes.ADD);
    this.marker = scene.add.graphics().setDepth(DEPTH.ui - 1);
  }

  /**
   * A burst of rifle fire from the muzzle at `to`: tracer rounds that fly there, each with a muzzle flash; most hit
   * with a few sparks, some miss and kick up dust on the ground (`ground`, under the target) beyond it.
   */
  bullets(from: Point, to: Point, ground: Point = to, flash = true): void {
    for (let i = 0; i < BULLETS.rounds; i++) {
      const j = () => (Math.random() * 2 - 1) * BULLETS.spread;
      const miss = Math.random() < BULLETS.missShare;
      let x2 = to.x + j(), y2 = to.y + j();
      if (miss) {
        const len = Math.hypot(ground.x - from.x, ground.y - from.y) || 1;
        const past = between(BULLETS.missPast);
        x2 = ground.x + ((ground.x - from.x) / len) * past + j();
        y2 = ground.y + ((ground.y - from.y) / len) * past * 0.5 + j() * 0.5;
      }
      const flight = (Math.hypot(x2 - from.x, y2 - from.y) / BULLETS.speed) * 1000;
      const delay = i * BULLETS.gapMs;
      this.rounds.push({ kind: 'bullet', x1: from.x, y1: from.y, x2, y2, age: -delay, flight, miss });
      if (flash) this.scene.time.delayedCall(delay, () => this.muzzleFlash(from));
    }
  }

  /**
   * A shot of the given projectile (the rules' weapon `projectile`): bullets, a shell, a fireball, or an instant
   * discharge. Anything else is drawn as bullets.
   */
  shot(projectile: string | undefined, from: Point, to: Point, ground?: Point, flash = true, hit?: ShotHit): void {
    if (projectile === 'ballistic shell') projectile = 'shell'; // artillery: a shell for now (no arc yet)
    if (projectile === 'shell' || projectile === 'fireball') {
      const speed = HEAVY[projectile].speed;
      const flight = (Math.hypot(to.x - from.x, to.y - from.y) / speed) * 1000;
      this.rounds.push({ kind: projectile, x1: from.x, y1: from.y, x2: to.x, y2: to.y, age: 0, flight, miss: false, hit, ground });
      if (flash) this.muzzleFlash(from, projectile === 'fireball' ? 0xffb050 : 0xfff0a0, 1.6);
    } else if (projectile === 'instant discharge') {
      this.discharge(from, to);
    } else this.bullets(from, to, ground, flash);
  }

  /** A jagged bolt from `from` to `to`, there for a moment, with flashes at both ends. */
  private discharge(from: Point, to: Point): void {
    const d = HEAVY.discharge;
    const nx = -(to.y - from.y), ny = to.x - from.x;
    const n = Math.hypot(nx, ny) || 1;
    const points = Array.from({ length: d.segments + 1 }, (_, i) => {
      const k = i / d.segments;
      const off = i === 0 || i === d.segments ? 0 : (Math.random() * 2 - 1) * d.jitter;
      return { x: from.x + (to.x - from.x) * k + (nx / n) * off, y: from.y + (to.y - from.y) * k + (ny / n) * off };
    });
    this.bolts.push({ points, age: 0 });
    this.muzzleFlash(from, d.glow, 2);
    this.muzzleFlash(to, d.glow, 2.4);
  }

  muzzleFlash(at: Point, color = 0xfff0a0, size = 1): void {
    const flash = this.scene.add.circle(at.x, at.y, 7 * size, color, 1).setDepth(DEPTH.ui - 5).setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({ targets: flash, scale: 0.3, alpha: 0, duration: 90 * Math.sqrt(size), onComplete: () => flash.destroy() });
  }

  explode(x: number, y: number, size: number): void {
    const flash = this.scene.add.circle(x, y, 20 * size, 0xffc04a, 0.9).setDepth(DEPTH.ui - 6);
    this.scene.tweens.add({ targets: flash, scale: 2.4, alpha: 0, duration: 380 + 120 * size, onComplete: () => flash.destroy() });
    const smoke = this.scene.add.circle(x, y - 10 * size, 26 * size, 0x2a2622, 0.6).setDepth(DEPTH.ui - 7);
    this.scene.tweens.add({ targets: smoke, scale: 2, y: smoke.y - 40 * size, alpha: 0, duration: 1200, onComplete: () => smoke.destroy() });
  }

  floatText(gx: number, gy: number, text: string): void {
    const p = iso(gx, gy);
    const t = this.scene.add.text(p.x, p.y - 260, text, {
      fontFamily: 'Rajdhani, system-ui, sans-serif', fontSize: '44px', fontStyle: 'bold',
      color: '#ffd34d', stroke: '#2a1d00', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(DEPTH.ui);
    this.scene.tweens.add({ targets: t, y: t.y - 90, alpha: 0, duration: 1400, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  /** Green diamond where a move order lands. */
  moveMarker(tx: number, ty: number): void {
    this.marker.clear().lineStyle(4, 0x7dff6a, 1).strokePoints(diamond(tx, ty), true).setAlpha(1);
    this.scene.tweens.add({ targets: this.marker, alpha: 0, duration: 600 });
  }

  /** Red ring on an attack target. */
  targetMarker(gx: number, gy: number, scale = 1): void {
    const p = iso(gx, gy);
    this.marker.clear().lineStyle(4, 0xff4a3a, 1).strokeEllipse(p.x, p.y - 4, 70 * scale, 34 * scale).setAlpha(1);
    this.scene.tweens.add({ targets: this.marker, alpha: 0, duration: 600 });
  }

  private impact(r: Round): void {
    if (r.kind !== 'bullet') {
      const depth = r.hit?.depth !== undefined ? r.hit.depth + 0.01 : undefined;
      impact(this.scene, this.impactStyle, { x: r.x2, y: r.y2, size: HEAVY[r.kind].blast / HEAVY.shell.blast, depth, targets: r.hit?.targets, ground: r.ground });
      return;
    }
    if (r.miss) {
      const puff = this.scene.add.circle(r.x2, r.y2, 5, BULLETS.dust, 0.7).setDepth(DEPTH.ui - 6);
      this.scene.tweens.add({ targets: puff, scale: 2.6, y: r.y2 - 10, alpha: 0, duration: 420, onComplete: () => puff.destroy() });
      return;
    }
    for (let i = 0; i < BULLETS.sparks; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = between(BULLETS.sparkSpeed);
      this.sparks.push({ x: r.x2, y: r.y2, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, age: 0 });
    }
  }

  update(deltaMs: number): void {
    const g = this.gfx.clear();
    // rounds: a short streak running from the muzzle to where it lands
    this.rounds = this.rounds.filter((r) => {
      r.age += deltaMs;
      if (r.age < 0) return true;
      const k = Math.min(1, r.age / r.flight);
      const len = Math.hypot(r.x2 - r.x1, r.y2 - r.y1) || 1;
      const head = { x: r.x1 + (r.x2 - r.x1) * k, y: r.y1 + (r.y2 - r.y1) * k };
      if (r.kind === 'fireball') {
        const f = HEAVY.fireball;
        g.fillStyle(f.glow, 0.45).fillCircle(head.x, head.y, f.radius * 1.8);
        g.fillStyle(f.core, 1).fillCircle(head.x, head.y, f.radius);
      } else {
        const look = r.kind === 'shell' ? HEAVY.shell : BULLETS;
        const t = Math.max(0, k - Math.min(1, look.streak / len));
        const tail = { x: r.x1 + (r.x2 - r.x1) * t, y: r.y1 + (r.y2 - r.y1) * t };
        const w = r.kind === 'shell' ? 1.8 : 1;
        g.lineStyle(5 * w, look.glow, 0.35).lineBetween(tail.x, tail.y, head.x, head.y);
        g.lineStyle(2 * w, look.core, 1).lineBetween(tail.x, tail.y, head.x, head.y);
      }
      if (k < 1) return true;
      this.impact(r);
      return false;
    });
    // discharges: a bolt that flickers and fades
    this.bolts = this.bolts.filter((b) => (b.age += deltaMs) < HEAVY.discharge.ms);
    for (const b of this.bolts) {
      const a = 1 - b.age / HEAVY.discharge.ms;
      g.lineStyle(9, HEAVY.discharge.glow, 0.35 * a).strokePoints(b.points);
      g.lineStyle(3, HEAVY.discharge.core, a).strokePoints(b.points);
    }
    // hit sparks: quick specks that fly out, fall a little and cool
    const dt = deltaMs / 1000;
    this.sparks = this.sparks.filter((p) => (p.age += deltaMs) < BULLETS.sparkLifeMs);
    for (const p of this.sparks) {
      p.vy += 500 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const a = 1 - p.age / BULLETS.sparkLifeMs;
      g.lineStyle(2, BULLETS.glow, a).lineBetween(p.x - p.vx * 0.02, p.y - p.vy * 0.02, p.x, p.y);
    }
  }
}
