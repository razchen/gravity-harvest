import Phaser from 'phaser';
import { FLAME_ANIM, ensureAnims } from './Destruction';
import { FX, FX_SHEETS, ensureFxTextures } from './fxTextures';

/** A building's effect point (render_construction.py `effects`), in frame pixels. */
export interface EffectPoint {
  kind: 'glow' | 'light' | 'steam' | 'flame' | 'sparks' | 'dust';
  x: number;
  y: number;
  color?: string;
}

/** How the running buildings' effects look. */
export const BUILDING_FX = {
  glow: { color: '#a46bff', alpha: [0.3, 0.7] as [number, number], size: [26, 36] as [number, number], periodS: 1.4 },
  light: { color: '#ff4a3a', periodS: 1.6, onShare: 0.18, size: 9 },
  steam: { perSec: 2.2, lifeS: 2.6, rise: 34, startScale: 0.12, endScale: 0.55, alpha: 0.32, tint: 0xd9d6d0 },
  /** A vent's small working flame (not a fire: those are render/Destruction.ts). */
  flame: { scale: 0.085, glow: 0.22, color: 0xff6a1c },
  sparks: { burstEveryMs: 420, count: 5, speed: [50, 130] as [number, number], lifeMs: 260, gravity: 320 },
  dust: { perSec: 3, lifeS: 1.2, rise: 14, startScale: 0.1, endScale: 0.4, alpha: 0.35, tint: 0x9a8466 },
};

const hex = (c: string) => Phaser.Display.Color.HexStringToColor(c).color;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
}

/**
 * A running building's effects, drawn by the game at the points rendered from its model: glows pulse and lights
 * blink while it has power; steam and flames rise from its stacks and vents; sparks and dust only while it works.
 */
export class BuildingFx {
  private readonly glows: { img: Phaser.GameObjects.Image; phase: number }[] = [];
  private readonly lights: { img: Phaser.GameObjects.Image; phase: number }[] = [];
  private readonly emitters: { e: Phaser.GameObjects.Particles.ParticleEmitter; working: boolean }[] = [];
  private readonly flames: Phaser.GameObjects.GameObject[] = [];
  private readonly sparkAt: { x: number; y: number }[] = [];
  private readonly gfx: Phaser.GameObjects.Graphics;
  private sparks: Spark[] = [];
  private sparkT = 0;
  private t = Math.random() * 10;
  private on = false;
  private powered = true;
  private working = false;

  constructor(scene: Phaser.Scene, points: EffectPoint[], toWorld: (x: number, y: number) => { x: number; y: number }, depth: number) {
    ensureFxTextures(scene);
    this.gfx = scene.add.graphics().setDepth(depth + 0.02).setBlendMode(Phaser.BlendModes.ADD);
    for (const p of points) {
      const w = toWorld(p.x, p.y);
      if (p.kind === 'glow') {
        const img = scene.add.image(w.x, w.y, FX.dot).setTint(hex(p.color ?? BUILDING_FX.glow.color)).setBlendMode(Phaser.BlendModes.ADD).setDepth(depth + 0.006);
        this.glows.push({ img, phase: Math.random() * 6 });
      } else if (p.kind === 'light') {
        const img = scene.add.image(w.x, w.y, FX.dot).setTint(hex(p.color ?? BUILDING_FX.light.color)).setBlendMode(Phaser.BlendModes.ADD).setDepth(depth + 0.03)
          .setScale(BUILDING_FX.light.size / 32);
        this.lights.push({ img, phase: Math.random() });
      } else if (p.kind === 'steam' || p.kind === 'dust') {
        const S = p.kind === 'steam' ? BUILDING_FX.steam : BUILDING_FX.dust;
        const e = scene.add.particles(w.x, w.y, FX.smoke, {
          lifespan: { min: S.lifeS * 850, max: S.lifeS * 1150 },
          speedX: { min: 4, max: 16 },
          speedY: { min: -S.rise * 1.3, max: -S.rise * 0.7 },
          scale: { start: S.startScale, end: S.endScale },
          alpha: { start: S.alpha, end: 0 },
          tint: p.color ? hex(p.color) : S.tint,
          frequency: 1000 / S.perSec,
        }).setDepth(depth + 0.04);
        this.emitters.push({ e, working: p.kind === 'dust' });
      } else if (p.kind === 'flame') {
        const F = BUILDING_FX.flame;
        const glow = scene.add.image(w.x, w.y, FX.dot).setTint(F.color).setBlendMode(Phaser.BlendModes.ADD).setDepth(depth + 0.03).setAlpha(F.glow).setScale(0.7, 0.45);
        this.flames.push(glow);
        if (scene.textures.exists(FX_SHEETS.flame.key)) {
          ensureAnims(scene);
          const flame = scene.add.sprite(w.x, w.y, FX_SHEETS.flame.key).setOrigin(0.5, 0.94).setScale(F.scale).setBlendMode(Phaser.BlendModes.ADD).setDepth(depth + 0.035);
          flame.play({ key: FLAME_ANIM, startFrame: Math.floor(Math.random() * FX_SHEETS.flame.frames) });
          this.flames.push(flame);
        }
      } else if (p.kind === 'sparks') this.sparkAt.push(w);
    }
    this.apply();
  }

  /** Shown at all (the building is finished). */
  setOn(on: boolean): void {
    this.on = on;
    this.apply();
  }

  setPowered(on: boolean): void {
    this.powered = on;
    this.apply();
  }

  setWorking(on: boolean): void {
    this.working = on;
    this.apply();
  }

  private apply(): void {
    const live = this.on && this.powered;
    for (const g of this.glows) g.img.setVisible(live);
    for (const l of this.lights) l.img.setVisible(live);
    for (const f of this.flames) (f as Phaser.GameObjects.Image).setVisible(this.on);
    for (const { e, working } of this.emitters) {
      const run = working ? live && this.working : live;
      if (run && !e.emitting) e.start();
      else if (!run && e.emitting) e.stop();
    }
    if (!live || !this.working) this.sparks = [];
  }

  update(deltaMs: number): void {
    this.t += deltaMs / 1000;
    const G = BUILDING_FX.glow;
    for (const g of this.glows) {
      const k = 0.5 + 0.5 * Math.sin(((this.t + g.phase) * 2 * Math.PI) / G.periodS);
      g.img.setAlpha(G.alpha[0] + (G.alpha[1] - G.alpha[0]) * k).setScale((G.size[0] + (G.size[1] - G.size[0]) * k) / 32);
    }
    const L = BUILDING_FX.light;
    for (const l of this.lights) l.img.setAlpha(((this.t / L.periodS + l.phase) % 1) < L.onShare ? 1 : 0.08);
    // sparks: short bursts at the working spots
    const S = BUILDING_FX.sparks;
    const g = this.gfx.clear();
    if (this.on && this.powered && this.working && this.sparkAt.length) {
      this.sparkT += deltaMs;
      if (this.sparkT >= S.burstEveryMs) {
        this.sparkT = 0;
        const at = this.sparkAt[Math.floor(Math.random() * this.sparkAt.length)];
        for (let i = 0; i < S.count; i++) {
          const a = rand(-Math.PI, 0);
          const v = rand(...S.speed);
          this.sparks.push({ x: at.x, y: at.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0 });
        }
      }
    }
    const dt = deltaMs / 1000;
    this.sparks = this.sparks.filter((p) => (p.age += deltaMs) < S.lifeMs);
    for (const p of this.sparks) {
      p.vy += S.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const k = p.age / S.lifeMs;
      g.lineStyle(2, Phaser.Display.Color.GetColor(255, Math.round(220 - 100 * k), Math.round(130 - 110 * k)), 1 - k)
        .lineBetween(p.x - p.vx * 0.03, p.y - p.vy * 0.03, p.x, p.y);
    }
  }

  destroy(): void {
    for (const g of this.glows) g.img.destroy();
    for (const l of this.lights) l.img.destroy();
    for (const { e } of this.emitters) e.destroy();
    for (const f of this.flames) f.destroy();
    this.gfx.destroy();
  }
}
