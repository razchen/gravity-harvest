// The unit pages' animation player: plays a unit's sprite-sheet animations straight from the game's atlases
// (public/assets/sprites), in any direction, on a plain canvas. Not part of the game build.
import { CAMERA, HOVER, RUN_CYCLE_TILES } from '../config/game';
import { facing } from '../core/geometry';
import { BULLETS } from '../render/Effects';
import { findRamps, framePixels, gridToPx as toScreen, pxToGrid as toGrid } from '../render/ramps';
import { TERRAIN_COPY_PX } from '../world/Terrain';
import { onLeave } from './page';
import { BAR, BUTTON, CHECKBOX, LABEL, SELECT } from './ui';

export interface UnitAnim {
  name: string;
  atlas: string;
  /** The frame names for direction d, in order. */
  frames: (d: number) => string[];
  fps: number;
  /** Play once, hold the last frame a moment, then start again (a death). */
  once?: boolean;
  /** Fire bursts from the atlas's muzzle points (meta.muzzle), as the game does (render/Effects.ts BULLETS). */
  fire?: boolean;
  /** A layer played over the (first) frame: a vehicle's wheels turning. */
  overlay?: (d: number) => string[];
  /** A hovering unit: its shadow alone (frame for direction d), drawn on the ground while the unit bobs over it. */
  under?: (d: number) => string;
  /**
   * A turret that turns on its own (the atlas's meta.turret_layer), its frame for direction t drawn over the hull
   * at its pivot: sweeping round, or aimed at a target off to the side that it stays on as the hull turns (firing
   * from the barrel tip, with `fire`).
   */
  turret?: { frame: (t: number) => string; mode: 'sweep' | 'aim' };
  /** Play the clip forwards, hold, then backwards, and hold again (doors opening and shutting). */
  pingPong?: boolean;
  /**
   * A soldier (his game atlas, at his run speed) boarding through the door the clip opens: it opens, he runs in from
   * a couple of tiles out up its ramp and is gone, and it shuts again (see findBoarding()).
   */
  board?: { atlas: string; tilesPerSec: number };
}

export interface UnitAnims {
  directions: number;
  /** Which way it faces at first. */
  start: number;
  list: UnitAnim[];
}

interface Atlas {
  img: HTMLImageElement;
  /** Trimmed frames (the rifleman's) say where their crop sits in the full canvas. */
  frames: Record<string, { frame: { x: number; y: number; w: number; h: number }; spriteSourceSize?: { x: number; y: number }; sourceSize?: { w: number; h: number } }>;
  meta: {
    anchor: { x: number; y: number }; res?: number; run_frames?: number; muzzle?: { x: number; y: number }[];
    /** A turretless gun's tips per direction (render_vehicle.py `muzzle`), from the anchor. */
    muzzles?: { x: number; y: number }[][];
    turret_layer?: { directions: number; pivot: { x: number; y: number }[]; muzzle: { x: number; y: number }[] };
  };
}

type P = { x: number; y: number };
/** A boarding soldier's way in, for one direction: world px from the anchor (zoom 1), and how long each leg takes. */
interface Boarding { start: P; foot: P; door: P; facing: number; approachTiles: number; rampTiles: number }

interface Round { x1: number; y1: number; x2: number; y2: number; age: number; flight: number; miss: boolean }
interface Fleck { x: number; y: number; vx: number; vy: number; age: number; life: number; dust: boolean }

const HOLD_MS = 1500;
/** Doors: how long they stay open, and shut, before going round again. */
const DOOR_HOLD_MS = 800;
/** A boarding soldier starts this many tiles out from the foot of the ramp, and fades in over this long. */
const BOARD_FROM_TILES = 2;
const BOARD_FADE_IN_MS = 250;
/** A sweeping turret moves on a direction every this many ms. */
const SWEEP_MS_PER_STEP = 90;
/** Shooting: how far away the target is (world px), and how often a burst goes. */
const RANGE = 150;
const BURST_EVERY_MS = 1100;
/** The sizes it can be drawn at: as a match starts, at the game's closest zoom (pixel for pixel), or closer up for detail. */
const SIZES = [
  { id: 'start', label: 'Game (start)', zoom: CAMERA.startZoom },
  { id: 'game', label: 'Game (closest)', zoom: CAMERA.maxZoom },
  { id: 'close', label: 'Close', zoom: 1.6 },
];
const SIZE_KEY = 'gh-dev-anim-size';

async function loadAtlas(name: string): Promise<Atlas> {
  const json = await fetch(`/assets/sprites/${name}.json`).then((r) => r.json()) as Omit<Atlas, 'img'>;
  const img = new Image();
  img.src = `/assets/sprites/${name}.png`;
  await img.decode();
  return { ...json, img };
}

/** A frame drawn into its full (untrimmed) canvas, for reading its pixels. */
function pixels(at: Atlas, name: string): ImageData | null {
  const e = at.frames[name];
  if (!e) return null;
  return framePixels(at.img, e.frame, e.spriteSourceSize ?? { x: 0, y: 0 }, e.sourceSize ?? e.frame);
}

/**
 * Where a soldier boards through the door a clip opens, in direction d of `directions` (render/ramps.ts findRamps):
 * the door whose ramp shows more, the one nearer the viewer. He comes in square to the side.
 */
function findBoarding(at: Atlas, shut: string, open: string, d: number, directions: number): Boarding | null {
  const a = pixels(at, shut), b = pixels(at, open);
  if (!a || !b) return null;
  const best = findRamps(a, b, at.meta.anchor, at.meta.res ?? 1, d, directions).reduce<ReturnType<typeof findRamps>[number] | null>((x, r) => (!x || r.pixels > x.pixels ? r : x), null);
  if (!best) return null;
  const { foot, door } = best;
  const ang = ((d * 360) / directions + 90 * best.side) * (Math.PI / 180);
  const away = toScreen(Math.cos(ang), -Math.sin(ang));
  const start = { x: foot.x + away.x * BOARD_FROM_TILES, y: foot.y + away.y * BOARD_FROM_TILES };
  const run = toGrid({ x: foot.x - start.x, y: foot.y - start.y });
  const up = toGrid({ x: door.x - foot.x, y: door.y - foot.y });
  return { start, foot, door, facing: facing(run.gx, run.gy, 16), approachTiles: BOARD_FROM_TILES, rampTiles: Math.hypot(up.gx, up.gy) };
}

/** Put the player in `host`. */
export async function mountAnimPlayer(host: HTMLElement, spec: UnitAnims): Promise<void> {
  const atlases: Record<string, Atlas> = {};
  for (const a of new Set(spec.list.flatMap((x) => [x.atlas, ...(x.board ? [x.board.atlas] : [])]))) atlases[a] = await loadAtlas(a);
  // boarding: the soldier's way in, worked out once for every direction
  const boarding = new Map<UnitAnim, (Boarding | null)[]>();
  for (const a of spec.list) {
    if (!a.board) continue;
    boarding.set(a, Array.from({ length: spec.directions }, (_, d) => {
      const f = a.frames(d);
      return findBoarding(atlases[a.atlas], f[0], f[f.length - 1], d, spec.directions);
    }));
  }

  // one canvas for every animation: room around the shared anchor for the biggest frame of each (at zoom 1)
  let zoom: number = SIZES[0].zoom;
  try { zoom = SIZES.find((s) => s.id === localStorage.getItem(SIZE_KEY))?.zoom ?? zoom; } catch { /* not kept */ }
  let left0 = 0, right0 = 0, up0 = 0, down0 = 0;
  for (const a of spec.list) {
    const at = atlases[a.atlas];
    const k = 1 / (at.meta.res ?? 1);
    for (let d = 0; d < spec.directions; d++) {
      for (const f of a.frames(d)) {
        const e = at.frames[f];
        if (!e) continue;
        const full = e.sourceSize ?? e.frame;
        left0 = Math.max(left0, at.meta.anchor.x * k);
        right0 = Math.max(right0, (full.w - at.meta.anchor.x) * k);
        up0 = Math.max(up0, at.meta.anchor.y * k);
        down0 = Math.max(down0, (full.h - at.meta.anchor.y) * k);
      }
    }
  }
  // shooting: room for the rounds' flight all round
  if (spec.list.some((a) => a.fire)) {
    const reach = RANGE + BULLETS.missPast[1];
    left0 = Math.max(left0, reach); right0 = Math.max(right0, reach); up0 = Math.max(up0, reach); down0 = Math.max(down0, reach * 0.6);
  }
  // boarding: room for the soldier all along his way in (a straight line from where he starts to the ramp's foot)
  for (const [a, ways] of boarding) {
    const at = atlases[a.board!.atlas], k = 1 / (at.meta.res ?? 1);
    for (const b of ways) {
      if (!b) continue;
      for (const f of [...Array.from({ length: at.meta.run_frames ?? 12 }, (_, i) => `inf_${b.facing}_${i}`), `inf_${b.facing}_idle`]) {
        const e = at.frames[f];
        if (!e) continue;
        const o = e.spriteSourceSize ?? { x: 0, y: 0 };
        for (const p of [b.start, b.foot]) {
          const x0 = p.x + (o.x - at.meta.anchor.x) * k, y0 = p.y + (o.y - at.meta.anchor.y) * k;
          left0 = Math.max(left0, -x0); right0 = Math.max(right0, x0 + e.frame.w * k);
          up0 = Math.max(up0, -y0); down0 = Math.max(down0, y0 + e.frame.h * k);
        }
      }
    }
  }
  const dpr = window.devicePixelRatio || 1;
  let left = 0, up = 0, cw = 0, ch = 0;
  host.innerHTML = `
    <div class="grid min-h-[260px] flex-1 place-items-center p-3"><canvas class="max-w-full h-auto!"></canvas></div>
    <div class="anim-controls ${BAR} gap-x-3 gap-y-1.5">
      <span class="inline-flex items-center gap-1">${spec.list.map((a, i) => `<button class="${BUTTON}" data-a="${i}">${a.name}</button>`).join('')}</span>
      <span class="inline-flex items-center gap-1"><button class="${BUTTON}" data-turn="1" title="Turn left">⟲</button><span class="dir min-w-[110px] text-center tabular-nums"></span><button class="${BUTTON}" data-turn="-1" title="Turn right">⟳</button>
        <label class="${LABEL}"><input type="checkbox" class="spin ${CHECKBOX}"> Turn round</label></span>
      <label class="${LABEL}">Size <select class="size ${SELECT}">${SIZES.map((s) => `<option value="${s.id}"${s.zoom === zoom ? ' selected' : ''}>${s.label}</option>`).join('')}</select></label>
      <label class="${LABEL}">Speed <select class="speed ${SELECT}"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></label>
    </div>`;
  const canvas = host.querySelector('canvas')!;
  const ctx = canvas.getContext('2d')!;
  /** Size the canvas for the zoom (CSS px; drawn at the screen's pixel density). */
  const layout = () => {
    left = left0 * zoom; up = up0 * zoom;
    cw = Math.ceil((left0 + right0) * zoom); ch = Math.ceil((up0 + down0) * zoom);
    canvas.width = cw * dpr; canvas.height = ch * dpr;
    canvas.style.width = `${cw}px`; canvas.style.height = `${ch}px`;
    host.style.backgroundSize = `${TERRAIN_COPY_PX * zoom}px`; // the ground at the same zoom as the unit, as in a match
    ctx.imageSmoothingQuality = 'high';
    rounds = []; flecks = [];
  };
  host.querySelector<HTMLSelectElement>('.size')!.onchange = (e) => {
    const id = (e.target as HTMLSelectElement).value;
    zoom = SIZES.find((s) => s.id === id)!.zoom;
    try { localStorage.setItem(SIZE_KEY, id); } catch { /* not kept */ }
    layout();
  };
  let anim = 0, dir = spec.start, t = 0, spinT = 0;
  const speed = host.querySelector<HTMLSelectElement>('.speed')!;
  const spin = host.querySelector<HTMLInputElement>('.spin')!;
  const show = () => {
    for (const b of host.querySelectorAll<HTMLElement>('[data-a]')) b.classList.toggle('primary', +b.dataset.a! === anim);
    host.querySelector('.dir')!.textContent = `facing ${dir} · ${Math.round((dir * 360) / spec.directions)}°`;
  };
  host.querySelector('.anim-controls')!.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-a], [data-turn]');
    if (!el) return;
    if (el.dataset.a !== undefined) { anim = +el.dataset.a; t = 0; }
    else dir = (dir + +el.dataset.turn! + spec.directions) % spec.directions;
    show();
  });
  show();

  // shooting: the game's bursts, scaled to the canvas
  let rounds: Round[] = [], flecks: Fleck[] = [], burstT = BURST_EVERY_MS, flashT = -1;
  layout();
  const rnd = ([a, b]: [number, number]) => a + Math.random() * (b - a);
  /** A burst from `from` towards angle `a` (radians, counter-clockwise from world +X, as the directions). */
  const fire = (from: { x: number; y: number }, a: number) => {
    const gx = Math.cos(a), gy = -Math.sin(a);              // grid direction (as core/geometry facing)
    const sx = (gx - gy) * 64, sy = (gx + gy) * 32;         // on screen
    const n = Math.hypot(sx, sy);
    const to = { x: from.x + (sx / n) * RANGE * zoom, y: from.y + (sy / n) * RANGE * zoom };
    for (let i = 0; i < BULLETS.rounds; i++) {
      const j = () => (Math.random() * 2 - 1) * BULLETS.spread * zoom;
      const miss = Math.random() < BULLETS.missShare;
      const past = miss ? rnd(BULLETS.missPast) * zoom : 0;
      const x2 = to.x + (sx / n) * past + j(), y2 = to.y + (sy / n) * past * 0.5 + 18 * zoom * +miss + j();
      rounds.push({ x1: from.x, y1: from.y, x2, y2, age: -i * BULLETS.gapMs, flight: (Math.hypot(x2 - from.x, y2 - from.y) / (BULLETS.speed * zoom)) * 1000, miss });
    }
  };
  const hex = (c: number, a: number) => `rgba(${c >> 16},${(c >> 8) & 255},${c & 255},${a})`;
  const drawShots = (dt: number, muzzle: { x: number; y: number }) => {
    ctx.globalCompositeOperation = 'lighter';
    rounds = rounds.filter((r) => {
      const was = r.age;
      r.age += dt;
      if (was < 0 && r.age >= 0) flashT = 0;
      if (r.age < 0) return true;
      const k = Math.min(1, r.age / r.flight);
      const len = Math.hypot(r.x2 - r.x1, r.y2 - r.y1) || 1;
      const t = Math.max(0, k - (BULLETS.streak * zoom) / len);
      const line = (w: number, c: string) => {
        ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath();
        ctx.moveTo(r.x1 + (r.x2 - r.x1) * t, r.y1 + (r.y2 - r.y1) * t);
        ctx.lineTo(r.x1 + (r.x2 - r.x1) * k, r.y1 + (r.y2 - r.y1) * k); ctx.stroke();
      };
      line(5 * zoom / 2, hex(BULLETS.glow, 0.35));
      line(2 * zoom / 2, hex(BULLETS.core, 1));
      if (k < 1) return true;
      if (r.miss) flecks.push({ x: r.x2, y: r.y2, vx: 0, vy: -20, age: 0, life: 420, dust: true });
      else for (let i = 0; i < BULLETS.sparks; i++) {
        const a = Math.random() * Math.PI * 2, v = rnd(BULLETS.sparkSpeed) * zoom;
        flecks.push({ x: r.x2, y: r.y2, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, age: 0, life: BULLETS.sparkLifeMs, dust: false });
      }
      return false;
    });
    if (flashT >= 0) {
      const k = flashT / 90;
      ctx.fillStyle = hex(0xfff0a0, 1 - k);
      ctx.beginPath(); ctx.arc(muzzle.x, muzzle.y, 7 * zoom * (1 - 0.7 * k), 0, Math.PI * 2); ctx.fill();
      flashT = (flashT += dt) > 90 ? -1 : flashT;
    }
    flecks = flecks.filter((f) => (f.age += dt) < f.life);
    for (const f of flecks) {
      const a = 1 - f.age / f.life;
      if (f.dust) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = hex(BULLETS.dust, 0.7 * a);
        ctx.beginPath(); ctx.arc(f.x, f.y - (f.age / 1000) * 24 * zoom, 5 * zoom * (1 + 1.6 * (1 - a)), 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'lighter';
        continue;
      }
      f.vy += 500 * zoom * (dt / 1000);
      f.x += f.vx * (dt / 1000); f.y += f.vy * (dt / 1000);
      ctx.strokeStyle = hex(BULLETS.glow, a); ctx.lineWidth = zoom;
      ctx.beginPath(); ctx.moveTo(f.x - f.vx * 0.02, f.y - f.vy * 0.02); ctx.lineTo(f.x, f.y); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  };

  let last = performance.now();
  let raf = 0;
  const draw = (now: number) => {
    const dt = (now - last) * +speed.value;
    last = now;
    t += dt;
    if (spin.checked && (spinT += dt) > 600) {
      spinT = 0;
      dir = (dir + 1) % spec.directions;
      show();
    }
    const a = spec.list[anim];
    const names = a.overlay ? a.overlay(dir) : a.frames(dir);
    const ms = 1000 / a.fps;
    let i = Math.floor(t / ms);
    // boarding: the door opens, he runs in and up the ramp, it shuts; the doors alone open, hold, shut and hold
    let rider: { p: P; frame: string; alpha: number } | null = null;
    const way = boarding.get(a)?.[dir];
    if (a.pingPong || way) {
      const n = names.length, clipMs = n * ms;
      const tileMs = way ? 1000 / a.board!.tilesPerSec : 0;
      const runMs = way ? (way.approachTiles + way.rampTiles) * tileMs : DOOR_HOLD_MS;
      if (t > 2 * clipMs + runMs + DOOR_HOLD_MS) t = 0;
      i = t < clipMs ? Math.floor(t / ms) : t < clipMs + runMs ? n - 1 : t < 2 * clipMs + runMs ? n - 1 - Math.floor((t - clipMs - runMs) / ms) : 0;
      i = Math.max(0, Math.min(n - 1, i));
      if (way && t < clipMs + runMs) {
        const s = Math.max(0, t - clipMs) / tileMs; // tiles run
        const onRamp = Math.max(0, s - way.approachTiles) / (way.rampTiles || 1);
        const climbing = s >= way.approachTiles, from = climbing ? way.foot : way.start, to = climbing ? way.door : way.foot;
        const k = climbing ? Math.min(1, onRamp) : s / way.approachTiles;
        const frames = atlases[a.board!.atlas].meta.run_frames ?? 12;
        rider = {
          p: { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k },
          frame: `inf_${way.facing}_${t < clipMs ? 'idle' : Math.floor((s * frames) / RUN_CYCLE_TILES) % frames}`,
          // fading in where he starts, and out as he goes up into the doorway
          alpha: Math.min(1, t / BOARD_FADE_IN_MS) * (1 - Math.min(1, onRamp)),
        };
      }
    } else if (a.once) {
      if (t > names.length * ms + HOLD_MS) t = i = 0;
      i = Math.min(i, names.length - 1);
    } else i %= names.length;
    const at = atlases[a.atlas];
    const over = a.overlay?.(dir);
    const entry = at.frames[over ? a.frames(dir)[0] : names[i]];
    const fr = entry?.frame;
    const off = entry?.spriteSourceSize ?? { x: 0, y: 0 };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    if (fr) {
      const k = zoom / (at.meta.res ?? 1);
      // a hovering unit: its shadow on the ground, and the unit bobbing over it (as the game does, config HOVER)
      const ue = a.under && at.frames[a.under(dir)];
      if (ue) {
        const o = ue.spriteSourceSize ?? { x: 0, y: 0 };
        ctx.drawImage(at.img, ue.frame.x, ue.frame.y, ue.frame.w, ue.frame.h, left + (o.x - at.meta.anchor.x) * k, up + (o.y - at.meta.anchor.y) * k, ue.frame.w * k, ue.frame.h * k);
      }
      const upB = up - (ue ? (Math.sin((now / HOVER.periodMs) * Math.PI * 2) + 1) * 0.5 * HOVER.bob * zoom : 0);
      ctx.drawImage(at.img, fr.x, fr.y, fr.w, fr.h, left + (off.x - at.meta.anchor.x) * k, upB + (off.y - at.meta.anchor.y) * k, fr.w * k, fr.h * k);
      const top = over && at.frames[over[i % over.length]];
      if (top) {
        const o = top.spriteSourceSize ?? { x: 0, y: 0 };
        ctx.drawImage(at.img, top.frame.x, top.frame.y, top.frame.w, top.frame.h, left + (o.x - at.meta.anchor.x) * k, up + (o.y - at.meta.anchor.y) * k, top.frame.w * k, top.frame.h * k);
      }
      // a turret of its own: over the hull at its pivot, firing from its barrel tip
      const tl = at.meta.turret_layer;
      let gun: { muzzle: { x: number; y: number }; angle: number } | null = null;
      if (a.turret && tl) {
        const n = tl.directions;
        const td = a.turret.mode === 'sweep'
          ? Math.floor(t / SWEEP_MS_PER_STEP) % n
          : (Math.round((spec.start * n) / spec.directions) + n / 4) % n; // a quarter turn left of where it started
        const pv = tl.pivot[dir] ?? { x: 0, y: 0 };
        const te = at.frames[a.turret.frame(td)];
        if (te) {
          const o = te.spriteSourceSize ?? { x: 0, y: 0 };
          ctx.drawImage(at.img, te.frame.x, te.frame.y, te.frame.w, te.frame.h, left + (pv.x + o.x - at.meta.anchor.x) * k, up + (pv.y + o.y - at.meta.anchor.y) * k, te.frame.w * k, te.frame.h * k);
        }
        const mz = tl.muzzle[td];
        if (mz) gun = { muzzle: { x: left + (pv.x + mz.x) * k, y: up + (pv.y + mz.y) * k }, angle: (td * 2 * Math.PI) / n };
      } else if (at.meta.muzzles?.[dir]?.length) {
        // its guns' tips, taking turns burst by burst
        const guns = at.meta.muzzles[dir];
        const mz = guns[Math.floor(t / BURST_EVERY_MS) % guns.length];
        gun = { muzzle: { x: left + mz.x * k, y: upB + mz.y * k }, angle: (dir * 2 * Math.PI) / spec.directions };
      } else {
        const mz = at.meta.muzzle?.[dir % at.meta.muzzle.length];
        if (mz) gun = { muzzle: { x: left + (mz.x - at.meta.anchor.x) * k, y: up + (mz.y - at.meta.anchor.y) * k }, angle: (dir * 2 * Math.PI) / spec.directions };
      }
      if (a.fire && gun) {
        if ((burstT += dt) >= BURST_EVERY_MS) { burstT = 0; fire(gun.muzzle, gun.angle); }
        drawShots(dt, gun.muzzle);
      } else rounds = [];
      // the boarding soldier, in front of the hull
      const sa = rider && atlases[a.board!.atlas];
      const se = sa && sa.frames[rider!.frame];
      if (rider && sa && se && rider.alpha > 0) {
        const sk = zoom / (sa.meta.res ?? 1), o = se.spriteSourceSize ?? { x: 0, y: 0 };
        ctx.globalAlpha = rider.alpha;
        ctx.drawImage(sa.img, se.frame.x, se.frame.y, se.frame.w, se.frame.h,
          left + rider.p.x * zoom + (o.x - sa.meta.anchor.x) * sk, up + rider.p.y * zoom + (o.y - sa.meta.anchor.y) * sk, se.frame.w * sk, se.frame.h * sk);
        ctx.globalAlpha = 1;
      }
    }
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
  onLeave(() => cancelAnimationFrame(raf));
}
