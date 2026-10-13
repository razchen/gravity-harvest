// Procedural scenery: a new landscape for every match (from the match seed), saved with the match.
//
// - Trees: two octaves of smooth value noise make a density field; groves form where it's high, with a few lone
//   trees anywhere. Candidate spots come from Poisson-disc sampling (blue noise), so trees in a grove are evenly
//   spread without rows or clumps on one tile. A coarser noise field picks a grove's main species, with some
//   mixing; dead trees are rarer and mostly where a grove thins out.
// - Rocks: outcrops spread far apart (blue noise again), each a big rock or two (2 x 2 tiles) with smaller rocks
//   around it, plus the odd boulder on its own.
// - Bushes: mostly around the edges of groves and outcrops, some scattered in the open. Logs and stumps on the
//   forest floor. Both are decoration: units walk through them and building over them hides them.
// - Abandoned sites (rare): one to three in the field (and maybe one past the edge), far from the bases and the ore,
//   placed first so they get room: a wreck (2 x 2) with a few rubble piles around it, an oil stain next to it and
//   sometimes a scorch mark, in a small clearing. Wrecks and rubble block their tiles, like rocks.
// - Rubble: small clusters of debris piles, mostly next to rock outcrops, some in the open, rarely in the woods.
// - Grass: its own noise field makes patches (a cluster with single tufts around it), plus a sprinkle of tufts at
//   grove and outcrop edges and in the open. Decoration: off ore, buildings and blockers.
// - Flat decals: a few craters and scorch marks in the open (old battlefield scars), and ore bits scattered around
//   each ore field and under its edge. The browser adds more as things happen (see SceneryLayer, GameScene).
// - Ground patches (big flat decals that break up the tiled ground texture): loose dirt all over, blue-noise spaced;
//   gravel next to rock outcrops and rubble and along the roads; cracked earth in dry open ground away from the woods,
//   and some next to abandoned sites. Off ore and the starting buildings; drawn under the other flat decals.
// - Beyond the field: the same landscape carries on over a margin (SCENERY.outside), from the same noise, so the
//   field's diamond shape doesn't show in the woods. It's scenery only (nobody can go there), a bit thicker far out.
// - Kept clear: the starting bases (room to build), ore and its surroundings, where units start.
// - Always playable: roads are cut through trees and rocks between the bases and from each base to the ore,
//   following the natural gaps (a cheapest path where blockers cost more than open ground), three tiles wide.
import type { SceneryView } from '@gravity-harvest/shared';
import type { Tile } from './geometry.js';
import type { Grid } from './grid.js';
import { SCENERY, SCENERY_KINDS, sceneryKind } from './layout.js';
import type { Ore } from './ore.js';
import type { Rng } from './rng.js';

export type Scenery = SceneryView;

export interface SiteInfo {
  /** Starting buildings' footprints: kept clear, and roads connect them. */
  buildings: { tx: number; ty: number; size: number; team: string }[];
  /** Where units start: kept clear. */
  units: { gx: number; gy: number }[];
}

/** Smooth value noise on a lattice of `cell` tiles (random corner values, smoothstep interpolation). */
function valueNoise(width: number, height: number, cell: number, rng: Rng): (x: number, y: number) => number {
  const cols = Math.ceil(width / cell) + 2;
  const rows = Math.ceil(height / cell) + 2;
  const lattice = Array.from({ length: cols * rows }, () => rng.next());
  const at = (i: number, j: number) => lattice[j * cols + i];
  const fade = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / cell;
    const fy = y / cell;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const u = fade(fx - i);
    const v = fade(fy - j);
    const top = at(i, j) + (at(i + 1, j) - at(i, j)) * u;
    const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * u;
    return top + (bottom - top) * v;
  };
}

/** Bridson's Poisson-disc sampling: points at least `r` apart covering the map. */
function poissonDisc(width: number, height: number, r: number, rng: Rng, tries = 24): { x: number; y: number }[] {
  const size = r / Math.SQRT2;
  const gw = Math.ceil(width / size);
  const gh = Math.ceil(height / size);
  const grid: number[] = new Array(gw * gh).fill(-1);
  const points: { x: number; y: number }[] = [];
  const active: number[] = [];
  const add = (x: number, y: number) => {
    points.push({ x, y });
    active.push(points.length - 1);
    grid[Math.floor(y / size) * gw + Math.floor(x / size)] = points.length - 1;
  };
  const fits = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const gx = Math.floor(x / size);
    const gy = Math.floor(y / size);
    for (let j = Math.max(0, gy - 2); j <= Math.min(gh - 1, gy + 2); j++) {
      for (let i = Math.max(0, gx - 2); i <= Math.min(gw - 1, gx + 2); i++) {
        const p = grid[j * gw + i];
        if (p >= 0 && (points[p].x - x) ** 2 + (points[p].y - y) ** 2 < r * r) return false;
      }
    }
    return true;
  };
  add(rng.range(0, width), rng.range(0, height));
  while (active.length) {
    const k = rng.int(active.length);
    const p = points[active[k]];
    let placed = false;
    for (let t = 0; t < tries; t++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(r, 2 * r);
      const x = p.x + Math.cos(a) * d;
      const y = p.y + Math.sin(a) * d;
      if (fits(x, y)) {
        add(x, y);
        placed = true;
        break;
      }
    }
    if (!placed) active.splice(k, 1);
  }
  return points;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Cheapest 8-way path where a tile costs `cost(x, y)` times a plain step and blocked tiles are impassable (Dijkstra). */
function roadPath(map: Grid, cost: (x: number, y: number) => number, from: Tile, to: Tile): Tile[] {
  const n = map.width * map.height;
  const idx = (x: number, y: number) => y * map.width + x;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  // binary heap of node indices ordered by dist
  const heap: number[] = [];
  const push = (i: number) => {
    heap.push(i);
    for (let c = heap.length - 1; c > 0;) {
      const p = (c - 1) >> 1;
      if (dist[heap[p]] <= dist[heap[c]]) break;
      [heap[p], heap[c]] = [heap[c], heap[p]];
      c = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let c = 0; ;) {
        const l = 2 * c + 1;
        const r = l + 1;
        let m = c;
        if (l < heap.length && dist[heap[l]] < dist[heap[m]]) m = l;
        if (r < heap.length && dist[heap[r]] < dist[heap[m]]) m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c], heap[m]];
        c = m;
      }
    }
    return top;
  };
  dist[idx(from.tx, from.ty)] = 0;
  push(idx(from.tx, from.ty));
  while (heap.length) {
    const cur = pop();
    if (done[cur]) continue;
    done[cur] = 1;
    const cx = cur % map.width;
    const cy = Math.floor(cur / map.width);
    if (cx === to.tx && cy === to.ty) break;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (map.isBlocked(nx, ny) && !(nx === to.tx && ny === to.ty)) continue;
        const ni = idx(nx, ny);
        const step = (dx && dy ? 1.414 : 1) * cost(nx, ny);
        if (dist[cur] + step < dist[ni]) {
          dist[ni] = dist[cur] + step;
          prev[ni] = cur;
          push(ni);
        }
      }
    }
  }
  const path: Tile[] = [];
  if (!done[idx(to.tx, to.ty)]) return path;
  for (let c = idx(to.tx, to.ty); c >= 0; c = prev[c]) path.push({ tx: c % map.width, ty: Math.floor(c / map.width) });
  return path.reverse();
}

const ofCategory = (c: string) => SCENERY_KINDS.filter((k) => k.category === c);

/** Grow the landscape. Call after buildings and ore are placed; blocks the tiles of trees, rocks, rubble and wrecks on `map`. */
export function growScenery(map: Grid, ore: Ore, site: SiteInfo, rng: Rng, nextId: () => number): Scenery[] {
  const { width: W, height: H } = map;
  const T = SCENERY.trees;
  // the landscape is grown over the field and a margin around it (pure scenery out there: nobody can go there), from
  // the same noise, so groves carry on across the edge instead of stopping in the field's diamond shape
  const M = SCENERY.outside.margin;
  const EW = W + 2 * M;
  const EH = H + 2 * M;
  const key = (x: number, y: number) => (x + M) * EH + (y + M);
  const inside = (x: number, y: number) => map.inBounds(x, y);
  const blocked = (x: number, y: number) => (inside(x, y) ? map.isBlocked(x, y) : x < -M || y < -M || x >= W + M || y >= H + M);
  /** How far outside the field (tiles; 0 inside). */
  const outsideBy = (x: number, y: number) => Math.max(0, -x, -y, x - W, y - H);
  const noise = (cell: number) => {
    const n = valueNoise(EW, EH, cell, rng);
    return (x: number, y: number) => n(x + M, y + M);
  };
  const density = noise(T.groveCell);
  const detail = noise(T.detailCell);
  const species = noise(T.speciesCell);
  // a little thicker towards the far edge of the margin, where the land fades into the dark
  const forest = (x: number, y: number) => 0.68 * density(x, y) + 0.32 * detail(x, y) +
    smoothstep(M * 0.55, M, outsideBy(x, y)) * SCENERY.outside.thicken;
  const disc = (r: number) => poissonDisc(EW, EH, r, rng).map((p) => ({ x: p.x - M, y: p.y - M }));

  // keep-clear zones: `clear` for blockers, `bare` (smaller) for decoration
  const clear = new Set<number>();
  const bare = new Set<number>();
  const mark = (set: Set<number>, x0: number, y0: number, x1: number, y1: number) => {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) if (!blocked(x, y) || inside(x, y)) set.add(key(x, y));
  };
  for (const b of site.buildings) {
    mark(clear, b.tx - SCENERY.baseClearance, b.ty - SCENERY.baseClearance, b.tx + b.size - 1 + SCENERY.baseClearance, b.ty + b.size - 1 + SCENERY.baseClearance);
    mark(bare, b.tx - SCENERY.decorBaseClearance, b.ty - SCENERY.decorBaseClearance, b.tx + b.size - 1 + SCENERY.decorBaseClearance, b.ty + b.size - 1 + SCENERY.decorBaseClearance);
  }
  for (const t of ore.tiles.values()) {
    mark(clear, t.tx - SCENERY.oreClearance, t.ty - SCENERY.oreClearance, t.tx + SCENERY.oreClearance, t.ty + SCENERY.oreClearance);
    mark(bare, t.tx, t.ty, t.tx, t.ty);
  }
  for (const u of site.units) {
    mark(clear, Math.floor(u.gx) - 1, Math.floor(u.gy) - 1, Math.floor(u.gx) + 1, Math.floor(u.gy) + 1);
    mark(bare, Math.floor(u.gx) - 1, Math.floor(u.gy) - 1, Math.floor(u.gx) + 1, Math.floor(u.gy) + 1);
  }

  // blockers (trees and rocks) by their top-left tile; `taken` holds every tile any blocker covers
  interface Spot { kind: string; tx: number; ty: number; x: number; y: number; d: number }
  const blockers = new Map<number, Spot>();
  const taken = new Map<number, number>(); // tile -> key of the blocker covering it
  const fits = (tx: number, ty: number, size: number) => {
    for (let x = tx; x < tx + size; x++) {
      for (let y = ty; y < ty + size; y++) if (blocked(x, y) || clear.has(key(x, y)) || taken.has(key(x, y))) return false;
    }
    return true;
  };
  const put = (spot: Spot) => {
    const size = sceneryKind(spot.kind).size;
    if (!fits(spot.tx, spot.ty, size)) return false;
    const k = key(spot.tx, spot.ty);
    blockers.set(k, spot);
    for (let x = spot.tx; x < spot.tx + size; x++) for (let y = spot.ty; y < spot.ty + size; y++) taken.set(key(x, y), k);
    return true;
  };

  // flat decals and other decoration claim their tile, one each (grass keeps its own set)
  const decor: Spot[] = [];
  const decorTaken = new Set<number>();
  const flats: Spot[] = [];
  const flatTaken = new Set<number>();
  const pick = <K extends { id: string }>(list: K[]) => list[rng.int(list.length)].id;
  const putFlat = (kind: string, tx: number, ty: number) => {
    const k = key(tx, ty);
    if (blocked(tx, ty) || taken.has(k) || flatTaken.has(k)) return false;
    flats.push({ kind, tx, ty, x: tx + 0.5, y: ty + 0.5, d: 0 });
    flatTaken.add(k);
    return true;
  };
  const decals = (prefix: string) => ofCategory('decal').filter((k) => k.id.startsWith(`${prefix}_`));
  const debris = ofCategory('debris');

  // abandoned sites first, so they get room: far from bases and ore, apart from each other, in a small clearing
  const S = SCENERY.sites;
  const wrecks = ofCategory('wreck');
  let nextWreck = rng.int(wrecks.length); // each match goes through the wrecks in turn, so a match has no repeats
  const sites: Tile[] = [];
  /** A site's wreck at (tx, ty); its area is the wreck plus `S.radius` tiles around it. */
  const siteFits = (tx: number, ty: number, outsideOnly: boolean) => {
    const x0 = tx - S.radius;
    const y0 = ty - S.radius;
    const x1 = tx + 1 + S.radius;
    const y1 = ty + 1 + S.radius;
    if (sites.some((o) => Math.hypot(o.tx - tx, o.ty - ty) < S.spacing)) return false;
    for (const b of site.buildings) {
      const gap = Math.max(b.tx - x1, x0 - (b.tx + b.size - 1), b.ty - y1, y0 - (b.ty + b.size - 1));
      if (gap <= SCENERY.baseClearance + S.baseGapExtra) return false;
    }
    for (const t of ore.tiles.values()) {
      if (Math.max(t.tx - x1, x0 - t.tx, t.ty - y1, y0 - t.ty) <= S.oreGap) return false;
    }
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        if (outsideOnly ? inside(x, y) : x < 0 || y < 0 || x >= W || y >= H) return false;
        if (blocked(x, y) || clear.has(key(x, y))) return false;
      }
    }
    return true;
  };
  const growSite = (tx: number, ty: number) => {
    sites.push({ tx, ty });
    put({ kind: wrecks[nextWreck++ % wrecks.length].id, tx, ty, x: tx + 1, y: ty + 1, d: 0 });
    for (let i = 0, n = S.debrisMin + rng.int(S.debrisMax - S.debrisMin + 1), tries = 0; i < n && tries < 20; tries++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(1.8, S.radius);
      const x = tx + 1 + Math.cos(a) * r;
      const y = ty + 1 + Math.sin(a) * r;
      if (put({ kind: pick(debris), tx: Math.floor(x), ty: Math.floor(y), x, y, d: 0 })) i++;
    }
    // the oil stain on a tile touching the wreck
    const ring: Tile[] = [];
    for (let x = tx - 1; x <= tx + 2; x++) for (let y = ty - 1; y <= ty + 2; y++) if (x < tx || x > tx + 1 || y < ty || y > ty + 1) ring.push({ tx: x, ty: y });
    for (let tries = 0; tries < 12; tries++) {
      const t = ring[rng.int(ring.length)];
      if (putFlat(pick(decals('oil')), t.tx, t.ty)) break;
    }
    if (rng.next() < S.scorchChance) {
      for (let tries = 0; tries < 12; tries++) {
        const a = rng.range(0, Math.PI * 2);
        const r = rng.range(1.5, S.radius);
        if (putFlat(pick(decals('scorch')), Math.floor(tx + 1 + Math.cos(a) * r), Math.floor(ty + 1 + Math.sin(a) * r))) break;
      }
    }
    // a clearing: trees and rocks keep off the site's area
    mark(clear, tx - S.radius, ty - S.radius, tx + 1 + S.radius, ty + 1 + S.radius);
  };
  const fieldSites = S.fieldMin + rng.int(S.fieldMax - S.fieldMin + 1);
  for (let tries = 0; sites.length < fieldSites && tries < 400; tries++) {
    const tx = S.edge + S.radius + rng.int(W - 2 * (S.edge + S.radius) - 1);
    const ty = S.edge + S.radius + rng.int(H - 2 * (S.edge + S.radius) - 1);
    if (siteFits(tx, ty, false)) growSite(tx, ty);
  }
  if (rng.next() < S.outsideChance) {
    for (let tries = 0; tries < 200; tries++) {
      const tx = Math.floor(rng.range(-M + 2 + S.radius, W + M - 3 - S.radius));
      const ty = Math.floor(rng.range(-M + 2 + S.radius, H + M - 3 - S.radius));
      if (siteFits(tx, ty, true)) {
        growSite(tx, ty);
        break;
      }
    }
  }

  // trees: blue-noise candidates, kept where the forest is dense, plus the odd lone tree
  const living = ofCategory('tree').filter((k) => k.id !== 'deadwood');
  for (const p of disc(T.spacing)) {
    const d = forest(p.x, p.y);
    const keep = smoothstep(T.groveFrom, T.groveTo, d) * T.groveFill + T.loneChance;
    if (rng.next() >= keep) continue;
    let kind: string;
    if (d < T.groveFrom + 0.04 && rng.next() < T.deadChance) kind = 'deadwood';
    else if (rng.next() < T.mixChance) kind = living[rng.int(living.length)].id;
    else kind = living[Math.min(living.length - 1, Math.floor(species(p.x, p.y) * living.length))].id;
    put({ kind, tx: Math.floor(p.x), ty: Math.floor(p.y), x: p.x, y: p.y, d });
  }

  // rocks: outcrops far apart, each a big rock or two with smaller ones around it; and lone boulders
  const R = SCENERY.rocks;
  const big = ofCategory('rock').filter((k) => k.size === 2);
  const small = ofCategory('rock').filter((k) => k.size === 1);
  for (const c of disc(R.outcropSpacing)) {
    if (rng.next() >= R.outcropChance) continue;
    const bigs = 1 + (rng.next() < 0.35 ? 1 : 0);
    for (let i = 0; i < bigs; i++) {
      const tx = Math.floor(c.x + rng.range(-1.5, 1.5));
      const ty = Math.floor(c.y + rng.range(-1.5, 1.5));
      put({ kind: big[rng.int(big.length)].id, tx, ty, x: tx + 1, y: ty + 1, d: 0 });
    }
    for (let i = 0, n = R.smallMin + rng.int(R.smallMax - R.smallMin + 1); i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(1.5, R.outcropRadius);
      const x = c.x + Math.cos(a) * r;
      const y = c.y + Math.sin(a) * r;
      put({ kind: small[rng.int(small.length)].id, tx: Math.floor(x), ty: Math.floor(y), x, y, d: 0 });
    }
  }
  for (let i = 0; i < R.loneRocks * (EW * EH) / (W * H); i++) {
    const x = rng.range(-M, W + M);
    const y = rng.range(-M, H + M);
    put({ kind: small[rng.int(small.length)].id, tx: Math.floor(x), ty: Math.floor(y), x, y, d: 0 });
  }

  // rubble: small clusters, mostly next to rock outcrops, some in the open, rarely in the woods
  const D = SCENERY.debris;
  const near = (tx: number, ty: number, r: number, category: string) => {
    for (let x = tx - r; x <= tx + r; x++) {
      for (let y = ty - r; y <= ty + r; y++) {
        const owner = taken.get(key(x, y));
        if (owner !== undefined && sceneryKind(blockers.get(owner)!.kind).category === category) return true;
      }
    }
    return false;
  };
  for (const c of disc(D.clusterSpacing)) {
    const chance = near(Math.floor(c.x), Math.floor(c.y), 4, 'rock') ? D.nearRocksChance : forest(c.x, c.y) < T.groveFrom ? D.openChance : D.woodsChance;
    if (rng.next() >= chance) continue;
    for (let i = 0, n = D.min + rng.int(D.max - D.min + 1); i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(0, D.radius);
      const x = c.x + Math.cos(a) * r;
      const y = c.y + Math.sin(a) * r;
      put({ kind: pick(debris), tx: Math.floor(x), ty: Math.floor(y), x, y, d: 0 });
    }
  }

  // roads: base to base, and each base to the nearest ore field, through the gaps
  const road = new Set<number>();
  const doors = site.buildings.map((b) => map.nearestFree(b.tx + Math.floor(b.size / 2), b.ty + b.size, 4)).filter((t): t is Tile => !!t);
  const fields = new Map<number, Tile>();
  for (const t of ore.tiles.values()) if (!fields.has(t.field)) fields.set(t.field, { tx: t.tx, ty: t.ty });
  const links: [Tile, Tile][] = [];
  for (let i = 1; i < doors.length; i++) links.push([doors[0], doors[i]]);
  for (const f of fields.values()) {
    const near = doors.reduce<Tile | null>((a, b) => (!a || Math.hypot(b.tx - f.tx, b.ty - f.ty) < Math.hypot(a.tx - f.tx, a.ty - f.ty) ? b : a), null);
    if (near) links.push([near, f]);
  }
  // a road is three tiles wide: it goes around an abandoned site if it can (and keeps a tile clear of its wreck), so
  // the site isn't cut away
  const nearWreck = new Set<number>();
  const siteArea = new Set<number>();
  for (const t of sites) {
    for (let x = t.tx - 1; x <= t.tx + 2; x++) for (let y = t.ty - 1; y <= t.ty + 2; y++) nearWreck.add(key(x, y));
    const r = S.radius + 1;
    for (let x = t.tx - r; x <= t.tx + 1 + r; x++) for (let y = t.ty - r; y <= t.ty + 1 + r; y++) siteArea.add(key(x, y));
  }
  const roadCost = (x: number, y: number) => {
    const k = key(x, y);
    if (taken.has(k) || nearWreck.has(k)) return SCENERY.roadBlockerCost;
    return siteArea.has(k) ? S.roadCost : 1;
  };
  for (const [a, b] of links) {
    for (const t of roadPath(map, roadCost, a, b)) {
      road.add(key(t.tx, t.ty));
      for (let x = t.tx - 1; x <= t.tx + 1; x++) {
        for (let y = t.ty - 1; y <= t.ty + 1; y++) {
          const owner = taken.get(key(x, y));
          if (owner === undefined) continue;
          const spot = blockers.get(owner)!;
          const size = sceneryKind(spot.kind).size;
          for (let i = spot.tx; i < spot.tx + size; i++) for (let j = spot.ty; j < spot.ty + size; j++) taken.delete(key(i, j));
          blockers.delete(owner);
        }
      }
    }
  }

  // decoration on open ground: bushes at the edges of groves and outcrops (and some anywhere); logs in the woods
  const B = SCENERY.decor;
  const bushes = ofCategory('bush');
  const logs = ofCategory('log');
  const nearBlockers = (tx: number, ty: number, r: number) => {
    let n = 0;
    for (let x = tx - r; x <= tx + r; x++) for (let y = ty - r; y <= ty + r; y++) if (taken.has(key(x, y))) n++;
    return n;
  };
  for (const p of disc(B.spacing)) {
    const tx = Math.floor(p.x);
    const ty = Math.floor(p.y);
    const k = key(tx, ty);
    if (blocked(tx, ty) || taken.has(k) || bare.has(k) || road.has(k) || decorTaken.has(k) || flatTaken.has(k)) continue;
    const around = nearBlockers(tx, ty, 1);
    const d = forest(p.x, p.y);
    if (around >= 2 && d > T.groveFrom && rng.next() < B.logChance) {
      decor.push({ kind: logs[rng.int(logs.length)].id, tx, ty, x: p.x, y: p.y, d });
    } else if ((around >= 1 && rng.next() < B.edgeBushChance) || rng.next() < B.loneBushChance) {
      decor.push({ kind: bushes[rng.int(bushes.length)].id, tx, ty, x: p.x, y: p.y, d });
    } else continue;
    decorTaken.add(k);
  }

  // old battlefield scars in the open: a few craters and scorch marks, away from the bases and the ore
  const C = SCENERY.scars;
  const scar = (prefix: string, n: number) => {
    for (let placed = 0, tries = 0; placed < n && tries < 200; tries++) {
      const x = rng.range(-M, W + M);
      const y = rng.range(-M, H + M);
      const tx = Math.floor(x);
      const ty = Math.floor(y);
      const k = key(tx, ty);
      if (clear.has(k) || bare.has(k) || decorTaken.has(k) || forest(x, y) >= T.groveFrom || nearBlockers(tx, ty, 1)) continue;
      if (putFlat(pick(decals(prefix)), tx, ty)) placed++;
    }
  };
  scar('crater', C.cratersMin + rng.int(C.cratersMax - C.cratersMin + 1));
  scar('scorch', C.scorchMin + rng.int(C.scorchMax - C.scorchMin + 1));

  // ore bits: scattered 1-2 tiles around each ore field, and a few under its edge tiles
  const O = SCENERY.oreBits;
  const bits = decals('ore_bits');
  const onBuilding = (x: number, y: number) => site.buildings.some((b) => x >= b.tx && x < b.tx + b.size && y >= b.ty && y < b.ty + b.size);
  const fieldIds = [...new Set([...ore.tiles.values()].map((t) => t.field))];
  for (const f of fieldIds) {
    const tiles = [...ore.tiles.values()].filter((t) => t.field === f);
    const ring = new Map<number, Tile>();
    const edge: Tile[] = [];
    for (const t of tiles) {
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !ore.at(t.tx + dx, t.ty + dy))) edge.push(t);
      for (let x = t.tx - 2; x <= t.tx + 2; x++) {
        for (let y = t.ty - 2; y <= t.ty + 2; y++) if (!ore.at(x, y) && !onBuilding(x, y) && !bare.has(key(x, y))) ring.set(key(x, y), { tx: x, ty: y });
      }
    }
    const ringTiles = [...ring.values()];
    const scatter = (from: Tile[], n: number) => {
      for (let placed = 0, tries = 0; placed < n && tries < 4 * n && from.length; tries++) {
        const t = from[rng.int(from.length)];
        if (putFlat(pick(bits), t.tx, t.ty)) placed++;
      }
    };
    scatter(ringTiles, O.ringMin + rng.int(O.ringMax - O.ringMin + 1));
    scatter(edge, O.edgeMin + rng.int(O.edgeMax - O.edgeMin + 1));
  }

  // grass: patches where the grass noise is high (a cluster with tufts around it), and single tufts at grove and
  // outcrop edges and in the open
  const G = SCENERY.grass;
  const grassNoise = noise(G.cell);
  const tufts = ofCategory('grass').filter((k) => !k.id.startsWith('grass_patch_'));
  const patches = ofCategory('grass').filter((k) => k.id.startsWith('grass_patch_'));
  const grass: Spot[] = [];
  const grassTaken = new Set<number>();
  const putGrass = (kind: string, x: number, y: number) => {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    const k = key(tx, ty);
    if (blocked(tx, ty) || taken.has(k) || bare.has(k) || grassTaken.has(k) || flatTaken.has(k)) return false;
    grass.push({ kind, tx, ty, x, y, d: 0 });
    grassTaken.add(k);
    return true;
  };
  for (const p of disc(G.patchSpacing)) {
    if (rng.next() >= smoothstep(G.from, G.to, grassNoise(p.x, p.y))) continue;
    if (!putGrass(pick(patches), p.x, p.y)) continue;
    for (let i = 0, n = G.tuftsMin + rng.int(G.tuftsMax - G.tuftsMin + 1); i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(0.9, G.tuftRadius);
      putGrass(pick(tufts), p.x + Math.cos(a) * r, p.y + Math.sin(a) * r);
    }
  }
  for (const p of disc(G.sprinkleSpacing)) {
    const chance = nearBlockers(Math.floor(p.x), Math.floor(p.y), 1) ? G.edgeChance : forest(p.x, p.y) < T.groveFrom ? G.openChance : 0;
    if (rng.next() < chance) putGrass(pick(tufts), p.x, p.y);
  }

  // ground patches: loose dirt anywhere (to break up the tiled ground), gravel by rocks, rubble and roads, cracked earth
  // in dry open ground and by abandoned sites. Big flat decals under everything else, so they claim no tile (grass and
  // other decals still go on them); patches of one kind keep apart, and all stay off ore and the starting buildings.
  const P = SCENERY.ground;
  const nearOre = new Set<number>();
  for (const t of ore.tiles.values()) {
    for (let x = t.tx - P.dirtOreGap; x <= t.tx + P.dirtOreGap; x++) for (let y = t.ty - P.dirtOreGap; y <= t.ty + P.dirtOreGap; y++) nearOre.add(key(x, y));
  }
  const nearBuilding = (x: number, y: number) => site.buildings.some((b) =>
    x >= b.tx - P.buildingGap && x < b.tx + b.size + P.buildingGap && y >= b.ty - P.buildingGap && y < b.ty + b.size + P.buildingGap);
  const patchesOf = new Map<string, { x: number; y: number }[]>();
  const putPatch = (prefix: string, x: number, y: number, spacing: number) => {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    const k = key(tx, ty);
    if (blocked(tx, ty) || taken.has(k) || nearOre.has(k) || nearBuilding(tx, ty)) return false;
    const mine = patchesOf.get(prefix) ?? [];
    if (mine.some((o) => Math.hypot(o.x - x, o.y - y) < spacing)) return false;
    mine.push({ x, y });
    patchesOf.set(prefix, mine);
    flats.push({ kind: pick(decals(prefix)), tx, ty, x, y, d: 0 });
    return true;
  };
  for (const p of disc(P.dirtSpacing)) if (rng.next() < P.dirtChance) putPatch('dirt', p.x, p.y, P.dirtSpacing);
  const nearRubble = (tx: number, ty: number) => near(tx, ty, 2, 'rock') || near(tx, ty, 2, 'debris');
  for (const p of disc(P.gravelSpacing / 2)) {
    if (nearRubble(Math.floor(p.x), Math.floor(p.y)) && rng.next() < P.gravelNearRocksChance) putPatch('gravel', p.x, p.y, P.gravelSpacing);
  }
  const roadTiles = [...road].sort((a, b) => a - b);
  for (let i = roadTiles.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [roadTiles[i], roadTiles[j]] = [roadTiles[j], roadTiles[i]];
  }
  for (const k of roadTiles) {
    if (rng.next() >= P.gravelRoadChance) continue;
    const x = Math.floor(k / EH) - M + rng.range(0.2, 0.8);
    const y = (k % EH) - M + rng.range(0.2, 0.8);
    const mine = patchesOf.get('gravel') ?? [];
    if (mine.some((o) => Math.hypot(o.x - x, o.y - y) < P.gravelRoadSpacing)) continue;
    putPatch('gravel', x, y, P.gravelSpacing);
  }
  for (const t of sites) {
    if (rng.next() >= P.crackedSiteChance) continue;
    for (let tries = 0; tries < 12; tries++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(2.5, S.radius + 1.5);
      if (putPatch('cracked', t.tx + 1 + Math.cos(a) * r, t.ty + 1 + Math.sin(a) * r, P.crackedSpacing)) break;
    }
  }
  for (const p of disc(P.crackedSpacing)) {
    if (forest(p.x, p.y) >= P.crackedForestMax || nearBlockers(Math.floor(p.x), Math.floor(p.y), 2)) continue;
    if (rng.next() < P.crackedChance) putPatch('cracked', p.x, p.y, P.crackedSpacing);
  }

  // finalize, in a stable order
  const out: Scenery[] = [];
  const emit = (s: Spot, blocks: boolean) => {
    const size = sceneryKind(s.kind).size;
    const jitter = size === 1 ? 0.16 : 0.08;
    out.push({
      id: nextId(),
      kind: s.kind,
      tx: s.tx,
      ty: s.ty,
      // drawn a little off-centre and at slightly different sizes so nothing looks stamped
      gx: s.tx + size / 2 + rng.range(-jitter, jitter),
      gy: s.ty + size / 2 + rng.range(-jitter, jitter),
      scale: rng.range(0.85, 1.15),
    });
    if (blocks) map.setFootprint(s.tx, s.ty, size, true); // (only the tiles inside the field)
  };
  for (const [, s] of [...blockers].sort((a, b) => a[0] - b[0])) emit(s, true);
  for (const s of [...decor, ...flats, ...grass]) emit(s, false);
  return out;
}
