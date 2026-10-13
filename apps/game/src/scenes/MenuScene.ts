import Phaser from 'phaser';
import { anchorOrigin, finishedFrames, meta } from '../assets/manifest';
import { CAMERA, DPR } from '../config/game';
import { iso } from '../core/geometry';
import { GameMap } from '../world/GameMap';
import { OreLayer } from '../world/OreLayer';
import { SceneryLayer } from '../world/SceneryLayer';
import { ShadowLayer } from '../world/ShadowLayer';
import { drawTerrain } from '../world/Terrain';

/**
 * Living backdrop behind the menus: a small base (refinery, power plants, radar, barracks, harvester, ore)
 * with its animations running, and the camera drifting slowly over it. No gameplay.
 */
export class MenuScene extends Phaser.Scene {
  private t = 0;
  private centre = { x: 0, y: 0 };

  constructor() {
    super('menu');
  }

  create(): void {
    this.t = 0;
    const map = new GameMap(26, 26);
    const ore = new OreLayer(this, map);
    const occupy = (tx: number, ty: number, size: number) =>
      map.addOccluder({ tx, ty, size, depth: iso(tx + size / 2, ty + size / 2).y, inFront: (gx, gy) => gx >= tx + size || gy >= ty + size });
    const buildings: [string, number, number, number][] = [
      ['b_refinery_build', 9, 8, 4],
      ['b_power_plant_build', 4, 8, 3],
      ['b_power_plant_build', 4, 12, 3],
      ['b_radar_build', 9, 3, 3],
      ['b_barracks_build', 14, 13, 3],
    ];
    for (const [, tx, ty, size] of buildings) occupy(tx, ty, size);
    // decorative ore field (no gameplay here, so a local random scatter is fine)
    const rng = new Phaser.Math.RandomDataGenerator(['menu']);
    const tiles: { tx: number; ty: number; richness: number }[] = [];
    for (let tx = 14; tx <= 22; tx++) {
      for (let ty = 5; ty <= 13; ty++) {
        const d = Math.hypot(tx - 18, ty - 9) / 3.4 + rng.realInRange(-0.25, 0.25);
        if (d < 1 && !map.isBlocked(tx, ty)) tiles.push({ tx, ty, richness: 1 - d });
      }
    }
    ore.setTiles(tiles);
    drawTerrain(this, map, ore);
    let id = 0;
    for (const t of tiles) {
      for (let i = 0, n = 1 + Math.round(t.richness * 2 * rng.frac()); i < n; i++) {
        ore.addRock({ id: id++, tx: t.tx, ty: t.ty, gx: t.tx + rng.realInRange(0.15, 0.85), gy: t.ty + rng.realInRange(0.15, 0.85), shape: rng.between(0, 7) });
      }
    }

    const shadows = new ShadowLayer(this, map);
    buildings.forEach(([key, tx, ty, size], i) => {
      const c = iso(tx + size / 2, ty + size / 2);
      const f = finishedFrames(key);
      shadows.set(i, { key, frame: f.shadow, x: c.x, y: c.y, anchor: meta(key).anchor });
      this.add.image(c.x, c.y, key, f.body).setOrigin(...anchorOrigin(meta(key))).setDepth(c.y);
    });
    // some trees, rocks and bushes around the base
    const kinds = ['oak', 'evergreen', 'olive', 'oak', 'deadwood', 'cypress', 'boulders', 'oak', 'evergreen', 'crag', 'olive', 'shrub', 'sage', 'log', 'juniper'];
    const spots = [[2, 4], [3, 6], [1, 9], [2, 16], [8, 17], [20, 3], [22, 5], [21, 15], [18, 18], [5, 19], [12, 20], [3, 12], [8, 3], [10, 18], [19, 14]];
    new SceneryLayer(this, map, shadows).add(spots.map(([tx, ty], i) => ({
      id: i, kind: kinds[i], tx, ty, gx: tx + 0.5 + rng.realInRange(-0.15, 0.15), gy: ty + 0.5 + rng.realInRange(-0.15, 0.15), scale: rng.realInRange(0.9, 1.1),
    })));
    // A harvester at work in the ore field
    const h = iso(16.5, 11.2);
    this.add.sprite(h.x, h.y, 'harvester', 'harv_10_0').setOrigin(...anchorOrigin(meta('harvester'))).setDepth(map.depthAt(16.5, 11.2) + 0.5);

    this.centre = iso(12, 10);
    const cam = this.cameras.main;
    cam.setZoom(CAMERA.startZoom * 1.15 * DPR).centerOn(this.centre.x, this.centre.y);
  }

  override update(_time: number, delta: number): void {
    this.t += delta / 1000;
    const cam = this.cameras.main;
    cam.centerOn(this.centre.x + Math.sin(this.t * 0.07) * 260, this.centre.y + Math.sin(this.t * 0.05) * 90);
  }
}
