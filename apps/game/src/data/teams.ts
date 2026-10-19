// Whose things are whose. The server names the two sides by seat (`a`, `b`) and says in the hello which one you
// play and each side's faction; everything on screen goes by "yours" or "theirs", never by seat, so you can sit on
// either side.
import type { MatchHello, PlayableFaction, TeamId } from '@gravity-harvest/shared';

export type { TeamId };

export interface TeamDef {
  name: string;
  /** Multiplied into building and unit sprites; null keeps the rendered colours. */
  tint: number | null;
  minimapUnit: string;
  minimapBuilding: string;
}

/** How each side is drawn: yours in your own colours, theirs in hostile red. */
export const SIDES: Readonly<Record<'mine' | 'theirs', TeamDef>> = {
  mine: { name: 'You', tint: null, minimapUnit: '#5aa2ff', minimapBuilding: '#c9c2b0' },
  theirs: { name: 'Enemy', tint: 0xff7a70, minimapUnit: '#ff4a3a', minimapBuilding: '#d8433a' },
};

// Until a hello arrives (the dev pages never get one): you in the first seat, the scenario's default factions.
let you: TeamId = 'a';
let factions: Record<TeamId, PlayableFaction> = { a: 'ordan', b: 'sable' };

/** Called when a match starts (from the hello). */
export function setSeats(h: Pick<MatchHello, 'you' | 'factions'>): void {
  you = h.you;
  factions = { ...h.factions };
}

/** The seat you play. */
export const myTeam = (): TeamId => you;
export const isMine = (team: TeamId): boolean => team === you;
/** How `team`'s things are drawn. */
export const colourOf = (team: TeamId): TeamDef => SIDES[isMine(team) ? 'mine' : 'theirs'];
/** The faction `team` plays, as the server reported it (both sides can play the same one). */
export const factionOfTeam = (team: TeamId): PlayableFaction => factions[team];
