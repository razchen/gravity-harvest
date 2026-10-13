import Phaser from 'phaser';

/** Create a canvas texture, replacing any left over from a previous run of the scene (restart / load). */
export function freshCanvasTexture(scene: Phaser.Scene, key: string, width: number, height: number): Phaser.Textures.CanvasTexture {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, width, height);
  if (!tex) throw new Error(`Could not create canvas texture "${key}"`);
  return tex;
}
