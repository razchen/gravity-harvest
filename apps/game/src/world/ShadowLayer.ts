import Phaser from 'phaser';
import { DEPTH } from '../config/game';
import { iso } from '../core/geometry';
import type { GameMap } from './GameMap';

/**
 * Opacity of the shared shadow layer. Every static shadow (scenery and buildings) is drawn into it at full strength
 * (overlaps saturate at 1), then the whole layer is shown at this opacity: no spot is ever darker than this, however
 * many shadows overlap. Moving things (units, ore rocks) keep small baked shadows at the same 18%
 * (tools/sprites/split_shadows.py).
 */
export const SHADOW_ALPHA = 0.18;
/**
 * Opacity of the contact-shadow layer: the small dark patch where a trunk or stem meets the ground (its own
 * ShadowLayer, drawn above the cast shadows, with the same never-stacks rule).
 */
export const CONTACT_ALPHA = 0.4;
/** The layer is drawn at this fraction of world resolution (half: sharp enough at every zoom). */
const SHADOW_RES = 0.5;

export interface ShadowStamp {
  /** Texture key and frame of a full-strength shadow mask. */
  key: string;
  frame: string;
  /** World position of the mask's anchor, and its scale. */
  x: number;
  y: number;
  scale?: number;
  /** Mask pixel that sits on (x, y). */
  anchor: { x: number; y: number };
}

/**
 * The shared shadow mask: one render texture under everything that stands on the ground. Scenery is added once per
 * match; buildings come and go (finished, destroyed, sold), which redraws the layer on the next frame, all in one
 * batched draw. The same class holds the contact shadows (`alpha` CONTACT_ALPHA, `depth` just above).
 */
export class ShadowLayer {
  private readonly rt: Phaser.GameObjects.RenderTexture;
  private readonly left: number;
  private readonly fixed: Phaser.GameObjects.Image[] = [];
  private readonly dynamic = new Map<number, Phaser.GameObjects.Image>();
  private dirty = false;

  constructor(private readonly scene: Phaser.Scene, map: GameMap, opts: { alpha?: number; depth?: number } = {}) {
    this.left = iso(0, map.height).x;
    const w = Math.ceil((iso(map.width, 0).x - this.left) * SHADOW_RES) + 128;
    const h = Math.ceil(iso(map.width, map.height).y * SHADOW_RES) + 128;
    this.rt = scene.add.renderTexture(this.left, 0, w, h)
      .setOrigin(0, 0).setScale(1 / SHADOW_RES).setAlpha(opts.alpha ?? SHADOW_ALPHA).setDepth(opts.depth ?? DEPTH.scorch + 1);
    this.rt.texture.setFilter(Phaser.Textures.FilterMode.LINEAR); // smooth when scaled up, never blocky
    // the scene is reused for every match: stop redrawing when this match's scene shuts down
    const flush = () => this.flush();
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, flush);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.events.off(Phaser.Scenes.Events.POST_UPDATE, flush));
  }

  private stamp(s: ShadowStamp): Phaser.GameObjects.Image {
    const f = this.scene.textures.getFrame(s.key, s.frame);
    return this.scene.make.image({ key: s.key, frame: s.frame }, false)
      .setOrigin(s.anchor.x / f.width, s.anchor.y / f.height)
      .setScale((s.scale ?? 1) * SHADOW_RES)
      .setPosition((s.x - this.left) * SHADOW_RES, s.y * SHADOW_RES);
  }

  /** Shadows that stay for the whole match (scenery). */
  addFixed(list: ShadowStamp[]): void {
    for (const s of list) this.fixed.push(this.stamp(s));
    this.dirty = true;
  }

  /** A shadow that can be removed again (a building), by id. */
  set(id: number, s: ShadowStamp): void {
    this.dynamic.get(id)?.destroy();
    this.dynamic.set(id, this.stamp(s));
    this.dirty = true;
  }

  remove(id: number): void {
    const img = this.dynamic.get(id);
    if (!img) return;
    img.destroy();
    this.dynamic.delete(id);
    this.dirty = true;
  }

  /** Redraw everything in one batch (drawing shadows one by one costs a GPU pass each). */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.rt.clear();
    const all = [...this.fixed, ...this.dynamic.values()];
    if (all.length) this.rt.draw(all);
  }
}
