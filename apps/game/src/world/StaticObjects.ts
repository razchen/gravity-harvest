import Phaser from 'phaser';
import { DEPTH } from '../config/game';

/** Things are kept drawn this far past the edges of the view (a share of the view's size), so panning rarely re-checks. */
const MARGIN = 0.35;
/** ...and re-checked once the view comes within this share of the kept area's edge. */
const GUARD = 0.1;

interface Item {
  obj: Phaser.GameObjects.Image;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The things in a match that never move (the ground's texture copies, ore, scenery, decals): some 5,000 of them, of
 * which a few hundred are on screen. Two things keep them cheap:
 *
 * - **Off screen, they're left out of drawing.** The renderer would otherwise work out every one of them each frame.
 *   It's done with the camera's ignore mask (`cameraFilter`), so `visible` keeps meaning hidden on purpose (decoration
 *   under a building). The view is checked just before drawing (the scene's pre-render), from the camera's scroll and
 *   zoom, which are this frame's by then (its `worldView` isn't until it draws), so a jump across the map is right on
 *   its first frame.
 * - **What lies flat on the ground is in a layer of its own** (`ground`, at the bottom of the scene: under everything
 *   that stands, as its depths already put it), so the scene doesn't re-sort those half of them every time a unit's
 *   depth changes. In the layer they keep their depths and their order.
 */
export class StaticObjects {
  readonly ground: Phaser.GameObjects.Layer;
  private readonly items: Item[] = [];
  /** The area last kept drawn, in world px (empty: check on the next frame). */
  private readonly kept = new Phaser.Geom.Rectangle(0, 0, 0, 0);

  constructor(private readonly scene: Phaser.Scene) {
    this.ground = scene.add.layer().setDepth(DEPTH.ground);
    scene.events.on(Phaser.Scenes.Events.PRE_RENDER, this.update, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.events.off(Phaser.Scenes.Events.PRE_RENDER, this.update, this));
  }

  /** `obj` stays where it is from now on (until it's destroyed): leave it out of drawing while it's off screen. */
  add<T extends Phaser.GameObjects.Image>(obj: T): T {
    const b = obj.getBounds();
    const it = { obj, left: b.left, top: b.top, right: b.right, bottom: b.bottom };
    this.items.push(it);
    if (!this.kept.isEmpty()) this.place(it, this.scene.cameras.main.id);
    return obj;
  }

  /** `obj` lies flat on the ground (under everything that stands) and stays where it is: into the ground layer. */
  addGround<T extends Phaser.GameObjects.Image>(obj: T): T {
    this.ground.add(obj);
    return this.add(obj);
  }

  private update(): void {
    const cam = this.scene.cameras.main;
    const w = cam.width / cam.zoom;
    const h = cam.height / cam.zoom;
    const x = cam.scrollX + cam.width / 2 - w / 2;
    const y = cam.scrollY + cam.height / 2 - h / 2;
    const k = this.kept;
    const gx = w * GUARD;
    const gy = h * GUARD;
    if (x - gx >= k.left && y - gy >= k.top && x + w + gx <= k.right && y + h + gy <= k.bottom) return;
    k.setTo(x - w * MARGIN, y - h * MARGIN, w * (1 + 2 * MARGIN), h * (1 + 2 * MARGIN));
    const id = cam.id;
    let n = 0;
    for (const it of this.items) {
      if (!it.obj.scene) continue; // destroyed (an ore look that was replaced): forget it
      this.items[n++] = it;
      this.place(it, id);
    }
    this.items.length = n;
  }

  /** Drawn (by camera `id`) if it overlaps the kept area. */
  private place(it: Item, id: number): void {
    const k = this.kept;
    const on = it.right >= k.left && it.left <= k.right && it.bottom >= k.top && it.top <= k.bottom;
    it.obj.cameraFilter = on ? it.obj.cameraFilter & ~id : it.obj.cameraFilter | id;
  }
}
