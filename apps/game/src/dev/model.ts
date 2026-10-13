// The dev pages' 3D view of a source model (art/models, served at /art-models by the dev server): orbit, zoom,
// auto-rotate, and a model's own animations. One model at a time, loaded only when asked for and removed when you
// leave the page (a 45-110 MB GLB takes a few hundred MB in the browser while it's shown). Not part of the game.
import { onLeave } from './page';

export interface ModelFile {
  /** Shown on its button ("Running"). */
  name: string;
  /** Path under art/models ("tripo/sentry.glb"). */
  file: string;
}

interface ModelViewerEl extends HTMLElement {
  src: string;
  availableAnimations?: string[];
  animationName?: string;
  play?: () => void;
}

/** Put a 3D viewer in `host` for these files (a button each when there are several), showing the first. */
export async function mountModel(host: HTMLElement, files: ModelFile[]): Promise<void> {
  host.innerHTML = '<div class="model-wait">Loading the 3D viewer…</div>';
  await import('@google/model-viewer');
  host.innerHTML = `
    <model-viewer camera-controls auto-rotate auto-rotate-delay="0" rotation-per-second="20deg" shadow-intensity="1"
      exposure="1" environment-image="neutral" interaction-prompt="none" autoplay
      style="width:100%;height:100%;background:radial-gradient(#3a3d40,#16171a)"></model-viewer>
    <div class="model-bar">
      ${files.length > 1 ? `<span class="group">${files.map((f, i) => `<button data-m="${i}">${f.name}</button>`).join('')}</span>` : ''}
      <label><input type="checkbox" class="spin" checked> Turn</label>
      <span class="model-status"></span>
    </div>`;
  const mv = host.querySelector('model-viewer') as ModelViewerEl;
  const status = host.querySelector<HTMLElement>('.model-status')!;
  const show = (i: number) => {
    for (const b of host.querySelectorAll<HTMLElement>('[data-m]')) b.classList.toggle('primary', +b.dataset.m! === i);
    status.textContent = `Loading ${files[i].file}…`;
    mv.src = `/art-models/${files[i].file}`;
  };
  mv.addEventListener('progress', (e) => {
    const p = (e as unknown as CustomEvent<{ totalProgress: number }>).detail.totalProgress;
    if (p < 1) status.textContent = `Loading… ${Math.round(p * 100)}%`;
  });
  mv.addEventListener('load', () => {
    const anims = mv.availableAnimations ?? [];
    status.textContent = anims.length ? `Playing: ${anims.join(', ')}` : '';
  });
  mv.addEventListener('error', () => (status.textContent = 'Could not load the model (is it in art/models?)'));
  host.querySelector('.model-bar')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-m]');
    if (b) show(+b.dataset.m!);
  });
  host.querySelector<HTMLInputElement>('.spin')!.addEventListener('change', (e) => mv.toggleAttribute('auto-rotate', (e.target as HTMLInputElement).checked));
  show(0);
  onLeave(() => mv.remove());
}
