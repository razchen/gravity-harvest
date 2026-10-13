// The dev pages' picture views: the high-resolution picture (tools/sprites/pack_previews.py, its _large copy), or
// the thing as the game draws it, at the game's zoom, pixel for pixel. Not part of the game build.
import { CAMERA } from '../config/game';
import { SHADOW_ALPHA } from '../world/ShadowLayer';
import { mountPicture } from './picture';

const KEY = 'gh-dev-picture-view';

/**
 * Put the views in `host` (a flex column): a stage, and a bar to switch between them. `inGame: false` leaves out the
 * in-game view (a unit page's animation player already shows it at the game's size).
 */
export function mountPictureViews(host: HTMLElement, file: string, frame: string, preview?: string, inGame = true): void {
  const stage = document.createElement('div');
  stage.className = 'pic-stage';
  const bar = document.createElement('div');
  bar.className = 'model-bar';
  const views = [
    ...(preview ? [{ id: 'hires', label: 'High-res picture' }] : []),
    ...(inGame ? [{ id: 'game', label: 'In game' }] : []),
  ];
  bar.innerHTML = `<span class="group">${views.map((v) => `<button data-v="${v.id}">${v.label}</button>`).join('')}</span><span class="model-status"></span>`;
  host.replaceChildren(stage, bar);
  const status = bar.querySelector<HTMLElement>('.model-status')!;
  const show = async (id: string) => {
    for (const b of bar.querySelectorAll<HTMLElement>('[data-v]')) b.classList.toggle('primary', b.dataset.v === id);
    try { localStorage.setItem(KEY, id); } catch { /* not kept */ }
    stage.replaceChildren();
    if (id === 'hires' && preview) {
      await mountPicture(stage, file, frame, `${preview.replace(/\.webp$/, '_large.webp')}?v=${Date.now()}`);
      const img = stage.querySelector('img');
      status.textContent = img ? `${img.naturalWidth} × ${img.naturalHeight} px` : '';
      return;
    }
    const { canvas, res } = await gameSprite(file, frame);
    const k = CAMERA.startZoom / res;
    canvas.className = 'game-size';
    canvas.style.width = `${canvas.width * k}px`;
    stage.append(canvas);
    status.textContent = `sprite ${canvas.width} × ${canvas.height} px, shown at ${Math.round(canvas.width * k)} × ${Math.round(canvas.height * k)} CSS px, as in the game (pixel for pixel on a Retina screen)`;
  };
  bar.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-v]');
    if (b) void show(b.dataset.v!);
  });
  let first = views[0].id;
  try { first = localStorage.getItem(KEY) ?? first; } catch { /* not kept */ }
  void show(views.some((v) => v.id === first) ? first : views[0].id).catch(() => { stage.textContent = 'picture missing'; });
}

/**
 * The frame as the game draws it: a building's finished stage over its shadow frame at the shared layer's strength
 * (a unit's shadow is baked in). `res`: the atlas is drawn at 1 / res.
 */
async function gameSprite(file: string, frame: string): Promise<{ canvas: HTMLCanvasElement; res: number }> {
  const bust = `?v=${Date.now()}`;
  const json = await fetch(`/assets/sprites/${file}.json${bust}`).then((r) => r.json()) as {
    frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>;
    meta: { res?: number };
  };
  const img = new Image();
  img.src = `/assets/sprites/${file}.png${bust}`;
  await img.decode();
  const body = json.frames[frame].frame;
  const shadow = frame.includes('_stage_') ? json.frames[frame.replace('_stage_', '_shadow_')]?.frame : undefined;
  const c = document.createElement('canvas');
  c.width = body.w;
  c.height = body.h;
  const g = c.getContext('2d')!;
  if (shadow) {
    g.globalAlpha = SHADOW_ALPHA;
    g.drawImage(img, shadow.x, shadow.y, shadow.w, shadow.h, 0, 0, shadow.w, shadow.h);
    g.globalAlpha = 1;
  }
  g.drawImage(img, body.x, body.y, body.w, body.h, 0, 0, body.w, body.h);
  return { canvas: c, res: json.meta.res ?? 1 };
}
