// Dev page (/dev/fire.html): a playground for the burning-building look: Flame02 or Flame03 (Unity Labs flipbooks,
// CC0) with smoke, every setting on a slider, rebuilt live on the refinery. Not part of the game build.
import Phaser from 'phaser';
import { TERRAIN, sprites, type SpriteMeta } from '../assets/manifest';
import { CAMERA, DEPTH, DPR } from '../config/game';
import { ConstructionView } from '../render/Construction';
import { FX } from '../render/fxTextures';
import type { GameMap } from '../world/GameMap';
import { ShadowLayer } from '../world/ShadowLayer';
import { TERRAIN_COPY_PX } from '../world/Terrain';
import { onLeave } from './page';

/** Set up the page in the markup the sidebar has just put in (nav.ts). */
export default function mount(): void {
  const ATLAS = 'b_refinery_build';
  const FLAMES = ['flame02', 'flame03'];
  const SMOKES = ['wispysmoke01', 'cloud02'];
  const STORE = 'gh-fire-playground';

  type Value = number | string;
  interface Control { key: string; label: string; group: 'Fire' | 'Smoke' | 'View'; min?: number; max?: number; step?: number; options?: string[]; color?: true; value: Value }

  /** Every setting, with its default. */
  const CONTROLS: Control[] = [
    { key: 'flame', label: 'Flame', group: 'Fire', options: FLAMES, value: 'flame02' },
    { key: 'spots', label: 'Burning spots', group: 'Fire', min: 1, max: 7, step: 1, value: 3 },
    { key: 'flamesPerSpot', label: 'Flames per spot', group: 'Fire', min: 1, max: 8, step: 1, value: 2 },
    { key: 'flameScale', label: 'Flame size', group: 'Fire', min: 0.1, max: 1.5, step: 0.01, value: 0.42 },
    { key: 'sizeVariety', label: 'Size variety', group: 'Fire', min: 0, max: 0.8, step: 0.01, value: 0.2 },
    { key: 'spread', label: 'Spread (px)', group: 'Fire', min: 0, max: 40, step: 1, value: 8 },
    { key: 'flameFps', label: 'Flame speed (fps)', group: 'Fire', min: 5, max: 60, step: 1, value: 30 },
    { key: 'blend', label: 'Blend', group: 'Fire', options: ['glow (additive)', 'normal'], value: 'glow (additive)' },
    { key: 'flameAlpha', label: 'Flame opacity', group: 'Fire', min: 0.1, max: 1, step: 0.01, value: 1 },
    { key: 'flameTint', label: 'Flame tint', group: 'Fire', color: true, value: '#ffffff' },
    { key: 'glow', label: 'Ground glow', group: 'Fire', min: 0, max: 1, step: 0.01, value: 0.32 },
    { key: 'embers', label: 'Embers per second', group: 'Fire', min: 0, max: 30, step: 1, value: 5 },

    { key: 'smoke', label: 'Smoke', group: 'Smoke', options: [...SMOKES, 'none'], value: 'wispysmoke01' },
    { key: 'smokeStart', label: 'Starts above flames (px)', group: 'Smoke', min: 0, max: 200, step: 1, value: 100 },
    { key: 'behind', label: 'Drawn', group: 'Smoke', options: ['behind the flames', 'in front'], value: 'behind the flames' },
    { key: 'smokeRate', label: 'Puffs per second', group: 'Smoke', min: 0.5, max: 12, step: 0.1, value: 3.8 },
    { key: 'smokeLife', label: 'Puff life (s)', group: 'Smoke', min: 1, max: 8, step: 0.1, value: 3.2 },
    { key: 'rise', label: 'Rise speed', group: 'Smoke', min: 5, max: 120, step: 1, value: 36 },
    { key: 'wind', label: 'Wind (→)', group: 'Smoke', min: -60, max: 60, step: 1, value: 14 },
    { key: 'smokeStartScale', label: 'Size at start', group: 'Smoke', min: 0.05, max: 2, step: 0.01, value: 0.45 },
    { key: 'smokeEndScale', label: 'Size at end', group: 'Smoke', min: 0.2, max: 4, step: 0.01, value: 1.5 },
    { key: 'smokeAlpha', label: 'Opacity', group: 'Smoke', min: 0.05, max: 1, step: 0.01, value: 0.8 },
    { key: 'fadeIn', label: 'Fade in (share of life)', group: 'Smoke', min: 0, max: 0.6, step: 0.01, value: 0.15 },
    { key: 'smokeTint', label: 'Smoke colour', group: 'Smoke', color: true, value: '#4a4440' },
    { key: 'spin', label: 'Spin (°)', group: 'Smoke', min: 0, max: 180, step: 1, value: 20 },

    { key: 'zoom', label: 'Zoom', group: 'View', min: 0.5, max: 4, step: 0.05, value: 2 },
  ];

  const defaults = Object.fromEntries(CONTROLS.map((c) => [c.key, c.value])) as Record<string, Value>;
  function load(): Record<string, Value> {
    try {
      return { ...defaults, ...(JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, Value>) };
    } catch {
      return { ...defaults };
    }
  }
  const settings = load();
  const save = () => {
    try { localStorage.setItem(STORE, JSON.stringify(settings)); } catch { /* private window: settings just aren't kept */ }
  };
  const num = (k: string) => Number(settings[k]);
  const str = (k: string) => String(settings[k]);
  const color = (k: string) => parseInt(str(k).slice(1), 16);
  const rand = (a: number, b: number) => a + Math.random() * (b - a);

  interface FxSheet { file: string; frameWidth: number; frameHeight: number; frames: number }

  class FireScene extends Phaser.Scene {
    private sheets: Record<string, FxSheet> = {};
    private made: Phaser.GameObjects.GameObject[] = [];
    private spotsAt: { x: number; y: number }[] = [];

    constructor() {
      super('fire');
    }

    preload(): void {
      this.load.setPath('/');
      this.load.image(TERRAIN.earth.key, TERRAIN.earth.file);
      this.load.atlas(ATLAS, `assets/sprites/${ATLAS}.png`, `assets/sprites/${ATLAS}.json`);
      this.load.json('atlas_meta', `assets/sprites/${ATLAS}.json`);
      this.load.json('fx_index', 'assets/fx/fx.json');
      this.load.once('filecomplete-json-fx_index', (_k: string, _t: string, data: Record<string, FxSheet>) => {
        this.sheets = data;
        for (const name of [...FLAMES, ...SMOKES]) {
          const sh = data[name];
          this.load.spritesheet(name, `assets/fx/${sh.file}`, { frameWidth: sh.frameWidth, frameHeight: sh.frameHeight });
        }
      });
    }

    create(): void {
      const src = this.textures.get(TERRAIN.earth.key).getSourceImage() as HTMLImageElement;
      for (let y = -2 * TERRAIN_COPY_PX; y < 6 * TERRAIN_COPY_PX; y += TERRAIN_COPY_PX) {
        for (let x = -4 * TERRAIN_COPY_PX; x < 4 * TERRAIN_COPY_PX; x += TERRAIN_COPY_PX) {
          this.add.image(x, y, TERRAIN.earth.key).setOrigin(0, 0).setScale(TERRAIN_COPY_PX / src.width).setDepth(DEPTH.ground);
        }
      }
      const frame = this.textures.getFrame(ATLAS, `${ATLAS}_stage_1`);
      const raw = (this.cache.json.get('atlas_meta') as { meta: Partial<SpriteMeta> }).meta;
      sprites[ATLAS] = { anchor: { x: 0, y: 0 }, ...raw, w: frame.width, h: frame.height };
      const shadows = new ShadowLayer(this, { width: 32, height: 32 } as GameMap);
      const bx = 0;
      const by = 1024;
      const v = new ConstructionView(this, ATLAS, bx, by, 0, { layer: shadows, id: 1 });
      v.showStage(v.stages.length - 1);
      const a = sprites[ATLAS].anchor;
      // the same spot order as the game's burning building (render/Destruction.ts)
      const spots = [...(sprites[ATLAS].damage?.spots ?? [])].sort((p, q) => ((p[0] * 7 + p[1] * 13) % 11) - ((q[0] * 7 + q[1] * 13) % 11));
      this.spotsAt = spots.map(([fx, fy]) => ({ x: bx + fx - a.x, y: by + fy - a.y }));
      this.cameras.main.centerOn(bx, by - 110);
      this.rebuild();
      this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
        if (!p.isDown) return;
        const cam = this.cameras.main;
        cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
        cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
      });
    }

    /** Throw away every effect and make them again from the settings. */
    rebuild(): void {
      for (const o of this.made) o.destroy();
      this.made = [];
      this.cameras.main.setZoom(CAMERA.startZoom * DPR * num('zoom'));
      const flame = str('flame');
      const sh = this.sheets[flame];
      if (this.anims.exists('play_flame')) this.anims.remove('play_flame');
      this.anims.create({ key: 'play_flame', frames: this.anims.generateFrameNumbers(flame, { start: 0, end: sh.frames - 1 }), frameRate: num('flameFps'), repeat: -1 });
      const smoke = str('smoke');
      if (this.anims.exists('play_smoke')) this.anims.remove('play_smoke');
      if (smoke !== 'none') {
        const ss = this.sheets[smoke];
        this.anims.create({ key: 'play_smoke', frames: this.anims.generateFrameNumbers(smoke, { start: 0, end: ss.frames - 1 }), frameRate: ss.frames / num('smokeLife'), repeat: 0 });
      }
      const glowBlend = str('blend').startsWith('glow');
      const behind = str('behind').startsWith('behind');
      const flameTop = sh.frameHeight * num('flameScale');
      for (const { x, y } of this.spotsAt.slice(0, num('spots'))) {
        for (let i = 0; i < num('flamesPerSpot'); i++) {
          const sp = num('spread');
          const s = this.add.sprite(x + rand(-sp, sp), y + rand(-sp * 0.35, sp * 0.35), flame)
            .setOrigin(0.5, 0.94).setScale(num('flameScale') * (1 + rand(-1, 1) * num('sizeVariety')))
            .setFlipX(Math.random() < 0.5).setDepth(0.5 + i * 0.001).setAlpha(num('flameAlpha')).setTint(color('flameTint'));
          if (glowBlend) s.setBlendMode(Phaser.BlendModes.ADD);
          s.play({ key: 'play_flame', startFrame: Math.floor(Math.random() * sh.frames) });
          this.made.push(s);
        }
        if (num('glow') > 0) {
          const g = this.add.image(x, y, FX.dot).setTint(0xff6a1c).setBlendMode(Phaser.BlendModes.ADD).setDepth(0.45).setScale(1.2, 0.75).setAlpha(num('glow'));
          this.tweens.add({ targets: g, alpha: num('glow') * 0.6, duration: 120, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
          this.made.push(g);
        }
        if (num('embers') > 0) {
          this.made.push(this.add.particles(x, y - flameTop * 0.3, FX.dot, {
            lifespan: { min: 900, max: 1700 },
            speedX: { min: -18, max: 18 + num('wind') },
            speedY: { min: -110, max: -40 },
            scale: { start: 0.07, end: 0.02 },
            alpha: { start: 1, end: 0 },
            color: [0xfff0a0, 0xff7a20, 0xa02008],
            blendMode: Phaser.BlendModes.ADD,
            frequency: 1000 / num('embers'),
          }).setDepth(0.55));
        }
        if (smoke !== 'none') {
          const peak = num('smokeAlpha');
          const fadeIn = Math.max(0.001, num('fadeIn'));
          const life = num('smokeLife') * 1000;
          this.made.push(this.add.particles(x, y - num('smokeStart'), smoke, {
            anim: 'play_smoke',
            lifespan: { min: life * 0.85, max: life * 1.15 },
            speedX: { min: num('wind') * 0.4, max: num('wind') * 1.6 },
            speedY: { min: -num('rise') * 1.3, max: -num('rise') * 0.7 },
            scale: { start: num('smokeStartScale'), end: num('smokeEndScale') },
            alpha: { onUpdate: (_p: Phaser.GameObjects.Particles.Particle, _k: string, t: number) => (t < fadeIn ? (t / fadeIn) * peak : peak * (1 - (t - fadeIn) / (1 - fadeIn))) },
            tint: color('smokeTint'),
            rotate: { min: -num('spin'), max: num('spin') },
            frequency: 1000 / num('smokeRate'),
          }).setDepth(behind ? 0.4 : 0.6));
        }
      }
    }
  }

  // --- the panel -------------------------------------------------------------------------------------------------
  const panel = document.getElementById('panel')!;
  let scene: FireScene | null = null;
  let pending = 0;
  const changed = () => {
    save();
    window.clearTimeout(pending);
    pending = window.setTimeout(() => scene?.rebuild(), 60);
  };
  let group = '';
  for (const c of CONTROLS) {
    if (c.group !== group) {
      group = c.group;
      panel.insertAdjacentHTML('beforeend', `<h2>${group}</h2>`);
    }
    const row = document.createElement('label');
    row.className = 'ctl';
    row.innerHTML = `<span>${c.label}</span>`;
    if (c.options) {
      const sel = document.createElement('select');
      sel.innerHTML = c.options.map((o) => `<option${o === settings[c.key] ? ' selected' : ''}>${o}</option>`).join('');
      sel.onchange = () => { settings[c.key] = sel.value; changed(); };
      row.append(sel);
    } else if (c.color) {
      const inp = Object.assign(document.createElement('input'), { type: 'color', value: str(c.key) });
      inp.oninput = () => { settings[c.key] = inp.value; changed(); };
      row.append(inp);
    } else {
      const out = document.createElement('output');
      out.textContent = String(settings[c.key]);
      const inp = Object.assign(document.createElement('input'), { type: 'range', min: String(c.min), max: String(c.max), step: String(c.step), value: String(settings[c.key]) });
      inp.oninput = () => { settings[c.key] = Number(inp.value); out.textContent = inp.value; changed(); };
      row.append(out, inp);
    }
    panel.append(row);
  }
  panel.insertAdjacentHTML('beforeend', `<div class="buttons"><button class="primary" id="copy">Copy settings</button><button id="reset">Reset</button><button id="again">Restart effects</button></div><p id="copied"></p>`);
  document.getElementById('copy')!.onclick = async () => {
    const text = JSON.stringify(settings, null, 1);
    try {
      await navigator.clipboard.writeText(text);
      document.getElementById('copied')!.textContent = 'Copied. Paste it to Claude to use these in the game.';
    } catch {
      document.getElementById('copied')!.textContent = text;
    }
  };
  document.getElementById('reset')!.onclick = () => {
    try { localStorage.removeItem(STORE); } catch { /* nothing kept */ }
    location.reload();
  };
  document.getElementById('again')!.onclick = () => scene?.rebuild();

  const view = document.getElementById('view')!;
  const size = () => ({ w: view.clientWidth, h: view.clientHeight });
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: view,
    backgroundColor: '#000000',
    scale: { mode: Phaser.Scale.NONE, width: size().w * DPR, height: size().h * DPR, zoom: 1 / DPR },
    render: { mipmapFilter: 'LINEAR_MIPMAP_LINEAR', roundPixels: true },
    scene: [FireScene],
  });
  game.events.once(Phaser.Core.Events.READY, () => { scene = game.scene.getScene('fire') as FireScene; });
  const resize = new ResizeObserver(() => game.scale.resize(size().w * DPR, size().h * DPR));
  resize.observe(view);
  onLeave(() => { window.clearTimeout(pending); resize.disconnect(); game.destroy(true); });
  Object.assign(window as object, { game });
}
