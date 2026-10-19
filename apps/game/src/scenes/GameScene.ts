import Phaser from 'phaser';
import type { BuildingView, Difficulty, MatchHello, PlayableFaction, PowerView, QueueItemView, TeamView } from '@gravity-harvest/shared';
import type { MusicStats } from '../audio/Music';
import { Sounds, type LoopWanted } from '../audio/Sounds';
import { DEPTH } from '../config/game';
import { EventBus, emptyStats, type GameEvents, type MatchStats } from '../core/EventBus';
import { TOAST_SOUNDS, type ToastCode } from '../data/toasts';
import { iso, toGrid, type GridPoint } from '../core/geometry';
import { BuildingSprite } from '../entities/BuildingSprite';
import { HarvesterSprite, InfantrySprite, canBoard, createUnitSprite, type UnitSprite } from '../entities/UnitSprite';
import { CameraController } from '../input/CameraController';
import { ControlGroups } from '../input/ControlGroups';
import { InputController } from '../input/InputController';
import { Orders, leadType } from '../input/Orders';
import { Selection } from '../input/Selection';
import { MatchClient } from '../net/MatchClient';
import { Boarding } from '../render/Boarding';
import { DebugOverlay } from '../render/DebugOverlay';
import { Effects } from '../render/Effects';
import { Overlays } from '../render/Overlays';
import { buildBlocker, setCatalog, trainResult, type BuyResult } from '../systems/availability';
import { Placement } from '../systems/Placement';
import type { DevInfoSection, GroupView, HudBridge, MinimapSnapshot, SelectedUnit } from '../ui/HudBridge';
import { FogOfWar } from '../world/FogOfWar';
import { GameMap } from '../world/GameMap';
import { OreLayer } from '../world/OreLayer';
import { SceneryLayer } from '../world/SceneryLayer';
import { ShadowLayer } from '../world/ShadowLayer';
import { drawTerrain } from '../world/Terrain';
import { DevInfoCollector, FrameTimes } from './devInfo';
import { EventPresenter } from './EventPresenter';

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


/** A unit of ours this close to one of our buildings (tiles) is in the base: hit there, it's the base under attack. */
const BASE_RADIUS = 8;

/**
 * One match, drawn. The server runs it (packages/sim): this scene sends orders through `orders` (to `net`) and
 * draws the views it receives, their events through `presenter`. It implements the HUD bridge from the latest view.
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
  units = new Map<number, UnitSprite>();
  selection = new Selection();
  /** Control groups (Ctrl+number saves, the number selects): client side only, new for every match. */
  readonly groups = new ControlGroups();
  effects!: Effects;
  sounds!: Sounds;
  /** Every order goes out through this (its marker and the units' answer with it). */
  orders!: Orders;
  /** Turns each view's events into effects and sounds. */
  private presenter!: EventPresenter;
  placement!: Placement;
  debug!: DebugOverlay;
  private overlays!: Overlays;
  private boarding!: Boarding;
  private camera!: CameraController;
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
    const scorch = this.add.graphics().setDepth(DEPTH.scorch);
    this.effects = new Effects(this);
    this.sounds = new Sounds(this);
    this.sounds.side = h.faction === 'sable' ? 'sable_' : '';
    this.effects.onImpact = (sound, at) => this.sounds.play(sound, at);
    this.orders = new Orders(this.net, this.effects, this.sounds);
    this.placement = new Placement(this);
    this.debug = new DebugOverlay(this, this.map, (m) => this.bus.emit('toast', m));
    this.overlays = new Overlays(this);
    this.boarding = new Boarding(this);
    this.presenter = new EventPresenter(this, scorch, this.boarding);
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
    for (const [id, s] of this.units) {
      if (seen.has(id)) continue;
      if (s.team === 'player') this.presenter.ownGone.add(id);
      this.dropUnit(s); // died, or went out of sight
    }
    this.presenter.present(v.events);
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
      this.presenter.gone.set(id, s);
    }
  }

  private dropUnit(s: UnitSprite): void {
    if (s instanceof InfantrySprite) this.presenter.droppedInfantry.set(s.id, { type: s.type, dir: s.dir, team: s.team });
    this.units.delete(s.id);
    this.selection.remove(s);
    s.destroy();
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
    if (!this.hello?.debug) return void this.bus.emit('toast', { text: 'Fog of war can only be turned off on a dev server', code: 'devOnly' });
    this.revealed = !this.revealed;
    this.net.debug({ d: 'reveal', on: this.revealed });
    this.bus.emit('toast', this.revealed ? 'Fog of war off (F)' : 'Fog of war on');
  }

  get fastMode(): number {
    return this.fastFactor;
  }

  /** Debug (T): cycle fast mode for your side (normal, 5x, 10x), if the server allows debug commands. */
  cycleFast(): void {
    if (!this.hello?.debug) return void this.bus.emit('toast', { text: 'Fast mode only works on a dev server', code: 'devOnly' });
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

  /** A message is shown (the HUD's toast): its code's sound (data/toasts.ts), if it has one. */
  toastSound(code: ToastCode | undefined): void {
    const sound = code ? TOAST_SOUNDS[code] : null;
    if (sound === 'noMoney') this.sounds.announce('announce_insufficient_funds', 'ui_error');
    else if (sound === 'refused') this.sounds.play('ui_error');
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

  startPlacement(type: string): 'ok' | 'poor' | { text: string; code: ToastCode } {
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
    this.orders.send(b.built ? { c: 'sell', building: b.id } : { c: 'cancelBuild', building: b.id });
  }

  /** E: selected Assemblers unpack into Assembly Yards where they stand. */
  deploySelected(): void {
    const assemblers = [...this.selection].filter((u) => u.type === 'assembler');
    if (!assemblers.length) return;
    for (const u of assemblers) this.orders.send({ c: 'deploy', unit: u.id });
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
    for (const t of this.loadedTransports()) this.orders.send({ c: 'unload', transport: t.id });
  }

  /** The selected soldiers get into your transport `t` (those it has no room for stop by it). */
  boardSelected(t: UnitSprite): void {
    const soldiers = [...this.selection].filter((u) => canBoard(u) && u.team === 'player');
    if (!soldiers.length) return;
    if (t.passengers >= t.seats) return void this.bus.emit('toast', { text: 'No room inside', code: 'noRoom' });
    this.orders.send({ c: 'board', units: soldiers.map((u) => u.id), transport: t.id });
    this.orders.mark({ kind: 'move', tx: Math.floor(t.gx), ty: Math.floor(t.gy) });
  }

  /** Repair mode: start repairing a damaged building, or stop. */
  toggleRepair(b: BuildingSprite): void {
    if (b.team !== 'player' || !b.alive || !b.built) return;
    if (!b.repairing && b.hp >= b.maxHp) return void this.bus.emit('toast', { text: 'Not damaged', code: 'notDamaged' });
    this.orders.send({ c: 'repair', building: b.id, on: !b.repairing });
  }

  buyUnit(type: string): BuyResult {
    const r = trainResult(type, this.credits(), this.ownedTypes(), this.population(), this.queue());
    if (r === 'ok') this.orders.send({ c: 'train', unit: type, near: this.cameraCentre() });
    return r;
  }

  cancelUnit(type: string): void {
    this.orders.send({ c: 'cancelTrain', unit: type });
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
