import Phaser from 'phaser';
import type { SceneryView } from '@gravity-harvest/shared';
import { sceneryKind } from '@gravity-harvest/sim/layout';
import { meta } from '../assets/manifest';
import { DEPTH } from '../config/game';
import { iso } from '../core/geometry';
import type { StaticObjects } from './StaticObjects';
import type { GameMap } from './GameMap';
import { CONTACT_ALPHA, ShadowLayer, type ShadowStamp } from './ShadowLayer';

/** A flat decal the browser adds where something happened (a scorch mark, a stain): not from the server, not saved. */
interface Stamped {
  tx: number;
  ty: number;
  size: number;
  img: Phaser.GameObjects.Image;
}

/** Depth between flat decal layers (SceneryKind.flatLayer): dirt sits 0.2 under the rest, still over the ore stain. */
const FLAT_LAYER_STEP = 0.1;

/** A small stable hash of a number (for picking variants and flips that look random but never change). */
export const hashId = (n: number): number => {
  let h = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
};

interface Placed {
  view: SceneryView;
  img: Phaser.GameObjects.Image;
  /** The ground patch under a tree or bush, if it has one. */
  base?: Phaser.GameObjects.Image;
  blocks: boolean;
}

/**
 * Scenery the server places (a new landscape each match): trees and rocks block their tiles (the placement preview
 * shows them as blocked; units path around them on the server), bushes, logs and stumps are decoration that units
 * walk through. Everything is depth-sorted like units, so a unit behind a tree is hidden by it. Their shadows go into
 * the shared shadow layer (ShadowLayer), with the buildings', so overlapping shadows never get darker.
 *
 * Trees and bushes also have a base decal (`<kind>_base`: dirt, roots, grass) laid flat on the ground under all the
 * shadows, and a contact shadow (`<kind>_contact`) where the trunk or stem meets the ground. Contact shadows have their
 * own layer, so they don't stack either.
 *
 * Flat kinds (craters, scorch marks, stains, ore bits; and ground patches of dirt, gravel and cracked earth under them) are decals: drawn on the ground at `DEPTH.groundDecal`, under
 * every shadow, not depth-sorted, with no shadow of their own. Iso art can't be rotated, so for variety a decal may be
 * mirrored (picked from its id). The browser adds more decals where things happen (`stamp`): those aren't saved.
 */
export class SceneryLayer {
  private readonly placed: Placed[] = [];
  private readonly stamped: Stamped[] = [];
  private readonly contact: ShadowLayer;

  constructor(private readonly scene: Phaser.Scene, private readonly map: GameMap, private readonly shadows: ShadowLayer, private readonly statics?: StaticObjects) {
    this.contact = new ShadowLayer(scene, map, { alpha: CONTACT_ALPHA, depth: DEPTH.scorch + 2 });
  }

  get items(): SceneryView[] {
    return this.placed.filter((p) => p.img.visible).map((p) => p.view);
  }

  add(list: SceneryView[]): void {
    const anchors = meta('scenery').anchors ?? {};
    const stamps: ShadowStamp[] = [];
    for (const s of list) {
      const anchor = anchors[s.kind];
      if (!anchor) continue;
      const kind = sceneryKind(s.kind);
      const p = iso(s.gx, s.gy);
      if (kind.flat) {
        const decal = this.decal(s.kind, p.x, p.y, s.scale, hashId(s.id) % 2 === 1, kind.flatLayer);
        if (decal) this.placed.push({ view: s, img: decal, blocks: false });
        continue;
      }
      const f = this.scene.textures.getFrame('scenery', s.kind);
      const img = this.scene.add.image(p.x, p.y, 'scenery', s.kind)
        .setOrigin(anchor.x / f.width, anchor.y / f.height)
        .setScale(s.scale)
        // decoration sorts just under things standing on the same spot
        .setDepth(this.map.depthAt(s.gx, s.gy) + (kind.blocks ? 0.3 : -0.5));
      this.statics?.add(img);
      const sa = anchors[`${s.kind}_shadow`];
      if (sa) stamps.push({ key: 'scenery', frame: `${s.kind}_shadow`, x: p.x, y: p.y, scale: s.scale, anchor: sa });
      const ca = anchors[`${s.kind}_contact`];
      // (by id: a hidden bush takes its contact shadow with it)
      if (ca) this.contact.set(s.id, { key: 'scenery', frame: `${s.kind}_contact`, x: p.x, y: p.y, scale: s.scale, anchor: ca });
      const ba = anchors[`${s.kind}_base`];
      let base: Phaser.GameObjects.Image | undefined;
      if (ba) {
        const bf = this.scene.textures.getFrame('scenery', `${s.kind}_base`);
        base = this.scene.add.image(p.x, p.y, 'scenery', `${s.kind}_base`)
          .setOrigin(ba.x / bf.width, ba.y / bf.height).setScale(s.scale).setDepth(DEPTH.groundDecal);
        this.statics?.addGround(base);
      }
      if (kind.blocks) for (let x = s.tx; x < s.tx + kind.size; x++) for (let y = s.ty; y < s.ty + kind.size; y++) this.map.blockTile(x, y);
      this.placed.push({ view: s, img, base, blocks: kind.blocks });
    }
    this.shadows.addFixed(stamps);
  }

  /** Whether the scenery atlas has this frame (an older atlas may lack the decals). */
  hasFrame(frame: string): boolean {
    return !!meta('scenery').anchors?.[frame] && this.scene.textures.get('scenery').has(frame);
  }

  /**
   * A flat image on the ground at (x, y) world px, at its anchor; mirrored if `flip`. Null if the atlas lacks it.
   * `layer` (SceneryKind.flatLayer) orders flat decals: ground patches (dirt 0, cracked earth and gravel 1) go under
   * craters, scorch marks, stains and ore bits (2), all between the ore stain and the debug band.
   */
  private decal(frame: string, x: number, y: number, scale: number, flip: boolean, layer = 2): Phaser.GameObjects.Image | null {
    if (!this.hasFrame(frame)) return null;
    const a = meta('scenery').anchors![frame];
    const f = this.scene.textures.getFrame('scenery', frame);
    // (mirroring flips the texture inside the frame, so the anchor moves to the other side)
    const ox = flip ? 1 - a.x / f.width : a.x / f.width;
    const img = this.scene.add.image(x, y, 'scenery', frame).setOrigin(ox, a.y / f.height).setScale(scale).setFlipX(flip)
      .setDepth(DEPTH.groundDecal + FLAT_LAYER_STEP * (layer - 2));
    this.statics?.addGround(img);
    return img;
  }

  /**
   * A decal where something happened (a building burnt down, a harvester was destroyed), centred on (gx, gy) and
   * covering the tiles (tx, ty, size) for hiding. `seed` picks the mirroring. Returns false if the atlas lacks it.
   */
  stamp(frame: string, gx: number, gy: number, scale: number, area: { tx: number; ty: number; size: number }, seed: number): boolean {
    const p = iso(gx, gy);
    const img = this.decal(frame, p.x, p.y, scale, hashId(seed) % 2 === 1);
    if (!img) return false;
    this.stamped.push({ ...area, img });
    return true;
  }

  /**
   * Something now covers these tiles (a building, or ore that grew): hide the decoration there, with its base decal and
   * contact shadow. Its cast shadow stays in the shared layer, but it's under the building or the ore anyway.
   */
  hideDecorIn(tx: number, ty: number, size: number, by: 'building' | 'ore' = 'building'): void {
    for (const p of this.placed) {
      if (p.blocks || !p.img.visible) continue;
      if (by === 'ore' && p.view.kind.startsWith('ore_bits_')) continue; // (ore bits belong under the ore)
      if (p.view.tx >= tx && p.view.tx < tx + size && p.view.ty >= ty && p.view.ty < ty + size) {
        p.img.setVisible(false);
        p.base?.setVisible(false);
        this.contact.remove(p.view.id);
      }
    }
    if (by !== 'building') return;
    for (const d of this.stamped) {
      if (d.tx < tx + size && tx < d.tx + d.size && d.ty < ty + size && ty < d.ty + d.size) d.img.setVisible(false);
    }
  }
}
