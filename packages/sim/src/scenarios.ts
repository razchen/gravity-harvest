import { TEAMS, type GridPoint, type TeamId } from '@gravity-harvest/shared';
import type { Faction } from '@gravity-harvest/rules';
import type { Tile } from './geometry.js';

/** A map and starting position, as plain data. New maps are new entries here. Server-side only. */
export interface ScenarioDef {
  id: string;
  name: string;
  /** One or two sentences for the New Game screen. */
  description: string;
  map: { width: number; height: number };
  /** `credits: 'rules'` starts with the spreadsheet's starting credits. */
  players: Record<TeamId, { credits: number | 'rules'; human: boolean; faction: Faction }>;
  /**
   * Ore fields. One with `mirrorOf` copies that (earlier) field tile for tile and density for density, mirrored
   * left to right (tile tx <-> width - 1 - tx), so two mirrored bases get the same field.
   */
  oreFields: { centre: Tile; radius: number; seed: number; mirrorOf?: number }[];
  /** The map's halves mirror each other left to right: the landscape is grown on the left and mirrored (scenery.ts). */
  mirrorX?: boolean;
  /**
   * Gravity vents: the top-left tile of each one's 2 x 2 footprint. Each seeds a ring of ore around itself that never
   * runs out (ore.ts); `seed` shapes the ring's edge.
   */
  vents?: (Tile & { seed: number })[];
  buildings: { type: string; team: TeamId; tx: number; ty: number }[];
  units: { type: string; team: TeamId; gx: number; gy: number; guard?: boolean }[];
  /** Where each side's camera starts (over its own base). */
  camera: Record<TeamId, GridPoint>;
}

/** The seat a human plays: the first marked `human` (seat `a` when none is, as in computer-only matches). */
export const humanSeat = (players: Record<TeamId, { human: boolean }>): TeamId => TEAMS.find((t) => players[t].human) ?? 'a';

/**
 * 1v1 skirmish on an 88 x 48 map: your base in the top corner, the computer's in the right-hand corner, along the same
 * edge, hidden by fog of war. The two bases are mirror images of each other left to right (tile tx <-> 87 - tx), each with its own ore field
 * next to its refinery, and start alike: an assembly yard, a power plant, a refinery with its harvester, two riflemen
 * and the spreadsheet's starting credits. A gravity vent on the mirror line, between them and as far from both, keeps
 * ore coming once the home fields run dry. The yards are 82 tiles apart and the vent 42 from each, as on the old
 * 64 x 64 map (about as many tiles, too).
 *
 * *Why this mirror and not one through the middle (top corner against bottom corner, as it was):* the sprites are
 * rendered from one camera, so every refinery ramp and every building's exit faces the same way (+gy, down-left on
 * screen). Mirrored through the middle, the bottom base's ramps and exits faced the map edge: its harvesters drove 25%
 * further to their ore and to the vent, its units came out of the back of its buildings, and it had less room to
 * build. Mirrored left to right, both bases' ramps and exits face into the map. (The sprites can't
 * be drawn mirrored instead: their light and shadows, and the harvester's unload clip at the ramp, are rendered for one
 * side.) The ramp and the unit exits sit within 0.2 tiles of the middle of their buildings' fronts, so their mirror
 * images are as good as theirs. *Why 88 wide:* on the 64 x 64 map mirrored this way the bases were only 58 tiles apart;
 * as they grew towards each other their armies' gathering points came within reach of each other's defences, and the
 * armies wore each other down in the middle instead of attacking.
 */
export const SKIRMISH: ScenarioDef = {
  id: 'skirmish',
  name: 'Skirmish',
  description: 'Your base in the north, the enemy in the east, both starting alike, with a gravity vent between them. Scout through the fog, build up, and destroy every enemy building.',
  map: { width: 88, height: 48 },
  players: {
    a: { credits: 'rules', human: true, faction: 'ordan' },
    b: { credits: 'rules', human: false, faction: 'sable' },
  },
  oreFields: [
    { centre: { tx: 15, ty: 9 }, radius: 4.3, seed: 100 },
    { centre: { tx: 72, ty: 9 }, radius: 4.3, seed: 100, mirrorOf: 0 },
  ],
  mirrorX: true,
  // on the mirror line (tiles 43-44 across), between the bases
  vents: [{ tx: 43, ty: 10, seed: 102 }],
  buildings: [
    { type: 'assembly_yard', team: 'a', tx: 1, ty: 1 },
    { type: 'refinery', team: 'a', tx: 5, ty: 5 },
    { type: 'power_plant', team: 'a', tx: 10, ty: 1 },
    { type: 'assembly_yard', team: 'b', tx: 83, ty: 1 },
    { type: 'refinery', team: 'b', tx: 79, ty: 5 },
    { type: 'power_plant', team: 'b', tx: 75, ty: 1 },
  ],
  units: [
    { type: 'harvester', team: 'a', gx: 7.2, gy: 11.6 },
    { type: 'rifleman', team: 'a', gx: 9.2, gy: 12.2 },
    { type: 'rifleman', team: 'a', gx: 10.0, gy: 12.8 },
    { type: 'harvester', team: 'b', gx: 80.8, gy: 11.6 },
    { type: 'rifleman', team: 'b', gx: 78.8, gy: 12.2 },
    { type: 'rifleman', team: 'b', gx: 78.0, gy: 12.8 },
  ],
  // mirrored like the bases (gx <-> 88 - gx)
  camera: { a: { gx: 11, gy: 9 }, b: { gx: 77, gy: 9 } },
};

export const SCENARIOS: Readonly<Record<string, ScenarioDef>> = { [SKIRMISH.id]: SKIRMISH };

/**
 * A fingerprint of what a scenario puts on the field (map size, sides, ore fields, vents, starting buildings and units,
 * cameras; not its name or description). Saves keep only the scenario's id and rebuild the map from code, so a save
 * records this to tell when the map has changed under it since (FNV-1a over its JSON, as hex).
 */
export function scenarioHash(sc: ScenarioDef): string {
  const { map, players, oreFields, mirrorX, vents, buildings, units, camera } = sc;
  const s = JSON.stringify({ map, players, oreFields, mirrorX, vents, buildings, units, camera });
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}
