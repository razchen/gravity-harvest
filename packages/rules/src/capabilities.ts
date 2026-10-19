// What an entity does beyond its numbers: the behaviours the simulation gives it, by role rather than by ID. Written by
// hand next to the generated rules, because the spreadsheet holds numbers, not engine behaviour. The sim, the AI and
// the browser ask for a role (`capabilitiesOf(id).refinery`, `withCapability('hover')`), never for an ID.
//
// Browser-safe (it's exported from ./public: the game draws turrets and hovering units from it), so it holds no rules
// data, and lists only entities that are in the match roster (packages/sim checks this).

export interface Capabilities {
  /** Mines ore and carries it to a refinery, where it's unloaded for credits. */
  harvester?: true;
  /** Harvesters dock at it and unload (its ramp must stay open); one finished during the match comes with a `grants`. */
  refinery?: { grants: string };
  /** Repairs the ground vehicle parked on its pad, paid as it goes (the tile in front of the pad must stay open). */
  repairsVehicles?: true;
  /** Buildings go up from it: a side without one can't place buildings, and what it has going up stops. */
  constructs?: true;
  /** A side's radar: online while it stands (offline on low power, if the rules say it needs power). */
  radar?: true;
  /** Unpacks into this building where it stands (it doesn't need to be near the base), in ENGINE.deploySec. */
  deploysInto?: string;
  /**
   * Its turret turns on its own (its art has a turret layer that's drawn turning): it aims the turret at what it
   * shoots instead of turning the hull, and fires on the move.
   */
  turret?: true;
  /**
   * Hovers (its art is rendered hovering: render_vehicle.py `hover`). Hovering units keep the rules of the soldiers
   * they replaced (they board transports, a Service Bay doesn't repair them), with a bigger body (ENGINE.hoverRadius).
   */
  hover?: true;
  /** Heals its side's damaged soldiers with its heal (a weapon with negative damage) instead of fighting. */
  heals?: true;
  /** Repairs its side's damaged buildings, for free, working at them from outside. */
  fixes?: true;
}

export const CAPABILITIES: Readonly<Record<string, Readonly<Capabilities>>> = {
  harvester: { harvester: true },
  refinery: { refinery: { grants: 'harvester' } },
  service_bay: { repairsVehicles: true },
  assembly_yard: { constructs: true },
  radar: { radar: true },
  assembler: { deploysInto: 'assembly_yard' },
  jackal: { turret: true },
  ram: { turret: true },
  spire: { turret: true },
  medic: { hover: true, heals: true },
  engineer: { hover: true, fixes: true },
  hound: { hover: true },
  lancer: { hover: true },
  operator: { hover: true },
  raider: { hover: true },
  infiltrator: { hover: true },
  grenadier: { hover: true },
  breaker: { hover: true },
};

const NONE: Readonly<Capabilities> = {};

/** What an entity does beyond its numbers (nothing, for most). */
export function capabilitiesOf(id: string): Readonly<Capabilities> {
  return CAPABILITIES[id] ?? NONE;
}

/** The entities that have a capability, in the table's order. */
export function withCapability(cap: keyof Capabilities): string[] {
  return Object.keys(CAPABILITIES).filter((id) => CAPABILITIES[id][cap] !== undefined);
}
