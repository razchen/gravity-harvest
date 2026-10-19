import type Phaser from 'phaser';
import type { MatchEvent, TeamId } from '@gravity-harvest/shared';
import { meta } from '../assets/manifest';
import { BUILDING_ART, SIDE_GLOW, UNIT_ART } from '../data/art';
import { factionOfTeam, isMine } from '../data/teams';
import { shotOf } from '../data/shots';
import { diamond, iso, type GridPoint } from '../core/geometry';
import { BuildingSprite } from '../entities/BuildingSprite';
import { HarvesterSprite, InfantrySprite, VehicleSprite, fallDead } from '../entities/UnitSprite';
import { isBuilding, type Entity } from '../entities/types';
import type { Boarding } from '../render/Boarding';
import { hashId } from '../world/SceneryLayer';
import type { GameScene } from './GameScene';

/** Soldiers whose death sets off what they carry (the rules: "explodes violently when killed"). */
const VOLATILE = new Set(['grenadier', 'breaker']);

/**
 * Turns a view's events (shots, deaths, doors, unloads, toasts...) into what you see and hear. GameScene keeps the
 * sprites in step with the view first, noting here what left it this update, so the events can tell a death from
 * something going out of sight.
 */
export class EventPresenter {
  /** Buildings that left the view this update, held until its events say whether they were destroyed (explode) or not (fade). */
  readonly gone = new Map<number, BuildingSprite>();
  /** Soldiers that left the view this update, so the ones that died can fall where they stood. */
  readonly droppedInfantry = new Map<number, { type: string; dir: number; team: TeamId }>();
  /** Units of ours that left the view this update (one that died: "unit lost"). */
  readonly ownGone = new Set<number>();

  constructor(
    private readonly s: GameScene,
    /** Where burnt-down buildings leave plain scorch marks (when the atlas has no decals). */
    private readonly scorch: Phaser.GameObjects.Graphics,
    private readonly boarding: Boarding,
  ) {}

  /** This update's events; then what left the view and wasn't explained by them was sold or went out of sight. */
  present(events: MatchEvent[]): void {
    for (const e of events) this.onEvent(e);
    this.droppedInfantry.clear();
    this.ownGone.clear();
    for (const b of this.gone.values()) b.dispose();
    this.gone.clear();
  }

  private onEvent(e: MatchEvent): void {
    const s = this.s;
    switch (e.e) {
      case 'shot':
        return this.shot(e);
      case 'unitDied': {
        // a soldier we saw falls (one we never saw is only heard); anything else blows up
        const soldier = this.droppedInfantry.get(e.id);
        const p = iso(e.gx, e.gy);
        const infantry = soldier || UNIT_ART[e.type]?.kind === 'infantry';
        s.groups.forget(e.id);
        if (this.ownGone.has(e.id)) s.sounds.announce('announce_unit_lost');
        s.sounds.play(VOLATILE.has(e.type) && s.sounds.has('infantry_explode') ? 'infantry_explode' : infantry ? 'infantry_death' : 'vehicle_explode', p);
        if (soldier) return fallDead(s, soldier.type, e.gx, e.gy, soldier.dir, soldier.team);
        if (infantry) return;
        s.effects.explode(p.x, p.y - 10, e.type === 'harvester' ? 2 : 0.8);
        // a burnt-out harvester leaves an oil stain (cosmetic, not saved)
        if (e.type === 'harvester') s.scenery.stamp(`oil_${1 + (hashId(e.id) % 2)}`, e.gx, e.gy, 1, { tx: Math.floor(e.gx), ty: Math.floor(e.gy), size: 1 }, e.id);
        return;
      }
      case 'buildingDestroyed': {
        // sold (a building still going up was cancelled: its money back, no sale to hear), or destroyed
        const cancelled = e.sold && this.gone.get(e.id)?.built === false;
        if (!cancelled) s.sounds.play(e.sold ? 'building_sold' : 'building_explode', iso(e.tx + e.size / 2, e.ty + e.size / 2));
        if (!e.sold && isMine(e.team)) s.sounds.announce('announce_building_lost');
        if (e.sold) return;
        // it blows up (render/Destruction.ts); one we never saw gets a plain explosion
        const b = this.gone.get(e.id);
        if (b) {
          this.gone.delete(e.id);
          b.explode();
        } else {
          const c = iso(e.tx + e.size / 2, e.ty + e.size / 2);
          s.effects.explode(c.x, c.y - 30 * e.size, e.size * 1.4);
        }
        if (!this.burnMark(e)) this.scorch.fillStyle(0x1b1712, 0.75).fillPoints(diamond(e.tx, e.ty, e.size), true);
        return;
      }
      case 'rockGone':
        return s.ore.removeRock(e.id);
      case 'rockAdded':
        s.scenery.hideDecorIn(e.rock.tx, e.rock.ty, 1, 'ore');
        return s.ore.addRock(e.rock);
      case 'oreTile':
        s.ore.addTile(e.tile);
        return;
      case 'door': {
        const b = s.buildings.get(e.refinery);
        b?.door(e.open);
        // (silent: the bay opening and closing for every load was only noise)
        return;
      }
      case 'unitOut': {
        const b = s.buildings.get(e.building);
        b?.unitOut(s.units.get(e.unit));
        if (b && BUILDING_ART[b.type]?.door) s.sounds.play('door', iso(b.gx, b.gy));
        return;
      }
      case 'hatch': {
        const t = s.units.get(e.unit);
        if (t instanceof VehicleSprite) t.hatch(e.open);
        return;
      }
      case 'boarded': {
        // he's gone from the view: drawn running up the ramp instead
        const t = s.units.get(e.transport);
        if (t instanceof VehicleSprite) this.boarding.board(e, t, this.droppedInfantry.get(e.unit)?.team ?? t.team);
        return;
      }
      case 'disembarked': {
        const t = s.units.get(e.transport);
        if (t instanceof VehicleSprite) s.units.get(e.unit)?.downRamp(t, e.side);
        return;
      }
      case 'unloaded': {
        const ref = s.buildings.get(e.refinery);
        if (ref) s.effects.floatText(ref.gx, ref.gy, `+${Math.round(e.credits).toLocaleString('en-US')}`);
        s.sounds.play('credits');
        return;
      }
      case 'toast':
        s.bus.emit('toast', { text: e.text, code: e.code });
        return;
      case 'buildingDone': {
        const b = s.buildings.get(e.id);
        if (b) s.sounds.play('building_done', iso(b.gx, b.gy));
        s.sounds.announce('announce_construction_complete');
        return;
      }
      case 'unitReady':
        s.sounds.announce('announce_unit_ready', 'unit_ready');
        return;
    }
  }

  /** A shot: drawn from its muzzle to its target and heard where it leaves, as its entry in data/shots.ts says. */
  private shot(e: Extract<MatchEvent, { e: 'shot' }>): void {
    const s = this.s;
    const from = s.units.get(e.from) ?? s.buildings.get(e.from);
    if (!from) return;
    const to = s.units.get(e.to) ?? s.buildings.get(e.to);
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
    const def = shotOf(p);
    // in its side's colour (a heal in its own green); energy balls and lasers from each of its guns at once
    const glow = isBuilding(from) || def.ownColour ? undefined : SIDE_GLOW[factionOfTeam(from.team)];
    // an Engineer welds where its arm meets the building: most of the way from it to the building, off the ground
    if (def.weld && to) {
      const c = isBuilding(to) ? { x: to.sprite.x, y: to.sprite.y } : iso(to.gx, to.gy);
      end = { x: start.x + (c.x - start.x) * 0.45, y: start.y + (c.y - start.y) * 0.45 - 6 };
    }
    // a column of light, a grenade or an artillery shell comes down on the ground under it (a building's centre)
    const onGround = def.strikesGround ? ground ?? (to ? { x: to.sprite.x, y: to.sprite.y } : undefined) : ground;
    const guns = from instanceof VehicleSprite ? from.guns() : [];
    s.effects.fire(p, start, guns, end, onGround, !(from instanceof HarvesterSprite), hit, glow);
    // bullets sound like what fires them: a soldier's rifle, a hovering unit's light gun, else an autocannon
    const fire = (from instanceof InfantrySprite && def.fireBy?.infantry)
      || (from instanceof VehicleSprite && meta(from.key).hover && def.fireBy?.hover)
      || def.fire;
    s.sounds.play(fire.find((k) => s.sounds.has(k)) ?? fire[0], start);
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
    if (!this.s.scenery.stamp(`scorch_${1 + (h % 4)}`, gx, gy, e.size / 2, area, e.id)) return false;
    if (e.size >= 3 && (h >>> 4) % 3 !== 0) this.s.scenery.stamp(`crater_${1 + ((h >>> 8) % 4)}`, gx, gy, e.size / 3, area, e.id + 1);
    return true;
  }

  private aimPoint(t: Entity | undefined, at: GridPoint) {
    if (t && isBuilding(t)) return { x: t.sprite.x, y: t.sprite.y - 40 * t.size };
    const p = iso(t ? t.gx : at.gx, t ? t.gy : at.gy);
    return { x: p.x, y: p.y - (t instanceof HarvesterSprite ? 30 : 16) };
  }
}
