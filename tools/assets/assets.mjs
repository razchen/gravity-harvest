// The game's assets (apps/game/public/assets: sprites, previews, terrain, fx, ui, audio, music) live in the public S3
// bucket named in apps/game/assets.json, not in git. Each upload goes to its own folder named after a hash of the
// files (<bucket>/<version>/assets/...), so files never change once uploaded and can be cached forever; a production
// build loads from the version in assets.json.
//   npm run assets:push   upload the local folder as a new version and record it in assets.json (needs AWS access:
//                         AWS_PROFILE, default "gravity"; AWS_CLI, default "aws")
//   npm run assets:pull   download the version in assets.json into the local folder (no AWS account needed)
//   npm run assets:status show whether the local folder matches assets.json

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME = join(ROOT, 'apps', 'game');
const LOCAL = join(GAME, 'public', 'assets');
const CONFIG = join(GAME, 'assets.json');
const SKIP = new Set(['.DS_Store']);

const config = JSON.parse(readFileSync(CONFIG, 'utf8'));
const base = (version) => `https://${config.bucket}.s3.${config.region}.amazonaws.com/${version}/`;

/** Every local asset file with its size and sha256, sorted by path. */
function scan() {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name)) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else {
        const data = readFileSync(path);
        files.push({ path: relative(LOCAL, path).split(sep).join('/'), size: data.length, sha256: createHash('sha256').update(data).digest('hex') });
      }
    }
  };
  if (existsSync(LOCAL)) walk(LOCAL);
  return files.sort((a, b) => (a.path < b.path ? -1 : 1));
}

const versionOf = (files) => createHash('sha256').update(files.map((f) => `${f.path}\t${f.sha256}`).join('\n')).digest('hex').slice(0, 12);

function push() {
  const files = scan();
  if (files.length === 0) throw new Error(`no assets in ${LOCAL}`);
  const version = versionOf(files);
  const env = { ...process.env, AWS_PROFILE: process.env.AWS_PROFILE ?? 'gravity', AWS_REGION: config.region };
  const aws = (...args) => execFileSync(process.env.AWS_CLI ?? 'aws', args, { env, stdio: 'inherit' });
  const dest = `s3://${config.bucket}/${version}`;
  console.log(`uploading ${files.length} files as version ${version}`);
  aws('s3', 'sync', LOCAL, `${dest}/assets`, '--exclude', '*.DS_Store', '--cache-control', 'public, max-age=31536000, immutable', '--only-show-errors');
  // the list goes last, so a version only counts as uploaded once all its files are there
  const list = join(GAME, 'node_modules', '.assets-files.json');
  mkdirSync(dirname(list), { recursive: true });
  writeFileSync(list, JSON.stringify({ version, files }));
  aws('s3', 'cp', list, `${dest}/files.json`, '--content-type', 'application/json', '--cache-control', 'public, max-age=31536000, immutable', '--only-show-errors');
  writeFileSync(CONFIG, JSON.stringify({ ...config, version }, null, 2) + '\n');
  console.log(`assets.json now points at ${base(version)} (commit it)`);
}

async function pull() {
  const res = await fetch(`${base(config.version)}files.json`);
  if (!res.ok) throw new Error(`files.json for version ${config.version}: HTTP ${res.status}`);
  const { files } = await res.json();
  const have = new Map(scan().map((f) => [f.path, f.sha256]));
  const todo = files.filter((f) => have.get(f.path) !== f.sha256);
  console.log(`${files.length - todo.length} files up to date, downloading ${todo.length}`);
  let done = 0;
  const worker = async () => {
    for (let f = todo.pop(); f; f = todo.pop()) {
      const r = await fetch(`${base(config.version)}assets/${f.path}`);
      if (!r.ok) throw new Error(`${f.path}: HTTP ${r.status}`);
      const data = Buffer.from(await r.arrayBuffer());
      if (createHash('sha256').update(data).digest('hex') !== f.sha256) throw new Error(`${f.path}: checksum mismatch`);
      const path = join(LOCAL, ...f.path.split('/'));
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, data);
      if (++done % 100 === 0) console.log(`  ${done} downloaded`);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log(`done: ${LOCAL} matches version ${config.version}`);
}

function status() {
  const version = versionOf(scan());
  console.log(version === config.version
    ? `local assets match version ${config.version}`
    : `local assets (${version}) differ from assets.json (${config.version}): run assets:push to upload them, or assets:pull to get the recorded version`);
  if (version !== config.version) process.exitCode = 1;
}

const cmd = process.argv[2];
if (cmd === 'push') push();
else if (cmd === 'pull') await pull();
else if (cmd === 'status') status();
else {
  console.error('usage: node tools/assets/assets.mjs push | pull | status');
  process.exitCode = 2;
}
