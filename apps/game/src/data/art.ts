// How each enabled entity looks. Keyed by the rules ID (design/balance.xlsx). Gameplay numbers are not here:
// the server owns them, and sends the browser only the roster's names, costs and prerequisites (MatchCatalog).

export interface BuildingArt {
  /** Its construction atlas (assets/manifest.ts): it goes up stage by stage, and the last stage is the finished building. */
  sprite: string;
  /** Build-panel card image. */
  card: string;
  /** The doorway units come out of, if it has a door (render/DoorExit.ts). */
  door?: Doorway;
}

/**
 * A doorway in the building's lower-left face (the side the sim brings units out of), in its frame's pixels: the
 * opening's bottom-centre on the ground, and its width and height. Measured by eye on the door's open frame (a
 * door video's whole front moves as it opens, so the opening can't be told from the frames reliably).
 */
export interface Doorway {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface UnitArt {
  /** Atlas key. */
  sprite: string;
  card: string;
  /**
   * The harvester has its own sheet (16 directions, wheel frames); vehicles are 16 directions (`v_<id>_<d>`,
   * tools/blender/render_vehicle.py); infantry 16 directions with a run cycle, and their death in `<sprite>_death`
   * (tools/blender/make_infantry.py).
   */
  kind: 'harvester' | 'vehicle' | 'infantry';
}

export const BUILDING_ART: Readonly<Record<string, BuildingArt>> = {
  assembly_yard: { sprite: 'b_assembly_build', card: 'assets/ui/assembly_yard.png' },
  power_plant: { sprite: 'b_power_plant_build', card: 'assets/ui/power_plant.png' },
  reactor_plant: { sprite: 'b_reactor_plant_build', card: 'assets/ui/reactor_plant.png' },
  refinery: { sprite: 'b_refinery_build', card: 'assets/ui/refinery.png' },
  barracks: { sprite: 'b_barracks_build', card: 'assets/ui/barracks.png', door: { x: 108, y: 183, w: 50, h: 34 } },
  radar: { sprite: 'b_radar_build', card: 'assets/ui/radar.png' },
  motor_works: { sprite: 'b_motor_works_build', card: 'assets/ui/motor_works.png', door: { x: 80, y: 188, w: 52, h: 36 } },
  service_bay: { sprite: 'b_service_bay_build', card: 'assets/ui/service_bay.png' },
  gravity_lab: { sprite: 'b_gravity_lab_build', card: 'assets/ui/gravity_lab.png' },
  gravity_forge: { sprite: 'b_gravity_forge_build', card: 'assets/ui/gravity_forge.png' },
  sentry: { sprite: 'b_sentry_build', card: 'assets/ui/sentry.png' },
  lance_battery: { sprite: 'b_lance_battery_build', card: 'assets/ui/lance_battery.png' },
  incinerator: { sprite: 'b_incinerator_build', card: 'assets/ui/incinerator.png' },
  anchor: { sprite: 'b_anchor_build', card: 'assets/ui/anchor.png' },
  hound_kennel: { sprite: 'b_hound_kennel_build', card: 'assets/ui/hound_kennel.png' },
};

export const UNIT_ART: Readonly<Record<string, UnitArt>> = {
  harvester: { sprite: 'harvester', card: 'assets/ui/harvester.png', kind: 'harvester' },
  skimmer: { sprite: 'v_skimmer', card: 'assets/ui/skimmer.png', kind: 'vehicle' },
  jackal: { sprite: 'v_jackal', card: 'assets/ui/jackal.png', kind: 'vehicle' },
  ram: { sprite: 'v_ram', card: 'assets/ui/ram.png', kind: 'vehicle' },
  spire: { sprite: 'v_spire', card: 'assets/ui/spire.png', kind: 'vehicle' },
  carrier: { sprite: 'v_carrier', card: 'assets/ui/carrier.png', kind: 'vehicle' },
  watcher: { sprite: 'v_watcher', card: 'assets/ui/watcher.png', kind: 'vehicle' },
  shroud: { sprite: 'v_shroud', card: 'assets/ui/shroud.png', kind: 'vehicle' },
  seeder: { sprite: 'v_seeder', card: 'assets/ui/seeder.png', kind: 'vehicle' },
  assembler: { sprite: 'v_assembler', card: 'assets/ui/assembler.png', kind: 'vehicle' },
  rifleman: { sprite: 'rifleman', card: 'assets/ui/rifleman.png', kind: 'infantry' },
  medic: { sprite: 'medic', card: 'assets/ui/medic.png', kind: 'infantry' },
  raider: { sprite: 'raider', card: 'assets/ui/raider.png', kind: 'infantry' },
  infiltrator: { sprite: 'infiltrator', card: 'assets/ui/infiltrator.png', kind: 'infantry' },
};

/** Wheel circumference is ~0.6 tile, 8 frames per turn. */
export const WHEEL_FRAMES_PER_TILE = 13;
