import Phaser from 'phaser';
import type { OreTileView, RockView } from '@gravity-harvest/shared';
import { meta } from '../assets/manifest';
import { DEPTH } from '../config/game';
import { iso, toGrid, type Tile } from '../core/geometry';
import type { StaticObjects } from './StaticObjects';
import type { GameMap } from './GameMap';
import { hashId } from './SceneryLayer';

/**
 * What a tile looks like at each density step (the server's rocks on a tile are its density in steps: 3 = full).
 * All flat decals in the scenery atlas: dense / medium ore patches (2:1 diamonds a bit larger than a tile, so a
 * field reads as one continuous deposit), a sparse scatter for the last step, and a dug-out scar when it's empty.
 */
const LOOKS: Record<number, string[]> = {
  3: ['ore_dense_1', 'ore_dense_2', 'ore_dense_3', 'ore_dense_4'],
  2: ['ore_medium_1', 'ore_medium_2', 'ore_medium_3', 'ore_medium_4'],
  1: ['ore_bits_1', 'ore_bits_3', 'ore_bits_4'],
  0: ['ore_scar'],
};
/** Ore lies flat on the ground, over the other ground decals: units and buildings always draw over it. */
const ORE_DEPTH = DEPTH.groundDecal + 0.05;
const FADE_MS = 220;
/** Rocks added or removed so far (for OreLayer.version). */
let changes = 0;
/** Mined-out scars are softer than the ore, so an exhausted field reads as dug ground, not a pattern. */
const SCAR_ALPHA = 0.7;

interface RockMark {
  id: number;
  gx: number;
  gy: number;
}

export interface OreTileSprite extends Tile {
  /** 0..1, higher in the middle of a field (darker ground stain). */
  richness: number;
  /** The server's rocks on this tile: its density in steps. */
  rocks: RockMark[];
}

/**
 * Ore as the server describes it, drawn as flat ground decals: one per tile, chosen by how much ore it holds, so a tile
 * visibly thins as it's harvested and fills back up as it regrows. Being flat, ore never covers a harvester driving on
 * it. A mined-out tile shows a scar until ore grows back.
 */
export class OreLayer {
  readonly tiles = new Map<number, OreTileSprite>();
  private readonly rocks = new Map<number, OreTileSprite>();
  private readonly decals = new Map<number, { img: Phaser.GameObjects.Image; step: number }>();
  /** Moves on as rocks come and go, never the same twice, in any match (the minimap redraws its ore only then). */
  version = 0;

  constructor(private readonly scene: Phaser.Scene, private readonly map: GameMap, private readonly statics?: StaticObjects) {}

  /** Tiles first (call drawTerrain after this), then rocks. */
  setTiles(tiles: OreTileView[]): void {
    for (const t of tiles) this.addTile(t);
  }

  addTile(t: OreTileView): OreTileSprite {
    const key = this.map.key(t.tx, t.ty);
    let tile = this.tiles.get(key);
    if (!tile) {
      tile = { tx: t.tx, ty: t.ty, richness: t.richness, rocks: [] };
      this.tiles.set(key, tile);
    }
    return tile;
  }

  addRock(r: RockView): void {
    if (this.rocks.has(r.id)) return;
    const tile = this.addTile({ tx: r.tx, ty: r.ty, richness: 0.3 });
    tile.rocks.push({ id: r.id, gx: r.gx, gy: r.gy });
    this.rocks.set(r.id, tile);
    this.version = ++changes;
    this.show(tile);
  }

  /** A rock was mined out: the tile drops a density step. */
  removeRock(id: number): void {
    const tile = this.rocks.get(id);
    if (!tile) return;
    this.rocks.delete(id);
    this.version = ++changes;
    tile.rocks = tile.rocks.filter((r) => r.id !== id);
    this.show(tile);
  }

  /** At the start: every tile without ore shows its scar (mined out before a save, say). Call after adding the rocks. */
  scarEmptyTiles(): void {
    for (const t of this.tiles.values()) if (!t.rocks.length) this.show(t);
  }

  /** Draw the tile's look for its density, crossfading from the old one. */
  private show(tile: OreTileSprite): void {
    const key = this.map.key(tile.tx, tile.ty);
    const step = Math.min(3, tile.rocks.length);
    const old = this.decals.get(key);
    if (old?.step === step) return;
    const looks = LOOKS[step].filter((k) => this.scene.textures.get('scenery').has(k));
    const hash = hashId(key);
    const frame = looks[hash % Math.max(1, looks.length)];
    const anchors = meta('scenery').anchors ?? {};
    if (frame && anchors[frame]) {
      const a = anchors[frame];
      const f = this.scene.textures.getFrame('scenery', frame);
      // (iso art can't be rotated: mirrored on some tiles for variety, which moves the anchor to the other side)
      const flip = (hash >> 3) % 2 === 1;
      // each tile a little off the grid and a little bigger or smaller, so a field's edges and scars don't line up
      const j = (bits: number) => ((hash >> bits) % 1000) / 1000 - 0.5;
      const p = iso(tile.tx + 0.5 + j(5) * 0.3, tile.ty + 0.5 + j(11) * 0.3);
      const scale = (step ? 1 : 0.85) + j(17) * 0.25;
      const alpha = step ? 1 : SCAR_ALPHA;
      const img = this.scene.add.image(p.x, p.y, 'scenery', frame)
        .setOrigin(flip ? 1 - a.x / f.width : a.x / f.width, a.y / f.height).setFlipX(flip).setScale(scale)
        .setDepth(ORE_DEPTH + (step ? 0.001 * step + 0.0001 * j(23) : -0.01)).setAlpha(alpha);
      this.statics?.addGround(img);
      if (old) {
        img.setAlpha(0);
        this.scene.tweens.add({ targets: img, alpha, duration: FADE_MS });
      }
      this.decals.set(key, { img, step });
    } else this.decals.delete(key);
    if (old) {
      const o = old.img;
      this.scene.tweens.add({ targets: o, alpha: 0, duration: FADE_MS, onComplete: () => o.destroy() });
    }
  }

  /** (Ore is flat on the ground now: nothing to re-sort against buildings.) */
  resort(_keys: number[]): void {}

  at(tx: number, ty: number): OreTileSprite | undefined {
    if (!this.map.inBounds(tx, ty)) return undefined; // keys outside the map would alias tiles inside
    return this.tiles.get(this.map.key(tx, ty));
  }

  hasOre(tx: number, ty: number): boolean {
    return (this.at(tx, ty)?.rocks.length ?? 0) > 0;
  }

  /** Ore tile under a world-pixel point (the tile itself, or the nearest neighbour with ore, since patches overlap). */
  under(x: number, y: number): OreTileSprite | null {
    const g = toGrid(x, y);
    const tx = Math.floor(g.gx);
    const ty = Math.floor(g.gy);
    const direct = this.at(tx, ty);
    if (direct?.rocks.length) return direct;
    let best: OreTileSprite | null = null;
    let bestD = 0.75; // in tiles: within the patch's overhang
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const t = this.at(tx + dx, ty + dy);
        if (!t?.rocks.length) continue;
        const d = Math.hypot(t.tx + 0.5 - g.gx, t.ty + 0.5 - g.gy);
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
    }
    return best;
  }

  totalRocks(): number {
    return this.rocks.size;
  }
}
