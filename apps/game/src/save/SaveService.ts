import type Phaser from 'phaser';
import type { SaveGameSummary } from '@gravity-harvest/shared';
import type { GameScene } from '../scenes/GameScene';
import { SaveApi } from './SaveApi';

const THUMB_W = 320;
const THUMB_H = 180;

/**
 * High-level saving. The server holds the match, so saving is a request over the match socket (the browser
 * only adds a thumbnail); listing, reading and deleting saves go over HTTP. Saves belong to this browser's
 * player id (net/playerId.ts). One autosave slot per scenario (the server keeps it to one, and clears it when a
 * match ends).
 */
export class SaveService {
  constructor(private readonly game: Phaser.Game) {}

  list(): Promise<SaveGameSummary[]> {
    return SaveApi.list();
  }

  async latest(): Promise<SaveGameSummary | null> {
    return (await SaveApi.list({ limit: 1 }))[0] ?? null;
  }

  get(id: string): Promise<SaveGameSummary> {
    return SaveApi.get(id);
  }

  remove(id: string): Promise<void> {
    return SaveApi.remove(id);
  }

  /** Save the match under a new name, or over an existing save if `overwriteId` is given. */
  async saveManual(scene: GameScene, name: string, overwriteId?: string): Promise<SaveGameSummary> {
    return scene.net.save('manual', name, await this.thumbnail(), overwriteId);
  }

  /** Write the autosave slot. `quick` skips the thumbnail (tab hidden: no frame worth keeping). */
  async autosave(scene: GameScene, quick = false): Promise<SaveGameSummary> {
    return scene.net.save('auto', 'Autosave', quick ? null : await this.thumbnail());
  }

  /** Small JPEG of the current frame (the DOM HUD isn't in the canvas, so it's just the battlefield). */
  private thumbnail(): Promise<string | null> {
    return new Promise((resolve) => {
      try {
        this.game.renderer.snapshot((img) => {
          if (!(img instanceof HTMLImageElement)) return resolve(null);
          const c = document.createElement('canvas');
          c.width = THUMB_W;
          c.height = THUMB_H;
          const ctx = c.getContext('2d')!;
          // cover-crop the frame to 16:9
          const s = Math.max(THUMB_W / img.width, THUMB_H / img.height);
          const w = img.width * s;
          const h = img.height * s;
          ctx.drawImage(img, (THUMB_W - w) / 2, (THUMB_H - h) / 2, w, h);
          resolve(c.toDataURL('image/jpeg', 0.72));
        });
      } catch {
        resolve(null);
      }
    });
  }
}
