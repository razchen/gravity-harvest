// Dev page (/dev/building.html?b=<id>&mode=construction|destruction): a building going up stage by stage, or being
// damaged and destroyed, on the game's ground at the game's scale (?b=all: every building with stages, side by side).
// Its Animation tab also has units coming out of it and coming to it (traffic.ts).
// Not part of the game build.
import Phaser from 'phaser';
import { UNITS } from '@gravity-harvest/rules';
import { ATLASES, TERRAIN, sprites, type SpriteMeta } from '../assets/manifest';
import { CAMERA, DEPTH, DPR, TILE_H } from '../config/game';
import { diamond, iso, toGrid } from '../core/geometry';
import { CONSTRUCTION, ConstructionView } from '../render/Construction';
import { armsDepth } from '../entities/BuildingSprite';
import { BuildingDamage } from '../render/Destruction';
import { loadFxSheets } from '../render/fxTextures';
import type { GameMap } from '../world/GameMap';
import { ShadowLayer } from '../world/ShadowLayer';
import { TERRAIN_COPY_PX } from '../world/Terrain';
import { DEV_BUILDINGS } from './buildings';
import { statsHtml } from './details';
import { mountModel } from './model';
import { mountPicture } from './picture';
import { mountPictureViews } from './pictureView';
import { onLeave } from './page';
import { Traffic, tripAtlases, tripsFor, type Trip } from './traffic';
import { LINK, NONE, PIC, ROLE, TAGS, TAG_V, VIEW_LABEL, ground, tagSide } from './ui';

/** A stage or phase under the view: gold for the one showing, brighter for those already past; `button`: one to click. */
const chip = (state: 'now' | 'done' | '' = '', button = false) => `mt-1 rounded-full border px-2.5 py-0.5 text-[13px] ${
  button ? 'cursor-pointer font-medium hover:border-gold' : 'font-semibold'} ${
  state === 'now' ? 'border-gold bg-gold text-ink' : `border-line ${button ? 'bg-panel ' : ''}${state === 'done' ? 'text-text' : 'text-muted'}`}`;

/** Set up the page in the markup the sidebar has just put in (nav.ts). */
export default function mount(): void {
  type Mode = 'construction' | 'destruction' | 'turret' | 'model' | 'picture' | 'idle';
  const params = new URLSearchParams(location.search);
  const wanted = params.get('b') ?? '';
  const known = DEV_BUILDINGS.find((b) => b.id === wanted);
  const asked = params.get('mode');
  // the 3D model first (when there is one), unless another tab was asked for
  const mode: Mode = asked === 'destruction' ? 'destruction' : asked === 'turret' && known?.turret ? 'turret'
    : asked === 'construction' ? 'construction' : asked === 'picture' && known?.picture ? 'picture'
    : asked === 'idle' && known?.idle ? 'idle' : known?.model ? 'model' : 'construction';
  const BUILDINGS = DEV_BUILDINGS.filter((b) => b.construction && (wanted === 'all' || b.id === wanted))
    .map((b) => ({ id: b.id, atlas: b.construction!, label: b.name, footprint: b.footprint, video: !!b.video }));
  /** Animation: the units that come out of the building and come to it (none: no traffic controls). */
  const TRIPS: Trip[] = mode === 'idle' && known ? tripsFor(known.id) : [];
  /** Repeat: the next unit goes this long after the last one has gone (ms). */
  const REPEAT_MS = 2000;
  /** Gap between buildings, in tiles. */
  const GAP_TILES = 2;
  /** The buildings stand on a stand-in map this big (the shadow layer covers a map), along its middle row. */
  const MAP = 48;
  /** Construction: pause on the finished buildings before a loop starts again (seconds). */
  const HOLD_S = 2.5;
  /** Destruction: what happens when (seconds), then it starts again. */
  const PHASES = [
    { at: 0, name: 'Intact' },
    { at: 1.5, name: 'Damaged: smoking' },
    { at: 4.5, name: 'Badly damaged: burning' },
    { at: 8.5, name: 'Destroyed' },
  ];
  const DESTRUCTION_LOOP_S = 14;
  /** Turret: how far either side of its rest direction "scan" swings (degrees). */
  const SCAN_DEG = 70;
  const SCORCH = 'scorch_2';

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const view = $<HTMLDivElement>('view');

  interface Placed {
    x: number;
    y: number;
    size: number;
    label: HTMLDivElement;
    building: ConstructionView;
    damage: BuildingDamage;
    scorch: Phaser.GameObjects.Image;
  }

  class BuildingScene extends Phaser.Scene {
    private placed: Placed[] = [];
    private outline!: Phaser.GameObjects.Graphics;
    private t = 0;
    private playing = true;
    private phase = -1;
    /** Relative to the game's start zoom: 1 is how a match opens. */
    private zoomLevel = 1;
    /** Turret: where the heads point (degrees, counter-clockwise from world +X). */
    private aim = 0;
    /** Animation: units coming out of the first building and coming to it. */
    private traffic: Traffic | null = null;

    constructor() {
      super('building');
    }

    preload(): void {
      this.load.setPath('/');
      this.load.image(TERRAIN.earth.key, TERRAIN.earth.file);
      this.load.atlas('scenery', 'assets/sprites/scenery.png', 'assets/sprites/scenery.json');
      this.load.json('scenery_meta', 'assets/sprites/scenery.json');
      loadFxSheets(this);
      for (const b of BUILDINGS) {
        this.load.atlas(b.atlas, `assets/sprites/${b.atlas}.png`, `assets/sprites/${b.atlas}.json`);
        this.load.json(`${b.atlas}_meta`, `assets/sprites/${b.atlas}.json`);
        // its running animation as a generated video (as in matches)
        if (b.video) {
          this.load.atlas(`${b.atlas}_video`, `assets/sprites/${b.atlas}_video.png`, `assets/sprites/${b.atlas}_video.json`);
          this.load.json(`${b.atlas}_video_meta`, `assets/sprites/${b.atlas}_video.json`);
        }
      }
      // the units its traffic draws
      for (const a of ATLASES.filter((x) => tripAtlases(TRIPS).includes(x.key))) {
        this.load.atlas(a.key, `assets/sprites/${a.file}.png`, `assets/sprites/${a.file}.json`);
        this.load.json(`${a.key}_meta`, `assets/sprites/${a.file}.json`);
      }
    }

    create(): void {
      // ground copies like the game's (world/Terrain.ts), over a generous area
      const src = this.textures.get(TERRAIN.earth.key).getSourceImage() as HTMLImageElement;
      for (let y = -2 * TERRAIN_COPY_PX; y < 8 * TERRAIN_COPY_PX; y += TERRAIN_COPY_PX) {
        for (let x = -10 * TERRAIN_COPY_PX; x < 10 * TERRAIN_COPY_PX; x += TERRAIN_COPY_PX) {
          this.add.image(x, y, TERRAIN.earth.key).setOrigin(0, 0).setScale(TERRAIN_COPY_PX / src.width).setDepth(DEPTH.ground);
        }
      }
      this.outline = this.add.graphics().setDepth(DEPTH.debug).setVisible(false);
      const shadows = new ShadowLayer(this, { width: MAP, height: MAP } as GameMap);
      const scorchAnchor = (this.cache.json.get('scenery_meta') as { meta: SpriteMeta }).meta.anchors?.[SCORCH] ?? { x: 0, y: 0 };
      const scorchFrame = this.textures.getFrame('scenery', SCORCH);

      let gx = MAP / 2 - 10;
      const labels = $<HTMLDivElement>('labels');
      for (const b of BUILDINGS) {
        const frame = this.textures.getFrame(b.atlas, `${b.atlas}_stage_1`);
        const raw = (this.cache.json.get(`${b.atlas}_meta`) as { meta: Partial<SpriteMeta> }).meta;
        sprites[b.atlas] = { anchor: { x: 0, y: 0 }, ...raw, w: frame.width, h: frame.height };
        if (b.video) {
          const v = (this.cache.json.get(`${b.atlas}_video_meta`) as { meta: Partial<SpriteMeta> }).meta;
          sprites[`${b.atlas}_video`] = { anchor: { x: 0, y: 0 }, ...v, w: frame.width, h: frame.height };
        }
        // tiles (gx, MAP - gx) run straight right on screen: the buildings line up in a row
        const gy = MAP - gx - b.footprint;
        const p = iso(gx + b.footprint / 2, gy + b.footprint / 2);
        const building = new ConstructionView(this, b.atlas, p.x, p.y, 0, { layer: shadows, id: this.placed.length });
        // as in the game: a Service Bay's arms draw over a vehicle on its pad
        const lift = armsDepth({ type: b.id, tx: gx, ty: gy }, 0, p.y);
        if (lift !== null) building.liftMoving(lift);
        const damage = new BuildingDamage(this, b.atlas, p.x, p.y, 0);
        // the scorch mark a destroyed building leaves, at the size the game draws it (GameScene.burnMark)
        const scorch = this.add.image(p.x, p.y, 'scenery', SCORCH)
          .setOrigin(scorchAnchor.x / scorchFrame.width, scorchAnchor.y / scorchFrame.height)
          .setScale(b.footprint / 2).setDepth(DEPTH.groundDecal).setAlpha(0);
        this.outline.lineStyle(3, 0xf5b301, 0.9).strokePoints(diamond(gx, gy, b.footprint), true);
        const label = document.createElement('div');
        label.className = `${VIEW_LABEL} bg-[rgba(18,19,21,0.75)] [&>small]:ml-1.5 [&>small]:font-medium [&>small]:text-muted [&>small]:[font-size:smaller]`;
        label.innerHTML = `${b.label}<small>${b.footprint}×${b.footprint}</small>`;
        labels.append(label);
        this.placed.push({ x: p.x, y: p.y, size: b.footprint, label, building, damage, scorch });
        if (TRIPS.length && !this.traffic) this.traffic = new Traffic(this, { type: b.id, tx: gx, ty: gy, size: b.footprint }, building, MAP);
        gx += b.footprint + GAP_TILES;
      }
      // the units' meta, as BootScene records it (the full frame size: trimmed frames are drawn within it)
      for (const a of ATLASES.filter((x) => tripAtlases(TRIPS).includes(x.key))) {
        const frame = this.textures.getFrame(a.key, a.firstFrame);
        const raw = (this.cache.json.get(`${a.key}_meta`) as { meta: Partial<SpriteMeta> }).meta;
        sprites[a.key] = { anchor: { x: 0, y: 0 }, ...raw, w: frame.realWidth, h: frame.realHeight };
      }
      this.bindTraffic();
      this.fitCamera();
      this.scale.on('resize', () => this.fitCamera());
      this.bindControls();
      if (mode === 'destruction') this.toPhase(0);
      if (mode === 'turret' || mode === 'idle') this.restart();
      for (const id of ['powered', 'working', 'dooropen']) $<HTMLInputElement>(id).onchange = () => this.applyIdle();
      // Door open only for a building with a door animation (its sprites' or its video's)
      $('dooropen').closest('label')!.hidden = mode !== 'idle' || !this.placed.some((p) => p.building.hasDoor);
      this.renderChips();
    }

    private fitCamera(): void {
      const cam = this.cameras.main;
      const first = this.placed[0];
      const last = this.placed[this.placed.length - 1];
      cam.setZoom(CAMERA.startZoom * DPR * this.zoomLevel).centerOn((first.x + last.x) / 2, (first.y + last.y) / 2 - TILE_H);
    }

    override update(_time: number, deltaMs: number): void {
      if (mode === 'construction') this.updateConstruction(deltaMs);
      else if (mode === 'destruction') this.updateDestruction(deltaMs);
      else if (mode === 'idle') {
        if (this.playing) this.t += deltaMs / 1000;
        this.updateTraffic(this.playing ? deltaMs : 0);
        for (const p of this.placed) {
          // a defence's head sweeps round slowly (its Turret tab has more ways to turn it)
          const t = p.building.turret;
          if (t) p.building.face(t.rest + (this.t / 8) * t.directions);
          p.building.update(this.playing ? deltaMs : 0);
        }
      }
      else this.updateTurret(deltaMs);
      // labels under each building, in CSS px
      const cam = this.cameras.main;
      for (const s of this.placed) {
        const below = s.y + (s.size / 2) * TILE_H + 10;
        s.label.style.left = `${((s.x - cam.worldView.x) * cam.zoom) / DPR}px`;
        s.label.style.top = `${((below - cam.worldView.y) * cam.zoom) / DPR}px`;
      }
    }

    // --- construction -------------------------------------------------------------------------------------------

    private updateConstruction(deltaMs: number): void {
      const speed = +$<HTMLSelectElement>('speed').value;
      const total = +$<HTMLSelectElement>('time').value;
      if (this.playing) {
        this.t += (deltaMs / 1000) * speed;
        if (this.t > total + HOLD_S) {
          if ($<HTMLInputElement>('loop').checked) this.restart();
          else this.t = total + HOLD_S;
        }
      }
      const progress = Math.min(1, this.t / total);
      for (const p of this.placed) {
        p.building.setProgress(progress);
        p.building.update(deltaMs * (this.playing ? speed : 1));
      }
      $<HTMLInputElement>('scrub').value = String(Math.round(progress * 1000));
      $('pct').textContent = `${Math.round(progress * 100)}%`;
      this.renderChips();
    }

    /** Jump to a progress without replaying effects (scrubbing), or to a stage's start with them (stepping). */
    private seek(progress: number, animate: boolean): void {
      const total = +$<HTMLSelectElement>('time').value;
      this.t = progress * total;
      for (const p of this.placed) {
        if (!animate) p.building.setProgress(-1, false);
        p.building.setProgress(progress, animate);
      }
    }

    private stepStage(dir: 1 | -1): void {
      const th = CONSTRUCTION.thresholds;
      const total = +$<HTMLSelectElement>('time').value;
      const now = Math.min(1, this.t / total);
      const current = th.filter((x) => now >= x - 1e-6).length - 1;
      const target = Phaser.Math.Clamp(current + dir, 0, th.length - 1);
      this.setPlaying(false);
      if (dir < 0) this.seek(th[target], false);
      else {
        this.seek(th[target] - 1e-4, false);
        this.seek(th[target] + 1e-4, true);
      }
    }

    // --- turret -------------------------------------------------------------------------------------------------

    private restAngle(p: Placed): number {
      const t = p.building.turret;
      return t ? (t.rest * 360) / t.directions : 0;
    }

    private updateTurret(deltaMs: number): void {
      const how = $<HTMLSelectElement>('turn').value;
      const speed = +$<HTMLSelectElement>('turnspeed').value;
      if (this.playing) {
        this.t += deltaMs / 1000;
        if (how === 'sweep') this.aim += (speed * deltaMs) / 1000;
      }
      const pointer = this.input.activePointer;
      for (const p of this.placed) {
        let deg = this.aim;
        if (how === 'scan') deg = this.restAngle(p) + SCAN_DEG * Math.sin((this.t * speed) / SCAN_DEG);
        else if (how === 'mouse') {
          const at = toGrid(pointer.worldX, pointer.worldY);
          const me = toGrid(p.x, p.y);
          deg = (Math.atan2(-(at.gy - me.gy), at.gx - me.gx) * 180) / Math.PI;
        }
        const n = p.building.turret?.directions ?? 16;
        p.building.face((deg / 360) * n);
        p.building.update(deltaMs);
      }
      this.renderChips();
    }

    /** Turret: turn one direction step and hold there. */
    private stepTurn(dir: 1 | -1): void {
      this.setPlaying(false);
      $<HTMLSelectElement>('turn').value = 'sweep';
      const n = this.placed[0]?.building.turret?.directions ?? 16;
      this.aim = Math.round(this.aim / (360 / n) + dir) * (360 / n);
    }

    // --- animation ----------------------------------------------------------------------------------------------

    /** Powered, Working and Door open as ticked; a unit coming out or docking opens the door, and repairing works. */
    private applyIdle(): void {
      const t = this.traffic;
      for (const p of this.placed) {
        p.building.setIdle($<HTMLInputElement>('powered').checked);
        p.building.setWorking($<HTMLInputElement>('working').checked || !!t?.working);
        p.building.setDoor($<HTMLInputElement>('dooropen').checked || !!t?.doorOpen);
      }
    }

    private updateTraffic(deltaMs: number): void {
      const t = this.traffic;
      if (!t) return;
      const was = [t.doorOpen, t.working];
      t.update(deltaMs);
      if (!t.busy && $<HTMLInputElement>('repeat').checked && t.idleMs >= REPEAT_MS) this.sendTrip();
      if (t.doorOpen !== was[0] || t.working !== was[1]) this.applyIdle();
    }

    /** Send the unit picked in the list. */
    private sendTrip(): void {
      const trip = TRIPS[+$<HTMLSelectElement>('tripunit').value];
      if (trip) this.traffic?.send(trip);
      this.applyIdle();
    }

    /** The traffic row: units that come out under "Coming out", the rest under "Coming to it". */
    private bindTraffic(): void {
      $('traffic').hidden = !this.traffic;
      if (!this.traffic) return;
      // a Service Bay works only while a vehicle is on its pad, as in matches: its visitor sets it going, not the box
      if (TRIPS.some((t) => t.kind === 'service')) $<HTMLInputElement>('working').checked = false;
      const group = (label: string, out: boolean) => {
        const options = TRIPS.map((t, i) => ({ t, i })).filter(({ t }) => (t.kind === 'out') === out)
          .map(({ t, i }) => `<option value="${i}">${UNITS[t.unit]?.name ?? t.unit}</option>`).join('');
        return options ? `<optgroup label="${label}">${options}</optgroup>` : '';
      };
      const list = $<HTMLSelectElement>('tripunit');
      list.innerHTML = group('Coming out', true) + group('Coming to it', false);
      list.onchange = () => this.sendTrip();
      $('send').onclick = () => this.sendTrip();
    }

    // --- destruction --------------------------------------------------------------------------------------------

    private updateDestruction(deltaMs: number): void {
      if (this.playing) {
        this.t += deltaMs / 1000;
        if (this.t > DESTRUCTION_LOOP_S) {
          if ($<HTMLInputElement>('loop').checked) this.toPhase(0);
          else this.t = DESTRUCTION_LOOP_S;
        }
        const due = PHASES.filter((p) => this.t >= p.at).length - 1;
        if (due > this.phase) this.applyPhase(due);
      }
      for (const p of this.placed) {
        p.damage.update(deltaMs);
        p.building.update(deltaMs);
      }
    }

    /** Jump straight to a phase (from intact), and carry on from there. */
    private toPhase(i: number): void {
      this.t = PHASES[i].at;
      this.applyPhase(0);
      if (i > 0) this.applyPhase(i);
    }

    private applyPhase(i: number): void {
      this.phase = i;
      for (const p of this.placed) {
        if (i === 0) {
          p.damage.clear();
          p.building.showStage(p.building.stages.length - 1);
          this.tweens.killTweensOf(p.scorch);
          p.scorch.setAlpha(0);
        } else if (i === 1 || i === 2) {
          p.damage.setLevel(i);
        } else {
          p.damage.collapse(p.building, () => this.tweens.add({ targets: p.scorch, alpha: 0.9, duration: 250 }));
        }
      }
      this.renderChips();
    }

    // --- controls -----------------------------------------------------------------------------------------------

    private setPlaying(on: boolean): void {
      this.playing = on;
      $('play').textContent = on ? 'Pause' : 'Play';
      // destruction effects run on the scene clock: pausing freezes them mid-air
      if (mode === 'destruction') {
        this.time.paused = !on;
        this.tweens.timeScale = on ? 1 : 0;
        for (const e of this.children.list) {
          if (e instanceof Phaser.GameObjects.Particles.ParticleEmitter) {
            if (on) e.resume();
            else e.pause();
          }
        }
      }
    }

    private restart(): void {
      if (mode === 'idle') {
        for (const p of this.placed) p.building.showStage(p.building.stages.length - 1);
        if (this.traffic) this.sendTrip();
        this.applyIdle();
        return;
      }
      if (mode === 'turret') {
        this.t = 0;
        this.aim = this.placed[0] ? this.restAngle(this.placed[0]) : 0;
        for (const p of this.placed) p.building.showStage(p.building.stages.length - 1);
        return;
      }
      if (mode === 'destruction') {
        this.toPhase(0);
        return;
      }
      this.t = 0;
      for (const p of this.placed) p.building.setProgress(-1, false);
    }

    private bindControls(): void {
      const toggle = () => this.setPlaying(!this.playing);
      $('play').onclick = toggle;
      $('restart').onclick = () => this.restart();
      $('prev').onclick = () => this.stepStage(-1);
      $('next').onclick = () => this.stepStage(1);
      const scrub = $<HTMLInputElement>('scrub');
      scrub.oninput = () => {
        this.setPlaying(false);
        this.seek(+scrub.value / 1000, false);
      };
      $<HTMLOptionElement>('zoommax').value = String(CAMERA.maxZoom / CAMERA.startZoom); // the game's closest zoom
      $<HTMLSelectElement>('zoom').onchange = (e) => {
        this.zoomLevel = +(e.target as HTMLSelectElement).value;
        this.fitCamera();
      };
      $<HTMLInputElement>('footprint').onchange = (e) => this.outline.setVisible((e.target as HTMLInputElement).checked);
      $('chips').onclick = (e) => {
        const i = (e.target as HTMLElement).closest<HTMLElement>('[data-phase]')?.dataset.phase;
        if (i === undefined) return;
        this.setPlaying(true);
        this.toPhase(+i);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return;
        if (e.key === ' ') { e.preventDefault(); toggle(); }
        else if (e.key === 'r') this.restart();
        else if (mode === 'construction' && e.key === 'ArrowRight') this.stepStage(1);
        else if (mode === 'construction' && e.key === 'ArrowLeft') this.stepStage(-1);
        else if (mode === 'turret' && e.key === 'ArrowRight') this.stepTurn(-1);
        else if (mode === 'turret' && e.key === 'ArrowLeft') this.stepTurn(1);
        else if (mode === 'destruction' && /^[1-4]$/.test(e.key)) { this.setPlaying(true); this.toPhase(+e.key - 1); }
      };
      window.addEventListener('keydown', onKey);
      onLeave(() => window.removeEventListener('keydown', onKey));
    }

    private renderChips(): void {
      const box = $('chips');
      let html: string;
      if (mode === 'construction') {
        const first = this.placed[0]?.building;
        const now = first?.stageIndex ?? -1;
        html = (first?.stages ?? []).map((s, i) => {
          return `<span class="${chip(i === now ? 'now' : i < now ? 'done' : '')}">${Math.round(CONSTRUCTION.thresholds[i] * 100)}% · ${s.name}</span>`;
        }).join('');
      } else if (mode === 'turret') {
        const b = this.placed[0]?.building;
        const n = b?.turret?.directions ?? 16;
        const d = ((Math.round((this.aim / 360) * n) % n) + n) % n;
        const how = $<HTMLSelectElement>('turn').value;
        html = b?.turret
          ? `<span class="${chip('now')}">${n} directions</span><span class="${chip()}">${how === 'sweep' ? `facing ${d} · ${Math.round((d * 360) / n)}°` : how === 'scan' ? 'scanning' : 'following the mouse'}</span><span class="${chip()}">← → turn one step</span>`
          : `<span class="${chip()}">This atlas has no turret frames yet</span>`;
      } else {
        html = PHASES.map((p, i) => {
          const state = i === this.phase ? 'now' : i < this.phase ? 'done' : '';
          return `<button class="${chip(state, true)}" data-phase="${i}" title="Jump here (${i + 1})">${i + 1} · ${p.name}</button>`;
        }).join('');
      }
      if (box.innerHTML !== html) box.innerHTML = html;
    }
  }

  // page chrome: title, tabs, which controls show
  const name = wanted === 'all' ? 'All buildings' : known?.name ?? 'Unknown building';
  const title = { construction: 'Construction', destruction: 'Destruction', turret: 'Turret', model: '3D model', picture: 'Picture', idle: 'Animation' }[mode];
  $('title').textContent = `${name}: ${title.toLowerCase()}`;
  document.title = `${wanted === 'all' ? 'Buildings' : known?.name ?? 'Unknown'} ${title}`;
  $('blurb').textContent = {
    construction: 'Assembling itself from its parts, on the game\'s ground, at the game\'s scale and zoom.',
    destruction: 'Smoking when damaged, burning when badly damaged, then blown up, leaving a scorch mark. Click a phase to jump to it.',
    turret: 'Its head turning on its base, through every direction it\'s rendered in. Sweep it round, scan it side to side, or have it follow the mouse.',
    model: 'The source model the sprites are rendered from. Drag to orbit, scroll to zoom. It loads only here, and is let go when you leave.',
    picture: 'The finished building as rendered from its model (the high-resolution preview), on the game\'s ground.',
    idle: `The finished building running, as in the game: what moves and its effects. Working shows it busy (producing, repairing, building); Door open opens its door. Without power it stops.${TRIPS.length ? ' Pick a unit to watch it come out of the building or come to it (docking, being repaired), moved as in matches; Repeat sends it again.' : ''}`,
  }[mode];
  if (known) {
    const power = `${known.power > 0 ? '+' : ''}${known.power} power`;
    $('about').innerHTML = `${known.description} <span>· $${known.cost.toLocaleString('en')} · ${power} · ${+known.buildTimeSec.toFixed(1)} s to build${known.needs.length ? ` · needs ${known.needs.join(', ')}` : ''}</span>`;
  }
  for (const a of $('tabs').querySelectorAll<HTMLAnchorElement>('a')) {
    a.href = `?b=${encodeURIComponent(wanted)}&mode=${a.dataset.mode}`;
    a.classList.toggle('on', a.dataset.mode === mode);
    if (a.dataset.mode === 'turret') a.hidden = !known?.turret;
    if (a.dataset.mode === 'model') a.hidden = !known?.model;
    if (a.dataset.mode === 'picture') a.hidden = !known?.picture;
    if (a.dataset.mode === 'idle') a.hidden = !known?.idle;
  }
  for (const el of document.querySelectorAll<HTMLElement>('footer [data-mode]')) el.hidden = !el.dataset.mode!.split(' ').includes(mode);

  const size = () => ({ w: view.clientWidth, h: view.clientHeight });
  if (mode === 'picture' && known?.picture) {
    document.querySelector('footer')!.hidden = true;
    view.classList.add('flex', 'flex-col', ...ground(128).split(' '));
    mountPictureViews(view, known.picture.file, known.picture.frame, known.preview);
  } else if (mode === 'model' && known?.model) {
    document.querySelector('footer')!.hidden = true;
    view.classList.add('flex', 'flex-col', '[&>model-viewer]:min-h-[320px]');
    void mountModel(view, [{ name: known.name, file: known.model }]);
  } else if (BUILDINGS.length) {
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: view,
      backgroundColor: '#000000',
      scale: { mode: Phaser.Scale.NONE, width: size().w * DPR, height: size().h * DPR, zoom: 1 / DPR },
      render: { mipmapFilter: 'LINEAR_MIPMAP_LINEAR', roundPixels: true },
      scene: [BuildingScene],
    });
    const resize = new ResizeObserver(() => game.scale.resize(size().w * DPR, size().h * DPR));
    resize.observe(view);
    onLeave(() => { resize.disconnect(); game.destroy(true); });
    // console debugging
    Object.assign(window as object, { game });
  } else {
    showInfo();
  }

  /** A building without stages yet: its picture (if any), what it does, its numbers and where its art stands. */
  function showInfo(): void {
    view.hidden = true;
    document.querySelector('footer')!.hidden = true;
    $('tabs').hidden = true;
    $('about').hidden = true;
    const info = $('info');
    info.hidden = false;
    if (!known) {
      $('title').textContent = 'Unknown building';
      $('blurb').textContent = '';
      info.innerHTML = `<p class="my-[1em]">No building with that id. <a class="${LINK}" href="./">See all buildings</a></p>`;
      return;
    }
    $('title').textContent = known.name;
    document.title = known.name;
    $('blurb').textContent = '';
    const side = known.faction === 'both' ? 'Shared' : known.faction === 'ordan' ? 'Ordan' : 'Sable';
    info.innerHTML = `
      <div class="pic ${PIC} aspect-[16/10] w-[min(520px,100%)] rounded-[8px] border border-line ${ground(256)}">${known.picture ? '' : `<span class="${NONE} text-white/80">No art yet</span>`}</div>
      <div class="grid min-w-[260px] max-w-[560px] flex-1 gap-2.5 [&>dl]:text-[16px]">
        <div class="${TAGS}"><span class="${TAG_V}">V${known.milestone}</span><span class="${tagSide(known.faction)}">${side}</span>${known.role ? `<span class="${ROLE}">${known.role}</span>` : ''}<span class="${ROLE}">${known.footprint}×${known.footprint} tiles</span></div>
        <p class="text-[18px]">${known.description}</p>
        ${statsHtml(known)}
        <p class="italic text-muted">${known.note} No construction stages yet: they need a Tripo parts model.</p>
      </div>`;
    if (known.picture) {
      mountPicture(info.querySelector<HTMLElement>('.pic')!, known.picture.file, known.picture.frame, known.preview)
        .catch(() => { info.querySelector('.pic')!.textContent = 'picture missing'; });
    }
  }
}
