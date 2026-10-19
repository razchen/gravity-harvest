// Each unit's own shot look, by its UNIT_ART `fire` key (data/art.ts): one file per look. Projectiles without one here
// are drawn by render/Effects.ts's older looks (bullets, shells, missiles, beams...).
import { arcBolt } from './arcBolt';
import { artilleryShell } from './artilleryShell';
import { battleShell } from './battleShell';
import { fragGrenade } from './fragGrenade';
import { heavyAutocannon } from './heavyAutocannon';
import type { Look } from './kit';
import { lightColumn } from './lightColumn';
import { lightShell } from './lightShell';
import { rapidAutocannon } from './rapidAutocannon';
import { twinPlasma } from './twinPlasma';

export const LOOKS: Record<string, Look> = {
  'rapid autocannon': rapidAutocannon,
  'heavy autocannon': heavyAutocannon,
  'light shell': lightShell,
  'battle shell': battleShell,
  'artillery shell': artilleryShell,
  'twin plasma': twinPlasma,
  'frag grenade': fragGrenade,
  'light column': lightColumn,
  'arc bolt': arcBolt,
};

/** Looks that come down on the ground: at a building they're aimed at its centre on the ground, not its middle. */
export const STRIKES_GROUND: ReadonlySet<string> = new Set(['column', 'lobbed grenade', 'light column', 'frag grenade', 'artillery shell']);
