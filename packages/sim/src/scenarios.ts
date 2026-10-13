import type { GridPoint, TeamId } from '@gravity-harvest/shared';
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
  oreFields: { centre: Tile; radius: number; seed: number }[];
  buildings: { type: string; team: TeamId; tx: number; ty: number }[];
  units: { type: string; team: TeamId; gx: number; gy: number; guard?: boolean }[];
  /** Where the human's camera starts. */
  camera: GridPoint;
}

/**
 * 1v1 skirmish on a 64 x 64 map: your base in the top corner (assembly yard, power plant, refinery, a harvester, two riflemen),
 * the enemy base in the bottom corner, guarded and hidden by fog of war.
 */
export const SKIRMISH: ScenarioDef = {
  id: 'skirmish',
  name: 'Skirmish',
  description: 'Your base in the north, the enemy entrenched in the south. Scout through the fog, build up, and destroy every enemy building.',
  map: { width: 64, height: 64 },
  players: {
    player: { credits: 'rules', human: true, faction: 'ordan' },
    enemy: { credits: 0, human: false, faction: 'sable' },
  },
  oreFields: [
    { centre: { tx: 15, ty: 9 }, radius: 4.3, seed: 100 },
    { centre: { tx: 44, ty: 42 }, radius: 4.3, seed: 101 },
  ],
  buildings: [
    { type: 'assembly_yard', team: 'player', tx: 1, ty: 1 },
    { type: 'refinery', team: 'player', tx: 5, ty: 5 },
    { type: 'power_plant', team: 'player', tx: 10, ty: 1 },
    { type: 'refinery', team: 'enemy', tx: 54, ty: 51 },
    { type: 'barracks', team: 'enemy', tx: 49, ty: 56 },
    { type: 'power_plant', team: 'enemy', tx: 58, ty: 46 },
    { type: 'power_plant', team: 'enemy', tx: 54, ty: 46 },
    { type: 'radar', team: 'enemy', tx: 46, ty: 50 },
    { type: 'assembly_yard', team: 'enemy', tx: 59, ty: 55 },
    { type: 'incinerator', team: 'enemy', tx: 51, ty: 47 },
  ],
  units: [
    { type: 'harvester', team: 'player', gx: 7.2, gy: 11.6 },
    { type: 'rifleman', team: 'player', gx: 9.2, gy: 12.2 },
    { type: 'rifleman', team: 'player', gx: 10.0, gy: 12.8 },
    { type: 'rifleman', team: 'enemy', gx: 52, gy: 49, guard: true },
    { type: 'rifleman', team: 'enemy', gx: 55, gy: 49.5, guard: true },
    { type: 'rifleman', team: 'enemy', gx: 50, gy: 54, guard: true },
    { type: 'rifleman', team: 'enemy', gx: 57, gy: 55, guard: true },
    { type: 'rifleman', team: 'enemy', gx: 47, gy: 48.5, guard: true },
    { type: 'rifleman', team: 'enemy', gx: 52, gy: 58, guard: true },
  ],
  camera: { gx: 11, gy: 9 },
};

export const SCENARIOS: Readonly<Record<string, ScenarioDef>> = { [SKIRMISH.id]: SKIRMISH };
