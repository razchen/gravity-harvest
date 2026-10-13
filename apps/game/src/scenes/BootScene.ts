import Phaser from 'phaser';
import { ATLASES, TERRAIN, sprites, type SpriteMeta } from '../assets/manifest';
import { loadFxSheets } from '../render/fxTextures';

/** Loads every atlas, records each atlas's meta block, builds the shared animations, then opens the menu. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload(): void {
    // the loading screen in index.html: fill its bar as files arrive
    const bar = document.getElementById('loading-bar');
    this.load.on(Phaser.Loader.Events.PROGRESS, (p: number) => { if (bar) bar.style.width = `${Math.round(p * 100)}%`; });
    this.load.image(TERRAIN.earth.key, TERRAIN.earth.file);
    loadFxSheets(this); // fire and smoke flipbooks (render/Destruction.ts)
    for (const a of ATLASES) {
      this.load.atlas(a.key, `assets/sprites/${a.file}.png`, `assets/sprites/${a.file}.json`);
      this.load.json(`${a.key}_meta`, `assets/sprites/${a.file}.json`);
    }
  }

  create(): void {
    for (const a of ATLASES) {
      const frame = this.textures.getFrame(a.key, a.firstFrame);
      const raw = (this.cache.json.get(`${a.key}_meta`) as { meta: Partial<SpriteMeta> }).meta;
      // the full frame size (trimmed frames, like the rifleman's, are drawn within it)
      sprites[a.key] = { anchor: { x: 0, y: 0 }, ...raw, w: frame.realWidth, h: frame.realHeight };
    }
    this.scene.start('menu');
    this.game.events.emit('booted');
    const loading = document.getElementById('loading');
    if (loading) {
      loading.classList.add('done');
      window.setTimeout(() => loading.remove(), 450);
    }
  }
}
