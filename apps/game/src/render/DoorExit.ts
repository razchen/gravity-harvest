// A unit coming out of a building's door, as it's drawn (in matches and on the dev building page). The sim puts a new
// unit on the tile out in front of the building and drives it on from there; drawn, it waits inside, hidden, while the
// door opens, then drives straight out of the doorway, seen only through the opening (the walls around the door hide
// it) until it's past the building's front. Where it goes after that is up to the caller.
import Phaser from 'phaser';
import { toGrid } from '../core/geometry';
import type { Doorway } from '../data/art';
import type { ConstructionView } from './Construction';

/** Straight out of the lower-left face: along +gy (directions turn counter-clockwise from +gx, so +gy is 12 of 16). */
export const OUT_DIR = 12;
/** A unit starts this far back inside the doorway (tiles). */
const INSIDE_TILES = 0.5;
/**
 * It's out this far past the building's front (tiles): the sim's first waypoint for a new unit (sim.ts spawnFighter:
 * it appears half a tile out, then drives a tile straight on).
 */
const OUT_TILES = 1.5;
/** Seen through the doorway until it's this far past the front (tiles); after that, all of it shows. */
const MASK_TILES = 0.5;
/** It waits for the door to open at most this much longer than the door takes (the door moves only while shown). */
const OPEN_SLACK_MS = 250;
/** The mask's ground in front of the face reaches this far (world px). */
const FRONT_PX = 600;

export class DoorExit {
  gx: number;
  gy: number;
  readonly dir = OUT_DIR;
  private phase: 'opening' | 'out' | 'done' = 'opening';
  private waited = 0;
  private readonly openMs: number;
  private readonly depth: number;
  private readonly outGy: number;
  private readonly maskGy: number;
  private readonly shape: Phaser.GameObjects.Graphics;
  private readonly mask: Phaser.Display.Masks.BitmapMask;

  /**
   * A unit out of `view`'s door, if it has one and its doorway is known (data/art.ts); null otherwise (the unit just
   * appears where the sim puts it). `b` is the building's footprint and its draw depth.
   */
  static create(scene: Phaser.Scene, view: ConstructionView, doorway: Doorway | undefined, b: { tx: number; ty: number; size: number; depth: number }): DoorExit | null {
    const door = view.door;
    return door && doorway ? new DoorExit(scene, view, doorway, door.anchor, b, door.ms) : null;
  }

  private constructor(
    scene: Phaser.Scene,
    private readonly view: ConstructionView,
    d: Doorway,
    anchor: { x: number; y: number },
    b: { tx: number; ty: number; size: number; depth: number },
    openMs: number,
  ) {
    this.openMs = openMs;
    this.depth = b.depth;
    // the doorway in world px: its bottom corners on the ground, along the face (half a pixel down per pixel across)
    const x = view.base.x + d.x - anchor.x;
    const y = view.base.y + d.y - anchor.y;
    const bl = { x: x - d.w / 2, y: y - d.w / 4 };
    const br = { x: x + d.w / 2, y: y + d.w / 4 };
    const ground = toGrid(x, y);
    this.gx = ground.gx;
    this.gy = ground.gy - INSIDE_TILES;
    this.outGy = Math.max(ground.gy, b.ty + b.size) + OUT_TILES;
    this.maskGy = Math.max(ground.gy, b.ty + b.size) + MASK_TILES;
    // what shows of it: the opening, and the ground in front of the face the door is in
    const far = FRONT_PX;
    this.shape = scene.make.graphics({}, false).fillStyle(0xffffff, 1).fillPoints([
      { x: bl.x - far, y: bl.y - far / 2 }, bl, { x: bl.x, y: bl.y - d.h }, { x: br.x, y: br.y - d.h }, br,
      { x: br.x + far, y: br.y + far / 2 }, { x: br.x + far, y: br.y + far * 2 }, { x: bl.x - far, y: br.y + far * 2 },
    ], true);
    this.mask = this.shape.createBitmapMask();
  }

  /** Still in the building (hidden, or seen through the doorway). */
  get inside(): boolean {
    return this.phase !== 'done';
  }

  /** Out of the door and clear of the building. */
  get done(): boolean {
    return this.phase === 'done';
  }

  /** Every frame: waits for the door, then drives out at `speed` (tiles/s). Returns how far it moved (tiles). */
  update(deltaMs: number, speed: number): number {
    if (this.phase === 'opening') {
      this.waited += deltaMs;
      if (this.view.doorOpened || this.waited >= this.openMs + OPEN_SLACK_MS) this.phase = 'out';
      return 0;
    }
    if (this.phase === 'done') return 0;
    const step = Math.min((speed * deltaMs) / 1000, this.outGy - this.gy);
    this.gy += step;
    if (this.gy >= this.outGy - 1e-6) this.phase = 'done';
    return step;
  }

  /**
   * Draw the unit's parts (its body first) as it is now: hidden while the door opens, then over the building but seen
   * only through the doorway, then as normal.
   */
  dress(parts: Phaser.GameObjects.Sprite[]): void {
    if (this.phase === 'opening') {
      for (const p of parts) p.setVisible(false);
      return;
    }
    parts[0].setVisible(true);
    const masked = this.gy < this.maskGy;
    parts.forEach((p, i) => {
      if (masked && p.mask !== this.mask) p.setMask(this.mask);
      else if (!masked && p.mask) p.clearMask();
      // in the footprint the map sorts it under the building: it's in the doorway, so over it
      if (masked) p.setDepth(this.depth + 1.5 + i * 0.001);
    });
  }

  /** Done with it (out, or gone): the parts as normal, the mask let go. */
  release(parts: Phaser.GameObjects.Sprite[]): void {
    for (const p of parts) if (p.mask) p.clearMask();
    parts[0].setVisible(true);
    this.mask.destroy();
    this.shape.destroy();
  }
}
