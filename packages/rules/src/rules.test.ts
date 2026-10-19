import { describe, expect, it } from 'vitest';
import {
  ABILITIES, BUILDINGS, CATALOG, CRATES, DAMAGE_MATRIX, ECONOMY, ENGINE_RULES, UNITS, WEAPONS, buildOrder, canBuild, creditsFor, damageMultiplier, dependentsOf, directlyUnlocks,
  effectiveDps, fullLoadCredits, hitDamage, isOperational, loadoutDps, missingRequirements, powerBalance, prerequisiteClosure,
  producersOf, productionOf, rawDps, refundFor, repairCost, speedToTilesPerSec, timeToKillSec, validateCatalog, validateCombat,
} from './index.js';
import { PUBLIC_BUILDINGS, PUBLIC_CATALOG, PUBLIC_UNITS } from './public.js';

describe('imported data', () => {
  it('has the whole roster', () => {
    expect(Object.keys(BUILDINGS)).toHaveLength(33);
    expect(Object.keys(UNITS)).toHaveLength(33);
    expect(Object.keys(WEAPONS)).toHaveLength(30);
  });

  it('is internally consistent (references, factions, stages, no cycles)', () => {
    expect(validateCatalog(CATALOG)).toEqual([]);
    expect(validateCombat()).toEqual([]);
  });

  it('matches spot values from the spreadsheet', () => {
    expect(ECONOMY.startingCredits).toBe(15000);
    expect(BUILDINGS.power_plant).toMatchObject({ cost: 450, hp: 1600, power: 500, buildTimeSec: 14.4, prerequisites: ['assembly_yard'] });
    expect(BUILDINGS.radar).toMatchObject({ power: -200, requiresPower: true, prerequisites: ['refinery'] });
    expect(UNITS.rifleman).toMatchObject({ cost: 150, hp: 200, armor: 'unarmored', weapons: ['service_rifle'] });
    expect(UNITS.operator.prerequisites).toEqual([['gravity_lab', 'gravity_forge']]);
    expect(UNITS.lander.producedAt).toEqual(['harbor', 'sub_dock']);
  });
});

describe('rule data (not read by the simulation yet)', () => {
  it('imports the rule columns and sheets', () => {
    expect(WEAPONS.sky_missile).toMatchObject({ hitsAir: true, hitsGround: false, instantHit: false, projectileSpeedTilesPerSec: 7.5 });
    expect(WEAPONS.service_rifle).toMatchObject({ instantHit: true, projectileSpeedTilesPerSec: null });
    expect(DAMAGE_MATRIX.high_explosive).toMatchObject({ damagesWalls: true, falloffStepTiles: 0.1172 });
    expect(UNITS.anvil).toMatchObject({ selfHeals: true, crushes: true });
    expect(UNITS.grenadier).toMatchObject({ explodesOnDeath: true, deathExplosionDamage: UNITS.grenadier.hp });
    expect(BUILDINGS.concrete_barrier).toMatchObject({ wallDamageLevels: 3, blocksLowShots: true, crushableWall: false });
    expect(ABILITIES.strategic_missile).toMatchObject({ damage: 800, radiusTiles: 3, warnsOpponent: true, pausesOnLowPower: true });
    expect(ENGINE_RULES.storage_cap.inGame).toBe('Ours differs (kept)');
  });

  it('is consistent with the rest of the workbook', () => {
    const perCredit = ENGINE_RULES.build_seconds_per_credit.value as number;
    for (const e of [...Object.values(BUILDINGS), ...Object.values(UNITS)]) expect(e.buildTimeSec).toBeCloseTo(e.cost * perCredit, 2);
    for (const a of Object.values(ABILITIES)) if (a.damageClass) expect(DAMAGE_MATRIX).toHaveProperty(a.damageClass);
    expect(Object.values(CRATES).reduce((sum, c) => sum + (c.chance ?? 0), 0)).toBeCloseTo(1, 2);
  });
});

describe('economy calculations', () => {
  it('full loads are capacity × value (the sheet computes 1050 / 2100)', () => {
    expect(fullLoadCredits('common')).toBe(1050);
    expect(fullLoadCredits('rare')).toBe(2100);
    expect(creditsFor(4, 'common')).toBe(150);
  });

  it('refunds half, repairs cost 20% of cost for a full repair', () => {
    expect(refundFor(3000)).toBe(1500);
    expect(refundFor(37.5)).toBe(18);
    expect(repairCost('refinery', 1)).toBe(600);
    expect(repairCost('harvester', 0.5)).toBe(210);
  });

  it('converts spreadsheet speed to tiles per second', () => {
    expect(speedToTilesPerSec(UNITS.rifleman.speed)).toBeCloseTo(1.4);
    expect(speedToTilesPerSec(UNITS.harvester.speed)).toBeCloseTo(2.1);
  });
});

describe('power', () => {
  it('sums production and consumption', () => {
    expect(powerBalance(['power_plant', 'refinery', 'barracks'])).toEqual({ produced: 500, consumed: 250, surplus: 250, low: false });
    const low = powerBalance(['power_plant', 'refinery', 'radar', 'gravity_lab']);
    expect(low.low).toBe(true);
    expect(isOperational('radar', low)).toBe(false);
    expect(isOperational('refinery', low)).toBe(true); // refineries don't require power
  });
});

describe('combat calculations', () => {
  it('applies the damage matrix', () => {
    expect(damageMultiplier('small_arms', 'heavy')).toBe(0.25);
    expect(hitDamage('service_rifle', 'unarmored')).toBe(60);
    expect(hitDamage('service_rifle', 'heavy')).toBe(15);
    expect(hitDamage('precision_sidearm', 'structure')).toBeCloseTo(10);
    expect(hitDamage('field_heal', 'unarmored')).toBe(-200); // heals
  });

  it('DPS before and after armor, with bursts', () => {
    expect(rawDps('service_rifle')).toBeCloseTo(45, 1);
    expect(rawDps('anvil_cannon')).toBeCloseTo(60, 1); // 160 × 2 / 5.333
    expect(effectiveDps('battle_cannon', 'heavy')).toBeCloseTo(36, 1);
    expect(loadoutDps('goliath', 'heavy')).toBeCloseTo(2 * (120 / 4.667), 1); // twin guns
  });

  it('time to kill', () => {
    // 200 HP rifleman, 60 per shot → 4 shots, first immediate: 3 intervals
    expect(timeToKillSec('service_rifle', 'rifleman')).toBeCloseTo(3 * 1.333, 3);
    expect(timeToKillSec('field_heal', 'rifleman')).toBe(Infinity);
  });
});

describe('dependencies', () => {
  it('tracks prerequisites and alternatives', () => {
    expect(missingRequirements(CATALOG, 'refinery', [])).toEqual([['power_plant']]);
    expect(canBuild(CATALOG, 'refinery', 'ordan', ['assembly_yard', 'power_plant'])).toBe(true);
    expect(canBuild(CATALOG, 'gravity_lab', 'sable', ['motor_works', 'radar'])).toBe(false); // Ordan only
    // Operator needs a barracks plus either faction's tech building
    expect(missingRequirements(CATALOG, 'operator', ['barracks'])).toEqual([['gravity_lab', 'gravity_forge']]);
    expect(missingRequirements(CATALOG, 'operator', ['barracks', 'gravity_forge'])).toEqual([]);
  });

  it('can treat buildings outside a reduced roster as owned', () => {
    expect(canBuild(CATALOG, 'power_plant', 'ordan', [], { assumeOwned: new Set(['assembly_yard']) })).toBe(true);
  });

  it('knows producers, products and what a building unlocks', () => {
    expect(producersOf(CATALOG, 'lander', 'ordan')).toEqual(['harbor']);
    expect(producersOf(CATALOG, 'lander', 'sable')).toEqual(['sub_dock']);
    expect(productionOf(CATALOG, 'barracks')).toContain('rifleman');
    expect(directlyUnlocks(CATALOG, 'power_plant')).toEqual(expect.arrayContaining(['refinery', 'barracks', 'reactor_plant']));
    expect(dependentsOf(CATALOG, 'refinery')).toEqual(expect.arrayContaining(['motor_works', 'radar', 'harvester', 'gravity_lab', 'phase_array']));
    expect(prerequisiteClosure(CATALOG, 'phase_array')).toEqual(expect.arrayContaining(['gravity_lab', 'motor_works', 'radar', 'refinery', 'power_plant', 'assembly_yard']));
  });

  it('orders buildings so prerequisites come first', () => {
    const order = buildOrder(CATALOG);
    for (const b of Object.values(BUILDINGS)) for (const p of b.prerequisites) expect(order.indexOf(p)).toBeLessThan(order.indexOf(b.id));
  });
});

describe('public subset', () => {
  it('has the same entities and dependency answers, but no combat data', () => {
    expect(Object.keys(PUBLIC_BUILDINGS)).toEqual(Object.keys(BUILDINGS));
    expect(Object.keys(PUBLIC_UNITS)).toEqual(Object.keys(UNITS));
    expect(missingRequirements(PUBLIC_CATALOG, 'operator', ['barracks'])).toEqual(missingRequirements(CATALOG, 'operator', ['barracks']));
    for (const e of [...Object.values(PUBLIC_BUILDINGS), ...Object.values(PUBLIC_UNITS)]) {
      for (const secret of ['hp', 'armor', 'weapons', 'sight', 'speed', 'notes']) expect(e).not.toHaveProperty(secret);
    }
  });
});
