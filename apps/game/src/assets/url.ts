// Where the game's assets are served from (tools/assets/assets.mjs): the version in assets.json on S3 for a build,
// the local public/assets folder in development. Vite sets VITE_ASSET_BASE (vite.config.ts); Phaser's loader gets it
// as its base URL (main.ts), so only files loaded outside Phaser (img tags, music) go through assetUrl.

/** Prefix for asset paths: '' (local) or the S3 version folder, ending in '/'. */
export const ASSET_BASE: string = import.meta.env.VITE_ASSET_BASE ?? '';

/** The URL of an asset path such as 'assets/ui/logo.webp'. */
export function assetUrl(path: string): string {
  return ASSET_BASE + path;
}
