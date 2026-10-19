import type { Grid } from './grid.js';

export const FogState = { Unexplored: 0, Explored: 1, Visible: 2 } as const;
export type FogState = (typeof FogState)[keyof typeof FogState];

export interface Viewer {
  gx: number;
  gy: number;
  sight: number;
}

/** One team's fog of war: tiles start unexplored, stay explored once seen, and are visible while in sight. */
export class Fog {
  private readonly state: Uint8Array;
  /** Debug: report everything as in sight. The real fog carries on underneath, so turning it off brings it back. */
  revealAll = false;

  constructor(private readonly map: Grid) {
    this.state = new Uint8Array(map.width * map.height);
  }

  at(tx: number, ty: number): FogState {
    if (!this.map.inBounds(tx, ty)) return FogState.Unexplored;
    if (this.revealAll) return FogState.Visible;
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

  /** True if any tile of the footprint is in sight. */
  anyVisible(tx: number, ty: number, size: number): boolean {
    for (let x = tx; x < tx + size; x++) for (let y = ty; y < ty + size; y++) if (this.at(x, y) === FogState.Visible) return true;
    return false;
  }

  update(viewers: Iterable<Viewer>): void {
    const st = this.state;
    const W = this.map.width;
    for (let i = 0; i < st.length; i++) st[i] = st[i] === FogState.Visible ? FogState.Explored : st[i];
    for (const v of viewers) {
      const r2 = v.sight * v.sight;
      for (let tx = Math.floor(v.gx - v.sight); tx <= v.gx + v.sight; tx++) {
        for (let ty = Math.floor(v.gy - v.sight); ty <= v.gy + v.sight; ty++) {
          if (!this.map.inBounds(tx, ty)) continue;
          const dx = tx + 0.5 - v.gx;
          const dy = ty + 0.5 - v.gy;
          if (dx * dx + dy * dy <= r2) st[ty * W + tx] = FogState.Visible;
        }
      }
    }
  }

  /** One char per tile: '0' unexplored, '1' explored, '2' visible. */
  encode(): string {
    if (this.revealAll) return '2'.repeat(this.state.length);
    let out = '';
    for (const v of this.state) out += v;
    return out;
  }

  /** Explored tiles as one char per tile (1 = explored), for saves. */
  serializeExplored(): string {
    let out = '';
    for (const v of this.state) out += v === FogState.Unexplored ? '0' : '1';
    return out;
  }

  restoreExplored(data: string): void {
    for (let i = 0; i < this.state.length && i < data.length; i++) if (data[i] === '1') this.state[i] = FogState.Explored;
  }

  /** Every tile's state as `encode()` gives it, but the real fog beneath a debug reveal: what a full save keeps. */
  serialize(): string {
    let out = '';
    for (const v of this.state) out += v;
    return out;
  }

  restore(data: string): void {
    for (let i = 0; i < this.state.length && i < data.length; i++) this.state[i] = Number(data[i]) as FogState;
  }
}
