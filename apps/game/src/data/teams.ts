export type TeamId = 'player' | 'enemy';

export const opponent = (team: TeamId): TeamId => (team === 'player' ? 'enemy' : 'player');

export interface TeamDef {
  name: string;
  /** Multiplied into building and unit sprites; null keeps the rendered colours. */
  tint: number | null;
  minimapUnit: string;
  minimapBuilding: string;
}

export const TEAMS: Record<TeamId, TeamDef> = {
  player: { name: 'You', tint: null, minimapUnit: '#5aa2ff', minimapBuilding: '#c9c2b0' },
  enemy: { name: 'Enemy', tint: 0xff7a70, minimapUnit: '#ff4a3a', minimapBuilding: '#d8433a' },
};
