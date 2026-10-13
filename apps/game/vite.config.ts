import { createReadStream, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Dev server only: the 3D models in art/models (gitignored, not in public/) at /art-models/..., for the dev pages'
 * model viewer. Only .glb files inside that folder.
 */
function artModels(): Plugin {
  const root = new URL('../../art/models/', import.meta.url).pathname;
  return {
    name: 'art-models',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/art-models', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '').split('?')[0]);
        const file = normalize(join(root, rel));
        if (!file.startsWith(normalize(root) + (root.endsWith(sep) ? '' : sep)) || !file.endsWith('.glb')) return next();
        try {
          const { size } = statSync(file);
          res.writeHead(200, { 'Content-Type': 'model/gltf-binary', 'Content-Length': size, 'Cache-Control': 'no-cache' });
          createReadStream(file).pipe(res);
        } catch {
          next();
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [artModels()],
  resolve: {
    alias: { '@': new URL('./src', import.meta.url).pathname },
  },
  server: {
    port: 5173,
    // The game server (apps/server, NestJS) listens on 4310; the browser talks to it via /api (HTTP for saves,
    // a WebSocket at /api/match for the match). GH_API_TARGET lets the e2e tests use a throwaway server.
    proxy: { '/api': { target: process.env.GH_API_TARGET ?? 'http://127.0.0.1:4310', ws: true } },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,   // Phaser alone is ~1.2 MB
  },
});
