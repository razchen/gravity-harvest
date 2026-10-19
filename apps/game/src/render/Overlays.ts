import Phaser from 'phaser';
import { DEPTH } from '../config/game';
import { iso } from '../core/geometry';
import { HarvesterSprite } from '../entities/UnitSprite';
import type { GameScene } from '../scenes/GameScene';

/** Selection rings, harvester cargo gauges, transports' passenger pips, and health bars on anything selected or damaged. */
export class Overlays {
  private readonly gfx: Phaser.GameObjects.Graphics;

  constructor(private readonly world: GameScene) {
    this.gfx = world.add.graphics().setDepth(DEPTH.ui);
  }

  private bar(x: number, y: number, w: number, frac: number): void {
    const color = frac > 0.5 ? 0x5fe04a : frac > 0.25 ? 0xf5c400 : 0xe8453a;
    this.gfx.fillStyle(0x000000, 0.75).fillRect(x - w / 2 - 2, y - 2, w + 4, 10);
    this.gfx.fillStyle(color, 1).fillRect(x - w / 2, y, w * Math.max(0, frac), 6);
  }

  draw(): void {
    const g = this.gfx.clear();
    for (const u of this.world.units.values()) {
      const p = iso(u.gx, u.gy);
      const harv = u instanceof HarvesterSprite;
      if (u.selected) {
        g.lineStyle(3, 0x7dff6a, 0.95).strokeEllipse(p.x, p.y - 4, harv ? 150 : 84, harv ? 70 : 42);
        if (u instanceof HarvesterSprite && u.capacity) {
          // cargo gauge
          g.fillStyle(0x000000, 0.75).fillRect(p.x - 57, p.y - 122, 114, 12);
          g.fillStyle(0xffc93a, 1).fillRect(p.x - 55, p.y - 120, 110 * (u.cargo / u.capacity), 8);
        }
      }
      if (u.selected || u.hp < u.maxHp) this.bar(p.x, p.y - (harv ? 100 : 112), harv ? 110 : 50, u.hp / u.maxHp);
      // a transport's passengers: a pip per seat over its health bar, lit for each one inside
      if (u.seats && u.passengers) {
        const w = 10, gap = 3, x0 = p.x - (u.seats * (w + gap) - gap) / 2, y = p.y - 130;
        g.fillStyle(0x000000, 0.75).fillRect(x0 - 2, y - 2, u.seats * (w + gap) - gap + 4, w + 4);
        for (let i = 0; i < u.seats; i++) g.fillStyle(i < u.passengers ? 0xffc93a : 0x3a3b3c, 1).fillRect(x0 + i * (w + gap), y, w, w);
      }
    }
    for (const b of this.world.buildings.values()) {
      if (b.built && b.hp < b.maxHp) this.bar(b.sprite.x, b.sprite.y - 70 * b.size, 40 * b.size, b.hp / b.maxHp);
    }
  }
}
