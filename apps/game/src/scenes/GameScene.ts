import Phaser from 'phaser';
import type { BuildingView, Difficulty, MatchEvent, MatchHello, PlayableFaction, PowerView, QueueItemView, TeamId, TeamView } from '@gravity-harvest/shared';
import type { MusicStats } from '../audio/Music';
import { Sounds, type LoopWanted } from '../audio/Sounds';
import { DEPTH } from '../config/game';
import { BUILDING_ART, SIDE_GLOW, UNIT_ART, factionOf } from '../data/art';
import { EventBus, emptyStats, type GameEvents, type MatchStats } from '../core/EventBus';
import { diamond, iso, toGrid, type GridPoint } from '../core/geometry';
import { BuildingSprite } from '../entities/BuildingSprite';
import { HarvesterSprite, InfantrySprite, VehicleSprite, canBoard, createUnitSprite, fallDead, type UnitSprite } from '../entities/UnitSprite';
import { isBuilding, type Entity } from '../entities/types';
import { meta } from '../assets/manifest';
import { CameraController } from '../input/CameraController';
import { ControlGroups } from '../input/ControlGroups';
import { InputController, leadType } from '../input/InputController';
import { Selection } from '../input/Selection';
import { MatchClient } from '../net/MatchClient';
import { Boarding } from '../render/Boarding';
import { DebugOverlay } from '../render/DebugOverlay';
import { Effects } from '../render/Effects';
import { STRIKES_GROUND } from '../render/shots';
import { Overlays } from '../render/Overlays';
import { buildBlocker, setCatalog, trainResult, type BuyResult } from '../systems/availability';
import { Placement } from '../systems/Placement';
import type { DevInfoSection, GroupView, HudBridge, MinimapSnapshot, SelectedUnit } from '../ui/HudBridge';
import { FogOfWar } from '../world/FogOfWar';
import { GameMap } from '../world/GameMap';
import { OreLayer } from '../world/OreLayer';
import { SceneryLayer, hashId } from '../world/SceneryLayer';
import { ShadowLayer } from '../world/ShadowLayer';
import { drawTerrain } from '../world/Terrain';
import { DevInfoCollector, FrameTimes } from './devInfo';

export interface SceneData {
  /** A new match on this scenario, or resume a save. */
  scenario?: string;
  saveId?: string;
  /** A new match: the side you play, and how well the computer plays. */
  faction?: PlayableFaction;
  difficulty?: Difficulty;
  /** Write the autosave slot if the connection closes mid-match. */
  autosaveOnLeave: boolean;
}


/**
 * The sound of a shot: by what the weapon fires (the rules' projectile), and for bullets by what fires them: a soldier's
 * rifle (the Operator's pistol), or a vehicle's or a defence's autocannon (the Skimmer, the Carrier, the Sentry). The
 * first of them the game has, so a newer sound falls back to an older one until it's picked.
 */
function fireSounds(projectile: string | undefined, from: unknown): string[] {
  // the units' own looks (render/shots), by what they fire
  if (projectile === 'rapid autocannon' || projectile === 'heavy autocannon') return ['autocannon_fire'];
  if (projectile === 'light shell' || projectile === 'battle shell') return ['cannon_fire'];
  if (projectile === 'artillery shell') return ['artillery_fire'];
  if (projectile === 'twin plasma') return ['plasma_fire', 'discharge_fire'];
  if (projectile === 'frag grenade') return ['grenade_throw'];
  if (projectile === 'light column') return ['column_fire', 'discharge_fire'];
  if (projectile === 'arc bolt') return ['discharge_fire'];
  if (projectile === 'ballistic shell') return ['artillery_fire'];
  if (projectile === 'shell') return ['cannon_fire'];
  if (projectile === 'fireball') return ['flame_fire'];
  if (projectile === 'flame') return ['flamethrower_fire', 'flame_fire'];
  if (projectile === 'instant discharge') return ['discharge_fire'];
  if (projectile === 'plasma') return ['plasma_fire', 'discharge_fire'];
  if (projectile === 'laser') return ['laser_fire', 'discharge_fire'];
  if (projectile === 'column') return ['column_fire', 'discharge_fire'];
  if (projectile === 'guided missile') return ['rocket_launch'];
  if (projectile === 'heavy missile') return ['heavy_missile_launch', 'rocket_launch'];
  if (projectile === 'lobbed grenade') return ['grenade_throw'];
  if (projectile === 'beam') return ['heal_beam'];
  if (projectile === 'repair') return ['self_repair', 'building_place'];
  if (projectile === 'leap') return ['hound_strike'];
  if (from instanceof InfantrySprite) return from.type === 'operator' ? ['sidearm_fire', 'rifle_fire'] : ['rifle_fire'];
  // the hovering units' light guns
  if (from instanceof VehicleSprite && meta(from.key).hover) return ['rifle_fire'];
  return ['autocannon_fire'];
}

/** Soldiers whose death sets off what they carry (the rules: "explodes violently when killed"). */
const VOLATILE = new Set(['grenadier', 'breaker']);

/** A unit of ours this close to one of our buildings (tiles) is in the base: hit there, it's the base under attack. */
const BASE_RADIUS = 8;
/** Messages that refuse something (from the server or the game): they sound the error. */
const REFUSAL = /^(Need \$|Not enough|Unit cap reached|Production queue is full|Build an? .+ first|Needs an Assembly Yard|Already building|Can't|.+ isn't damaged|Not damaged|No room inside|Too far from your base|Blocked|A unit is in the way|The (ramp|pad) needs|Fog of war can only|Fast mode only)/;
/** Messages that refuse for want of money: the announcer says so. */
const MONEY = /^(Need \$|Not enough money)/;
/** Messages that warn of an attack: they sound the alarm. */
const WARNING = /^Enemy raid/;

/**
 * One match, drawn. The server runs it (packages/sim): this scene sends orders through `net` and draws the
 * views it receives. It implements the HUD bridge from the latest view.
 */
export class GameScene extends Phaser.Scene implements HudBridge {
  readonly bus = new EventBus<GameEvents>();
  net!: MatchClient;
  hello: MatchHello | null = null;
  /** The latest view from the server. */
  view: TeamView | null = null;
  map!: GameMap;
  ore!: OreLayer;
  scenery!: SceneryLayer;
  shadows!: ShadowLayer;
  fog!: FogOfWar;
  buildings = new Map<number, BuildingSprite>();
  /** Buildings that left the view this update, held until its events say whether they were destroyed (explode) or not (fade). */
  private gone = new Map<number, BuildingSprite>();
  /** Soldiers that left the view this update, so the ones that died can fall where they stood. */
  private droppedInfantry = new Map<number, { type: string; dir: number; team: TeamId }>();
  units = new Map<number, UnitSprite>();
  selection = new Selection();
  /** Control groups (Ctrl+number saves, the number selects): client side only, new for every match. */
  readonly groups = new ControlGroups();
  effects!: Effects;
  sounds!: Sounds;
  /** Units of ours that left the view this update (one that died: "unit lost"). */
  private readonly ownGone = new Set<number>();
  placement!: Placement;
  debug!: DebugOverlay;
  private overlays!: Overlays;
  private boarding!: Boarding;
  private camera!: CameraController;
  private scorch!: Phaser.GameObjects.Graphics;
  private over = false;
  private revealed = false;
  /** Debug fast mode (T): how much faster your side builds, produces and moves. */
  private fastFactor = 1;
  private stats: MatchStats = emptyStats();
  /** Recent frame times, and the Dev info panel's reader (I). */
  readonly frames = new FrameTimes();
  private readonly devInfoCollector = new DevInfoCollector(this);
  /** The music's state, for the Dev info panel (set by GameFlow, which owns the music). */
  musicStats: (() => MusicStats) | null = null;

  constructor() {
    super('game');
  }

  get ready(): boolean {
    return this.view !== null;
  }

  get isOver(): boolean {
    return this.over;
  }

  /** The side you're playing (from the server). */
  get faction(): PlayableFaction | null {
    return this.hello?.faction ?? null;
  }

  /** How well the computer opponent plays (from the server; a save keeps its own). */
  get difficulty(): Difficulty | null {
    return this.hello?.difficulty ?? null;
  }

  get scenarioId(): string {
    return this.hello?.scenario ?? '';
  }

  create(data: SceneData): void {
    this.hello = null;
    this.view = null;
    this.over = false;
    this.revealed = false;
    this.buildings = new Map();
    this.gone = new Map();
    this.units = new Map();
    this.selection = new Selection();
    this.groups.clear();
    this.stats = emptyStats();
    this.net = new MatchClient({
      hello: (h) => this.onHello(h),
      view: (v) => this.onView(v),
      gameOver: (result, stats) => this.onGameOver(result, stats),
      failed: (msg) => this.game.events.emit('match-failed', msg),
      error: (msg) => this.bus.emit('toast', msg),
    });
    const net = this.net;
    this.events.once('shutdown', () => net.close());
    net.start({ ...(data.saveId ? { saveId: data.saveId } : { scenario: data.scenario, ...(data.faction && { faction: data.faction }), ...(data.difficulty && { difficulty: data.difficulty }) }), autosaveOnLeave: data.autosaveOnLeave });
  }

  /** The server accepted the match: build the static world. Views follow. */
  private onHello(h: MatchHello): void {
    this.hello = h;
    setCatalog(h.catalog);
    this.map = new GameMap(h.map.width, h.map.height);
    this.ore = new OreLayer(this, this.map);
    this.ore.setTiles(h.ore.tiles);
    drawTerrain(this, this.map, this.ore);
    for (const r of h.ore.rocks) this.ore.addRock(r);
    this.ore.scarEmptyTiles();
    this.shadows = new ShadowLayer(this, this.map);
    this.scenery = new SceneryLayer(this, this.map, this.shadows);
    this.scenery.add(h.scenery);
    this.fog = new FogOfWar(this, this.map);
    this.scorch = this.add.graphics().setDepth(DEPTH.scorch);
    this.effects = new Effects(this);
    this.sounds = new Sounds(this);
    this.sounds.side = h.faction === 'sable' ? 'sable_' : '';
    this.effects.onImpact = (kind, at) => this.sounds.play(kind === 'bullet' || kind === 'plasma' || kind === 'laser' ? 'bullet_hit' : 'shell_hit', at);
    this.placement = new Placement(this);
    this.debug = new DebugOverlay(this, this.map, (m) => this.bus.emit('toast', m));
    this.overlays = new Overlays(this);
    this.boarding = new Boarding(this);
    this.camera = new CameraController(this, h.camera, h.map);
    new InputController(this);
  }

  private onView(v: TeamView): void {
    if (!this.hello) return;
    const first = !this.view;
    const now = this.time.now;
    if (this.view && v.power.low !== this.view.power.low) {
      this.sounds.play(v.power.low ? 'power_down' : 'power_up');
      this.sounds.announce(v.power.low ? 'announce_low_power' : 'announce_power_restored');
    }
    this.view = v;
    this.stats = v.stats;
    if (v.fog) this.fog.apply(v.fog);
    this.syncBuildings(v.buildings);
    const seen = new Set<number>();
    for (const u of v.units) {
      seen.add(u.id);
      const s = this.units.get(u.id);
      // ours, hit in the base: under attack (it says so now and then, not every shot; a fight out in the field isn't)
      if (s && u.team === 'player' && u.hp < s.hp && this.inBase(u.gx, u.gy)) this.sounds.announce('announce_base_attack', 'under_attack');
      if (s) s.apply(u, now);
      else this.units.set(u.id, createUnitSprite(this, u, now));
    }
    this.ownGone.clear();
    for (const [id, s] of this.units) {
      if (seen.has(id)) continue;
      if (s.team === 'player') this.ownGone.add(id);
      this.dropUnit(s); // died, or went out of sight
    }
    for (const e of v.events) this.onEvent(e);
    this.droppedInfantry.clear();
    // the rest were sold or went out of sight
    for (const s of this.gone.values()) s.dispose();
    this.gone.clear();
    if (first) this.game.events.emit('world-ready', this);
  }

  /** Within BASE_RADIUS tiles of one of our buildings. */
  private inBase(gx: number, gy: number): boolean {
    for (const b of this.buildings.values()) {
      if (b.team !== 'player') continue;
      const dx = Math.max(b.tx - gx, 0, gx - (b.tx + b.size));
      const dy = Math.max(b.ty - gy, 0, gy - (b.ty + b.size));
      if (Math.hypot(dx, dy) <= BASE_RADIUS) return true;
    }
    return false;
  }

  private syncBuildings(list: BuildingView[]): void {
    const seen = new Set<number>();
    for (const b of list) {
      seen.add(b.id);
      const s = this.buildings.get(b.id);
      if (s) {
        // ours, hit: the base is under attack (it says so now and then, not every shot)
        if (b.team === 'player' && b.hp < s.hp && this.view) this.sounds.announce('announce_base_attack', 'under_attack');
        s.apply(b);
      } else {
        const nb = new BuildingSprite(this, b);
        // ours, just placed: it starts going up
        if (b.team === 'player' && !b.built && b.progress < 0.05 && this.view) this.sounds.play('building_place', iso(nb.gx, nb.gy));
        this.buildings.set(b.id, nb);
        this.scenery.hideDecorIn(b.tx, b.ty, b.size);
        this.ore.resort(this.map.addOccluder(nb));
      }
    }
    for (const [id, s] of this.buildings) {
      if (seen.has(id)) continue;
      this.buildings.delete(id);
      this.map.removeOccluder(s, [...this.buildings.values()]);
      this.gone.set(id, s);
    }
  }

  private dropUnit(s: UnitSprite): void {
    if (s instanceof InfantrySprite) this.droppedInfantry.set(s.id, { type: s.type, dir: s.dir, team: s.team });
    this.units.delete(s.id);
    this.selection.remove(s);
    s.destroy();
  }

  private onEvent(e: MatchEvent): void {
    switch (e.e) {
      case 'shot': {
        const from = this.units.get(e.from) ?? this.buildings.get(e.from);
        if (!from) return;
        const to = this.units.get(e.to) ?? this.buildings.get(e.to);
        let start = iso(from.gx, from.gy);
        start.y -= 20;
        if (from instanceof InfantrySprite || from instanceof BuildingSprite || from instanceof VehicleSprite) start = from.muzzle();
        const ground = to && isBuilding(to) ? undefined : iso(e.at.gx, e.at.gy);
        // a shell or fireball bursts just in front of what it hits, which flashes
        const hit = to ? { depth: to.sprite.depth, targets: isBuilding(to) ? [to.sprite] : to.hitParts() } : undefined;
        let end = this.aimPoint(to, e.at);
        // a turret's shot leaves its barrel and flies straight along it
        if (from instanceof VehicleSprite) ({ from: start, to: end } = from.fireLine(end));
        // how the shot looks and sounds: the unit's own (UNIT_ART `fire`), else the rules' projectile
        const p = (!isBuilding(from) && UNIT_ART[from.type]?.fire) || e.p;
        // in its side's colour (a heal in its own green); energy balls and lasers from each of its guns at once
        const glow = isBuilding(from) ? undefined : p === 'beam' ? undefined : SIDE_GLOW[factionOf(from.team, this.faction)];
        // an Engineer welds where its arm meets the building: most of the way from it to the building, off the ground
        if (p === 'repair' && to) {
          const c = isBuilding(to) ? { x: to.sprite.x, y: to.sprite.y } : iso(to.gx, to.gy);
          end = { x: start.x + (c.x - start.x) * 0.45, y: start.y + (c.y - start.y) * 0.45 - 6 };
        }
        // a column of light, a grenade or an artillery shell comes down on the ground under it (a building's centre)
        const onGround = p && STRIKES_GROUND.has(p) ? ground ?? (to ? { x: to.sprite.x, y: to.sprite.y } : undefined) : ground;
        const guns = from instanceof VehicleSprite ? from.guns() : [];
        this.effects.fire(p, start, guns, end, onGround, !(from instanceof HarvesterSprite), hit, glow);
        const fire = fireSounds(p, from);
        this.sounds.play(fire.find((s) => this.sounds.has(s)) ?? fire[0], start);
        return;
      }
      case 'unitDied': {
        // a soldier we saw falls (one we never saw is only heard); anything else blows up
        const soldier = this.droppedInfantry.get(e.id);
        const p = iso(e.gx, e.gy);
        const infantry = soldier || UNIT_ART[e.type]?.kind === 'infantry';
        this.groups.forget(e.id);
        if (this.ownGone.has(e.id)) this.sounds.announce('announce_unit_lost');
        this.sounds.play(VOLATILE.has(e.type) && this.sounds.has('infantry_explode') ? 'infantry_explode' : infantry ? 'infantry_death' : 'vehicle_explode', p);
        if (soldier) return fallDead(this, soldier.type, e.gx, e.gy, soldier.dir, soldier.team);
        if (infantry) return;
        this.effects.explode(p.x, p.y - 10, e.type === 'harvester' ? 2 : 0.8);
        // a burnt-out harvester leaves an oil stain (cosmetic, not saved)
        if (e.type === 'harvester') this.scenery.stamp(`oil_${1 + (hashId(e.id) % 2)}`, e.gx, e.gy, 1, { tx: Math.floor(e.gx), ty: Math.floor(e.gy), size: 1 }, e.id);
        return;
      }
      case 'buildingDestroyed': {
        // sold (a building still going up was cancelled: its money back, no sale to hear), or destroyed
        const cancelled = e.sold && this.gone.get(e.id)?.built === false;
        if (!cancelled) this.sounds.play(e.sold ? 'building_sold' : 'building_explode', iso(e.tx + e.size / 2, e.ty + e.size / 2));
        if (!e.sold && e.team === 'player') this.sounds.announce('announce_building_lost');
        if (e.sold) return;
        // it blows up (render/Destruction.ts); one we never saw gets a plain explosion
        const s = this.gone.get(e.id);
        if (s) {
          this.gone.delete(e.id);
          s.explode();
        } else {
          const c = iso(e.tx + e.size / 2, e.ty + e.size / 2);
          this.effects.explode(c.x, c.y - 30 * e.size, e.size * 1.4);
        }
        if (!this.burnMark(e)) this.scorch.fillStyle(0x1b1712, 0.75).fillPoints(diamond(e.tx, e.ty, e.size), true);
        return;
      }
      case 'rockGone':
        return this.ore.removeRock(e.id);
      case 'rockAdded':
        this.scenery.hideDecorIn(e.rock.tx, e.rock.ty, 1, 'ore');
        return this.ore.addRock(e.rock);
      case 'oreTile':
        this.ore.addTile(e.tile);
        return;
      case 'door': {
        const b = this.buildings.get(e.refinery);
        b?.door(e.open);
        // (silent: the bay opening and closing for every load was only noise)
        return;
      }
      case 'unitOut': {
        const b = this.buildings.get(e.building);
        b?.unitOut(this.units.get(e.unit));
        if (b && BUILDING_ART[b.type]?.door) this.sounds.play('door', iso(b.gx, b.gy));
        return;
      }
      case 'hatch': {
        const t = this.units.get(e.unit);
        if (t instanceof VehicleSprite) t.hatch(e.open);
        return;
      }
      case 'boarded': {
        // he's gone from the view: drawn running up the ramp instead
        const t = this.units.get(e.transport);
        if (t instanceof VehicleSprite) this.boarding.board(e, t, this.droppedInfantry.get(e.unit)?.team ?? t.team);
        return;
      }
      case 'disembarked': {
        const t = this.units.get(e.transport);
        if (t instanceof VehicleSprite) this.units.get(e.unit)?.downRamp(t, e.side);
        return;
      }
      case 'unloaded': {
        const ref = this.buildings.get(e.refinery);
        if (ref) this.effects.floatText(ref.gx, ref.gy, `+${Math.round(e.credits).toLocaleString('en-US')}`);
        this.sounds.play('credits');
        return;
      }
      case 'toast':
        this.bus.emit('toast', e.text);
        return;
      case 'buildingDone': {
        const b = this.buildings.get(e.id);
        if (b) this.sounds.play('building_done', iso(b.gx, b.gy));
        this.sounds.announce('announce_construction_complete');
        return;
      }
      case 'unitReady':
        this.sounds.announce('announce_unit_ready', 'unit_ready');
        return;
    }
  }

  /**
   * Where a building burnt down: a scorch mark the size of its footprint, and for a big one sometimes a crater
   * (cosmetic, not saved; variants picked from its id). False if the atlas has no decals (the caller draws a plain one).
   */
  private burnMark(e: Extract<MatchEvent, { e: 'buildingDestroyed' }>): boolean {
    const h = hashId(e.id);
    const gx = e.tx + e.size / 2;
    const gy = e.ty + e.size / 2;
    const area = { tx: e.tx, ty: e.ty, size: e.size };
    if (!this.scenery.stamp(`scorch_${1 + (h % 4)}`, gx, gy, e.size / 2, area, e.id)) return false;
    if (e.size >= 3 && (h >>> 4) % 3 !== 0) this.scenery.stamp(`crater_${1 + ((h >>> 8) % 4)}`, gx, gy, e.size / 3, area, e.id + 1);
    return true;
  }

  private aimPoint(t: Entity | undefined, at: GridPoint) {
    if (t && isBuilding(t)) return { x: t.sprite.x, y: t.sprite.y - 40 * t.size };
    const p = iso(t ? t.gx : at.gx, t ? t.gy : at.gy);
    return { x: p.x, y: p.y - (t instanceof HarvesterSprite ? 30 : 16) };
  }

  private onGameOver(result: 'victory' | 'defeat', stats: MatchStats): void {
    this.over = true;
    this.stats = stats;
    this.selection.clear();
    this.placement?.cancel();
    this.sounds.announce(`announce_${result}`);
    this.bus.emit('gameOver', { result, stats });
  }

  get fogRevealed(): boolean {
    return this.revealed;
  }

  /** Debug commands exist on this server (dev and tests only). */
  get debugAvailable(): boolean {
    return !!this.hello?.debug;
  }

  zoomBy(factor: number): void {
    this.camera?.zoomBy(factor);
  }

  resetZoom(): void {
    this.camera?.resetZoom();
  }

  get zoomLevel(): number {
    return this.camera?.zoomLevel ?? 1;
  }

  toggleGrid(): void {
    this.debug?.toggle();
  }

  get gridOn(): boolean {
    return this.debug?.on ?? false;
  }

  /** Debug (F): reveal the whole map, if the server allows debug commands. */
  toggleFog(): void {
    if (!this.hello?.debug) return void this.bus.emit('toast', 'Fog of war can only be turned off on a dev server');
    this.revealed = !this.revealed;
    this.net.debug({ d: 'reveal', on: this.revealed });
    this.bus.emit('toast', this.revealed ? 'Fog of war off (F)' : 'Fog of war on');
  }

  get fastMode(): number {
    return this.fastFactor;
  }

  /** Debug (T): cycle fast mode for your side (normal, 5x, 10x), if the server allows debug commands. */
  cycleFast(): void {
    if (!this.hello?.debug) return void this.bus.emit('toast', 'Fast mode only works on a dev server');
    const steps = [1, 5, 10];
    this.fastFactor = steps[(steps.indexOf(this.fastFactor) + 1) % steps.length];
    this.net.debug({ d: 'fast', factor: this.fastFactor });
    this.bus.emit('toast', this.fastFactor === 1 ? 'Fast mode off' : `Fast mode: building, production and movement ${this.fastFactor}× (T)`);
  }

  // --- Frame update --------------------------------------------------------------------------

  override update(_time: number, delta: number): void {
    this.frames.add(performance.now(), delta);
    if (!this.view || !this.hello) return;
    const dt = Math.min(delta, 100) / 1000;
    if (this.camera.update(dt) && this.placement.active) {
      const p = this.input.activePointer;
      p.updateWorldPoint(this.cameras.main);
      this.placement.update(p.worldX, p.worldY);
    }
    const now = this.time.now;
    for (const u of this.units.values()) u.tick(now, this.hello.viewMs);
    for (const b of this.buildings.values()) b.tick(delta);
    this.effects.update(delta);
    this.boarding.update(delta);
    this.overlays.draw();
    this.sounds.loops(this.loopsWanted());
  }

  /**
   * The sounds that run while something goes on: the ambience and buildings going up. Harvesters at work, vehicles
   * driving and busy Service Bays stay quiet: they go on all match long, so their loops were constant background noise
   * (the units' acknowledgements and the economy's credits are heard instead).
   */
  private loopsWanted(): LoopWanted[] {
    const out: LoopWanted[] = [{ key: 'ambience', slot: 'ambience' }];
    const c = this.cameras.main.worldView;
    const near = <T extends { sprite: { x: number; y: number } }>(list: T[], n: number) =>
      list.map((t) => ({ t, d: Math.hypot(t.sprite.x - c.centerX, t.sprite.y - c.centerY) })).sort((a, b) => a.d - b.d).slice(0, n).map((x) => x.t);
    for (const b of near([...this.buildings.values()].filter((b) => !b.built), 2)) {
      out.push({ key: `build${b.id}`, slot: 'construction', at: b.sprite, volume: 0.9 });
    }
    return out;
  }

  get gameTimeMs(): number {
    return this.view?.timeMs ?? 0;
  }

  /** A message is shown (the HUD's toast): a refusal sounds the error, a raid warning the alarm. */
  toastSound(text: string): void {
    if (MONEY.test(text)) this.sounds.announce('announce_insufficient_funds', 'ui_error');
    else if (REFUSAL.test(text)) this.sounds.play('ui_error');
    else if (WARNING.test(text)) this.sounds.announce('announce_base_attack', 'under_attack');
  }

  /** End-screen tallies from the server. */
  matchStats(): MatchStats {
    return { ...this.stats };
  }

  /** The camera's centre as a grid point (new units come out of the producer nearest to it). */
  cameraCentre(): GridPoint {
    const v = this.cameras.main.worldView;
    return toGrid(v.centerX, v.centerY);
  }

  // --- HudBridge -------------------------------------------------------------------------------

  credits(): number {
    return this.view?.credits ?? 0;
  }

  power(): PowerView {
    return this.view?.power ?? { made: 0, used: 0, low: false };
  }

  population(): { units: number; cap: number } {
    // passengers count too (they're off the map, inside their transports)
    const mine = [...this.units.values()].filter((u) => u.team === 'player');
    return { units: mine.reduce((n, u) => n + 1 + u.passengers, 0), cap: this.view?.unitCap ?? 0 };
  }

  queue(): QueueItemView[] {
    return this.view?.queue ?? [];
  }

  /** Finished building types the human owns (for prerequisites). */
  ownedTypes(): string[] {
    return [...this.buildings.values()].filter((b) => b.team === 'player' && b.built).map((b) => b.type);
  }

  placingType(): string | null {
    return this.placement?.type ?? null;
  }

  startPlacement(type: string): 'ok' | 'poor' | string {
    const blocked = buildBlocker(type, [...this.buildings.values()].filter((b) => b.team === 'player'));
    if (blocked) return blocked;
    this.selection.clear();
    this.setMode(null);
    return this.placement.start(type);
  }

  /** Sell or repair mode (the HUD's buttons): the next clicks on your buildings sell or repair them. */
  private actionMode: 'sell' | 'repair' | null = null;

  get mode(): 'sell' | 'repair' | null {
    return this.actionMode;
  }

  setMode(mode: 'sell' | 'repair' | null): void {
    if (mode === this.actionMode) return;
    this.actionMode = mode;
    if (mode) {
      this.placement.cancel();
      this.selection.clear();
    }
    this.bus.emit('mode', mode);
  }

  /** Sell mode: sell a finished building (half its price back) or cancel one under construction (all of it back). */
  sellOrCancel(b: BuildingSprite): void {
    if (b.team !== 'player' || !b.alive) return;
    this.net.command(b.built ? { c: 'sell', building: b.id } : { c: 'cancelBuild', building: b.id });
  }

  /** E: selected Assemblers unpack into Assembly Yards where they stand. */
  deploySelected(): void {
    const assemblers = [...this.selection].filter((u) => u.type === 'assembler');
    if (!assemblers.length) return;
    for (const u of assemblers) this.net.command({ c: 'deploy', unit: u.id });
  }

  /** Your transports in the selection with someone inside. */
  private loadedTransports(): UnitSprite[] {
    return [...this.selection].filter((u) => u.team === 'player' && u.passengers > 0);
  }

  /** A transport with passengers is selected (the HUD shows Unload). */
  canUnload(): boolean {
    return this.loadedTransports().length > 0;
  }

  /** Unload (E, or the HUD's button): the selected transports stop and let their passengers out. */
  unloadSelected(): void {
    for (const t of this.loadedTransports()) this.net.command({ c: 'unload', transport: t.id });
  }

  /** The selected soldiers get into your transport `t` (those it has no room for stop by it). */
  boardSelected(t: UnitSprite): void {
    const soldiers = [...this.selection].filter((u) => canBoard(u) && u.team === 'player');
    if (!soldiers.length) return;
    if (t.passengers >= t.seats) return void this.bus.emit('toast', 'No room inside');
    this.net.command({ c: 'board', units: soldiers.map((u) => u.id), transport: t.id });
    this.effects.moveMarker(Math.floor(t.gx), Math.floor(t.gy));
  }

  /** Repair mode: start repairing a damaged building, or stop. */
  toggleRepair(b: BuildingSprite): void {
    if (b.team !== 'player' || !b.alive || !b.built) return;
    if (!b.repairing && b.hp >= b.maxHp) return void this.bus.emit('toast', 'Not damaged');
    this.net.command({ c: 'repair', building: b.id, on: !b.repairing });
  }

  buyUnit(type: string): BuyResult {
    const r = trainResult(type, this.credits(), this.ownedTypes(), this.population(), this.queue());
    if (r === 'ok') this.net.command({ c: 'train', unit: type, near: this.cameraCentre() });
    return r;
  }

  cancelUnit(type: string): void {
    this.net.command({ c: 'cancelTrain', unit: type });
  }

  /** The selected units answer, in the voice of the most of them (as when you click or box-select them). */
  ackSelection(): void {
    if (this.selection.size) this.sounds.answer([`ack_${leadType(this.selection)}_select`]);
  }

  get selectionVersion(): number {
    return this.selection.version;
  }

  selected(): SelectedUnit[] {
    return [...this.selection].map((u) => ({
      id: u.id, type: u.type, team: u.team, hp: u.hp, maxHp: u.maxHp,
      ...(u instanceof HarvesterSprite && { cargo: { load: u.cargo, capacity: u.capacity, activity: u.activity } }),
      ...(u.seats > 0 && { seats: { used: u.passengers, total: u.seats } }),
    }));
  }

  selectType(type: string, drop: boolean): void {
    const of = [...this.selection].filter((u) => u.type === type);
    if (drop) return of.forEach((u) => this.selection.remove(u));
    this.selection.set(of);
    this.ackSelection();
  }

  /** Group `n`'s units on the map now (not the dead, nor passengers inside a transport). */
  private groupUnits(n: number): UnitSprite[] {
    return this.groups.ids(n).map((id) => this.units.get(id)).filter((u): u is UnitSprite => !!u && u.team === 'player' && !u.inside);
  }

  /** Ctrl+number: the selection becomes group `n` (nothing selected empties it). */
  saveGroup(n: number): void {
    this.groups.save(n, this.selection.ids());
    const k = this.selection.size;
    this.bus.emit('toast', k ? `Group ${n}: ${k} unit${k === 1 ? '' : 's'}` : `Group ${n} cleared`);
  }

  /** The number (or a group button): select group `n`, or add it (shift); pressed twice quickly, the camera centres on it. */
  tapGroup(n: number, add: boolean): void {
    if (this.placement.active || this.mode) return;
    const list = this.groupUnits(n);
    const double = this.groups.tap(n, this.time.now);
    if (!list.length) return;
    this.selection.set(list, add);
    this.ackSelection();
    if (!double) return;
    const c = iso(list.reduce((s, u) => s + u.gx, 0) / list.length, list.reduce((s, u) => s + u.gy, 0) / list.length);
    this.centerOnWorld(c.x, c.y);
  }

  controlGroups(): GroupView[] {
    const sel = this.selection;
    return this.groups.numbers().map((n) => {
      const list = this.groupUnits(n);
      const selected = list.filter((u) => sel.has(u)).length;
      return { n, count: list.length, selected, current: selected > 0 && selected === list.length && list.length === sel.size };
    });
  }

  centerOnWorld(x: number, y: number): void {
    this.camera.centerOn(x, y);
  }

  minimap(): MinimapSnapshot {
    const v = this.cameras.main.worldView;
    return {
      width: this.map.width,
      height: this.map.height,
      radar: this.view?.radar ?? 'none',
      buildings: [...this.buildings.values()].map((b) => ({ tx: b.tx, ty: b.ty, size: b.size, team: b.team, built: b.built })),
      ore: [...this.ore.tiles.values()].filter((t) => t.rocks.length && this.fog.at(t.tx, t.ty)).map((t) => ({ tx: t.tx, ty: t.ty, rocks: t.rocks.length })),
      scenery: this.scenery.items.filter((t) => this.fog.at(t.tx, t.ty)).map((t) => ({ tx: t.tx, ty: t.ty, kind: t.kind })),
      units: [...this.units.values()].map((u) => ({ gx: u.gx, gy: u.gy, team: u.team, selected: u.selected, harvester: u instanceof HarvesterSprite })),
      fogAt: (tx, ty) => this.fog.at(tx, ty),
      view: { x: v.x, y: v.y, width: v.width, height: v.height },
      iso,
    };
  }

  perfText(): string {
    const fps = this.game.loop.actualFps;
    const enemies = [...this.units.values()].filter((u) => u.team !== 'player').length;
    return `${fps.toFixed(0)} fps · tick ${this.view?.tick ?? 0} · ${this.children.length} objects · ${this.ore.totalRocks()} rocks · ${this.scenery.items.length} scenery · ` +
      `${this.population().units} units · ${enemies} enemies in sight · ${this.buildings.size} buildings`;
  }

  devInfo(open: ReadonlySet<DevInfoSection>): Partial<Record<DevInfoSection, string>> {
    return this.devInfoCollector.collect(open, this.musicStats?.() ?? null);
  }

  requestMenu(): void {
    this.bus.emit('menu', null);
  }
}
