// A building's or unit's picture for the dev pages: its high-resolution preview if it has one
// (tools/sprites/pack_previews.py), else one sprite frame cropped to what's in it.

interface AtlasJson {
  frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>;
}

/** The picture as an image element. */
export async function picture(file: string, frame: string, preview?: string): Promise<HTMLImageElement> {
  if (preview) return loadImage(preview);
  return toImage(await spriteFrame(file, frame));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const im = new Image();
    im.onload = () => ok(im);
    im.onerror = fail;
    im.src = src;
  });
}

async function toImage(c: HTMLCanvasElement): Promise<HTMLImageElement> {
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok));
  return blob ? loadImage(URL.createObjectURL(blob)) : loadImage(c.toDataURL());
}

/** One atlas frame, cropped to what's in it, on a canvas. */
async function spriteFrame(file: string, frame: string): Promise<HTMLCanvasElement> {
  const [json, img] = await Promise.all([
    fetch(`/assets/sprites/${file}.json`).then((r) => r.json() as Promise<AtlasJson>),
    new Promise<HTMLImageElement>((ok, fail) => {
      const im = new Image();
      im.onload = () => ok(im);
      im.onerror = fail;
      im.src = `/assets/sprites/${file}.png`;
    }),
  ]);
  const f = json.frames[frame].frame;
  const full = Object.assign(document.createElement('canvas'), { width: f.w, height: f.h });
  const ctx = full.getContext('2d')!;
  ctx.drawImage(img, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
  // crop to the opaque pixels, so every building fills its card the same way
  const a = ctx.getImageData(0, 0, f.w, f.h).data;
  let x0 = f.w, y0 = f.h, x1 = 0, y1 = 0;
  for (let y = 0; y < f.h; y++) {
    for (let x = 0; x < f.w; x++) {
      if (a[(y * f.w + x) * 4 + 3] > 40) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
  }
  if (x1 < x0) return full;
  const out = Object.assign(document.createElement('canvas'), { width: x1 - x0 + 1, height: y1 - y0 + 1 });
  out.getContext('2d')!.drawImage(full, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

interface PreviewMeta { w: number; h: number; body: { x: number; y: number; w: number; h: number } }
let metas: Promise<Record<string, PreviewMeta>> | null = null;
const previewMeta = (src: string) => {
  metas ??= fetch('/assets/previews/previews.json').then((r) => (r.ok ? (r.json() as Promise<Record<string, PreviewMeta>>) : {})).catch(() => ({}));
  return metas.then((all) => all[src.split('?')[0].split('/').pop()!.replace(/(_large)?\.webp$/, '')]);
};

/** Building's share of its box (the shadow is free to run past the edge). */
const FILL_W = 0.86;
const FILL_H = 0.84;

/**
 * Put a picture in `box`. A preview is sized and centred by the building alone, so every building fills its box the
 * same way and its shadow spills out wherever it falls; a plain sprite is fitted inside the box.
 */
export async function mountPicture(box: HTMLElement, file: string, frame: string, preview?: string): Promise<void> {
  const img = await picture(file, frame, preview);
  const meta = preview ? await previewMeta(preview) : undefined;
  if (!meta) {
    img.classList.add('fit');
    box.append(img);
    return;
  }
  img.classList.add('placed');
  const place = () => {
    const bw = box.clientWidth;
    const bh = box.clientHeight;
    const s = Math.min((bw * FILL_W) / meta.body.w, (bh * FILL_H) / meta.body.h);
    img.style.width = `${meta.w * s}px`;
    img.style.left = `${bw / 2 - (meta.body.x + meta.body.w / 2) * s}px`;
    img.style.top = `${bh / 2 - (meta.body.y + meta.body.h / 2) * s}px`;
  };
  box.append(img);
  place();
  new ResizeObserver(place).observe(box);
}
