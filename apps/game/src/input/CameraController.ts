import Phaser from 'phaser';
import { CAMERA, DPR } from '../config/game';
import { iso, type GridPoint } from '../core/geometry';

/**
 * Camera: start position, keyboard zoom (+ / − held, 0 resets) between limits, WASD / arrow keys and right-drag
 * panning. The centre of the view is held inside the field's bounding box (the ground around it is scenery), so
 * panning stops at the edge, straight, from any direction.
 */
export class CameraController {
  private readonly keys: Record<'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'W' | 'A' | 'S' | 'D' | 'PLUS' | 'MINUS' | 'NUMPAD_ADD' | 'NUMPAD_SUBTRACT', Phaser.Input.Keyboard.Key>;

  constructor(private readonly scene: Phaser.Scene, start: GridPoint, private readonly field: { width: number; height: number }) {
    const cam = scene.cameras.main;
    const p = iso(start.gx, start.gy);
    cam.setZoom(CAMERA.startZoom * DPR).centerOn(p.x, p.y);
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!p.rightButtonDown()) return;
      cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
      cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
    });
    // no key capture: capturing would swallow W / A / S / D everywhere on the page, including text fields
    this.keys = scene.input.keyboard!.addKeys('UP,DOWN,LEFT,RIGHT,W,A,S,D,PLUS,MINUS,NUMPAD_ADD,NUMPAD_SUBTRACT', false) as CameraController['keys'];
  }

  centerOn(x: number, y: number): void {
    this.scene.cameras.main.centerOn(x, y);
    this.clamp();
  }

  /**
   * Keep the centre of the view inside the field's screen-aligned bounding box (left / right / top / bottom of the
   * diamond). A rectangle, not the diamond itself: at an edge, panning just stops instead of sliding diagonally
   * along the diamond's slanted sides. The corners of the box look over the land around the field.
   */
  clamp(): void {
    const cam = this.scene.cameras.main;
    const left = iso(0, this.field.height).x;
    const right = iso(this.field.width, 0).x;
    const bottom = iso(this.field.width, this.field.height).y;
    const x = cam.scrollX + cam.width / 2;
    const y = cam.scrollY + cam.height / 2;
    const cx = Phaser.Math.Clamp(x, left, right);
    const cy = Phaser.Math.Clamp(y, 0, bottom);
    if (cx !== x || cy !== y) cam.centerOn(cx, cy);
  }

  /** Multiply the zoom (clamped to the limits). */
  zoomBy(factor: number): void {
    const cam = this.scene.cameras.main;
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * factor, CAMERA.minZoom * DPR, CAMERA.maxZoom * DPR));
  }

  resetZoom(): void {
    this.scene.cameras.main.setZoom(CAMERA.startZoom * DPR);
  }

  /** Current zoom relative to the default (1 = default). */
  get zoomLevel(): number {
    return this.scene.cameras.main.zoom / (CAMERA.startZoom * DPR);
  }

  /** Returns true if the camera moved this frame. */
  update(dt: number): boolean {
    const cam = this.scene.cameras.main;
    const k = this.keys;
    if (typingInField()) return false;
    const pan = (CAMERA.panSpeed * dt * DPR) / cam.zoom;
    const dx = (k.RIGHT.isDown || k.D.isDown ? 1 : 0) - (k.LEFT.isDown || k.A.isDown ? 1 : 0);
    const dy = (k.DOWN.isDown || k.S.isDown ? 1 : 0) - (k.UP.isDown || k.W.isDown ? 1 : 0);
    cam.scrollX += dx * pan;
    cam.scrollY += dy * pan;
    const zoom = (k.PLUS.isDown || k.NUMPAD_ADD.isDown ? 1 : 0) - (k.MINUS.isDown || k.NUMPAD_SUBTRACT.isDown ? 1 : 0);
    if (zoom) this.zoomBy(Math.exp(zoom * CAMERA.zoomSpeed * dt)); // smooth while held
    this.clamp(); // after keys, right-drag and minimap jumps alike
    return dx !== 0 || dy !== 0 || zoom !== 0;
  }
}

/** A text field has focus (keys belong to it, not the camera). */
export function typingInField(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable);
}
