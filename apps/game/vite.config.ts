import { execFile } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, relative, sep } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
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

  const AUDIO_TYPES: Record<string, string> = { '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.flac': 'audio/flac' };

  /**
   * Dev server only, for the Sounds page (dev/sounds.html): the candidate sounds in art/audio (gitignored) at
   * /art-audio/..., their list at /art-audio/index.json, and the sounds picked for the game's slots, read from and saved
   * to tools/audio/picks.json (POST /art-audio/picks). Also the ElevenLabs prompts (GET/POST /art-audio/prompts:
   * tools/audio/sfx_prompts.json), making a slot's sounds (POST /art-audio/generate {slot}: tools/audio/elevenlabs.py)
   * and packing the picks into the game (POST /art-audio/pack: tools/audio/pack_audio.py).
   */
  function artAudio(): Plugin {
    const root = new URL('../../art/audio/', import.meta.url).pathname;
    const picks = new URL('../../tools/audio/picks.json', import.meta.url).pathname;
    const prompts = new URL('../../tools/audio/sfx_prompts.json', import.meta.url).pathname;
    const repo = new URL('../../', import.meta.url).pathname;
    /** Run one of the audio tools from the repo root; resolves with what it printed. */
    const tool = (args: string[]) => new Promise<{ ok: boolean; out: string }>((done) => {
      execFile('python3', args, { cwd: repo, timeout: 15 * 60_000, maxBuffer: 4 << 20 }, (err, stdout, stderr) => {
        done({ ok: !err, out: `${stdout}${stderr}`.trim().split('\n').slice(-40).join('\n') });
      });
    });
    const body = (req: import('node:http').IncomingMessage) => new Promise<unknown>((done) => {
      let text = '';
      req.on('data', (c) => { text += c; });
      req.on('end', () => {
        try {
          done(JSON.parse(text));
        } catch {
          done(null);
        }
      });
    });
    const list = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return e.name === 'zips' ? [] : list(p);
      return Object.keys(AUDIO_TYPES).some((x) => e.name.toLowerCase().endsWith(x)) ? [relative(root, p).split(sep).join('/')] : [];
    });
    return {
      name: 'art-audio',
      apply: 'serve',
      configureServer(server) {
        server.middlewares.use('/art-audio', (req, res, next) => {
          const rel = decodeURIComponent((req.url ?? '').split('?')[0]);
          const json = (status: number, body: unknown) => {
            res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
            res.end(JSON.stringify(body));
          };
          if (rel === '/index.json') {
            try {
              return json(200, list(root).sort());
            } catch {
              return json(200, []);
            }
          }
          if (rel === '/labels') {
            // what each made sound says or is (the .json next to it: a voice's line, an effect's short name)
            const labels: Record<string, string> = {};
            try {
              for (const f of list(root)) {
                try {
                  const m = JSON.parse(readFileSync(join(root, f.replace(/\.[^.]+$/, '.json')), 'utf8')) as { kind?: string; text?: string; name?: string };
                  const label = m.kind === 'voice' && m.text ? `“${m.text}”` : m.name ?? m.text?.split(/[:.]/)[0];
                  if (label) labels[f] = label;
                } catch { /* no notes: the page shows its file name */ }
              }
            } catch { /* no art/audio */ }
            return json(200, labels);
          }
          if (rel === '/voices') {
            try {
              return json(200, JSON.parse(readFileSync(new URL('../../tools/audio/voice_lines.json', import.meta.url).pathname, 'utf8')));
            } catch {
              return json(200, {});
            }
          }
          if (rel === '/levels') {
            try {
              return json(200, JSON.parse(readFileSync(new URL('../../tools/audio/levels.json', import.meta.url).pathname, 'utf8')));
            } catch {
              return json(200, {});
            }
          }
          if (rel === '/prompts') {
            if (req.method === 'POST') {
              // one slot's prompt: { slot, prompt, seconds, loop, variations }
              void body(req).then((b) => {
                const v = b as { slot?: string; prompt?: string; seconds?: number; loop?: boolean; variations?: number } | null;
                if (!v?.slot || !/^[a-z_]+$/.test(v.slot) || !v.prompt?.trim()) return json(400, { ok: false });
                let sheet: Record<string, unknown> = {};
                try {
                  sheet = JSON.parse(readFileSync(prompts, 'utf8')) as Record<string, unknown>;
                } catch { /* a new sheet */ }
                sheet[v.slot] = {
                  prompt: v.prompt.trim(),
                  seconds: Math.min(30, Math.max(0.5, Number(v.seconds) || 1)),
                  ...(v.loop && { loop: true }),
                  variations: Math.min(5, Math.max(1, Math.round(Number(v.variations) || 2))),
                };
                writeFileSync(prompts, `${JSON.stringify(sheet, null, 1)}\n`);
                json(200, { ok: true });
              });
              return;
            }
            try {
              return json(200, JSON.parse(readFileSync(prompts, 'utf8')));
            } catch {
              return json(200, {});
            }
          }
          if (rel === '/generate' && req.method === 'POST') {
            void body(req).then(async (b) => {
              const slot = (b as { slot?: string } | null)?.slot;
              if (!slot || !/^[a-z_]+$/.test(slot)) return json(400, { ok: false, out: 'no slot' });
              json(200, await tool(['tools/audio/elevenlabs.py', 'sfx', slot, '--yes']));
            });
            return;
          }
          if (rel === '/pack' && req.method === 'POST') {
            void tool(['tools/audio/pack_audio.py']).then((r) => json(200, r));
            return;
          }
          if (rel === '/picks') {
            if (req.method === 'POST') {
              let body = '';
              req.on('data', (c) => { body += c; });
              req.on('end', () => {
                try {
                  const data = JSON.parse(body) as unknown;
                  mkdirSync(dirname(picks), { recursive: true });
                  writeFileSync(picks, `${JSON.stringify(data, null, 1)}\n`);
                  json(200, { ok: true });
                } catch {
                  json(400, { ok: false });
                }
              });
              return;
            }
            try {
              return json(200, JSON.parse(readFileSync(picks, 'utf8')));
            } catch {
              return json(200, {});
            }
          }
          const file = normalize(join(root, rel));
          const type = Object.entries(AUDIO_TYPES).find(([x]) => file.toLowerCase().endsWith(x))?.[1];
          if (!file.startsWith(normalize(root) + (root.endsWith(sep) ? '' : sep)) || !type) return next();
          try {
            const { size } = statSync(file);
            // byte ranges: a browser only lets you jump around in a sound (the Sounds page's seek bar) if it can ask for one
            const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
            if (range && (range[1] || range[2])) {
              const start = range[1] ? +range[1] : Math.max(0, size - +range[2]);
              const end = range[1] && range[2] ? Math.min(+range[2], size - 1) : size - 1;
              if (start >= size || start > end) {
                res.writeHead(416, { 'Content-Range': `bytes */${size}` });
                return res.end();
              }
              res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`,
                'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
              return createReadStream(file, { start, end }).pipe(res);
            }
            res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
            createReadStream(file).pipe(res);
          } catch {
            next();
          }
        });
      },
    };
  }

  /**
   * Where the game loads its assets from (src/assets/url.ts, tools/assets/assets.mjs): a build always uses the version in
   * assets.json on S3; the dev server uses the local public/assets folder, or S3 when that folder is missing (a fresh
   * clone that hasn't run `npm run assets:pull`). GH_ASSETS=local or remote forces one.
   */
  function assetBase(command: 'build' | 'serve'): string {
    const { bucket, region, version } = JSON.parse(readFileSync(new URL('./assets.json', import.meta.url), 'utf8'));
    const remote = `https://${bucket}.s3.${region}.amazonaws.com/${version}/`;
    const force = process.env.GH_ASSETS;
    if (force === 'local') return '';
    if (force === 'remote' || command === 'build') return remote;
    return existsSync(new URL('./public/assets/sprites', import.meta.url)) ? '' : remote;
  }

  /** Build only: the assets aren't copied into dist (they're on S3), so copy the rest of public/ (the icons) here. */
  function publicIcons(): Plugin {
    return {
      name: 'public-icons',
      apply: 'build',
      generateBundle() {
        for (const fileName of ['favicon.png', 'icon-192.png']) {
          this.emitFile({ type: 'asset', fileName, source: readFileSync(new URL(`./public/${fileName}`, import.meta.url)) });
        }
      },
    };
  }

  export default defineConfig(({ command }) => {
    // read by Vite as an env variable: import.meta.env.VITE_ASSET_BASE in code, %VITE_ASSET_BASE% in index.html
    process.env.VITE_ASSET_BASE = assetBase(command);
    return {
    // Tailwind styles the dev pages only: dev/dev.css is the one stylesheet that imports it (the game's CSS doesn't)
    plugins: [artModels(), artAudio(), tailwindcss(), publicIcons()],
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
      copyPublicDir: false,
      chunkSizeWarningLimit: 2000,   // Phaser alone is ~1.2 MB
    },
  };
});
