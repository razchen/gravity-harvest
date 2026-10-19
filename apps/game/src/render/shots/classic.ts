// The classic looks: the first shots the game drew, for the rules' projectiles that have no look of their own yet.
// render/Effects.ts draws and steps them (kit.classic); here is only which of its guns a shot leaves from.
import { HEAVY } from '../Effects';
import type { Look } from './kit';

/** Tracer rounds from the muzzle, a few of them missing (also what the rules' unpictured projectiles look like for now). */
export const bullets: Look = (kit, s) => kit.classic.bullets(s.from, s.to, s.ground, s.flash, kit.landed);

export const shell: Look = (kit, s) => kit.classic.round('shell', s.from, s, kit.landed);

export const fireball: Look = (kit, s) => kit.classic.round('fireball', s.from, s, kit.landed);

/** A ball of energy from each of its guns at once (the Hound's pods). */
export const plasma: Look = (kit, s) => {
  for (const from of s.guns.length ? s.guns : [s.from]) kit.classic.plasma(from, s, kit.landed);
};

/** A laser from each of its guns at once (the Lancers'). */
export const laser: Look = (kit, s) => {
  for (const from of s.guns.length ? s.guns : [s.from]) kit.classic.beam(from, s.to, false, s.glow, kit.landed);
};

/** A Medic's heal: a gentle beam, in its own green. */
export const healBeam: Look = (kit, s) => kit.classic.beam(s.from, s.to, true, s.glow, kit.landed);

/** An Engineer's repair: welding sparks where its arm works on the building. */
export const weld: Look = (kit, s) => kit.classic.weld(s.to);

export const column: Look = (kit, s) => kit.classic.column(s.from, s, kit.landed);

export const lobbedGrenade: Look = (kit, s) => kit.classic.grenade(s.from, s, kit.landed);

export const discharge: Look = (kit, s) => kit.classic.discharge(s.from, s.to, s.glow, kit.landed);

/** A missile from each of its pods in turn, a moment apart (one pod: a single missile). */
export const guidedMissile: Look = (kit, s) => {
  if (s.guns.length > 1) s.guns.forEach((g, i) => kit.classic.missile(g, s, kit.landed, i * HEAVY.missile.gapMs));
  else kit.classic.missile(s.from, s, kit.landed, 0);
};
