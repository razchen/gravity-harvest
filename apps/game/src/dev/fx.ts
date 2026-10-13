// Dev page (/dev/fx.html): fire, smoke and explosion tests on the refinery, the Unity Labs flipbooks (CC0, packed by
// tools/sprites/pack_vfx.py) side by side with the current particle effects, and a Jackal shelling a different building
// in each of the impact looks (render/Impact.ts). Not part of the game build.
import Phaser from 'phaser';
import { ATLASES, TERRAIN, sprites, type SpriteMeta } from '../assets/manifest';
import { CAMERA, DEPTH, DPR, TILE_H } from '../config/game';
import { ConstructionView } from '../render/Construction';
import { BuildingDamage, DESTRUCTION } from '../render/Destruction';
import { footprint } from '@gravity-harvest/sim/layout';
import { alongBarrel, iso } from '../core/geometry';
import { Effects } from '../render/Effects';
import { IMPACT_STYLES, type ImpactStyle } from '../render/Impact';
import { FX, loadFxSheets } from '../render/fxTextures';
import type { GameMap } from '../world/GameMap';
import { ShadowLayer } from '../world/ShadowLayer';
import { TERRAIN_COPY_PX } from '../world/Terrain';
import { onLeave } from './page';

/** Set up the page in the markup the sidebar has just put in (nav.ts). */
export default function mount(): void {
  const ATLAS = 'b_refinery_build';
  const MAP = 48;
  /** World spacing of the test buildings. */
  const COL = 820;
  const ROW = 620;
  const TOP = 900;
  /** Explosion tests: one blast every this many ms, the building back after this long. */
  const BLAST_EVERY = 3200;
  const BACK_AFTER = 1900;
  /** Shell hits: a shell every this many ms, and every this many shots one lands on the ground beside the target. */
  const SHELL_EVERY = 1500;
  const GROUND_EVERY = 3;
  /** Shell hits: the Jackal shoots a different building in each look (atlas, building type). */
  const SHOOTER = 'v_jackal';
  const hasVideo = (atlas: string) => ATLASES.some((e) => e.key === `${atlas}_video`);
  const SHELL_TARGETS: [string, string][] = [
    ['b_power_plant_build', 'power_plant'], ['b_barracks_build', 'barracks'], ['b_radar_build', 'radar'],
    ['b_motor_works_build', 'motor_works'], ['b_gravity_lab_build', 'gravity_lab'], ['b_reactor_plant_build', 'reactor_plant'],
  ];

  interface FxSheet { file: string; frameWidth: number; frameHeight: number; frames: number }

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const view = $<HTMLDivElement>('view');
  const rand = (a: number, b: number) => a + Math.random() * (b - a);
  /** Direction (of `steps`) of a grid vector, as the sim's facing(): 0 along +gx, counter-clockwise from above. */
  const facing = (dgx: number, dgy: number, steps: number) => ((Math.round(Math.atan2(-dgy, dgx) / ((2 * Math.PI) / steps)) % steps) + steps) % steps;

  /** A burning-spot look: flames at a roof spot (or none for the particle baseline) and the smoke above it. */
  interface FireTest { title: string; note: string; make: (s: FxScene, x: number, y: number) => void }
  interface BlastTest { title: string; note: string; blast: (s: FxScene, x: number, y: number, size: number) => void }
  interface SmokeTest { title: string; note: string; make: (s: FxScene, x: number, y: number) => void }

  class FxScene extends Phaser.Scene {
    sheets: Record<string, FxSheet> = {};
    private damages: BuildingDamage[] = [];
    private effects: Effects[] = [];
    /** The shelled buildings: their own animations (a radar dish, steam) keep running. */
    private targets: ConstructionView[] = [];
    private labels = $<HTMLDivElement>('labels');
    private marks: { x: number; y: number; el: HTMLDivElement }[] = [];
    private zoomLevel = 1.4;

    constructor() {
      super('fx');
    }

    preload(): void {
      this.load.setPath('/');
      this.load.image(TERRAIN.earth.key, TERRAIN.earth.file);
      this.load.atlas(ATLAS, `assets/sprites/${ATLAS}.png`, `assets/sprites/${ATLAS}.json`);
      this.load.json('atlas_meta', `assets/sprites/${ATLAS}.json`);
      loadFxSheets(this); // the game's own fire and smoke (the 'Now' tests use them)
      this.load.atlas(SHOOTER, `assets/sprites/${SHOOTER}.png`, `assets/sprites/${SHOOTER}.json`);
      this.load.json('shooter_meta', `assets/sprites/${SHOOTER}.json`);
      for (const [a] of SHELL_TARGETS) {
        this.load.atlas(a, `assets/sprites/${a}.png`, `assets/sprites/${a}.json`);
        this.load.json(`${a}_meta`, `assets/sprites/${a}.json`);
        // a building whose running animation (or door) is a generated video has it in an atlas of its own, as in the game
        if (hasVideo(a)) {
          this.load.atlas(`${a}_video`, `assets/sprites/${a}_video.png`, `assets/sprites/${a}_video.json`);
          this.load.json(`${a}_video_meta`, `assets/sprites/${a}_video.json`);
        }
      }
      this.load.json('fx_index', 'assets/fx/fx.json');
      this.load.once('filecomplete-json-fx_index', (_k: string, _t: string, data: Record<string, FxSheet>) => {
        this.sheets = data;
        for (const [name, sh] of Object.entries(data)) {
          this.load.spritesheet(name, `assets/fx/${sh.file}`, { frameWidth: sh.frameWidth, frameHeight: sh.frameHeight });
        }
      });
    }

    create(): void {
      const src = this.textures.get(TERRAIN.earth.key).getSourceImage() as HTMLImageElement;
      for (let y = -2 * TERRAIN_COPY_PX; y < 10 * TERRAIN_COPY_PX; y += TERRAIN_COPY_PX) {
        for (let x = -10 * TERRAIN_COPY_PX; x < 10 * TERRAIN_COPY_PX; x += TERRAIN_COPY_PX) {
          this.add.image(x, y, TERRAIN.earth.key).setOrigin(0, 0).setScale(TERRAIN_COPY_PX / src.width).setDepth(DEPTH.ground);
        }
      }
      const frame = this.textures.getFrame(ATLAS, `${ATLAS}_stage_1`);
      const raw = (this.cache.json.get('atlas_meta') as { meta: Partial<SpriteMeta> }).meta;
      sprites[ATLAS] = { anchor: { x: 0, y: 0 }, ...raw, w: frame.width, h: frame.height };
      for (const [a] of SHELL_TARGETS) {
        const f = this.textures.getFrame(a, `${a}_stage_1`);
        const r = (this.cache.json.get(`${a}_meta`) as { meta: Partial<SpriteMeta> }).meta;
        sprites[a] = { anchor: { x: 0, y: 0 }, ...r, w: f.width, h: f.height };
        if (hasVideo(a)) {
          const vm = (this.cache.json.get(`${a}_video_meta`) as { meta: Partial<SpriteMeta> }).meta;
          sprites[`${a}_video`] = { anchor: { x: 0, y: 0 }, ...vm, w: f.width, h: f.height };
        }
      }
      // flipbook animations: flames loop at 30 fps; smoke is stretched over a puff's life; explosions play once
      for (const [name, sh] of Object.entries(this.sheets)) {
        const frames = this.anims.generateFrameNumbers(name, { start: 0, end: sh.frames - 1 });
        const smoke = name.includes('smoke') || name.includes('cloud');
        const blast = name.startsWith('explosion');
        this.anims.create({ key: name, frames, frameRate: smoke ? sh.frames / 3.2 : blast ? 30 : 30, repeat: blast ? 0 : -1 });
      }
      const shadows = new ShadowLayer(this, { width: MAP, height: MAP } as GameMap);
      const anchor = sprites[ATLAS].anchor;
      const spots = (sprites[ATLAS].damage?.spots ?? []).slice();
      const fireSpots = [...spots].sort((a, b) => ((a[0] * 7 + a[1] * 13) % 11) - ((b[0] * 7 + b[1] * 13) % 11)).slice(0, 3);
      const smokeSpots = fireSpots.slice(0, 2);

      let id = 0;
      const building = (x: number, y: number) => {
        const v = new ConstructionView(this, ATLAS, x, y, 0, { layer: shadows, id: id++ });
        v.showStage(v.stages.length - 1);
        return v;
      };
      const at = (x: number, y: number, [fx, fy]: [number, number]) => ({ x: x + fx - anchor.x, y: y + fy - anchor.y });
      const rowTitle = (text: string, y: number) => this.mark(-2.1 * COL + 140, y - 260, `<span>${text}</span>`, 'row-title');

      // --- row 1: burning --------------------------------------------------------------------------------------
      const fires: FireTest[] = [
        { title: 'Now: in the game', note: 'your playground settings', make: () => {} },
        { title: 'Flame02 (glowing)', note: 'big flame flipbook, additive', make: (s, x, y) => { s.flames(x, y, 'flame02', 2, 0.42, true); s.smoke(x, y - 100, 'wispysmoke01', true); } },
        { title: 'Flame03 (painted)', note: 'normal blend: solid, no glow', make: (s, x, y) => { s.flames(x, y, 'flame03', 3, 0.7, false, 10); s.smoke(x, y - 80, 'wispysmoke01', true); } },
        { title: 'Flame02 + Cloud02', note: 'big flame, thick cloud smoke', make: (s, x, y) => { s.flames(x, y, 'flame02', 2, 0.42, true); s.smoke(x, y - 100, 'cloud02', true); } },
      ];
      let y = TOP;
      rowTitle('Burning', y);
      fires.forEach((t, i) => {
        const x = (i - (fires.length - 1) / 2) * COL;
        building(x, y);
        if (i === 0) {
          const d = new BuildingDamage(this, ATLAS, x, y, 0);
          d.setLevel(2);
          this.damages.push(d);
        } else {
          for (const sp of fireSpots) {
            const p = at(x, y, sp);
            t.make(this, p.x, p.y);
            this.embers(p.x, p.y);
          }
        }
        this.mark(x, y + 2 * TILE_H + 12, `${t.title}<small>${t.note}</small>`);
      });

      // --- row 2: smoking (damaged) ----------------------------------------------------------------------------
      const smokes: SmokeTest[] = [
        { title: 'Now: in the game', note: 'damaged smoke', make: () => {} },
        { title: 'WispySmoke01', note: 'thin wisps', make: (s, x, y) => s.smoke(x, y, 'wispysmoke01', false) },
        { title: 'Cloud02', note: 'billowing cloud', make: (s, x, y) => s.smoke(x, y, 'cloud02', false) },
      ];
      y += ROW;
      rowTitle('Smoking', y);
      smokes.forEach((t, i) => {
        const x = (i - 1) * COL;
        building(x, y);
        if (i === 0) {
          const d = new BuildingDamage(this, ATLAS, x, y, 0);
          d.setLevel(1);
          this.damages.push(d);
        } else {
          for (const sp of smokeSpots) {
            const p = at(x, y, sp);
            t.make(this, p.x, p.y);
          }
        }
        this.mark(x, y + 2 * TILE_H + 12, `${t.title}<small>${t.note}</small>`);
      });

      // --- row 3: explosions -------------------------------------------------------------------------------------
      const blasts: BlastTest[] = [
        { title: 'Now: in the game', note: 'particle explosions', blast: () => {} },
        { title: 'Explosion01', note: 'fireball and smoke', blast: (s, x, py, size) => s.blast(x, py, 'explosion01', size) },
        { title: 'Explosion02', note: 'darker, more smoke', blast: (s, x, py, size) => s.blast(x, py, 'explosion02', size) },
        { title: 'Explosion01 + flash', note: 'with the bright flash and embers', blast: (s, x, py, size) => { s.flash(x, py, size); s.blast(x, py, 'explosion01', size); s.embers(x, py, true); } },
      ];
      y += ROW;
      rowTitle('Destroyed', y);
      blasts.forEach((t, i) => {
        const x = (i - 1.5) * COL;
        const v = building(x, y);
        const d = i === 0 ? new BuildingDamage(this, ATLAS, x, y, 0) : null;
        if (d) this.damages.push(d);
        const centre = spots.length ? spots[Math.floor(spots.length / 2)] : [anchor.x, anchor.y - 60] as [number, number];
        const go = () => {
          if (d) {
            d.collapse(v);
          } else {
            const c = at(x, y, centre);
            t.blast(this, c.x, c.y, 1.4);
            const spread = [...spots].sort(() => Math.random() - 0.5);
            for (let b = 1; b < DESTRUCTION.blasts; b++) {
              const p = at(x, y, spread[b % Math.max(1, spread.length)] ?? centre);
              this.time.delayedCall(b * DESTRUCTION.blastGapMs, () => t.blast(this, p.x, p.y, rand(0.85, 1.15)));
            }
            this.time.delayedCall(60, () => v.showStage(-1));
          }
          this.time.delayedCall(BACK_AFTER, () => v.showStage(v.stages.length - 1));
        };
        this.time.delayedCall(800 + i * 150, go);
        this.time.addEvent({ delay: BLAST_EVERY, startAt: 0, loop: true, callback: go });
        this.mark(x, y + 2 * TILE_H + 12, `${t.title}<small>${t.note}</small>`);
      });

      this.shellHits(shadows, () => id++);
      this.fitCamera();
      this.scale.on('resize', () => this.fitCamera());
      this.bindControls();
    }

    // --- shell hits: a Jackal shelled from off to the left, in each impact look -------------------------------------

    private shellHits(shadows: ShadowLayer, nextId: () => number): void {
      const y = TOP - ROW;
      this.mark(-((IMPACT_STYLES.length - 1) / 2 + 0.6) * COL + 140, y - 260, '<span>Shell hits</span>', 'row-title');
      const m = (this.cache.json.get('shooter_meta') as { meta: SpriteMeta }).meta;
      const k = 1 / (m.res ?? 1);
      const tl = m.turret_layer;
      const titles: Record<ImpactStyle, [string, string]> = {
        painted: ['Painted (in the game)', 'painted puffs, embers, debris'],
        shockwave: ['Shockwave', 'pop, dust ring, sparks'],
        plasma: ['Plasma', 'cyan core, ground ring, arcs'],
        ion: ['Ion arc', 'lightning over the target'],
        gravity: ['Gravity collapse', 'pulls in, then pops'],
        railgun: ['Railgun', 'white-hot star, spikes, slag'],
      };
      IMPACT_STYLES.forEach((style, i) => {
        const x = (i - (IMPACT_STYLES.length - 1) / 2) * COL;
        const [atlas, type] = SHELL_TARGETS[i % SHELL_TARGETS.length];
        const size = footprint(type);
        const v = new ConstructionView(this, atlas, x, y, 0, { layer: shadows, id: nextId() });
        v.showStage(v.stages.length - 1);
        this.targets.push(v);
        const fx = new Effects(this);
        fx.impactStyle = style;
        this.effects.push(fx);
        // the Jackal, off its front-left corner: hull one way, turret aimed at the building's centre
        const off = { gx: -(size / 2 + 2), gy: size / 2 + 1.2 };
        const at = iso(off.gx, off.gy);
        const jx = x + at.x, jy = y + at.y;
        const n = tl?.directions ?? 32;
        const aim = facing(-off.gx, -off.gy, n);
        const hullDir = (Math.round((aim * 16) / n) + 3) % 16;
        const anchor = (sp: Phaser.GameObjects.Sprite) => sp.setOrigin(m.anchor.x / sp.frame.realWidth, m.anchor.y / sp.frame.realHeight).setScale(k);
        anchor(this.add.sprite(jx, jy, SHOOTER, `${SHOOTER}_h${hullDir}`)).setDepth(0.5);
        const pv = tl?.pivot[hullDir] ?? { x: 0, y: 0 };
        anchor(this.add.sprite(jx + pv.x * k, jy + pv.y * k, SHOOTER, `${SHOOTER}_t${aim}`)).setDepth(0.502);
        const mz = tl?.muzzle[aim] ?? { x: 0, y: -40 };
        const muzzle = { x: jx + (pv.x + mz.x) * k, y: jy + (pv.y + mz.y) * k };
        // the barrel's height on screen: its tip is `reach` out along the aim and this far up
        const ang = (aim * 2 * Math.PI) / n;
        const d = iso(Math.cos(ang), -Math.sin(ang));
        const dl = Math.hypot(d.x, d.y);
        const rise = Math.abs(d.x / dl) > 0.2 ? (mz.x / (d.x / dl)) * (d.y / dl) - mz.y : 40 / k;
        const height = Math.max(10, rise * k);
        let shots = 0;
        const shoot = () => {
          if (++shots % GROUND_EVERY === 0) {
            // short: on the ground in front of the building
            // falls short: straight from the barrel, dipping onto the ground under its line
            const p = alongBarrel(muzzle, aim, n, { x, y: y + rand(0.2, 0.4) * size * TILE_H });
            const g = { x: p.x, y: p.y + height };
            fx.shot('shell', muzzle, { x: g.x, y: g.y - 4 }, g, true, { depth: 0.3 });
          } else {
            // straight along the barrel, landing where that line crosses the building (nearer or deeper each time)
            const to = alongBarrel(muzzle, aim, n, { x, y: y - 40 * size + rand(-18, 18) });
            fx.shot('shell', muzzle, to, undefined, true, { depth: v.base.depth, targets: [v.base] });
          }
        };
        this.time.addEvent({ delay: SHELL_EVERY, startAt: i * 180, loop: true, callback: shoot });
        this.mark(x, y + (size * TILE_H) / 2 + 12, `${titles[style][0]}<small>${titles[style][1]} · ${type.replace(/_/g, ' ')}</small>`);
      });
    }

    // --- the flipbook effects --------------------------------------------------------------------------------------

    /** `n` looping flame sprites at a spot, each its own size, start frame and mirroring. */
    flames(x: number, y: number, key: string, n: number, scale: number, glow: boolean, spread = 8): void {
      const total = this.sheets[key].frames;
      for (let i = 0; i < n; i++) {
        const s = this.add.sprite(x + rand(-spread, spread), y + rand(-spread * 0.35, spread * 0.35), key)
          .setOrigin(0.5, 0.94).setScale(scale * rand(0.75, 1.15)).setFlipX(Math.random() < 0.5).setDepth(0.5 + i * 0.001);
        if (glow) s.setBlendMode(Phaser.BlendModes.ADD);
        s.play({ key, startFrame: Math.floor(Math.random() * total) });
      }
      const g = this.add.image(x, y, FX.dot).setTint(0xff6a1c).setBlendMode(Phaser.BlendModes.ADD).setDepth(0.45).setScale(1.2, 0.75).setAlpha(0.32);
      this.tweens.add({ targets: g, alpha: 0.2, duration: 120, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    /** Smoke puffs that each play the smoke flipbook as they rise and spread, drifting with the wind. Over a fire it
     *  starts at the flame tips and is drawn behind the flames, so it never covers them. */
    smoke(x: number, y: number, key: string, heavy: boolean): void {
      const peak = heavy ? 0.8 : 0.6;
      this.add.particles(x, y, key, {
        anim: key,
        lifespan: { min: 2800, max: 3600 },
        speedX: { min: DESTRUCTION.wind * 0.4, max: DESTRUCTION.wind * 1.6 },
        speedY: { min: -46, max: -26 },
        scale: { start: heavy ? 0.45 : 0.32, end: heavy ? 1.5 : 1.1 },
        // each puff fades in, then thins out
        alpha: { onUpdate: (_p: Phaser.GameObjects.Particles.Particle, _k: string, t: number) => (t < 0.15 ? (t / 0.15) * peak : peak * (1 - (t - 0.15) / 0.85)) },
        tint: heavy ? 0x4a4440 : 0x9a928a,
        rotate: { min: -20, max: 20 },
        frequency: heavy ? 260 : 380,
      }).setDepth(heavy ? 0.4 : 0.6);
    }

    embers(x: number, y: number, burst = false): void {
      const e = this.add.particles(x, y, FX.dot, {
        lifespan: { min: 900, max: 1700 },
        speedX: burst ? { min: -160, max: 160 } : { min: -18, max: 18 + DESTRUCTION.wind },
        speedY: burst ? { min: -220, max: -60 } : { min: -110, max: -40 },
        gravityY: burst ? 220 : 0,
        scale: { start: 0.07, end: 0.02 },
        alpha: { start: 1, end: 0 },
        color: [0xfff0a0, 0xff7a20, 0xa02008],
        blendMode: Phaser.BlendModes.ADD,
        frequency: 200,
        emitting: !burst,
      }).setDepth(0.55);
      if (burst) {
        e.explode(18);
        this.time.delayedCall(2000, () => e.destroy());
      }
    }

    /** One explosion flipbook, played once at a point and removed. */
    blast(x: number, y: number, key: string, size: number): void {
      const s = this.add.sprite(x, y, key).setScale(1.1 * size).setRotation(rand(-0.3, 0.3)).setFlipX(Math.random() < 0.5).setDepth(0.7);
      s.play(key);
      s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => s.destroy());
    }

    flash(x: number, y: number, size: number): void {
      const f = this.add.image(x, y, FX.dot).setTint(0xffd890).setBlendMode(Phaser.BlendModes.ADD).setDepth(0.71).setScale(1.7 * size).setAlpha(0.85);
      this.tweens.add({ targets: f, alpha: 0, scale: 2.6 * size, duration: 220, onComplete: () => f.destroy() });
    }

    // --- page --------------------------------------------------------------------------------------------------------

    override update(_t: number, deltaMs: number): void {
      for (const d of this.damages) d.update(deltaMs);
      for (const e of this.effects) e.update(deltaMs);
      for (const v of this.targets) v.update(deltaMs);
      const cam = this.cameras.main;
      for (const m of this.marks) {
        m.el.style.left = `${((m.x - cam.worldView.x) * cam.zoom) / DPR}px`;
        m.el.style.top = `${((m.y - cam.worldView.y) * cam.zoom) / DPR}px`;
      }
    }

    private mark(x: number, y: number, html: string, cls = 'label'): void {
      const el = document.createElement('div');
      el.className = cls;
      el.innerHTML = html;
      this.labels.append(el);
      this.marks.push({ x, y, el });
    }

    private fitCamera(): void {
      this.cameras.main.setZoom(CAMERA.startZoom * DPR * this.zoomLevel).centerOn(0, TOP - ROW + 20);
    }

    private bindControls(): void {
      let playing = true;
      $('play').onclick = () => {
        playing = !playing;
        $('play').textContent = playing ? 'Pause' : 'Play';
        if (playing) this.scene.resume();
        else this.scene.pause();
      };
      $<HTMLSelectElement>('zoom').onchange = (e) => {
        this.zoomLevel = +(e.target as HTMLSelectElement).value;
        this.fitCamera();
      };
      // drag to pan
      this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
        if (!p.isDown) return;
        const cam = this.cameras.main;
        cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
        cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
      });
    }
  }

  const size = () => ({ w: view.clientWidth, h: view.clientHeight });
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: view,
    backgroundColor: '#000000',
    scale: { mode: Phaser.Scale.NONE, width: size().w * DPR, height: size().h * DPR, zoom: 1 / DPR },
    render: { mipmapFilter: 'LINEAR_MIPMAP_LINEAR', roundPixels: true },
    scene: [FxScene],
  });
  const resize = new ResizeObserver(() => game.scale.resize(size().w * DPR, size().h * DPR));
  resize.observe(view);
  onLeave(() => { resize.disconnect(); game.destroy(true); });
  Object.assign(window as object, { game });
}
