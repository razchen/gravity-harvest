import { Controller, Get } from '@nestjs/common';
import { ECONOMY } from '@gravity-harvest/rules';
import type { PlayableFaction, ScenarioSummary } from '@gravity-harvest/shared';
import { SCENARIOS } from '@gravity-harvest/sim';

/** The sides on the New Game screen (docs/FACTIONS.md). Sent from here so the names stay out of the game's code. */
const FACTIONS: ScenarioSummary['factions'] = [
  { id: 'ordan', name: 'Ordan', tagline: 'Controlled gravity, precision engineering, disciplined power.' },
  { id: 'sable', name: 'Sable', tagline: 'Compressed power, industrial aggression, overwhelming force.' },
];

/** The New Game list. Layouts (and enemy positions) stay on the server. */
@Controller('scenarios')
export class ScenariosController {
  @Get()
  list(): ScenarioSummary[] {
    return Object.values(SCENARIOS).map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      map: { ...s.map },
      startingCredits: s.players.player.credits === 'rules' ? ECONOMY.startingCredits : s.players.player.credits,
      factions: FACTIONS.map((f) => ({ ...f })),
      defaultFaction: s.players.player.faction as PlayableFaction,
    }));
  }
}
