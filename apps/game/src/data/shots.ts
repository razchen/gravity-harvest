// How every shot looks and sounds, keyed by what it fires: a unit's own `fire` (data/registry.ts), else the rules'
// projectile (and the sim's own two: an Engineer's 'repair', a heal's 'beam'). The server decides hits and damage; this
// is only the look. Every projectile the rules have needs an entry (data/content.test.ts).

/** The looks in render/shots, by name (render/shots/index.ts has one for each). */
export type LookName =
  // the units' own looks
  | 'rapid autocannon' | 'heavy autocannon' | 'light shell' | 'battle shell' | 'artillery shell' | 'twin plasma'
  | 'frag grenade' | 'light column' | 'arc bolt'
  // the classic looks (render/shots/classic.ts)
  | 'bullets' | 'shell' | 'fireball' | 'plasma' | 'laser' | 'heal beam' | 'weld' | 'column' | 'lobbed grenade'
  | 'discharge' | 'guided missile';

export interface ShotDef {
  look: LookName;
  /** Its sound as it leaves: the first of these the game has, so a newer sound falls back to an older one until it's picked. */
  fire: string[];
  /** For bullets, by what fires them: a soldier's rifle, a hovering unit's light gun (`fire` is the rest: vehicles' and defences' autocannons). */
  fireBy?: { infantry?: string[]; hover?: string[] };
  /** Its sound where it lands (a round that misses is silent). None: it lands quietly (a heal, a weld). */
  impact?: 'bullet_hit' | 'shell_hit';
  /** It comes down on the ground: at a building it's aimed at its centre on the ground, not its middle. */
  strikesGround?: boolean;
  /** Drawn in its own colour, not its side's energy colour (a heal's green). */
  ownColour?: boolean;
  /** An Engineer's weld: drawn where its arm meets the building, most of the way to it and off the ground. */
  weld?: boolean;
}

/** Plain bullets, heard by what fires them. */
const GUN: ShotDef = { look: 'bullets', fire: ['autocannon_fire'], fireBy: { infantry: ['rifle_fire'], hover: ['rifle_fire'] }, impact: 'bullet_hit' };

export const SHOTS: Readonly<Record<string, ShotDef>> = {
  // the units' own looks, by what they fire
  'rapid autocannon': { look: 'rapid autocannon', fire: ['autocannon_fire'], impact: 'bullet_hit' },
  'heavy autocannon': { look: 'heavy autocannon', fire: ['autocannon_fire'], impact: 'bullet_hit' },
  'light shell': { look: 'light shell', fire: ['cannon_fire'], impact: 'shell_hit' },
  'battle shell': { look: 'battle shell', fire: ['cannon_fire'], impact: 'shell_hit' },
  'artillery shell': { look: 'artillery shell', fire: ['artillery_fire'], impact: 'shell_hit', strikesGround: true },
  'twin plasma': { look: 'twin plasma', fire: ['plasma_fire', 'discharge_fire'], impact: 'bullet_hit' },
  'frag grenade': { look: 'frag grenade', fire: ['grenade_throw'], impact: 'shell_hit', strikesGround: true },
  'light column': { look: 'light column', fire: ['column_fire', 'discharge_fire'], impact: 'shell_hit', strikesGround: true },
  'arc bolt': { look: 'arc bolt', fire: ['discharge_fire'], impact: 'bullet_hit' },

  // the rules' projectiles
  bullet: GUN,
  shell: { look: 'shell', fire: ['cannon_fire'], impact: 'shell_hit' },
  // artillery: a shell for now (no arc yet)
  'ballistic shell': { look: 'shell', fire: ['artillery_fire'], impact: 'shell_hit' },
  fireball: { look: 'fireball', fire: ['flame_fire'], impact: 'shell_hit' },
  'instant discharge': { look: 'discharge', fire: ['discharge_fire'], impact: 'shell_hit' },
  plasma: { look: 'plasma', fire: ['plasma_fire', 'discharge_fire'], impact: 'bullet_hit' },
  laser: { look: 'laser', fire: ['laser_fire', 'discharge_fire'], impact: 'bullet_hit' },
  column: { look: 'column', fire: ['column_fire', 'discharge_fire'], impact: 'shell_hit', strikesGround: true },
  'guided missile': { look: 'guided missile', fire: ['rocket_launch'], impact: 'shell_hit' },
  'lobbed grenade': { look: 'lobbed grenade', fire: ['grenade_throw'], impact: 'shell_hit', strikesGround: true },
  beam: { look: 'heal beam', fire: ['heal_beam'], ownColour: true },
  repair: { look: 'weld', fire: ['self_repair', 'building_place'], weld: true },
  // heard as themselves, drawn as bullets until they have a look
  flame: { look: 'bullets', fire: ['flamethrower_fire', 'flame_fire'], impact: 'bullet_hit' },
  'heavy missile': { look: 'bullets', fire: ['heavy_missile_launch', 'rocket_launch'], impact: 'bullet_hit' },
  leap: { look: 'bullets', fire: ['hound_strike'], impact: 'bullet_hit' },
  // seen and heard as bullets until they have a look and a sound
  'aa projectile': GUN,
  'depth charge': GUN,
  torpedo: GUN,
};

const warned = new Set<string>();

/** The shot `p` fires (a weapon with no projectile fires bullets). */
export function shotOf(p: string | undefined): ShotDef {
  const def = SHOTS[p ?? 'bullet'];
  if (def) return def;
  // the content test keeps this from happening; should it anyway, say so once rather than quietly drawing bullets
  if (!warned.has(p!)) console.warn(`No shot look for "${p}" in data/shots.ts: drawn as bullets`);
  warned.add(p!);
  return GUN;
}
