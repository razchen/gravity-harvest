import Phaser from 'phaser';
import type { BuildingView, MatchEvent, MatchHello, PlayableFaction, PowerView, QueueItemView, TeamId, TeamView } from '@gravity-harvest/shared';
import { DEPTH } from '../config/game';
import { EventBus, emptyStats, type GameEvents, type MatchStats } from '../core/EventBus';
import { diamond, iso, toGrid, type GridPoint } from '../core/geometry';
import { BuildingSprite } from '../entities/BuildingSprite';
import { HarvesterSprite, InfantrySprite, VehicleSprite, createUnitSprite, fallDead, type UnitSprite } from '../entities/UnitSprite';
import { isBuilding, type Entity } from '../entities/types';
import { CameraController } from '../input/CameraController';
import { InputController } from '../input/InputController';
import { Selection } from '../input/Selection';
import { MatchClient } from '../net/MatchClient';
import { DebugOverlay } from '../render/DebugOverlay';
import { Effects } from '../render/Effects';
import { Overlays } from '../render/Overlays';
import { setCatalog, trainResult, type BuyResult } from '../systems/availability';
import { Placement } from '../systems/Placement';
import type { HudBridge, MinimapSnapshot } from '../ui/HudBridge';
import { FogOfWar } from '../world/FogOfWar';
import { GameMap } from '../world/GameMap';
import { OreLayer } from '../world/OreLayer';
import { SceneryLayer, hashId } from '../world/SceneryLayer';
import { ShadowLayer } from '../world/ShadowLayer';
import { drawTerrain } from '../world/Terrain';

export interface SceneData {
  /** A new match on this scenario, or resume a save. */
  scenario?: string;
  saveId?: string;
  /** A new match: the side you play. */
  faction?: PlayableFaction;
  /** Write the autosave slot if the connection closes mid-match. */
  autosaveOnLeave: boolean;
}

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
  effects!: Effects;
  placement!: Placement;
  debug!: DebugOverlay;
  private overlays!: Overlays;
  private camera!: CameraController;
  private scorch!: Phaser.GameObjects.Graphics;
  private over = false;
  private revealed = false;
  /** Debug fast mode (T): how much faster your side builds, produces and moves. */
  private fastFactor = 1;
  private stats: MatchStats = emptyStats();

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
    net.start({ ...(data.saveId ? { saveId: data.saveId } : { scenario: data.scenario, ...(data.faction && { faction: data.faction }) }), autosaveOnLeave: data.autosaveOnLeave });
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
    this.placement = new Placement(this);
    this.debug = new DebugOverlay(this, this.map, (m) => this.bus.emit('toast', m));
    this.overlays = new Overlays(this);
    this.camera = new CameraController(this, h.camera, h.map);
    new InputController(this);
  }

  private onView(v: TeamView): void {
    if (!this.hello) return;
    const first = !this.view;
    const now = this.time.now;
    this.view = v;
    this.stats = v.stats;
    if (v.fog) this.fog.apply(v.fog);
    this.syncBuildings(v.buildings);
    const seen = new Set<number>();
    for (const u of v.units) {
      seen.add(u.id);
      const s = this.units.get(u.id);
      if (s) s.apply(u, now);
      else this.units.set(u.id, createUnitSprite(this, u, now));
    }
    for (const [id, s] of this.units) if (!seen.has(id)) this.dropUnit(s); // died, or went out of sight
    for (const e of v.events) this.onEvent(e);
    this.droppedInfantry.clear();
    // the rest were sold or went out of sight
    for (const s of this.gone.values()) s.dispose();
    this.gone.clear();
    if (first) this.game.events.emit('world-ready', this);
  }

  private syncBuildings(list: BuildingView[]): void {
    const seen = new Set<number>();
    for (const b of list) {
      seen.add(b.id);
      const s = this.buildings.get(b.id);
      if (s) s.apply(b);
      else {
        const nb = new BuildingSprite(this, b);
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
        const hit = to ? { depth: to.sprite.depth, targets: isBuilding(to) ? [to.sprite] : to.parts() } : undefined;
        let end = this.aimPoint(to, e.at);
        // a turret's shot leaves its barrel and flies straight along it
        if (from instanceof VehicleSprite) ({ from: start, to: end } = from.fireLine(end));
        this.effects.shot(e.p, start, end, ground, !(from instanceof HarvesterSprite), hit);
        return;
      }
      case 'unitDied': {
        // a soldier we saw falls; anything else (or one we never saw) blows up
        const soldier = this.droppedInfantry.get(e.id);
        if (soldier) return fallDead(this, soldier.type, e.gx, e.gy, soldier.dir, soldier.team);
        const p = iso(e.gx, e.gy);
        this.effects.explode(p.x, p.y - 10, e.type === 'harvester' ? 2 : 0.8);
        // a burnt-out harvester leaves an oil stain (cosmetic, not saved)
        if (e.type === 'harvester') this.scenery.stamp(`oil_${1 + (hashId(e.id) % 2)}`, e.gx, e.gy, 1, { tx: Math.floor(e.gx), ty: Math.floor(e.gy), size: 1 }, e.id);
        return;
      }
      case 'buildingDestroyed': {
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
      case 'door':
        this.buildings.get(e.refinery)?.door(e.open);
        return;
      case 'unitOut':
        this.buildings.get(e.building)?.unitOut(this.units.get(e.unit));
        return;
      case 'unloaded': {
        const ref = this.buildings.get(e.refinery);
        if (ref) this.effects.floatText(ref.gx, ref.gy, `+${Math.round(e.credits).toLocaleString('en-US')}`);
        return;
      }
      case 'toast':
        this.bus.emit('toast', e.text);
        return;
      case 'buildingDone':
      case 'unitReady':
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
    this.overlays.draw();
  }

  get gameTimeMs(): number {
    return this.view?.timeMs ?? 0;
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
    return { units: [...this.units.values()].filter((u) => u.team === 'player').length, cap: this.view?.unitCap ?? 0 };
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

  startPlacement(type: string): 'ok' | 'poor' {
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

  /** Repair mode: start repairing a damaged building, or stop. */
  toggleRepair(b: BuildingSprite): void {
    if (b.team !== 'player' || !b.alive || !b.built) return;
    if (!b.repairing && b.hp >= b.maxHp) return void this.bus.emit('toast', 'Not damaged');
    this.net.command({ c: 'repair', building: b.id, on: !b.repairing });
  }

  buyUnit(type: string): BuyResult {
    const r = trainResult(type, this.credits(), this.ownedTypes(), this.population(), this.queue().length);
    if (r === 'ok') this.net.command({ c: 'train', unit: type, near: this.cameraCentre() });
    return r;
  }

  cancelUnit(type: string): void {
    this.net.command({ c: 'cancelTrain', unit: type });
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

  requestMenu(): void {
    this.bus.emit('menu', null);
  }
}
