import Phaser from 'phaser';
import { DEPTH } from '../config/game';
import { iso, toGrid } from '../core/geometry';
import { isMine } from '../data/teams';
import type { BuildingSprite } from '../entities/BuildingSprite';
import { HarvesterSprite, VehicleSprite, canBoard, type UnitSprite } from '../entities/UnitSprite';
import { isBuilding, isUnit, type Entity } from '../entities/types';
import type { GameScene } from '../scenes/GameScene';
import { $ } from '../ui/dom';
import { typingInField } from './CameraController';
import { leadType } from './Orders';
import type { OreTileSprite } from '../world/OreLayer';

/** The cursor over a building you can sell or repair: a coin or a wrench. */
const svgCursor = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'>${svg}</svg>`)}") 16 16, pointer`;
const MODE_CURSOR = {
  sell: svgCursor("<circle cx='16' cy='16' r='13' fill='#ffc61a' stroke='#1a1406' stroke-width='2.5'/><text x='16' y='22.5' font-family='Arial' font-weight='bold' font-size='18' text-anchor='middle' fill='#1a1406'>$</text>"),
  repair: svgCursor("<path d='M26.5 22.6 17.7 13.8a6.4 6.4 0 0 0-8.2-8.2l3.8 3.8-3.3 3.3-3.8-3.8a6.4 6.4 0 0 0 8.2 8.2l8.8 8.8a2.3 2.3 0 0 0 3.3-3.3z' fill='#ffc61a' stroke='#1a1406' stroke-width='2'/>"),
};

/** Over your Service Bay with damaged vehicles selected: they'll go to be repaired (the repair wrench). */
const SERVICE_CURSOR = MODE_CURSOR.repair;

/** Over your damaged unit with a Medic selected: it'll go and heal it (a green cross). */
const HEAL_CURSOR = svgCursor("<path d='M12 4h8v8h8v8h-8v8h-8v-8H4v-8h8z' fill='#5be38a' stroke='#0d2414' stroke-width='2.5' stroke-linejoin='round'/>");

/** Over your damaged building with Engineers selected: they'll go and repair it (the repair wrench). */
const FIX_CURSOR = MODE_CURSOR.repair;

/** Over your transport with soldiers selected: they'll get in (an arrow down into a hatch). */
const BOARD_CURSOR = svgCursor("<rect x='5' y='17' width='22' height='10' rx='2' fill='#ffc61a' stroke='#1a1406' stroke-width='2'/><path d='M16 3v14m-6-6 6 6 6-6' fill='none' stroke='#1a1406' stroke-width='5' stroke-linecap='round' stroke-linejoin='round'/><path d='M16 3v14m-6-6 6 6 6-6' fill='none' stroke='#ffc61a' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'/>");

/** Ctrl held with units selected: a click attack-moves (a red sight with a dot). */
const ATTACK_MOVE_CURSOR = svgCursor(
  "<g fill='none' stroke-linecap='round'><g stroke='#1a1406' stroke-width='5'><circle cx='16' cy='16' r='9'/><path d='M16 2v6M16 24v6M2 16h6M24 16h6'/></g>" +
  "<g stroke='#ff4a3a' stroke-width='2.5'><circle cx='16' cy='16' r='9'/><path d='M16 2v6M16 24v6M2 16h6M24 16h6'/></g></g>" +
  "<circle cx='16' cy='16' r='2.5' fill='#ff4a3a' stroke='#1a1406' stroke-width='1.5'/>",
);

/** How close (world px) a click must be to a unit's body to pick it. */
const UNIT_PICK_RADIUS = 56;

/** Keys for the game, not a field being typed in or a menu or screen over it. */
export const inGame = () => !typingInField() && $('#screens').hidden;

/**
 * Mouse and keyboard for the human player, classic RTS controls:
 * left-click selects (shift adds), left-drag box-selects, left-click with a selection gives an order
 * (ore = harvest, own refinery = unload there, own transport with soldiers selected = get in, own Service Bay with damaged
 * vehicles selected = repair there, enemy = attack, ground = move), right-click deselects (or, over your transport with
 * soldiers selected or your Service Bay with damaged vehicles selected, gives that order too). Ctrl+click (right or left)
 * with a selection attack-moves to the ground there, or attacks the enemy there.
 * While placing a building, left-click places and right-click / Esc cancels (Esc is handled in GameFlow).
 * Orders go to the server through `world.orders` (input/Orders.ts), which marks them and has the units answer at once.
 */
export class InputController {
  private boxStart: { x: number; y: number } | null = null;
  private readonly boxGfx: Phaser.GameObjects.Graphics;
  /** Ctrl is held; and when (performance.now()) a Ctrl+click last gave an order. */
  private ctrl = false;
  private ctrlClickAt = -Infinity;

  constructor(private readonly world: GameScene) {
    this.boxGfx = world.add.graphics().setDepth(DEPTH.ui + 1);
    const input = world.input;
    input.mouse?.disableContextMenu();
    const kb = input.keyboard!;
    // Esc (cancel placement / open the menu) is handled by GameFlow on the page, so it works while paused too.
    // Phaser keeps key events from while the scene was paused, so ignore anything typed into a field or a menu (inGame).
    kb.on('keydown-F', () => inGame() && world.toggleFog());
    kb.on('keydown-G', () => inGame() && world.toggleGrid());
    kb.on('keydown-T', () => inGame() && world.cycleFast());
    // E: Assemblers deploy, transports let their passengers out
    kb.on('keydown-E', () => {
      if (!inGame()) return;
      world.deploySelected();
      world.unloadSelected();
    });
    kb.on('keydown-P', () => inGame() && world.bus.emit('perf', null));
    kb.on('keydown-I', () => inGame() && world.bus.emit('devInfo', null));
    // Z resets the zoom (0 is control group 10, and Ctrl+0 saves it)
    kb.on('keydown-Z', (e: KeyboardEvent) => !e.ctrlKey && !e.metaKey && inGame() && world.resetZoom());
    // Control groups, on the page rather than through Phaser so Ctrl+number's browser default (zoom reset on Ctrl+0,
    // tab switching on Cmd+number where the browser lets a page have it) is stopped before it happens
    const onKey = (e: KeyboardEvent) => this.groupKey(e, () => !!inGame());
    document.addEventListener('keydown', onKey);
    // Ctrl held: the attack-move cursor (with units selected)
    const onCtrl = (e: KeyboardEvent | FocusEvent) => {
      const ctrl = e instanceof KeyboardEvent && e.ctrlKey;
      if (ctrl === this.ctrl) return;
      this.ctrl = ctrl;
      this.onMove(input.activePointer);
    };
    document.addEventListener('keydown', onCtrl);
    document.addEventListener('keyup', onCtrl);
    window.addEventListener('blur', onCtrl);
    // macOS: Ctrl+click is the system's right-click. Should a browser report it only as a context menu, with no click on
    // the map to follow, the attack-move is given from that (never twice: a click handled just before or after wins)
    const canvas = world.game.canvas;
    const onMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (!e.ctrlKey) return;
      const at = performance.now();
      window.setTimeout(() => {
        const p = input.activePointer;
        if (this.ctrlClickAt > at - 300 || p.isDown || !inGame() || !world.scene.isActive()) return;
        if (world.selection.size && !world.placement.active && !world.mode) this.ctrlOrder(p, input.hitTestPointer(p));
      }, 250);
    };
    canvas.addEventListener('contextmenu', onMenu);
    world.events.once('shutdown', () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('keydown', onCtrl);
      document.removeEventListener('keyup', onCtrl);
      window.removeEventListener('blur', onCtrl);
      canvas.removeEventListener('contextmenu', onMenu);
    });
    kb.on('keydown-BACKTICK', () => inGame() && world.bus.emit('debugMenu', null));
    input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.leftButtonDown() && !world.placement.active) this.boxStart = { x: p.worldX, y: p.worldY };
    });
    input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.event instanceof MouseEvent) this.ctrl = p.event.ctrlKey; // Ctrl pressed while the page had no focus
      this.onMove(p);
    });
    input.on('pointerup', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => this.onUp(p, over));
  }

  /**
   * 1 to 9 and 0 (top row or keypad): select that control group (twice quickly: and centre on it), shift adds it to
   * the selection, Ctrl (or Cmd) saves the selection as it.
   */
  private groupKey(e: KeyboardEvent, inGame: () => boolean): void {
    const m = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
    if (!m || e.altKey || !inGame() || this.world.isOver || !this.world.ready) return;
    const n = Number(m[1]);
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (!e.repeat) this.world.saveGroup(n);
      return;
    }
    if (e.repeat) return;
    this.world.tapGroup(n, e.shiftKey);
  }

  private onMove(p: Phaser.Input.Pointer): void {
    const w = this.world;
    if (w.placement.active) return w.placement.update(p.worldX, p.worldY);
    this.boxGfx.clear();
    if (this.boxStart && p.leftButtonDown() && p.getDistance() > 6) {
      const b = this.boxRect(p, this.boxStart);
      const cam = w.cameras.main;
      this.boxGfx.lineStyle(2 / cam.zoom, 0x7dff6a, 1).strokeRect(b.x, b.y, b.width, b.height)
        .fillStyle(0x7dff6a, 0.08).fillRect(b.x, b.y, b.width, b.height);
    }
    if (w.mode) {
      const over = w.input.hitTestPointer(p).some((o) => {
        const e = o.getData('entity') as Entity | undefined;
        return !!e && isBuilding(e) && isMine(e.team) && (w.mode === 'sell' || e.built);
      });
      w.game.canvas.style.cursor = over ? MODE_CURSOR[w.mode] : 'not-allowed';
      return;
    }
    if (this.ctrl && w.selection.size) return void (w.game.canvas.style.cursor = ATTACK_MOVE_CURSOR);
    const under = this.unitAt(p.worldX, p.worldY);
    if (this.transportFor(under)) return void (w.game.canvas.style.cursor = BOARD_CURSOR);
    if (this.medicsFor(under).length) return void (w.game.canvas.style.cursor = HEAL_CURSOR);
    const hit = w.input.hitTestPointer(p);
    if (this.fixersFor(hit).length) return void (w.game.canvas.style.cursor = FIX_CURSOR);
    if (this.bayFor(hit)) return void (w.game.canvas.style.cursor = SERVICE_CURSOR);
    const harvesterSelected = [...w.selection].some((u) => u instanceof HarvesterSprite);
    w.game.canvas.style.cursor = harvesterSelected && w.ore.under(p.worldX, p.worldY) ? 'crosshair' : 'default';
  }

  /** The selected Medics that would heal `u`: it's yours, damaged, one they mend (not a vehicle), and not one of them. */
  private medicsFor(u: UnitSprite | null): UnitSprite[] {
    if (!u || !isMine(u.team) || u.hp >= u.maxHp || !canBoard(u)) return [];
    return [...this.world.selection].filter((s) => s.type === 'medic' && s !== u);
  }

  /** The selected Engineers that would repair the building among `over`: yours, finished and damaged. */
  private fixersFor(over: Phaser.GameObjects.GameObject[]): UnitSprite[] {
    const b = this.damagedBuilding(over);
    return b ? [...this.world.selection].filter((s) => s.type === 'engineer') : [];
  }

  /** Your finished, damaged building among `over`, if any. */
  private damagedBuilding(over: Phaser.GameObjects.GameObject[]): BuildingSprite | null {
    return over.map((o) => o.getData('entity') as Entity | undefined)
      .find((e): e is BuildingSprite => !!e && isBuilding(e) && e.alive && e.built && isMine(e.team) && e.hp < e.maxHp) ?? null;
  }

  /** The selected vehicles that a Service Bay would repair: yours, and damaged. */
  private damagedVehicles(): UnitSprite[] {
    return [...this.world.selection].filter((u) => u instanceof VehicleSprite && isMine(u.team) && u.hp < u.maxHp);
  }

  /** Your finished Service Bay among `over`, if damaged vehicles are selected (a click on it sends them to be repaired). */
  private bayFor(over: Phaser.GameObjects.GameObject[]): BuildingSprite | null {
    const bay = over.map((o) => o.getData('entity') as Entity | undefined)
      .find((e): e is BuildingSprite => !!e && isBuilding(e) && e.alive && e.built && e.type === 'service_bay' && isMine(e.team));
    return bay && this.damagedVehicles().length ? bay : null;
  }

  /** The selected damaged vehicles go onto your Service Bay's pad to be repaired, one at a time. */
  private sendToBay(bay: BuildingSprite): void {
    const w = this.world;
    const vehicles = this.damagedVehicles();
    w.orders.send({ c: 'service', units: vehicles.map((u) => u.id), bay: bay.id });
    w.orders.answer(vehicles, 'move');
  }

  /** `u`, if it's your transport and soldiers are selected (a click on it sends them in). */
  private transportFor(u: UnitSprite | null): UnitSprite | null {
    if (!u || !isMine(u.team) || !u.seats || u.selected) return null;
    return [...this.world.selection].some(canBoard) ? u : null;
  }

  private onUp(p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]): void {
    const w = this.world;
    const start = this.boxStart;
    this.boxStart = null;
    this.boxGfx.clear();
    if (p.event && p.event.target !== w.game.canvas) return; // released over the HUD, not the map
    const dragged = p.getDistance() > 6;
    // Ctrl+click with units selected, right button or left (on macOS Ctrl+click is the right-click): attack-move
    const ctrl = (p.event as MouseEvent | undefined)?.ctrlKey ?? false;
    if (ctrl && !dragged && w.selection.size && !w.placement.active && !w.mode) return this.ctrlOrder(p, over);
    if (p.rightButtonReleased()) {
      if (!dragged) {
        const transport = !w.placement.active && !w.mode ? this.transportFor(this.unitAt(p.worldX, p.worldY)) : null;
        const bay = !w.placement.active && !w.mode && !transport ? this.bayFor(over) : null;
        if (w.placement.active) w.placement.cancel();
        else if (w.mode) w.setMode(null);
        else if (transport) w.boardSelected(transport);
        else if (bay) this.sendToBay(bay);
        else w.selection.clear();
      }
      return;
    }
    // sell / repair mode: a click on one of your buildings sells (or cancels) or repairs it; the mode stays on
    if (w.mode) {
      if (dragged) return;
      const b = over.map((o) => o.getData('entity') as Entity | undefined).find((e): e is BuildingSprite => !!e && isBuilding(e) && e.alive && isMine(e.team));
      if (b) {
        if (w.mode === 'sell') w.sellOrCancel(b);
        else w.toggleRepair(b);
      }
      return;
    }
    if (w.placement.active) {
      if (!dragged) w.placement.confirm();
      return;
    }
    const shift = (p.event as MouseEvent | undefined)?.shiftKey ?? false;
    if (dragged && start) {
      const b = this.boxRect(p, start);
      w.selection.set([...w.units.values()].filter((u) => isMine(u.team) && !u.inside && b.contains(u.sprite.x, u.sprite.y - 20)), shift);
      if (w.selection.size) w.sounds.answer([`ack_${leadType(w.selection)}_select`]);
      return;
    }
    const hits = over.map((o) => o.getData('entity') as Entity | undefined).filter((e): e is Entity => !!e && e.alive);
    // units win over buildings: a soldier standing in front of (or behind) a building is what you meant
    const hitUnit = this.unitAt(p.worldX, p.worldY) ?? hits.find(isUnit);
    // your transport with soldiers selected: they get in
    const transport = shift ? null : this.transportFor(hitUnit ?? null);
    if (transport) return w.boardSelected(transport);
    // your damaged unit with Medics selected: they go and heal it (rather than selecting it)
    const medics = shift ? [] : this.medicsFor(hitUnit ?? null);
    if (medics.length && hitUnit) {
      w.orders.send({ c: 'support', units: medics.map((u) => u.id), target: hitUnit.id });
      w.orders.answer(medics, 'move');
      return w.orders.mark({ kind: 'move', tx: Math.floor(hitUnit.gx), ty: Math.floor(hitUnit.gy) });
    }
    if (hitUnit && isMine(hitUnit.team)) {
      w.selection.set([hitUnit], shift);
      w.sounds.answer([`ack_${leadType(w.selection)}_select`]);
      return;
    }
    if (!w.selection.size) return;
    const hitBuilding = hits.filter(isBuilding).find((b) => b.built);
    // (own units returned above, so any unit hit here is hostile)
    const enemy: Entity | null = hitUnit ?? (hitBuilding && !isMine(hitBuilding.team) ? hitBuilding : null);
    const ownRefinery = hitBuilding?.type === 'refinery' && isMine(hitBuilding.team) ? hitBuilding : null;
    const ownBay = hitBuilding?.type === 'service_bay' && isMine(hitBuilding.team) ? hitBuilding : null;
    // your damaged building with Engineers selected: they go and repair it (the rest move there)
    const fixers = this.fixersFor(over);
    const broken = this.damagedBuilding(over);
    if (fixers.length && broken) {
      w.orders.send({ c: 'support', units: fixers.map((u) => u.id), target: broken.id });
      w.orders.answer(fixers, 'move');
    }
    const ore = w.ore.under(p.worldX, p.worldY);
    this.issueOrders(enemy, ownRefinery, ownBay, ore, toGrid(p.worldX, p.worldY), new Set(fixers));
  }

  private issueOrders(
    enemy: Entity | null, ownRefinery: BuildingSprite | null, ownBay: BuildingSprite | null, ore: OreTileSprite | null, g: { gx: number; gy: number },
    busy: ReadonlySet<UnitSprite> = new Set(),
  ): void {
    const w = this.world;
    const harvesters = [...w.selection].filter((u) => u instanceof HarvesterSprite).map((u) => u.id);
    // clicking your Service Bay sends your damaged vehicles onto its pad to be repaired (the rest just go there)
    const toBay: UnitSprite[] = ownBay && !enemy ? this.damagedVehicles() : [];
    const others = [...w.selection].filter((u) => !(u instanceof HarvesterSprite) && !toBay.includes(u) && !busy.has(u));
    const movers = [...(ownRefinery || ore ? [] : harvesters.map((id) => w.units.get(id)!)), ...(enemy ? [] : others)];
    const orders = w.orders;
    if (ownBay && toBay.length) orders.send({ c: 'service', units: toBay.map((u) => u.id), bay: ownBay.id });
    if (ownRefinery && harvesters.length) orders.send({ c: 'dock', units: harvesters, refinery: ownRefinery.id });
    else if (ore && harvesters.length) orders.send({ c: 'harvest', units: harvesters, tx: ore.tx, ty: ore.ty });
    if (enemy && others.length) orders.send({ c: 'attack', units: others.map((u) => u.id), target: enemy.id });
    // all to the clicked point: the server gives each a tile of its own around it, in formation
    if (movers.length) orders.send({ c: 'move', orders: movers.map((u) => ({ id: u.id, gx: g.gx, gy: g.gy })) });
    if (enemy) orders.mark({ kind: 'target', gx: enemy.gx, gy: enemy.gy, scale: isBuilding(enemy) ? enemy.size * 1.4 : 1 });
    else if (!ownRefinery && !ore && !toBay.length) orders.mark({ kind: 'move', tx: Math.floor(g.gx), ty: Math.floor(g.gy) });
    // the units answer, in the voice of the most of them (an unarmed one sent at an enemy says it's moving)
    if (enemy && others.length) orders.answer(w.selection, 'attack', 'move');
    else if (w.selection.size) orders.answer(w.selection, 'move');
  }

  /**
   * Ctrl+click with units selected: an attack-move to the point (they fight whatever they meet on the way, then carry
   * on; harvesters just go there). Over an enemy it's a plain attack on it.
   */
  private ctrlOrder(p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]): void {
    const w = this.world;
    this.ctrlClickAt = performance.now();
    const hits = over.map((o) => o.getData('entity') as Entity | undefined).filter((e): e is Entity => !!e && e.alive);
    const hitUnit = this.unitAt(p.worldX, p.worldY) ?? hits.find(isUnit);
    const hitBuilding = hits.filter(isBuilding).find((b) => b.built && !isMine(b.team));
    const enemy: Entity | null = hitUnit && !isMine(hitUnit.team) ? hitUnit : hitBuilding ?? null;
    const g = toGrid(p.worldX, p.worldY);
    if (enemy) return this.issueOrders(enemy, null, null, null, g);
    // all to the clicked point, in the same formation as a move
    w.orders.send({ c: 'attackMove', orders: [...w.selection].map((u) => ({ id: u.id, gx: g.gx, gy: g.gy })) });
    w.orders.mark({ kind: 'attackMove', tx: Math.floor(g.gx), ty: Math.floor(g.gy) });
    // they answer as for an attack (an unarmed lead says it's moving)
    w.orders.answer(w.selection, 'attack', 'move');
  }

  /** The unit whose body is under (or nearest to) a world point, within a small radius. */
  private unitAt(x: number, y: number): UnitSprite | null {
    let best: UnitSprite | null = null;
    let bestD = UNIT_PICK_RADIUS;
    for (const u of this.world.units.values()) {
      if (u.inside) continue; // still coming out of a building
      const c = iso(u.gx, u.gy);
      const body = u instanceof HarvesterSprite ? 40 : 60; // pick around the middle of the body, not the feet
      const d = Math.hypot(c.x - x, c.y - body - y);
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }

  private boxRect(p: Phaser.Input.Pointer, s: { x: number; y: number }): Phaser.Geom.Rectangle {
    return new Phaser.Geom.Rectangle(Math.min(s.x, p.worldX), Math.min(s.y, p.worldY), Math.abs(p.worldX - s.x), Math.abs(p.worldY - s.y));
  }
}
