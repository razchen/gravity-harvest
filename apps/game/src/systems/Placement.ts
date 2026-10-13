import Phaser from 'phaser';
import { checkPlacement, footprint, TOO_FAR, type PlacementCheck } from '@gravity-harvest/sim/layout';
import { anchorOrigin, finishedFrames, meta } from '../assets/manifest';
import { DEPTH } from '../config/game';
import { diamond, iso, toGrid } from '../core/geometry';
import { BUILDING_ART } from '../data/art';
import type { GameScene } from '../scenes/GameScene';
import { getCatalog, missingFor } from './availability';

interface Placing {
  type: string;
  ghost: Phaser.GameObjects.Sprite;
  gfx: Phaser.GameObjects.Graphics;
  tx: number;
  ty: number;
  problem: string | null;
}

/**
 * Building placement: a ghost that follows the mouse with green / red tiles, confirm or cancel. The preview
 * uses the same check as the server (packages/sim layout.ts) on what this player can see; the server decides.
 */
export class Placement {
  private placing: Placing | null = null;

  constructor(private readonly world: GameScene) {}

  get active(): boolean {
    return this.placing !== null;
  }

  get type(): string | null {
    return this.placing?.type ?? null;
  }

  /** Current problem with the spot under the mouse (null = can build). */
  get problem(): string | null {
    return this.placing?.problem ?? null;
  }

  start(type: string): 'ok' | 'poor' {
    if (this.world.credits() < getCatalog().buildings[type].cost) return 'poor';
    this.cancel();
    const art = BUILDING_ART[type];
    const ghost = this.world.add.sprite(0, 0, art.sprite, finishedFrames(art.sprite).body)
      .setOrigin(...anchorOrigin(meta(art.sprite))).setAlpha(0.6).setDepth(DEPTH.ui - 3);
    this.placing = { type, ghost, gfx: this.world.add.graphics().setDepth(DEPTH.ui - 4), tx: 0, ty: 0, problem: null };
    const p = this.world.input.activePointer;
    this.update(p.worldX, p.worldY);
    return 'ok';
  }

  cancel(): void {
    if (!this.placing) return;
    this.placing.ghost.destroy();
    this.placing.gfx.destroy();
    this.placing = null;
  }

  private check(type: string, tx: number, ty: number): PlacementCheck {
    const w = this.world;
    const units = [...w.units.values()];
    return checkPlacement(type, tx, ty, {
      isBlocked: (x, y) => w.map.isBlocked(x, y),
      hasOre: (x, y) => w.ore.hasOre(x, y),
      unitOn: (x, y) => units.some((u) => Math.floor(u.gx) === x && Math.floor(u.gy) === y),
      ownBuildings: [...w.buildings.values()].filter((b) => b.team === 'player'),
    });
  }

  /** Follow the pointer (world coordinates). */
  update(wx: number, wy: number): void {
    const pl = this.placing;
    if (!pl) return;
    const n = footprint(pl.type);
    const g = toGrid(wx, wy);
    pl.tx = Math.round(g.gx - n / 2);
    pl.ty = Math.round(g.gy - n / 2);
    const { problem, tiles } = this.check(pl.type, pl.tx, pl.ty);
    pl.problem = problem;
    const c = iso(pl.tx + n / 2, pl.ty + n / 2);
    pl.ghost.setPosition(c.x, c.y);
    if (problem) pl.ghost.setTint(0xff7a6a);
    else pl.ghost.clearTint();
    pl.gfx.clear();
    for (const t of tiles) {
      const red = t.bad || problem === TOO_FAR;
      const color = red ? 0xff4a3a : 0x7dff6a;
      pl.gfx.fillStyle(color, t.extra ? 0.18 : 0.35).fillPoints(diamond(t.tx, t.ty), true)
        .lineStyle(2, color, 0.9).strokePoints(diamond(t.tx, t.ty), true);
    }
  }

  confirm(): void {
    const pl = this.placing;
    if (!pl) return;
    const w = this.world;
    if (pl.problem) return w.bus.emit('toast', pl.problem);
    const needs = missingFor(pl.type, w.ownedTypes());
    if (needs) return w.bus.emit('toast', `Build a ${needs} first`);
    const cost = getCatalog().buildings[pl.type].cost;
    if (w.credits() < cost) return w.bus.emit('toast', `Need $${(cost - w.credits()).toLocaleString('en-US')} more`);
    w.net.command({ c: 'place', building: pl.type, tx: pl.tx, ty: pl.ty });
    this.cancel();
  }
}
