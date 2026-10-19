import Phaser from 'phaser';
import { TERRAIN } from '../assets/manifest';
import { DEPTH } from '../config/game';
import { diamond, iso, worldRect } from '../core/geometry';
import { freshCanvasTexture } from '../core/textures';
import type { StaticObjects } from './StaticObjects';
import type { GameMap } from './GameMap';
import type { OreLayer } from './OreLayer';

/** Size of one ground-texture copy in world px (4 tiles wide). 1:1 on a Retina screen at 2x default zoom. */
export const TERRAIN_COPY_PX = 512;

/**
 * Ground: the seamless dirt texture tiled straight onto the screen (unrotated, unsquashed: seen
 * from above dirt has no direction, and skipping the isometric warp keeps it crisp). It covers the map and a wide
 * border around it (WORLD.borderTiles), so the land carries on past the playable field instead of ending in black.
 * Plain images rather than a TileSprite so the GPU uses the texture's mipmaps (and off-screen ones can be left out of
 * drawing, `statics`). Ore fields get a soft dark stain.
 */
export function drawTerrain(scene: Phaser.Scene, map: GameMap, ore: OreLayer, statics?: StaticObjects): void {
  const left = iso(0, map.height).x;
  const right = iso(map.width, 0).x;
  const bottom = iso(map.width, map.height).y;

  const src = scene.textures.get(TERRAIN.earth.key).getSourceImage() as HTMLImageElement;
  const k = TERRAIN_COPY_PX / src.width;
  const ground = scene.add.container(0, 0).setDepth(DEPTH.ground);
  statics?.ground.add(ground);
  const area = worldRect(map.width, map.height);
  // copies stay aligned to the map's grid of texture copies, so the playable area looks the same as before
  const x0 = left - Math.ceil((left - area.left) / TERRAIN_COPY_PX) * TERRAIN_COPY_PX;
  const y0 = -Math.ceil(-area.top / TERRAIN_COPY_PX) * TERRAIN_COPY_PX;
  for (let y = y0; y < area.bottom; y += TERRAIN_COPY_PX) {
    for (let x = x0; x < area.right; x += TERRAIN_COPY_PX) {
      const copy = scene.make.image({ x, y, key: TERRAIN.earth.key }, false).setOrigin(0, 0).setScale(k);
      ground.add(copy);
      statics?.add(copy);
    }
  }

  // Ore stain: per-tile alpha painted at low resolution, blurred, then stretched over the map
  const S = 16;
  const cw = Math.ceil((right - left) / S);
  const ch = Math.ceil(bottom / S);
  const raw = document.createElement('canvas');
  raw.width = cw;
  raw.height = ch;
  const r = raw.getContext('2d')!;
  for (const t of ore.tiles.values()) {
    r.fillStyle = `rgba(38,24,12,${0.35 + 0.3 * t.richness})`;
    r.beginPath();
    diamond(t.tx, t.ty).forEach((p, i) => (i ? r.lineTo((p.x - left) / S, p.y / S) : r.moveTo((p.x - left) / S, p.y / S)));
    r.closePath();
    r.fill();
  }
  // one stain texture per scene, so the menu backdrop and a match never share (and destroy) each other's
  const key = `${scene.scene.key}_ore_stain`;
  const tex = freshCanvasTexture(scene, key, cw, ch);
  const ctx = tex.getContext();
  ctx.filter = 'blur(5px)';
  ctx.drawImage(raw, 0, 0);
  ctx.filter = 'none';
  tex.refresh();
  const stain = scene.add.image(left, 0, key).setOrigin(0, 0).setScale(S).setDepth(DEPTH.groundStain);
  statics?.ground.add(stain);
}
