import type { Point } from '../core/geometry';
import { sceneryKind } from '@gravity-harvest/sim/layout';
import { SIDES, colourOf, isMine } from '../data/teams';
import { $ } from './dom';
import type { HudBridge } from './HudBridge';

/**
 * Radar minimap: the map in the game's isometric projection, scaled down. Needs a powered radar.
 * Shows only what the human has explored, with the same fog of war. Click / drag to move the camera.
 *
 * It's redrawn several times a second, but only the units and the camera's frame change that often: the map under them
 * (ground, buildings, scenery, ore) and the fog over them are each kept in a canvas of their own, redrawn when they
 * change (the fog's or the ore's version moves on, or the buildings do).
 */
export class Minimap {
  private readonly canvas = $<HTMLCanvasElement>('#minimap');
  private readonly ctx = this.canvas.getContext('2d')!;
  private k = 1;
  private ox = 0;
  private oy = 0;
  private ready = false;
  /** The map under the units and the fog over them, as last drawn, and what they were drawn from. */
  private readonly under = new Cached();
  private readonly fog = new Cached();

  constructor(private readonly game: HudBridge) {
    let dragging = false;
    const jump = (e: PointerEvent) => {
      if (this.game.minimap().radar !== 'online') return;
      const rect = this.canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) * (this.canvas.width / rect.width) - this.ox) / this.k;
      const y = ((e.clientY - rect.top) * (this.canvas.height / rect.height) - this.oy) / this.k;
      this.game.centerOnWorld(x, y);
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      jump(e);
    });
    this.canvas.addEventListener('pointermove', (e) => dragging && jump(e));
    this.canvas.addEventListener('pointerup', () => (dragging = false));
  }

  private layout(mw: number, mh: number, iso: (gx: number, gy: number) => Point): void {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const left = iso(0, mh).x;
    const right = iso(mw, 0).x;
    const bottom = iso(mw, mh).y;
    this.k = Math.min((W - 8) / (right - left), (H - 8) / bottom);
    this.ox = (W - (right - left) * this.k) / 2 - left * this.k;
    this.oy = (H - bottom * this.k) / 2;
    this.ready = true;
  }

  draw(): void {
    const s = this.game.minimap();
    if (!this.ready) this.layout(s.width, s.height, s.iso);
    const { ctx, k, ox, oy } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const P = (p: Point): [number, number] => [ox + p.x * k, oy + p.y * k];
    const poly = (ctx: CanvasRenderingContext2D, pts: Point[], fill: string) => {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(...P(p)) : ctx.moveTo(...P(p))));
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };
    const tile = (tx: number, ty: number, n = 1) => [s.iso(tx, ty), s.iso(tx + n, ty), s.iso(tx + n, ty + n), s.iso(tx, ty + n)];
    ctx.clearRect(0, 0, W, H);

    if (s.radar !== 'online') {
      poly(ctx, tile(0, 0, Math.max(s.width, s.height)), '#4a4232');
      for (let i = 0; i < 260; i++) {
        ctx.fillStyle = `rgba(200,200,190,${Math.random() * 0.18})`;
        ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2);
      }
      ctx.fillStyle = 'rgba(10,10,10,0.55)';
      ctx.fillRect(0, H / 2 - 20, W, 40);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f5b301';
      ctx.font = '700 14px Rajdhani, sans-serif';
      ctx.fillText(s.radar === 'offline' ? 'RADAR OFFLINE: LOW POWER' : 'NO RADAR', W / 2, H / 2 - 2);
      ctx.fillStyle = '#9a968c';
      ctx.font = '600 11px Rajdhani, sans-serif';
      ctx.fillText(s.radar === 'offline' ? 'Build Power Plants' : 'Build a Radar to see the map', W / 2, H / 2 + 13);
      return;
    }
    const buildings = s.buildings.map((b) => `${b.tx},${b.ty},${b.size},${b.team},${b.built}`).join(';');
    ctx.drawImage(this.under.get(W, H, `${s.fogVersion}|${s.oreVersion}|${buildings}`, (ctx) => {
      poly(ctx, tile(0, 0, Math.max(s.width, s.height)), '#4a4232');
      for (const b of s.buildings) poly(ctx, tile(b.tx, b.ty, b.size), isMine(b.team) && !b.built ? '#8a8576' : colourOf(b.team).minimapBuilding);
      // trees dark green, rocks grey, wrecks dark grey, rubble grey and small, gravity vents gold (grass and other
      // decoration isn't shown)
      const colour: Record<string, string> = { rock: '#8d887c', wreck: '#4f4d49', debris: '#7a766d', vent: '#d9a21b' };
      for (const t of s.scenery) {
        const k = sceneryKind(t.kind);
        if (!k.blocks) continue;
        ctx.fillStyle = colour[k.category] ?? '#3f5a2a';
        const [x, y] = P(s.iso(t.tx + k.size / 2, t.ty + k.size / 2));
        const r = k.category === 'debris' ? 0.7 : k.size;
        ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
      }
      ctx.fillStyle = '#f5b301';
      for (const t of s.ore) {
        const [x, y] = P(s.iso(t.tx + 0.5, t.ty + 0.5));
        const r = 1 + Math.min(1.5, t.rocks * 0.5);
        ctx.fillRect(x - r / 2, y - r / 2, r, r);
      }
    }), 0, 0);
    for (const u of s.units) {
      const [x, y] = P(s.iso(u.gx, u.gy));
      ctx.fillStyle = !isMine(u.team) ? colourOf(u.team).minimapUnit : u.selected ? '#ffffff' : u.harvester ? '#7dff6a' : SIDES.mine.minimapUnit;
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    ctx.drawImage(this.fog.get(W, H, String(s.fogVersion), (ctx) => {
      for (let tx = 0; tx < s.width; tx++) {
        for (let ty = 0; ty < s.height; ty++) {
          const f = s.fogAt(tx, ty);
          if (f !== 2) poly(ctx, tile(tx, ty), f ? 'rgba(0,0,0,0.5)' : '#050505');
        }
      }
    }), 0, 0);
    ctx.strokeStyle = '#f5b301';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(ox + s.view.x * k, oy + s.view.y * k, s.view.width * k, s.view.height * k);
  }
}

/** A canvas drawn once and kept until what it was drawn from (`key`) changes. */
class Cached {
  private readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d')!;
  private key: string | null = null;

  get(width: number, height: number, key: string, draw: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
    if (key === this.key && this.canvas.width === width && this.canvas.height === height) return this.canvas;
    this.key = key;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    } else this.ctx.clearRect(0, 0, width, height);
    draw(this.ctx);
    return this.canvas;
  }
}
