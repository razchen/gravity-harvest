// Dev page (/dev/weapons.html): an armed unit firing at a target as the game draws its shots (render/Effects.ts
// `fire`), from its own guns, in its side's colour, on the game's ground at the game's zoom. Not part of the game build.
import Phaser from 'phaser';
import { UNITS, WEAPONS, type WeaponDef } from '@gravity-harvest/rules';
import { ROSTER } from '@gravity-harvest/sim/layout';
import { ATLASES, TERRAIN, anchorOrigin, sprites, type SpriteMeta } from '../assets/manifest';
import { CAMERA, DEPTH, DPR, HOVER, TILE_W } from '../config/game';
import { alongBarrel, facing, iso, type Point } from '../core/geometry';
import { SIDE_GLOW, UNIT_ART, unitArt } from '../data/art';
import { shotOf } from '../data/shots';
import { TEAMS } from '../data/teams';
import { Effects } from '../render/Effects';
import { FX, loadFxSheets } from '../render/fxTextures';
import { TERRAIN_COPY_PX } from '../world/Terrain';
import { onLeave } from './page';
import { BAR, BUTTON, CHECKBOX, LABEL, SELECT } from './ui';

export type Side = 'ordan' | 'sable';

/** What it shoots at: a tank (it flashes as it's hit), or a spot on open ground (scorched). */
const TARGET = 'v_ram';
/** Turning round: the target goes once round the shooter in this long (ms). */
const TURN_MS = 16000;
/** The zooms to look at it at, as in a match or closer. */
const ZOOMS: Record<string, number> = { far: 0.4, start: CAMERA.startZoom, closest: CAMERA.maxZoom, close: 1.2 };

/** The weapon a unit fires at things on the ground (the rules'), if it has one that does damage. */
function weaponOf(id: string): WeaponDef | undefined {
  return UNITS[id]?.weapons.map((w) => WEAPONS[w]).find((w) => w && w.damage > 0 && w.targeting !== 'air');
}

/** The units in matches that the game draws as vehicles (hovering or not) and that have a weapon. */
export const ARMED: string[] = ROSTER.units.filter((id) => UNIT_ART[id]?.kind === 'vehicle' && weaponOf(id));

/** Set up the page in the markup the sidebar has just put in (nav.ts): any armed unit, picked from a list. */
export default function mount(): void {
  const params = new URLSearchParams(location.search);
  const unit = ARMED.includes(params.get('u')!) ? params.get('u')! : 'lancer';
  mountWeaponView(document.getElementById('view')!, { unit, side: params.get('side') === 'sable' ? 'sable' : 'ordan', pickUnit: true });
}

export interface WeaponViewOptions {
  unit: string;
  /** The side it's drawn for, for a unit both sides build. */
  side?: Side;
  /** Offer every armed unit to pick from, keeping the address in step (the Weapons page). */
  pickUnit?: boolean;
}

/** `opts.unit` firing at a target, with its controls under it, in `host` (a flex column). */
export function mountWeaponView(host: HTMLElement, opts: WeaponViewOptions): void {
  const state = {
    unit: opts.unit,
    side: opts.side ?? 'ordan',
    target: 'tank' as 'tank' | 'ground',
    near: false,
    turn: false,
    zoom: 'start',
  };
  const both = (id: string) => UNITS[id].faction === 'both';
  const option = (value: string, label: string, on = false) => `<option value="${value}"${on ? ' selected' : ''}>${label}</option>`;
  host.innerHTML = `
    <div class="w-view relative min-h-[420px] flex-1"></div>
    <div class="${BAR} gap-x-3 gap-y-1.5">
      <button class="w-play ${BUTTON}">Pause</button>
      ${opts.pickUnit ? `<label class="${LABEL}">Unit <select class="w-unit ${SELECT}">${ARMED.map((id) => option(id, UNITS[id].name, id === state.unit)).join('')}</select></label>` : ''}
      ${opts.pickUnit || both(state.unit) ? `<label class="${LABEL}">Side <select class="w-side ${SELECT} disabled:opacity-50">${option('ordan', 'Ordan')}${option('sable', 'Sable')}</select></label>` : ''}
      <label class="${LABEL}">Target <select class="w-target ${SELECT}">${option('tank', 'a tank')}${option('ground', 'open ground')}</select></label>
      <label class="${LABEL}">Distance <select class="w-distance ${SELECT}">${option('range', 'its range')}${option('near', 'close')}</select></label>
      <label class="${LABEL}">Zoom <select class="w-zoom ${SELECT}">${option('far', 'far')}${option('start', 'game (start)', true)}${option('closest', 'game (closest)')}${option('close', 'close')}</select></label>
      <label class="${LABEL}"><input type="checkbox" class="w-turn ${CHECKBOX}"> Turn round</label>
      <span class="w-info text-muted"></span>
    </div>`;
  const q = <T extends HTMLElement>(c: string) => host.querySelector<T>(`.w-${c}`);
  const view = q<HTMLDivElement>('view')!;

  /** The side it's drawn for: the one picked for a unit both sides build, else its own. */
  const sideOf = (): Side => {
    const f = UNITS[state.unit].faction;
    return f === 'ordan' || f === 'sable' ? f : state.side;
  };
  const sideSel = q<HTMLSelectElement>('side');
  const showSide = () => {
    if (!sideSel) return;
    sideSel.value = sideOf();
    sideSel.disabled = !both(state.unit);
  };
  showSide();

  class WeaponsScene extends Phaser.Scene {
    private effects!: Effects;
    private shooter: { key: string; hull: Phaser.GameObjects.Sprite; turret: Phaser.GameObjects.Sprite | null; shadow: Phaser.GameObjects.Sprite | null; glow: Phaser.GameObjects.Image | null } | null = null;
    private target!: { hull: Phaser.GameObjects.Sprite; turret: Phaser.GameObjects.Sprite | null };
    private angle = Math.PI * 0.12;
    private nextShot = 0;
    private gun = 0;
    private dir = 0;
    private turretDir = 0;

    constructor() {
      super('weapons');
    }

    preload(): void {
      this.load.setPath('/');
      this.load.image(TERRAIN.earth.key, TERRAIN.earth.file);
      loadFxSheets(this);
      const keys = new Set([TARGET, ...ARMED.flatMap((id) => [unitArt(id, 'ordan')!.sprite, unitArt(id, 'sable')!.sprite])]);
      for (const a of ATLASES.filter((e) => keys.has(e.key))) {
        this.load.atlas(a.key, `assets/sprites/${a.file}.png`, `assets/sprites/${a.file}.json`);
        this.load.json(`${a.key}_meta`, `assets/sprites/${a.file}.json`);
      }
    }

    create(): void {
      for (const a of ATLASES.filter((e) => this.textures.exists(e.key))) {
        const frame = this.textures.getFrame(a.key, a.firstFrame);
        const raw = (this.cache.json.get(`${a.key}_meta`) as { meta: Partial<SpriteMeta> }).meta;
        sprites[a.key] = { anchor: { x: 0, y: 0 }, ...raw, w: frame.realWidth, h: frame.realHeight };
      }
      const src = this.textures.get(TERRAIN.earth.key).getSourceImage() as HTMLImageElement;
      for (let y = -6 * TERRAIN_COPY_PX; y < 6 * TERRAIN_COPY_PX; y += TERRAIN_COPY_PX) {
        for (let x = -6 * TERRAIN_COPY_PX; x < 6 * TERRAIN_COPY_PX; x += TERRAIN_COPY_PX) {
          this.add.image(x, y, TERRAIN.earth.key).setOrigin(0, 0).setScale(TERRAIN_COPY_PX / src.width).setDepth(DEPTH.ground);
        }
      }
      this.effects = new Effects(this);
      const tm = sprites[TARGET];
      const tint = TEAMS.enemy.tint!;
      this.target = {
        hull: this.add.sprite(0, 0, TARGET).setOrigin(...anchorOrigin(tm)).setScale(1 / (tm.res ?? 1)).setTint(tint),
        turret: tm.turret_layer ? this.add.sprite(0, 0, TARGET).setOrigin(...anchorOrigin(tm)).setScale(1 / (tm.res ?? 1)).setTint(tint) : null,
      };
      this.build();
      this.fitCamera();
      this.scale.on('resize', () => this.fitCamera());
      // drag to pan
      this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
        if (!p.isDown) return;
        const cam = this.cameras.main;
        cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
        cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
      });
    }

    /** The shooter's sprites, for the unit and side picked. */
    build(): void {
      const s = this.shooter;
      if (s) for (const o of [s.hull, s.turret, s.shadow, s.glow]) o?.destroy();
      const key = unitArt(state.unit, sideOf())!.sprite;
      const m = sprites[key];
      const layer = () => this.add.sprite(0, 0, key).setOrigin(...anchorOrigin(m)).setScale(1 / (m.res ?? 1));
      const hv = m.hover;
      this.shooter = {
        key,
        hull: layer(),
        turret: m.turret_layer ? layer() : null,
        shadow: hv ? layer() : null,
        glow: hv
          ? this.add.image(0, 0, FX.dot).setBlendMode(Phaser.BlendModes.ADD)
            .setTint(Phaser.Display.Color.GetColor(...hv.glow.map((c) => Math.round(255 * Math.min(1, c))) as [number, number, number]))
            .setDisplaySize(TILE_W * HOVER.glowTiles, TILE_W * HOVER.glowTiles * 0.5)
          : null,
      };
      this.gun = 0;
      this.nextShot = this.time.now + 400;
      const w = weaponOf(state.unit)!;
      const p = UNIT_ART[state.unit]?.fire ?? w.projectile;
      q('info')!.textContent = `${w.name}: ${p} · ${w.damage} damage every ${w.fireIntervalSec} s · range ${w.rangeTiles} tiles`;
    }

    /** How far away the target is (tiles): the weapon's range, or close. */
    private range(): number {
      return state.near ? Math.min(2.5, weaponOf(state.unit)!.rangeTiles) : weaponOf(state.unit)!.rangeTiles * 0.95;
    }

    fitCamera(): void {
      const cam = this.cameras.main;
      cam.setZoom(ZOOMS[state.zoom] * DPR);
      // the shooter and the target both in view (the shooter in the middle while the target goes round it)
      const t = iso(Math.cos(this.angle) * this.range(), Math.sin(this.angle) * this.range());
      cam.centerOn(state.turn ? 0 : t.x / 2, state.turn ? -30 : t.y / 2 - 30);
    }

    override update(time: number, delta: number): void {
      const s = this.shooter!;
      const m = sprites[s.key];
      if (state.turn) this.angle += (delta / TURN_MS) * Math.PI * 2;
      const r = this.range();
      const tg = { gx: Math.cos(this.angle) * r, gy: Math.sin(this.angle) * r };
      // the shooter faces the target, its turret (if it has one) aimed at it
      const n = m.directions ?? 16;
      this.dir = facing(tg.gx, tg.gy, n as 8 | 16);
      const tl = m.turret_layer;
      s.hull.setFrame(tl ? `${s.key}_h${this.dir}` : `${s.key}_${this.dir}`).setPosition(0, 0).setDepth(0);
      if (s.shadow && s.glow) {
        const b = Math.sin((time / HOVER.periodMs) * Math.PI * 2);
        s.hull.y -= (b + 1) * 0.5 * HOVER.bob;
        s.shadow.setFrame(`${s.key}_s${this.dir}`).setDepth(-0.002);
        s.glow.setDepth(-0.001).setAlpha(HOVER.glowMin + (HOVER.glowMax - HOVER.glowMin) * (1 - b) * 0.5);
      }
      if (s.turret && tl) {
        this.turretDir = facing(tg.gx, tg.gy, tl.directions as 8 | 16);
        const pv = tl.pivot[this.dir] ?? { x: 0, y: 0 };
        const k = 1 / (m.res ?? 1);
        s.turret.setFrame(`${s.key}_t${this.turretDir}`).setPosition(s.hull.x + pv.x * k, s.hull.y + pv.y * k).setDepth(0.002);
      }
      // the target faces the shooter
      const at = iso(tg.gx, tg.gy);
      const tm = sprites[TARGET];
      const back = facing(-tg.gx, -tg.gy, (tm.directions ?? 16) as 8 | 16);
      const showTank = state.target === 'tank';
      this.target.hull.setVisible(showTank).setPosition(at.x, at.y).setDepth(at.y)
        .setFrame(tm.turret_layer ? `${TARGET}_h${back}` : `${TARGET}_${back}`);
      if (this.target.turret && tm.turret_layer) {
        const pv = tm.turret_layer.pivot[back] ?? { x: 0, y: 0 };
        const k = 1 / (tm.res ?? 1);
        const t = Math.round((back * tm.turret_layer.directions) / (tm.directions ?? 16)) % tm.turret_layer.directions;
        this.target.turret.setVisible(showTank).setFrame(`${TARGET}_t${t}`).setPosition(at.x + pv.x * k, at.y + pv.y * k).setDepth(at.y + 0.002);
      }
      if (time >= this.nextShot) {
        const w = weaponOf(state.unit)!;
        this.nextShot = time + Math.max(500, w.fireIntervalSec * 1000);
        this.shoot(at);
      }
      this.effects.update(delta);
    }

    /** One shot at the target, as GameScene's `shot` event draws it. */
    private shoot(at: Point): void {
      const s = this.shooter!;
      const m = sprites[s.key];
      const k = 1 / (m.res ?? 1);
      const guns = (m.muzzles?.[this.dir] ?? []).map((g) => ({ x: s.hull.x + g.x * k, y: s.hull.y + g.y * k }));
      const tank = state.target === 'tank';
      let end = tank ? { x: at.x, y: at.y - 16 } : at;
      let start: Point = guns.length ? guns[this.gun++ % guns.length] : { x: s.hull.x, y: s.hull.y - 34 };
      const tl = m.turret_layer;
      if (s.turret && tl) {
        const mz = tl.muzzle[this.turretDir] ?? { x: 0, y: -34 * (m.res ?? 1) };
        start = { x: s.turret.x + mz.x * k, y: s.turret.y + mz.y * k };
        end = alongBarrel(start, this.turretDir, tl.directions, end);
      }
      const p = UNIT_ART[state.unit]?.fire ?? weaponOf(state.unit)!.projectile ?? undefined;
      const glow = shotOf(p).ownColour ? undefined : SIDE_GLOW[sideOf()];
      const hit = tank ? { depth: this.target.hull.depth, targets: [this.target.hull, ...(this.target.turret ? [this.target.turret] : [])] } : undefined;
      // as in a match: a unit's the target (the tank, or nothing on open ground), so the ground under it goes too
      const onGround = at;
      this.effects.fire(p, start, guns, end, onGround, true, hit, glow);
    }
  }

  const size = () => ({ w: view.clientWidth, h: view.clientHeight });
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: view,
    backgroundColor: '#000000',
    scale: { mode: Phaser.Scale.NONE, width: size().w * DPR, height: size().h * DPR, zoom: 1 / DPR },
    render: { mipmapFilter: 'LINEAR_MIPMAP_LINEAR', roundPixels: true },
    scene: [WeaponsScene],
  });
  const resize = new ResizeObserver(() => game.scale.resize(size().w * DPR, size().h * DPR));
  resize.observe(view);
  onLeave(() => { resize.disconnect(); game.destroy(true); });
  const scene = () => game.scene.getScene('weapons') as WeaponsScene | null;

  /** Keep what's picked in the address, so a reload (or a link) shows the same. */
  const remember = () => { if (opts.pickUnit) history.replaceState(null, '', `?u=${state.unit}&side=${state.side}`); };
  const unitSel = q<HTMLSelectElement>('unit');
  if (unitSel) unitSel.onchange = () => { state.unit = unitSel.value; showSide(); remember(); scene()?.build(); scene()?.fitCamera(); };
  if (sideSel) sideSel.onchange = () => { state.side = sideSel.value as Side; remember(); scene()?.build(); };
  q<HTMLSelectElement>('target')!.onchange = (e) => { state.target = (e.target as HTMLSelectElement).value as 'tank' | 'ground'; };
  q<HTMLSelectElement>('distance')!.onchange = (e) => { state.near = (e.target as HTMLSelectElement).value === 'near'; scene()?.fitCamera(); };
  q<HTMLSelectElement>('zoom')!.onchange = (e) => { state.zoom = (e.target as HTMLSelectElement).value; scene()?.fitCamera(); };
  q<HTMLInputElement>('turn')!.onchange = (e) => { state.turn = (e.target as HTMLInputElement).checked; scene()?.fitCamera(); };
  const play = q<HTMLButtonElement>('play')!;
  play.onclick = () => {
    const paused = game.scene.isPaused('weapons');
    if (paused) game.scene.resume('weapons');
    else game.scene.pause('weapons');
    play.textContent = paused ? 'Pause' : 'Play';
  };
}
