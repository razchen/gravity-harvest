// Every shot look, by name: one file per unit's own look, and the classic looks (classic.ts) for the rules'
// projectiles that have none of their own yet. Which shot gets which look is data/shots.ts.
import type { LookName } from '../../data/shots';
import { arcBolt } from './arcBolt';
import { artilleryShell } from './artilleryShell';
import { battleShell } from './battleShell';
import * as classic from './classic';
import { fragGrenade } from './fragGrenade';
import { heavyAutocannon } from './heavyAutocannon';
import type { Look } from './kit';
import { lightColumn } from './lightColumn';
import { lightShell } from './lightShell';
import { rapidAutocannon } from './rapidAutocannon';
import { twinPlasma } from './twinPlasma';

export const LOOKS: Readonly<Record<LookName, Look>> = {
  'rapid autocannon': rapidAutocannon,
  'heavy autocannon': heavyAutocannon,
  'light shell': lightShell,
  'battle shell': battleShell,
  'artillery shell': artilleryShell,
  'twin plasma': twinPlasma,
  'frag grenade': fragGrenade,
  'light column': lightColumn,
  'arc bolt': arcBolt,
  bullets: classic.bullets,
  shell: classic.shell,
  fireball: classic.fireball,
  plasma: classic.plasma,
  laser: classic.laser,
  'heal beam': classic.healBeam,
  weld: classic.weld,
  column: classic.column,
  'lobbed grenade': classic.lobbedGrenade,
  discharge: classic.discharge,
  'guided missile': classic.guidedMissile,
};
