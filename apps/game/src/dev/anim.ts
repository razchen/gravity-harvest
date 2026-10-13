// The unit pages' animation player: plays a unit's sprite-sheet animations straight from the game's atlases
// (public/assets/sprites), in any direction, on a plain canvas. Not part of the game build.
import { CAMERA } from '../config/game';
import { BULLETS, HEAVY } from '../render/Effects';
import { onLeave } from './page';

export interface UnitAnim {
  name: string;
  atlas: string;
  /** The frame names for direction d, in order. */
  frames: (d: number) => string[];
  fps: number;
  /** Play once, hold the last frame a moment, then start again (a death). */
  once?: boolean;
  /** Fire bursts from the atlas's muzzle points (meta.muzzle), as the game does (render/Effects.ts BULLETS). */
  fire?: boolean | 'shell';
  /** A layer played over the (first) frame: a vehicle's wheels turning. */
  overlay?: (d: number) => string[];
  /**
   * A turret that turns on its own (the atlas's meta.turret_layer), its frame for direction t drawn over the hull
   * at its pivot: sweeping round, or aimed at a target off to the side that it stays on as the hull turns (firing
   * from the barrel tip, with `fire`).
   */
  turret?: { frame: (t: number) => string; mode: 'sweep' | 'aim' };
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
    anchor: { x: number; y: number }; res?: number; muzzle?: { x: number; y: number }[];
    turret_layer?: { directions: number; pivot: { x: number; y: number }[]; muzzle: { x: number; y: number }[] };
  };
}

interface Round { x1: number; y1: number; x2: number; y2: number; age: number; flight: number; miss: boolean; shell?: boolean }
interface Blast { x: number; y: number; age: number }
interface Fleck { x: number; y: number; vx: number; vy: number; age: number; life: number; dust: boolean }

const HOLD_MS = 1500;
/** How long a shell's burst lasts (ms). */
const BLAST_MS = 260;
/** A sweeping turret moves on a direction every this many ms. */
const SWEEP_MS_PER_STEP = 90;
/** Shooting: how far away the target is (world px), and how often a burst goes. */
const RANGE = 150;
const BURST_EVERY_MS = 1100;
/** The sizes it can be drawn at: as in a match (the game's closest zoom, pixel for pixel), or closer up for detail. */
const SIZES = [
  { id: 'game', label: 'Game size', zoom: CAMERA.maxZoom },
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

/** Put the player in `host`. */
export async function mountAnimPlayer(host: HTMLElement, spec: UnitAnims): Promise<void> {
  const atlases: Record<string, Atlas> = {};
  for (const a of new Set(spec.list.map((x) => x.atlas))) atlases[a] = await loadAtlas(a);

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
  const dpr = window.devicePixelRatio || 1;
  let left = 0, up = 0, cw = 0, ch = 0;
  host.innerHTML = `
    <div class="anim-stage"><canvas></canvas></div>
    <div class="anim-controls">
      <span class="group">${spec.list.map((a, i) => `<button data-a="${i}">${a.name}</button>`).join('')}</span>
      <span class="group"><button data-turn="1" title="Turn left">⟲</button><span class="dir"></span><button data-turn="-1" title="Turn right">⟳</button>
        <label><input type="checkbox" class="spin"> Turn round</label></span>
      <label>Size <select class="size">${SIZES.map((s) => `<option value="${s.id}"${s.zoom === zoom ? ' selected' : ''}>${s.label}</option>`).join('')}</select></label>
      <label>Speed <select class="speed"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></label>
    </div>`;
  const canvas = host.querySelector('canvas')!;
  const ctx = canvas.getContext('2d')!;
  /** Size the canvas for the zoom (CSS px; drawn at the screen's pixel density). */
  const layout = () => {
    left = left0 * zoom; up = up0 * zoom;
    cw = Math.ceil((left0 + right0) * zoom); ch = Math.ceil((up0 + down0) * zoom);
    canvas.width = cw * dpr; canvas.height = ch * dpr;
    canvas.style.width = `${cw}px`; canvas.style.height = `${ch}px`;
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
  let rounds: Round[] = [], flecks: Fleck[] = [], blasts: Blast[] = [], burstT = BURST_EVERY_MS, flashT = -1;
  layout();
  const rnd = ([a, b]: [number, number]) => a + Math.random() * (b - a);
  /**
   * A burst from `from` towards angle `a` (radians, counter-clockwise from world +X, as the directions), or with
   * `shell` one cannon shell (render/Effects.ts HEAVY.shell) that bursts where it lands.
   */
  const fire = (from: { x: number; y: number }, a: number, shell = false) => {
    const gx = Math.cos(a), gy = -Math.sin(a);              // grid direction (as core/geometry facing)
    const sx = (gx - gy) * 64, sy = (gx + gy) * 32;         // on screen
    const n = Math.hypot(sx, sy);
    const to = { x: from.x + (sx / n) * RANGE * zoom, y: from.y + (sy / n) * RANGE * zoom };
    if (shell) {
      rounds.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y, age: 0, flight: (RANGE * zoom / (HEAVY.shell.speed * zoom)) * 1000, miss: false, shell: true });
      flashT = 0;
      return;
    }
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
      const look = r.shell ? HEAVY.shell : BULLETS;
      const wide = r.shell ? 1.8 : 1;
      const t = Math.max(0, k - (look.streak * zoom) / len);
      const line = (w: number, c: string) => {
        ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath();
        ctx.moveTo(r.x1 + (r.x2 - r.x1) * t, r.y1 + (r.y2 - r.y1) * t);
        ctx.lineTo(r.x1 + (r.x2 - r.x1) * k, r.y1 + (r.y2 - r.y1) * k); ctx.stroke();
      };
      line(5 * wide * zoom / 2, hex(look.glow, 0.35));
      line(2 * wide * zoom / 2, hex(look.core, 1));
      if (k < 1) return true;
      if (r.shell) blasts.push({ x: r.x2, y: r.y2, age: 0 });
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
    // a shell's burst where it lands: a flash that swells and fades
    blasts = blasts.filter((b) => (b.age += dt) < BLAST_MS);
    for (const b of blasts) {
      const k = b.age / BLAST_MS;
      ctx.fillStyle = hex(HEAVY.shell.glow, 0.8 * (1 - k));
      ctx.beginPath(); ctx.arc(b.x, b.y, 22 * zoom * HEAVY.shell.blast * (0.6 + k), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = hex(HEAVY.shell.core, 1 - k);
      ctx.beginPath(); ctx.arc(b.x, b.y, 10 * zoom * HEAVY.shell.blast * (1 - 0.5 * k), 0, Math.PI * 2); ctx.fill();
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
    if (a.once) {
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
      ctx.drawImage(at.img, fr.x, fr.y, fr.w, fr.h, left + (off.x - at.meta.anchor.x) * k, up + (off.y - at.meta.anchor.y) * k, fr.w * k, fr.h * k);
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
      } else {
        const mz = at.meta.muzzle?.[dir % at.meta.muzzle.length];
        if (mz) gun = { muzzle: { x: left + (mz.x - at.meta.anchor.x) * k, y: up + (mz.y - at.meta.anchor.y) * k }, angle: (dir * 2 * Math.PI) / spec.directions };
      }
      if (a.fire && gun) {
        if ((burstT += dt) >= BURST_EVERY_MS) { burstT = 0; fire(gun.muzzle, gun.angle, a.fire === 'shell'); }
        drawShots(dt, gun.muzzle);
      } else { rounds = []; blasts = []; }
    }
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
  onLeave(() => cancelAnimationFrame(raf));
}
