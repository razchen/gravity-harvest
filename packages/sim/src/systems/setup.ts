// A new match: the scenario's buildings, gravity vents, ore fields, grown scenery and starting units, with each side
// looking around before its harvesters go to work.
import { BUILDINGS, type Faction } from '@gravity-harvest/rules';
import { TEAMS, opponentOf, type Difficulty, type TeamId } from '@gravity-harvest/shared';
import type { Harvester } from '../entities.js';
import { FACTION_COUNTERPART, VENT_KIND, footprint, sceneryKind } from '../layout.js';
import { Rng } from '../rng.js';
import { humanSeat, type ScenarioDef } from '../scenarios.js';
import { growScenery } from '../scenery.js';
import { SimState } from '../state.js';
import { autoHarvest } from './harvesting.js';
import { addBuilding, addUnit } from './lifecycle.js';
import { refresh } from './power.js';
import { updateFog } from './visibility.js';

/** Options for a new match. */
export interface CreateOptions {
  /** The seat the human plays (the computer takes the other). Default: the scenario's human seat. */
  seat?: TeamId;
  /** How well the computer plays (each computer side). */
  difficulty?: Difficulty;
  /** The other side's faction, if not the opposite of the human's (mirror matches in simulations). */
  otherFaction?: Faction;
  /** Both sides played by the computer (AI against AI, headless simulations). */
  computerOnly?: boolean;
}

export function newMatch(sc: ScenarioDef, seed: number, faction: Faction | undefined, opts: CreateOptions): SimState {
  const s = new SimState(sc, seed);
  const seat = opts.seat ?? humanSeat(sc.players);
  if (opts.seat) for (const t of TEAMS) s.players[t].human = t === seat;
  if (faction) {
    s.players[seat].faction = faction;
    s.players[opponentOf(seat)].faction = faction === 'ordan' ? 'sable' : 'ordan';
  }
  if (opts.otherFaction) s.players[opponentOf(seat)].faction = opts.otherFaction;
  for (const t of TEAMS) {
    if (opts.difficulty) s.players[t].difficulty = opts.difficulty;
    if (opts.computerOnly) s.players[t].human = false;
  }
  // starting buildings of the other faction become the owner's own counterpart
  const buildings = sc.buildings.map((b) => {
    const f = BUILDINGS[b.type].faction;
    return f !== 'both' && f !== s.players[b.team].faction && FACTION_COUNTERPART[b.type] ? { ...b, type: FACTION_COUNTERPART[b.type] } : b;
  });
  for (const b of buildings) addBuilding(s, b.type, b.team, b.tx, b.ty, true);
  // gravity vents block their footprint before any ore is laid, so their rings go round them
  const vents = (sc.vents ?? []).map((v) => {
    const size = sceneryKind(VENT_KIND).size;
    s.map.setFootprint(v.tx, v.ty, size, true);
    return { id: s.nextId++, kind: VENT_KIND, tx: v.tx, ty: v.ty, gx: v.tx + size / 2, gy: v.ty + size / 2, scale: 1 };
  });
  sc.oreFields.forEach((f, i) => {
    if (f.mirrorOf !== undefined) s.ore.addMirroredField(i, f.mirrorOf, sc.map.width);
    else s.ore.addField(i, f.centre, f.radius, new Rng(f.seed));
  });
  (sc.vents ?? []).forEach((v, i) => s.ore.addVent(sc.oreFields.length + i, v, new Rng(v.seed)));
  s.ore.placeRocks(s.rng, () => s.nextId++);
  s.scenery = [...vents, ...growScenery(s.map, s.ore, { buildings: buildings.map((b) => ({ ...b, size: footprint(b.type) })), units: sc.units, mirrorX: sc.mirrorX }, s.rng, () => s.nextId++)];
  const harvesters: Harvester[] = [];
  for (const u of sc.units) {
    const unit = addUnit(s, u.type, u.team, u.gx, u.gy);
    if (unit.kind === 'harvester') harvesters.push(unit);
    else if (u.guard) unit.post = { gx: u.gx, gy: u.gy };
  }
  refresh(s);
  updateFog(s);
  // harvesters go to work once their side has looked around: the nearest field it can see
  for (const h of harvesters) autoHarvest(s, h, true);
  return s;
}
