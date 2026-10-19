import Phaser from 'phaser';
import { DEPTH } from '../config/game';
import { diamond, iso, type Point } from '../core/geometry';
import { impact, type Flashable, type ImpactStyle } from './Impact';
import { FX, FX_SHEETS, ensureFxTextures } from './fxTextures';
import { LOOKS } from './shots';
import type { Kit, Live } from './shots/kit';

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
  /** A ball of energy (the hovering Hound's, one from each pod): small and quick, with a short fading tail. */
  plasma: { speed: 1300, radius: 4.5, tail: 22, core: 0xffe0d8, glow: 0xff2a1a, blast: 0.25 },
  /**
   * A laser (the Lancers'): a beam in its side's colour shoots out from each gun to the target (`reachMs`), holds,
   * pulsing (`ms` in all), then thins away (`fadeMs`); a soft wide glow, a narrow bright core of the same hue (`whiten`
   * of the way to white), a flare at the gun and a flare and sparks where it hits.
   */
  laser: { ms: 480, reachMs: 70, fadeMs: 140, width: 7, glowWidth: 30, whiten: 0.55, flare: 22, glow: 0xb050ff },
  /**
   * A column of light (the Breaker's): it charges on the unit (`chargeMs`), then a thick beam shoots up from the
   * ground at the target, out of sight, holds and narrows away from the bottom up, leaving a scorch.
   */
  column: { chargeMs: 220, riseMs: 90, holdMs: 420, fadeMs: 260, width: 26, height: 1400, core: 0xfff6f0, glow: 0xff3a1a, blast: 0.5 },
  /** A Medic's heal: a gentle beam (a laser's look, thinner and softer) and a glow round the unit it mends. */
  heal: { width: 0.45, glow: 0x7dffb0 },
  /** An Engineer's repair: a burst of welding sparks where its arm works on the building. */
  weld: { sparks: 7, core: 0xfff6d0, glow: 0xffc860 },
  /** A lobbed grenade (the Grenadier's): a small round on a high arc, bursting where it lands. */
  grenade: { speed: 520, arc: 0.45, radius: 4, core: 0xfff0d0, glow: 0xff5a2a, blast: 0.55 },
  /**
   * A guided missile (the Lancers', one from each pod, `gapMs` apart): it leaves climbing (`climb` px) and veering off
   * to one side (`swerve` of the way), curves round onto the target and speeds up as it goes (`accel`: 0 steady, 1 from
   * a standstill). A small body (`length` px) with a flickering exhaust in its side's colour (`flame` px), throwing
   * embers; it leaves a puff of smoke every `trailPx`, which lingers, swells and thins out (`puffMs`); a back-blast of
   * smoke as it leaves, and a fiery burst where it lands.
   */
  missile: {
    speed: 820, accel: 0.55, climb: 90, swerve: 0.2, gapMs: 150, length: 20, flame: 22,
    trailPx: 5, puffMs: [700, 1200] as [number, number], puffScale: [0.05, 0.24] as [number, number], puffAlpha: 0.55, smoke: 0xd6d0c6,
    core: 0xfff4dc, glow: 0xffa040, blast: 0.6,
  },
};

type RoundKind = 'bullet' | 'shell' | 'fireball' | 'plasma' | 'grenade' | 'missile';

interface Beam {
  from: Point;
  to: Point;
  age: number;
  glow: number;
  /** Its soft glow and bright core (FX.beam stretched along it), and the flares at the gun and where it hits. */
  outer: Phaser.GameObjects.Image;
  core: Phaser.GameObjects.Image;
  muzzle: Phaser.GameObjects.Image;
  spot: Phaser.GameObjects.Image;
  hit: boolean;
  /** Its width against a laser's, and whether it's a heal (it mends: no sparks, a soft glow round what it hits). */
  width: number;
  heal: boolean;
}

interface Column {
  x: number;
  y: number;
  /** ms since the unit started charging (it shoots up at chargeMs). */
  age: number;
  glow: number;
  hit?: ShotHit;
  struck: boolean;
}

interface Bolt {
  points: Point[];
  age: number;
  glow: number;
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
  /** Its colour over the kind's (a side's: the Hound's red). */
  glow?: number;
  /** A missile: its way there, its body and exhaust (made as it leaves), and where its smoke trail has got to. */
  path?: Phaser.Curves.CubicBezier;
  body?: Phaser.GameObjects.Image;
  flame?: Phaser.GameObjects.Image[];
  trailAt?: Point;
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
  color?: number;
}

const between = ([a, b]: [number, number]) => a + Math.random() * (b - a);

/** Short-lived visuals: bullets, muzzle flashes, explosions, floating text, order markers. */
export class Effects {
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly marker: Phaser.GameObjects.Graphics;
  private rounds: Round[] = [];
  private sparks: Spark[] = [];
  private bolts: Bolt[] = [];
  private beams: Beam[] = [];
  private columns: Column[] = [];
  /** Missiles' smoke trails and exhaust embers: one emitter each for every missile, made on the first. */
  private trail: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  /** The units' own looks (render/shots) still on screen, and what they draw with. */
  private live: Live[] = [];
  private readonly kit: Kit;
  private embers: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  /** How shells and fireballs burst (render/Impact.ts). */
  impactStyle: ImpactStyle = 'shockwave';
  /** Called as a round lands (its sound): bullets that hit, a shell's or fireball's burst, a discharge's strike. */
  onImpact: ((kind: RoundKind | 'discharge' | 'laser' | 'column', at: Point) => void) | null = null;

  constructor(private readonly scene: Phaser.Scene) {
    ensureFxTextures(scene);
    this.gfx = scene.add.graphics().setDepth(DEPTH.ui - 5).setBlendMode(Phaser.BlendModes.ADD);
    this.marker = scene.add.graphics().setDepth(DEPTH.ui - 1);
    const fx = this;
    this.kit = {
      scene,
      add: (l) => this.live.push(l),
      get impactStyle() { return fx.impactStyle; },
      landed: (kind, at) => this.onImpact?.(kind, at),
      legacy: (p, s) => this.legacyFire(p, s.from, s.guns, s.to, s.ground, s.flash, s.hit, s.glow),
    };
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
  shot(projectile: string | undefined, from: Point, to: Point, ground?: Point, flash = true, hit?: ShotHit, glow?: number, delayMs = 0): void {
    if (projectile === 'ballistic shell') projectile = 'shell'; // artillery: a shell for now (no arc yet)
    if (projectile === 'guided missile') return this.missile(from, to, ground, hit, glow, delayMs);
    if (projectile === 'shell' || projectile === 'fireball') {
      const speed = HEAVY[projectile].speed;
      const flight = (Math.hypot(to.x - from.x, to.y - from.y) / speed) * 1000;
      this.rounds.push({ kind: projectile, x1: from.x, y1: from.y, x2: to.x, y2: to.y, age: 0, flight, miss: false, hit, ground });
      if (flash) this.muzzleFlash(from, projectile === 'fireball' ? 0xffb050 : 0xfff0a0, 1.6);
    } else if (projectile === 'plasma') {
      const p = HEAVY.plasma;
      const flight = (Math.hypot(to.x - from.x, to.y - from.y) / p.speed) * 1000;
      this.rounds.push({ kind: 'plasma', x1: from.x, y1: from.y, x2: to.x, y2: to.y, age: 0, flight, miss: false, hit, ground, glow });
      if (flash) this.muzzleFlash(from, glow ?? p.glow, 1.1);
    } else if (projectile === 'repair') {
      // welding at the building: a flash and a spray of sparks
      const w = HEAVY.weld;
      this.muzzleFlash(to, w.core, 1.2);
      for (let i = 0; i < w.sparks; i++) {
        const a = -Math.PI * (0.15 + Math.random() * 0.7);
        const v = between(BULLETS.sparkSpeed);
        this.sparks.push({ x: to.x, y: to.y, vx: Math.cos(a) * v * (Math.random() < 0.5 ? -1 : 1), vy: Math.sin(a) * v, age: 0, color: w.glow });
      }
    } else if (projectile === 'beam' || projectile === 'laser') {
      const l = HEAVY.laser;
      const heal = projectile === 'beam';
      const c = glow ?? (heal ? HEAVY.heal.glow : l.glow);
      const core = Phaser.Display.Color.Interpolate.ColorWithColor(Phaser.Display.Color.ValueToColor(c), Phaser.Display.Color.ValueToColor(0xffffff), 1, l.whiten);
      const coreColor = Phaser.Display.Color.GetColor(core.r, core.g, core.b);
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const band = (tint: number) => this.scene.add.image(from.x, from.y, FX.beam).setOrigin(0, 0.5).setRotation(angle)
        .setTint(tint).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.ui - 5).setDisplaySize(1, 1);
      const flare = (at: Point, tint: number) => this.scene.add.image(at.x, at.y, FX.dot).setTint(tint)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.ui - 5).setDisplaySize(l.flare, l.flare);
      this.beams.push({
        from, to, age: 0, glow: c, outer: band(c), core: band(coreColor), muzzle: flare(from, coreColor), spot: flare(to, c).setAlpha(0), hit: false,
        width: heal ? HEAVY.heal.width : 1, heal,
      });
    } else if (projectile === 'column') {
      // `from` (the unit) charges first; the column strikes the ground under the target (`ground`, or the target)
      const at = ground ?? to;
      this.columns.push({ x: at.x, y: at.y, age: 0, glow: glow ?? HEAVY.column.glow, hit, struck: false });
      const c = this.scene.add.circle(from.x, from.y, 9, glow ?? HEAVY.column.glow, 0.9).setDepth(DEPTH.ui - 5).setBlendMode(Phaser.BlendModes.ADD).setScale(0.3);
      this.scene.tweens.add({ targets: c, scale: 1.4, duration: HEAVY.column.chargeMs, yoyo: true, onComplete: () => c.destroy() });
    } else if (projectile === 'lobbed grenade') {
      const gr = HEAVY.grenade;
      const at = ground ?? to;
      const flight = (Math.hypot(at.x - from.x, at.y - from.y) / gr.speed) * 1000 + 250;
      this.rounds.push({ kind: 'grenade', x1: from.x, y1: from.y, x2: at.x, y2: at.y, age: 0, flight, miss: false, hit, ground, glow });
      if (flash) this.muzzleFlash(from, glow ?? gr.glow, 1.2);
    } else if (projectile === 'instant discharge') {
      this.discharge(from, to, glow);
    } else this.bullets(from, to, ground, flash);
  }

  /**
   * A unit's or building's shot as the game draws it (`p`: its UNIT_ART `fire`, else the rules' projectile): energy
   * balls and lasers from all its `guns` at once, a missile from each gun in turn, anything else from `from`.
   */
  fire(p: string | undefined, from: Point, guns: Point[], to: Point, ground?: Point, flash = true, hit?: ShotHit, glow?: number): void {
    const look = p ? LOOKS[p] : undefined;
    if (look) look(this.kit, { from, guns, to, ground, flash, hit, glow });
    else this.legacyFire(p, from, guns, to, ground, flash, hit, glow);
  }

  /** The older looks, by the rules' projectile. */
  private legacyFire(p: string | undefined, from: Point, guns: Point[], to: Point, ground?: Point, flash = true, hit?: ShotHit, glow?: number): void {
    if ((p === 'plasma' || p === 'laser') && guns.length) for (const g of guns) this.shot(p, g, to, ground, flash, hit, glow);
    else if (p === 'guided missile' && guns.length > 1) guns.forEach((g, i) => this.shot(p, g, to, ground, flash, hit, glow, i * HEAVY.missile.gapMs));
    else this.shot(p, from, to, ground, flash, hit, glow);
  }

  /** A missile from `from` to `to`, leaving after `delayMs`: its way there is set now, it's drawn as it flies. */
  private missile(from: Point, to: Point, ground?: Point, hit?: ShotHit, glow?: number, delayMs = 0): void {
    const m = HEAVY.missile;
    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    // off to one side or the other, and climbing: further out and higher on a longer shot
    const side = (Math.random() < 0.5 ? -1 : 1) * m.swerve * len * (0.7 + Math.random() * 0.6);
    const climb = m.climb * Math.min(1.4, 0.5 + len / 600);
    const v = (x: number, y: number) => new Phaser.Math.Vector2(x, y);
    const path = new Phaser.Curves.CubicBezier(
      v(from.x, from.y),
      v(from.x + dx * 0.3 - uy * side, from.y + dy * 0.3 + ux * side - climb),
      v(to.x - dx * 0.25 + uy * side * 0.25, to.y - dy * 0.25 - ux * side * 0.25 - climb * 0.35),
      v(to.x, to.y),
    );
    const flight = (path.getLength() / m.speed) * 1000 * (1 + m.accel * 0.5);
    this.rounds.push({ kind: 'missile', x1: from.x, y1: from.y, x2: to.x, y2: to.y, age: -delayMs, flight, miss: false, hit, ground, glow, path });
  }

  /** The missiles' trail and ember emitters, made once. */
  private missileEmitters(): [Phaser.GameObjects.Particles.ParticleEmitter, Phaser.GameObjects.Particles.ParticleEmitter] {
    if (!this.trail || !this.embers) {
      const m = HEAVY.missile;
      const soft = FX_SHEETS.impactSoft;
      const sheet = this.scene.textures.exists(soft.key);
      this.trail = this.scene.add.particles(0, 0, sheet ? soft.key : FX.smoke, {
        ...(sheet ? { frame: Array.from({ length: soft.frames }, (_, i) => i) } : {}),
        lifespan: { min: m.puffMs[0], max: m.puffMs[1] },
        scale: { start: m.puffScale[0], end: m.puffScale[1], ease: 'Quad.easeOut' },
        alpha: { start: m.puffAlpha, end: 0, ease: 'Quad.easeIn' },
        rotate: { min: -180, max: 180 },
        speedX: { min: -8, max: 8 },
        speedY: { min: -18, max: -4 },
        tint: m.smoke,
        emitting: false,
      }).setDepth(DEPTH.ui - 7);
      this.embers = this.scene.add.particles(0, 0, FX.dot, {
        lifespan: { min: 140, max: 260 },
        scale: { start: 0.14, end: 0 },
        alpha: { start: 1, end: 0 },
        speed: { min: 10, max: 50 },
        blendMode: Phaser.BlendModes.ADD,
        emitting: false,
      }).setDepth(DEPTH.ui - 5.5);
    }
    return [this.trail, this.embers];
  }

  /** A missile in flight: along its way, speeding up, leaving smoke; it bursts when it gets there. */
  private flyMissile(r: Round, k: number): void {
    const m = HEAVY.missile;
    const glow = r.glow ?? m.glow;
    const [trail, embers] = this.missileEmitters();
    if (!r.body) {
      // it leaves: a flash at the pod and a back-blast of smoke
      ensureFxTextures(this.scene);
      r.body = this.scene.add.image(r.x1, r.y1, FX.missile).setDepth(DEPTH.ui - 5).setDisplaySize(m.length, m.length * 0.28);
      const flare = (tint: number) => this.scene.add.image(r.x1, r.y1, FX.dot).setTint(tint).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.ui - 5.2);
      r.flame = [flare(glow), flare(m.core)];
      this.muzzleFlash({ x: r.x1, y: r.y1 }, glow, 1.3);
      for (let i = 0; i < 5; i++) trail.emitParticleAt(r.x1 + (Math.random() * 2 - 1) * 8, r.y1 + (Math.random() * 2 - 1) * 5, 1);
      r.trailAt = { x: r.x1, y: r.y1 };
    }
    const s = Math.min(1, m.accel * k * k + (1 - m.accel) * k);
    const at = r.path!.getPointAt(s);
    const dir = r.path!.getTangentAt(s);
    const angle = Math.atan2(dir.y, dir.x);
    r.body.setPosition(at.x, at.y).setRotation(angle);
    // its exhaust, just behind it, flickering
    const tail = { x: at.x - dir.x * m.length * 0.55, y: at.y - dir.y * m.length * 0.55 };
    const f = 0.8 + Math.random() * 0.4;
    r.flame![0].setPosition(tail.x, tail.y).setDisplaySize(m.flame * f, m.flame * f).setAlpha(0.85);
    r.flame![1].setPosition(tail.x, tail.y).setDisplaySize(m.flame * 0.45 * f, m.flame * 0.45 * f);
    if (Math.random() < 0.6) embers.setParticleTint(Math.random() < 0.5 ? glow : m.core).emitParticleAt(tail.x, tail.y, 1);
    // smoke left behind it, evenly spaced however fast it's going
    const p = r.trailAt!;
    let gap = Math.hypot(tail.x - p.x, tail.y - p.y);
    while (gap >= m.trailPx) {
      p.x += ((tail.x - p.x) / gap) * m.trailPx;
      p.y += ((tail.y - p.y) / gap) * m.trailPx;
      trail.emitParticleAt(p.x, p.y, 1);
      gap -= m.trailPx;
    }
    if (k >= 1) {
      r.body.destroy();
      for (const o of r.flame!) o.destroy();
    }
  }

  /** A jagged bolt from `from` to `to`, there for a moment, with flashes at both ends. */
  private discharge(from: Point, to: Point, glow = HEAVY.discharge.glow): void {
    const d = HEAVY.discharge;
    const nx = -(to.y - from.y), ny = to.x - from.x;
    const n = Math.hypot(nx, ny) || 1;
    const points = Array.from({ length: d.segments + 1 }, (_, i) => {
      const k = i / d.segments;
      const off = i === 0 || i === d.segments ? 0 : (Math.random() * 2 - 1) * d.jitter;
      return { x: from.x + (to.x - from.x) * k + (nx / n) * off, y: from.y + (to.y - from.y) * k + (ny / n) * off };
    });
    this.bolts.push({ points, age: 0, glow });
    this.onImpact?.('discharge', to);
    this.muzzleFlash(from, glow, 2);
    this.muzzleFlash(to, glow, 2.4);
  }

  /** A small burst: a flash and a few hot specks flying out, in `color`. */
  private burst(at: Point, color: number, size: number): void {
    this.muzzleFlash(at, color, size);
    for (let i = 0; i < BULLETS.sparks; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = between(BULLETS.sparkSpeed);
      this.sparks.push({ x: at.x, y: at.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, age: 0, color });
    }
  }

  /** A scorch mark on the ground that fades over a few seconds. */
  private scorch(x: number, y: number): void {
    const s = this.scene.add.ellipse(x, y, 54, 26, 0x1a1410, 0.55).setDepth(DEPTH.scorch);
    this.scene.tweens.add({ targets: s, alpha: 0, delay: 2500, duration: 2000, onComplete: () => s.destroy() });
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

  /** Red diamond in a wider one where an attack-move lands. */
  attackMoveMarker(tx: number, ty: number): void {
    this.marker.clear().lineStyle(4, 0xff4a3a, 1).strokePoints(diamond(tx, ty), true)
      .lineStyle(2, 0xff4a3a, 0.8).strokePoints(diamond(tx - 0.5, ty - 0.5, 2), true).setAlpha(1);
    this.scene.tweens.add({ targets: this.marker, alpha: 0, duration: 600 });
  }

  /** Red ring on an attack target. */
  targetMarker(gx: number, gy: number, scale = 1): void {
    const p = iso(gx, gy);
    this.marker.clear().lineStyle(4, 0xff4a3a, 1).strokeEllipse(p.x, p.y - 4, 70 * scale, 34 * scale).setAlpha(1);
    this.scene.tweens.add({ targets: this.marker, alpha: 0, duration: 600 });
  }

  private impact(r: Round): void {
    if (!r.miss) this.onImpact?.(r.kind, { x: r.x2, y: r.y2 });
    if (r.kind === 'plasma') {
      // a small burst in its colour: a flash and a few hot specks
      this.burst({ x: r.x2, y: r.y2 }, r.glow ?? HEAVY.plasma.glow, 1.8);
      return;
    }
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
    this.live = this.live.filter((l) => l.step(deltaMs, g));
    // rounds: a short streak running from the muzzle to where it lands
    this.rounds = this.rounds.filter((r) => {
      r.age += deltaMs;
      if (r.age < 0) return true;
      const k = Math.min(1, r.age / r.flight);
      const len = Math.hypot(r.x2 - r.x1, r.y2 - r.y1) || 1;
      const head = { x: r.x1 + (r.x2 - r.x1) * k, y: r.y1 + (r.y2 - r.y1) * k };
      if (r.kind === 'missile') {
        this.flyMissile(r, k);
      } else if (r.kind === 'grenade') {
        // on its arc: up and over, falling onto where it lands
        const f = HEAVY.grenade;
        const lift = 4 * k * (1 - k) * Math.max(60, len * f.arc);
        g.fillStyle(r.glow ?? f.glow, 0.45).fillCircle(head.x, head.y - lift, f.radius * 2);
        g.fillStyle(f.core, 1).fillCircle(head.x, head.y - lift, f.radius);
      } else if (r.kind === 'plasma') {
        const f = HEAVY.plasma;
        const t = Math.max(0, k - Math.min(1, f.tail / len));
        const tail = { x: r.x1 + (r.x2 - r.x1) * t, y: r.y1 + (r.y2 - r.y1) * t };
        g.lineStyle(f.radius * 1.6, r.glow ?? f.glow, 0.3).lineBetween(tail.x, tail.y, head.x, head.y);
        g.fillStyle(r.glow ?? f.glow, 0.5).fillCircle(head.x, head.y, f.radius * 2);
        g.fillStyle(f.core, 1).fillCircle(head.x, head.y, f.radius);
      } else if (r.kind === 'fireball') {
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
    // lasers: shoot out to the target, hold pulsing, then thin away
    const l = HEAVY.laser;
    this.beams = this.beams.filter((b) => {
      b.age += deltaMs;
      if (b.age >= l.ms) {
        for (const o of [b.outer, b.core, b.muzzle, b.spot]) o.destroy();
        return false;
      }
      const len = Math.hypot(b.to.x - b.from.x, b.to.y - b.from.y);
      const reach = Math.min(1, b.age / l.reachMs);
      const fade = Math.min(1, (l.ms - b.age) / l.fadeMs);
      const pulse = 0.85 + 0.15 * Math.sin(b.age / 22) + Math.random() * 0.08;
      b.outer.setDisplaySize(len * reach, l.glowWidth * b.width * fade * pulse).setAlpha(0.75 * fade);
      b.core.setDisplaySize(len * reach, l.width * b.width * fade * pulse).setAlpha(fade);
      b.muzzle.setDisplaySize(l.flare * pulse, l.flare * pulse).setAlpha(fade);
      if (reach >= 1 && !b.hit) {
        b.hit = true;
        if (!b.heal) {
          this.onImpact?.('laser', b.to);
          this.burst(b.to, b.glow, 1.4);
        }
      }
      if (b.hit) b.spot.setAlpha(fade).setDisplaySize(l.flare * 1.6 * pulse, l.flare * 1.6 * pulse);
      return true;
    });
    // columns of light: shoot up from the ground, hold, then narrow and fade from the bottom up
    const c = HEAVY.column;
    this.columns = this.columns.filter((col) => (col.age += deltaMs) < c.chargeMs + c.riseMs + c.holdMs + c.fadeMs);
    for (const col of this.columns) {
      const t = col.age - c.chargeMs;
      if (t < 0) continue;
      if (!col.struck) {
        col.struck = true;
        this.onImpact?.('column', { x: col.x, y: col.y });
        impact(this.scene, this.impactStyle, { x: col.x, y: col.y, size: c.blast / HEAVY.shell.blast, depth: col.hit?.depth !== undefined ? col.hit.depth + 0.01 : undefined, targets: col.hit?.targets });
        this.scorch(col.x, col.y);
      }
      const rise = Math.min(1, t / c.riseMs);
      const out = Math.max(0, (t - c.riseMs - c.holdMs) / c.fadeMs);
      const w = c.width * (1 - out * 0.8) * (0.92 + Math.random() * 0.08);
      const bottom = col.y - out * c.height * 0.6;
      const top = col.y - c.height * rise;
      if (bottom <= top) continue;
      const a = 1 - out;
      g.fillStyle(col.glow, 0.22 * a).fillRect(col.x - w, top, w * 2, bottom - top);
      g.fillStyle(col.glow, 0.45 * a).fillRect(col.x - w * 0.55, top, w * 1.1, bottom - top);
      g.fillStyle(c.core, 0.9 * a).fillRect(col.x - w * 0.2, top, w * 0.4, bottom - top);
      // its glowing ring on the ground, spreading
      if (out === 0) {
        const ring = 1 + Math.min(1, t / (c.riseMs + c.holdMs)) * 1.6;
        g.lineStyle(3, col.glow, 0.6 * (1 - t / (c.riseMs + c.holdMs))).strokeEllipse(col.x, col.y, c.width * 2.4 * ring, c.width * 1.2 * ring);
        g.fillStyle(c.core, 0.5).fillEllipse(col.x, col.y, c.width * 1.6, c.width * 0.7);
      }
    }
    // discharges: a bolt that flickers and fades
    this.bolts = this.bolts.filter((b) => (b.age += deltaMs) < HEAVY.discharge.ms);
    for (const b of this.bolts) {
      const a = 1 - b.age / HEAVY.discharge.ms;
      g.lineStyle(9, b.glow, 0.35 * a).strokePoints(b.points);
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
      g.lineStyle(2, p.color ?? BULLETS.glow, a).lineBetween(p.x - p.vx * 0.02, p.y - p.vy * 0.02, p.x, p.y);
    }
  }
}
