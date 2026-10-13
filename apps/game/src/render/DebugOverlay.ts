import Phaser from 'phaser';
import { DEPTH } from '../config/game';
import { iso } from '../core/geometry';
import type { GameMap } from '../world/GameMap';
import { TERRAIN_COPY_PX } from '../world/Terrain';

/** G: tile grid and the borders of each copy of the ground texture. */
export class DebugOverlay {
  private gfx: Phaser.GameObjects.Graphics | null = null;

  constructor(private readonly scene: Phaser.Scene, private readonly map: GameMap, private readonly onToast: (msg: string) => void) {}

  get on(): boolean {
    return this.gfx !== null;
  }

  toggle(): void {
    if (this.gfx) {
      this.gfx.destroy();
      this.gfx = null;
      return;
    }
    const g = (this.gfx = this.scene.add.graphics().setDepth(DEPTH.debug));
    const { width: W, height: H } = this.map;
    const line = (ax: number, ay: number, bx: number, by: number) => {
      const a = iso(ax, ay);
      const b = iso(bx, by);
      g.lineBetween(a.x, a.y, b.x, b.y);
    };
    g.lineStyle(1, 0xffffff, 0.22);
    for (let i = 0; i <= W; i++) line(i, 0, i, H);
    for (let j = 0; j <= H; j++) line(0, j, W, j);
    g.lineStyle(4, 0xffd34d, 0.95);
    const left = iso(0, H).x;
    const right = iso(W, 0).x;
    const bottom = iso(W, H).y;
    for (let x = left; x <= right; x += TERRAIN_COPY_PX) g.lineBetween(x, 0, x, bottom);
    for (let y = 0; y <= bottom; y += TERRAIN_COPY_PX) g.lineBetween(left, y, right, y);
    this.onToast('Debug (G): white = tiles, yellow = one copy of the ground texture');
  }
}
