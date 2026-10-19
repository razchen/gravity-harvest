import Phaser from 'phaser';
import { DEPTH, FOG, WORLD } from '../config/game';
import { diamond, iso, worldRect } from '../core/geometry';
import { freshCanvasTexture } from '../core/textures';
import type { GameMap } from './GameMap';
import { TERRAIN_COPY_PX } from './Terrain';

/** Outside the field, the fade into the dark is drawn in this many bands (the blur smooths them into a gradient). */
const OUTSIDE_BANDS = 10;

/** Fog changes so far (for FogOfWar.version). */
let changes = 0;

export const FogState = { Unexplored: 0, Explored: 1, Visible: 2 } as const;
export type FogState = (typeof FogState)[keyof typeof FogState];

/**
 * Fog of war as the server reports it: tiles unexplored (black), explored (dimmed) or in sight (clear).
 * Rendered as a low-resolution canvas that is blurred for soft edges and stretched over the map. It carries on
 * over the border around the map: outside tiles take the state of the nearest edge tile, but are never more than
 * explored (a visible edge eases into that over WORLD.outsideSoftTiles), so the land past the field stays a little
 * dim, then fades into the dark by WORLD.outsideFadeTiles.
 */
export class FogOfWar {
  private readonly state: Uint8Array;
  private readonly raw: HTMLCanvasElement;
  private readonly tex: Phaser.Textures.CanvasTexture;
  private readonly originX: number;
  private readonly originY: number;
  /** Moves on with every change of the fog, never the same twice, in any match (the minimap redraws its fog only then). */
  version = 0;

  constructor(scene: Phaser.Scene, private readonly map: GameMap) {
    this.state = new Uint8Array(map.width * map.height);
    const S = FOG.cellPx;
    // a margin past the ground's own area: its texture copies are snapped to 512 px blocks, so it overhangs a little
    const area = worldRect(map.width, map.height);
    const margin = TERRAIN_COPY_PX;
    this.originX = area.left - margin;
    this.originY = area.top - margin;
    this.raw = document.createElement('canvas');
    this.raw.width = Math.ceil((area.right - area.left + 2 * margin) / S);
    this.raw.height = Math.ceil((area.bottom - area.top + 2 * margin) / S);
    this.tex = freshCanvasTexture(scene, 'fog', this.raw.width, this.raw.height);
    scene.add.image(this.originX, this.originY, 'fog').setOrigin(0, 0).setScale(S).setDepth(DEPTH.fog);
  }

  at(tx: number, ty: number): FogState {
    if (!this.map.inBounds(tx, ty)) return FogState.Unexplored;
    return this.state[ty * this.map.width + tx] as FogState;
  }

  isVisible(gx: number, gy: number): boolean {
    return this.at(Math.floor(gx), Math.floor(gy)) === FogState.Visible;
  }

  /** True if any tile of the footprint has ever been seen. */
  isExplored(tx: number, ty: number, size: number): boolean {
    for (let x = tx; x < tx + size; x++) for (let y = ty; y < ty + size; y++) if (this.at(x, y) !== FogState.Unexplored) return true;
    return false;
  }

  /** Apply the server's fog string (one char per tile, row-major: '0' unexplored, '1' explored, '2' visible). */
  apply(fog: string): void {
    const n = Math.min(fog.length, this.state.length);
    for (let i = 0; i < n; i++) this.state[i] = fog.charCodeAt(i) - 48;
    this.version = ++changes;
    this.render();
  }

  private render(): void {
    const S = FOG.cellPx;
    const r = this.raw.getContext('2d')!;
    r.fillStyle = '#000';
    r.fillRect(0, 0, this.raw.width, this.raw.height);
    r.globalCompositeOperation = 'destination-out';
    const { width: W, height: H } = this.map;
    const cut = (f: number, corners: { x: number; y: number }[], grow: number) => {
      if (f === FogState.Unexplored) return;
      r.fillStyle = `rgba(0,0,0,${f === FogState.Visible ? 1 : 1 - FOG.exploredAlpha})`;
      // slightly oversized so neighbours overlap (no hairline seams)
      const cx = corners.reduce((n, p) => n + p.x, 0) / corners.length;
      const cy = corners.reduce((n, p) => n + p.y, 0) / corners.length;
      r.beginPath();
      corners.forEach((p, i) => {
        const x = (cx + (p.x - cx) * grow - this.originX) / S;
        const y = (cy + (p.y - cy) * grow - this.originY) / S;
        if (i) r.lineTo(x, y);
        else r.moveTo(x, y);
      });
      r.closePath();
      r.fill();
    };
    const at = (tx: number, ty: number) => this.state[ty * W + tx];
    for (let tx = 0; tx < W; tx++) for (let ty = 0; ty < H; ty++) cut(at(tx, ty), diamond(tx, ty), 1.15);
    // Beyond the field: each edge tile's fog carried outwards in bands (the corners as L-shaped bands). Near the
    // edge, a visible tile eases down to the outside's "explored" dimness over a few tiles (no line at the edge);
    // further out everything fades into the dark.
    const SOFT = WORLD.outsideSoftTiles;
    const FADE = WORLD.outsideFadeTiles;
    const edges: number[] = [];
    for (let d = 0; d < SOFT; d += 0.5) edges.push(d);
    for (let d = SOFT; d < FADE; d += (FADE - SOFT) / OUTSIDE_BANDS) edges.push(d);
    edges.push(FADE);
    const explored = 1 - FOG.exploredAlpha;
    /** How much fog to cut at `d` tiles out, for an edge tile in state `f`. */
    const alphaAt = (f: number, d: number) => {
      if (f === FogState.Unexplored) return 0;
      // outside is never brighter than explored, except easing into it from a visible edge
      const lit = f === FogState.Visible ? 1 + (explored - 1) * Math.min(1, d / SOFT) : explored;
      return lit * (1 - Math.max(0, Math.min(1, (d - SOFT) / (FADE - SOFT))));
    };
    const quad = (f: number, d: number, c: [number, number][]) => {
      const alpha = alphaAt(f, d);
      if (alpha <= 0) return;
      r.fillStyle = `rgba(0,0,0,${alpha})`;
      r.beginPath();
      c.map(([x, y]) => iso(x, y)).forEach((p, i) => {
        const x = (p.x - this.originX) / S;
        const y = (p.y - this.originY) / S;
        if (i) r.lineTo(x, y);
        else r.moveTo(x, y);
      });
      r.closePath();
      r.fill();
    };
    for (let k = 0; k + 1 < edges.length; k++) {
      const n0 = edges[k];
      const n1 = edges[k + 1];
      const d = (n0 + n1) / 2;
      for (let ty = 0; ty < H; ty++) {
        quad(at(0, ty), d, [[-n1, ty], [-n0, ty], [-n0, ty + 1], [-n1, ty + 1]]);
        quad(at(W - 1, ty), d, [[W + n0, ty], [W + n1, ty], [W + n1, ty + 1], [W + n0, ty + 1]]);
      }
      for (let tx = 0; tx < W; tx++) {
        quad(at(tx, 0), d, [[tx, -n1], [tx + 1, -n1], [tx + 1, -n0], [tx, -n0]]);
        quad(at(tx, H - 1), d, [[tx, H + n0], [tx + 1, H + n0], [tx + 1, H + n1], [tx, H + n1]]);
      }
      // corners: the part of the L-band at distance band k (the farther of the two offsets is in band k)
      for (let j = 0; j <= k; j++) {
        const m0 = edges[j];
        const m1 = edges[j + 1];
        const parts: [number, number, number, number][] = j === k ? [[n0, n1, n0, n1]] : [[n0, n1, m0, m1], [m0, m1, n0, n1]];
        for (const [a0, a1, b0, b1] of parts) {
          quad(at(0, 0), d, [[-a1, -b1], [-a0, -b1], [-a0, -b0], [-a1, -b0]]);
          quad(at(W - 1, 0), d, [[W + a0, -b1], [W + a1, -b1], [W + a1, -b0], [W + a0, -b0]]);
          quad(at(W - 1, H - 1), d, [[W + a0, H + b0], [W + a1, H + b0], [W + a1, H + b1], [W + a0, H + b1]]);
          quad(at(0, H - 1), d, [[-a1, H + b0], [-a0, H + b0], [-a0, H + b1], [-a1, H + b1]]);
        }
      }
    }
    r.globalCompositeOperation = 'source-over';
    const ctx = this.tex.getContext();
    ctx.clearRect(0, 0, this.raw.width, this.raw.height);
    ctx.filter = `blur(${FOG.blurPx}px)`;
    ctx.drawImage(this.raw, 0, 0);
    ctx.filter = 'none';
    this.tex.refresh();
  }
}
