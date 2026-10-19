import type { Command } from '@gravity-harvest/shared';
import type { Sounds } from '../audio/Sounds';
import type { UnitSprite } from '../entities/UnitSprite';
import type { MatchClient } from '../net/MatchClient';
import type { Effects } from '../render/Effects';

/** Where an order lands, marked on the map: a move (a tile), an attack-move (a tile), or an attack's target (a ring round it). */
export type OrderMarker =
  | { kind: 'move' | 'attackMove'; tx: number; ty: number }
  | { kind: 'target'; gx: number; gy: number; scale: number };

/** The unit type most of a selection is (the first of them on a tie): whose voice answers for the group. */
export function leadType(units: Iterable<UnitSprite>): string {
  const n = new Map<string, number>();
  for (const u of units) n.set(u.type, (n.get(u.type) ?? 0) + 1);
  let best = '';
  for (const [type, c] of n) if (c > (n.get(best) ?? 0)) best = type;
  return best;
}

/**
 * Every order the player gives goes out through here, from the HUD and from the mouse alike: one place for what an
 * order shows and says straight away (its marker, the units answering), so the round trip to the server isn't felt.
 */
export class Orders {
  constructor(private readonly net: MatchClient, private readonly effects: Effects, private readonly sounds: Sounds) {}

  /** Send an order to the server (it checks it, and has the final say). */
  send(cmd: Command): void {
    this.net.command(cmd);
  }

  /** Mark where an order lands. */
  mark(m: OrderMarker): void {
    if (m.kind === 'target') this.effects.targetMarker(m.gx, m.gy, m.scale);
    else if (m.kind === 'attackMove') this.effects.attackMoveMarker(m.tx, m.ty);
    else this.effects.moveMarker(m.tx, m.ty);
  }

  /** `units` answer an order, in the voice of the most of them: the first of `as` that voice has (an unarmed unit sent to attack says it's moving). */
  answer(units: Iterable<UnitSprite>, ...as: ('move' | 'attack')[]): void {
    const lead = leadType(units);
    this.sounds.answer(as.map((a) => `ack_${lead}_${a}`));
  }
}
