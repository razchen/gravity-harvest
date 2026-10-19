// Imports design/balance.xlsx (the source of truth for rules and economy) into:
//   src/generated/balance.ts   full typed data (server / simulation only)
//   src/generated/public.ts    the subset the browser may see (names, costs, power, build times, prerequisites)
//   docs/rules/*.md            human-readable reference, generated from the same data
// Run: npm run import --workspace @gravity-harvest/rules   (re-run whenever the spreadsheet changes)
// With --check: write nothing, fail if any generated file is out of date (run by the package's tests).
// Only raw inputs are imported; derived values (full loads, DPS) are computed in src/calc.ts.

import { readWorkbook } from './xlsx-reader.mjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const XLSX = join(ROOT, 'design', 'balance.xlsx');
const GEN = join(HERE, '..', 'src', 'generated');
const DOCS = join(ROOT, 'docs', 'rules');

const CHECK = process.argv.includes('--check');
const stale = [];
/** Write a generated file, or in --check mode record it if its content differs. */
function emit(path, content) {
  if (CHECK) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== content) stale.push(path);
  } else writeFileSync(path, content);
}

const wb = readWorkbook(XLSX);
/** Column letters A, B, ... Z, AA, AB, ... (enough for every sheet). */
const COLS = Array.from({ length: 78 }, (_, i) => (i < 26 ? '' : String.fromCharCode(64 + Math.floor(i / 26))) + String.fromCharCode(65 + (i % 26)));

/** Rows of a sheet as objects keyed by the header row (row 3 in this workbook). */
function table(sheetName, headerRow = 3) {
  const cells = wb.sheet(sheetName);
  const headers = COLS.map((c) => (cells[`${c}${headerRow}`] !== undefined ? String(cells[`${c}${headerRow}`]).trim() : null));
  const maxRow = Math.max(...Object.keys(cells).map((k) => Number(k.replace(/^[A-Z]+/, ''))));
  const rows = [];
  for (let r = headerRow + 1; r <= maxRow; r++) {
    const obj = {};
    let any = false;
    headers.forEach((h, i) => {
      if (!h) return;
      const v = cells[`${COLS[i]}${r}`];
      obj[h] = v ?? null;
      if (v !== undefined) any = true;
    });
    if (any) rows.push(obj);
  }
  return rows;
}

const str = (v) => (v === null || v === undefined ? null : String(v).trim() || null);
const num = (v, what) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Not a number for ${what}: ${v}`);
  return n;
};
const bool = (v) => v === true || String(v).toLowerCase() === 'true';
/** Optional yes/no column: blank stays null. */
const flag = (v) => (v === null || v === undefined || v === '' ? null : bool(v));
const list = (v, sep = ',') => (str(v) ? String(v).split(sep).map((s) => s.trim()).filter(Boolean) : []);
const faction = (v) => {
  const f = str(v)?.toLowerCase();
  if (f === 'both') return 'both';
  if (f === 'ordan' || f === 'sable') return f;
  throw new Error(`Unknown faction "${v}"`);
};
const ARMOR = { unarmored: 'unarmored', structure: 'structure', light: 'light', heavy: 'heavy', fortified: 'fortified' };
const armor = (v) => {
  const a = ARMOR[str(v)?.toLowerCase()];
  if (!a) throw new Error(`Unknown armor "${v}"`);
  return a;
};

// --- Overview / Economy -----------------------------------------------------------------------

const econRows = table('Economy');
const econ = Object.fromEntries(econRows.map((r) => [str(r.ID), r]));
const need = (id) => {
  if (!(id in econ)) throw new Error(`Economy sheet is missing "${id}"`);
  return econ[id].Value;
};
const economy = {
  startingCredits: num(need('starting_credits'), 'starting_credits'),
  harvesterCapacity: num(need('harvester_capacity'), 'harvester_capacity'),
  commonResourceValue: num(need('common_resource_value'), 'common_resource_value'),
  rareResourceValue: num(need('rare_resource_value'), 'rare_resource_value'),
  refundFraction: num(need('refund_percent'), 'refund_percent'),
  structureFullRepairFraction: num(need('structure_full_repair_cost'), 'structure_full_repair_cost'),
  unitFullRepairFraction: num(need('unit_full_repair_cost'), 'unit_full_repair_cost'),
  resourceRegrowth: bool(need('resource_regrowth')),
  resourceSpread: bool(need('resource_spread')),
  aiFirstAttackMinutes: num(need('ai_first_attack_target'), 'ai_first_attack_target'),
  aiAttackIntervalMinutes: num(need('ai_attack_interval_target'), 'ai_attack_interval_target'),
  aiDesiredPowerSurplus: num(need('ai_desired_power_surplus'), 'ai_desired_power_surplus'),
  resourceTileMaxUnits: num(need('resource_tile_max_units'), 'resource_tile_max_units'),
  resourceStartDensity: num(need('resource_start_density'), 'resource_start_density'),
  resourceGrowthIntervalSec: num(need('resource_growth_interval'), 'resource_growth_interval'),
  resourceGrowthChance: num(need('resource_growth_chance'), 'resource_growth_chance'),
  resourceSpreadChance: num(need('resource_spread_chance'), 'resource_spread_chance'),
  resourceRootRegrowthChance: num(need('resource_root_regrowth_chance'), 'resource_root_regrowth_chance'),
};

// Overview: normalization factors (documentation only: values in the workbook are already normalized)
const ov = wb.sheet('Overview');
const normalization = {};
for (let r = 4; r <= 12; r++) {
  const k = str(ov[`A${r}`]);
  const v = num(ov[`B${r}`], k);
  if (k && v !== null) normalization[k] = v;
}
const coreRules = [];
for (let r = 4; r <= 12; r++) {
  const k = str(ov[`D${r}`]);
  const v = str(ov[`E${r}`]);
  if (k && v) coreRules.push({ topic: k, rule: v });
}
const factionNames = [str(ov.B25), str(ov.D25)];

// --- Damage matrix ------------------------------------------------------------------------------

const damageMatrix = {};
for (const r of table('Damage Matrix')) {
  const id = str(r['Damage Class ID']);
  damageMatrix[id] = {
    name: str(r.Name),
    vs: {
      unarmored: num(r.Unarmored, `${id} unarmored`),
      structure: num(r.Structure, `${id} structure`),
      light: num(r['Light Armor'], `${id} light`),
      heavy: num(r['Heavy Armor'], `${id} heavy`),
      fortified: num(r.Fortified, `${id} fortified`),
    },
    falloffStepTiles: num(r['Falloff Step (tiles)'], `${id} falloff step`),
    damagesWalls: flag(r['Damages Walls']),
    damagesWoodenWalls: flag(r['Damages Wooden Walls']),
    damagesOre: flag(r['Damages Ore']),
    ruleNotes: str(r['Rule Notes']),
  };
}

// --- Weapons --------------------------------------------------------------------------------------

const weapons = {};
for (const r of table('Weapons')) {
  const id = str(r.ID);
  weapons[id] = {
    id,
    name: str(r.Name),
    damage: num(r.Damage, `${id} damage`),
    fireIntervalSec: num(r['Fire Interval (sec)'], `${id} interval`),
    rangeTiles: num(r['Range (tiles)'], `${id} range`),
    burst: num(r.Burst, `${id} burst`) ?? 1,
    damageClass: str(r['Damage Class']),
    projectile: str(r['Projectile / Effect']),
    targeting: str(r.Targeting),
    notes: str(r.Notes),
    projectileSpeedTilesPerSec: num(r['Projectile Speed (tiles/s)'], `${id} projectile speed`),
    instantHit: flag(r['Instant Hit']),
    homingTurnDegPerSec: num(r['Homing Turn (deg/s)'], `${id} homing turn`),
    inaccurate: flag(r.Inaccurate),
    arcing: flag(r.Arcing),
    fliesOverWalls: flag(r['Flies Over Walls']),
    hitsAir: flag(r['Hits Air']),
    hitsGround: flag(r['Hits Ground']),
    hitsSubmerged: flag(r['Hits Submerged']),
    fasterVsAircraft: flag(r['Faster vs Aircraft']),
    chargeUp: flag(r['Charge-Up']),
    ruleNotes: str(r['Rule Notes']),
  };
}

// --- Buildings ------------------------------------------------------------------------------------

const STAGES = ['Establish', 'Economy', 'Warfare', 'Advanced', 'Strategic'];
const stage = (v) => {
  const s = str(v);
  if (!STAGES.includes(s)) throw new Error(`Unknown stage "${v}"`);
  return s.toLowerCase();
};

const buildings = {};
for (const r of table('Buildings')) {
  const id = str(r.ID);
  buildings[id] = {
    id,
    name: str(r.Name),
    faction: faction(r.Faction),
    role: str(r.Role),
    cost: num(r.Cost, `${id} cost`),
    hp: num(r.HP, `${id} hp`),
    armor: armor(r.Armor),
    sight: num(r.Sight, `${id} sight`),
    power: num(r['Power Delta'], `${id} power`),
    stage: stage(r.Stage),
    prerequisites: list(r.Prerequisites),
    buildTimeSec: num(r['Build Time (sec)'], `${id} build time`),
    requiresPower: bool(r['Requires Power']),
    sensors: bool(r.Sensors),
    weapons: [str(r['Primary Weapon']), str(r['Secondary Weapon'])].filter(Boolean),
    notes: str(r.Notes),
    description: str(r.Description),
    capturable: flag(r.Capturable),
    survivors: num(r.Survivors, `${id} survivors`),
    repairable: flag(r.Repairable),
    placementAdjacency: num(r['Placement Adjacency'], `${id} placement adjacency`),
    extendsBase: flag(r['Extends Base']),
    waterPlacement: flag(r['Water Placement']),
    turretTurnDegPerSec: num(r['Turret Turn Rate (deg/s)'], `${id} turret turn`),
    ammo: num(r.Ammo, `${id} ammo`),
    wallDamageLevels: num(r['Wall Damage Levels'], `${id} wall levels`),
    wallDamagePerLevel: num(r['Wall Damage per Level'], `${id} wall damage per level`),
    crushableWall: flag(r['Crushable Wall']),
    blocksLowShots: flag(r['Blocks Low Shots']),
    ruleNotes: str(r['Rule Notes']),
  };
}

// --- Units ------------------------------------------------------------------------------------------

const units = {};
for (const r of table('Units')) {
  const id = str(r.ID);
  units[id] = {
    id,
    name: str(r.Name),
    faction: faction(r.Faction),
    category: str(r.Category),
    role: str(r.Role),
    cost: num(r.Cost, `${id} cost`),
    hp: num(r.HP, `${id} hp`),
    armor: armor(r.Armor),
    speed: num(r.Speed, `${id} speed`),
    sight: num(r.Sight, `${id} sight`),
    stage: stage(r.Stage),
    // "harbor|sub_dock" = any of (faction-specific producers); prerequisites likewise allow alternatives with |
    producedAt: list(r['Produced At'], '|'),
    prerequisites: list(r['Additional Prerequisites']).map((p) => p.split('|').map((s) => s.trim())),
    buildTimeSec: num(r['Build Time (sec)'], `${id} build time`),
    weapons: [str(r['Primary Weapon']), str(r['Secondary Weapon'])].filter(Boolean),
    ammo: num(r.Ammo, `${id} ammo`),
    passengers: num(r.Passengers, `${id} passengers`) ?? 0,
    notes: str(r['Traits / Notes']),
    description: str(r.Description),
    turnDegPerSec: num(r['Turn Rate (deg/s)'], `${id} turn rate`),
    crushable: flag(r.Crushable),
    crushes: flag(r.Crushes),
    survivorChance: num(r['Survivor Chance'], `${id} survivor chance`),
    selfHeals: flag(r['Self-Heals']),
    explodesOnDeath: flag(r['Explodes on Death']),
    deathExplosionDamage: num(r['Death Explosion Damage'], `${id} death explosion damage`),
    deathExplosionRadiusTiles: num(r['Death Explosion Radius (tiles)'], `${id} death explosion radius`),
    cloaks: flag(r.Cloaks),
    detectsCloaked: flag(r['Detects Cloaked']),
    cantFireMoving: flag(r["Can't Fire Moving"]),
    guardRangeTiles: num(r['Guard Range (tiles)'], `${id} guard range`),
    ruleNotes: str(r['Rule Notes']),
  };
}

// --- Abilities, decisions -----------------------------------------------------------------------------

const abilities = {};
for (const r of table('Abilities')) {
  const id = str(r.ID);
  const unit = str(r.Unit);
  if (unit !== 'minutes') throw new Error(`Ability ${id}: unexpected recharge unit ${unit}`);
  abilities[id] = {
    id, name: str(r.Name), faction: faction(r.Faction), grantedBy: str(r['Granted By']),
    rechargeSec: num(r.Recharge, `${id} recharge`) * 60, notes: str(r.Notes),
    targets: str(r.Targets),
    damage: num(r.Damage, `${id} damage`),
    damageClass: str(r['Damage Class']),
    radiusTiles: num(r['Radius (tiles)'], `${id} radius`),
    durationSec: num(r['Duration (sec)'], `${id} duration`),
    arrives: str(r.Arrives),
    count: num(r.Count, `${id} count`),
    delaySec: num(r['Delay (sec)'], `${id} delay`),
    warnsOpponent: flag(r['Warns Opponent']),
    pausesOnLowPower: flag(r['Pauses on Low Power']),
    ruleNotes: str(r['Rule Notes']),
  };
  if (abilities[id].damageClass && !(abilities[id].damageClass in damageMatrix)) throw new Error(`Ability ${id}: unknown damage class ${abilities[id].damageClass}`);
}

// --- Engine rules, crates (data only for now: the simulation does not read them yet) -------------------

const IN_GAME = ['In game', 'Ours differs (kept)', 'Ours differs (not changed)', 'Not in game yet', 'Proposed'];
const engineRules = {};
for (const r of table('Engine Rules')) {
  const id = str(r.ID);
  if (id in engineRules) throw new Error(`Engine Rules: duplicate ${id}`);
  const inGame = str(r['In Our Game']);
  if (!IN_GAME.includes(inGame)) throw new Error(`Engine rule ${id}: unknown status "${inGame}"`);
  const v = r.Value;
  engineRules[id] = {
    id, topic: str(r.Topic), rule: str(r.Rule),
    value: v === null || v === undefined ? null : typeof v === 'string' ? v.trim() : v,
    unit: str(r.Unit), inGame, notes: str(r.Notes),
  };
}

const crates = {};
for (const r of table('Crates')) {
  const id = str(r.ID);
  crates[id] = {
    id, name: str(r.Crate), shares: num(r.Shares, `${id} shares`), chance: num(r.Chance, `${id} chance`),
    effect: str(r.Effect), value: num(r.Value, `${id} value`), unit: str(r.Unit), notes: str(r.Notes),
  };
}

const decisions = table('Design Decisions').map((r) => ({
  decision: str(r.Decision), status: str(r.Status), why: str(r.Why), effect: str(r['Gameplay Effect']),
  revisit: str(r['Can Revisit?']), implementation: str(r.Implementation),
}));

// --- Write generated TypeScript ----------------------------------------------------------------------

mkdirSync(GEN, { recursive: true });
const HEADER = '// GENERATED from design/balance.xlsx by scripts/import-balance.mjs. Do not edit; edit the spreadsheet and re-run `npm run import`.\n';
const json = (v) => JSON.stringify(v, null, 2);

emit(join(GEN, 'balance.ts'), `${HEADER}/* eslint-disable */
import type { AbilityDef, BuildingDef, CrateDef, DamageClassDef, EconomyRules, EngineRuleDef, UnitDef, WeaponDef } from '../types.js';

export const ECONOMY: EconomyRules = ${json(economy)};

export const NORMALIZATION: Readonly<Record<string, number>> = ${json(normalization)};

export const DAMAGE_MATRIX: Readonly<Record<string, DamageClassDef>> = ${json(damageMatrix)};

export const WEAPONS: Readonly<Record<string, WeaponDef>> = ${json(weapons)};

export const BUILDINGS: Readonly<Record<string, BuildingDef>> = ${json(buildings)};

export const UNITS: Readonly<Record<string, UnitDef>> = ${json(units)};

export const ABILITIES: Readonly<Record<string, AbilityDef>> = ${json(abilities)};

/** How the rules behave (formulas, rates, effects). Data only for now: the simulation does not read it yet. */
export const ENGINE_RULES: Readonly<Record<string, EngineRuleDef>> = ${json(engineRules)};

/** Crate pick-ups. Not in the game yet. */
export const CRATES: Readonly<Record<string, CrateDef>> = ${json(crates)};

export const FACTION_NAMES = ${json(factionNames)} as const;
`);

// Public subset: what a player can see in the UI anyway. No HP, armor, weapons, damage, sight or AI values.
const pub = (e) => ({ id: e.id, name: e.name, faction: e.faction, role: e.role, cost: e.cost, stage: e.stage, buildTimeSec: e.buildTimeSec });
emit(join(GEN, 'public.ts'), `${HEADER}/* eslint-disable */
import type { PublicBuildingDef, PublicUnitDef } from '../public-types.js';

/** Safe to ship to the browser: only what the UI shows. Full rules stay on the server. */
export const PUBLIC_BUILDINGS: Readonly<Record<string, PublicBuildingDef>> = ${json(Object.fromEntries(Object.values(buildings).map((b) => [b.id, { ...pub(b), description: b.description, power: b.power, prerequisites: b.prerequisites }])))};

export const PUBLIC_UNITS: Readonly<Record<string, PublicUnitDef>> = ${json(Object.fromEntries(Object.values(units).map((u) => [u.id, { ...pub(u), description: u.description, category: u.category, producedAt: u.producedAt, prerequisites: u.prerequisites }])))};

export const PUBLIC_ECONOMY = ${json({ startingCredits: economy.startingCredits })} as const;
`);

// --- Write docs ------------------------------------------------------------------------------------

mkdirSync(DOCS, { recursive: true });
const DOC_HEADER = '<!-- GENERATED from design/balance.xlsx by packages/rules/scripts/import-balance.mjs. Do not edit by hand. -->\n\n';
const esc = (v) => (v === null || v === undefined ? '' : String(v).replace(/\|/g, '\\|').replace(/\n/g, ' '));
const mdTable = (cols, rows) => [
  `| ${cols.map((c) => c[0]).join(' | ')} |`,
  `|${cols.map((c) => (c[2] === 'r' ? '---:' : '---')).join('|')}|`,
  ...rows.map((r) => `| ${cols.map((c) => esc(c[1](r))).join(' | ')} |`),
].join('\n');
const fmt = (n, d = 2) => (n === null || n === undefined ? '' : Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: d }));
const fac = (f) => (f === 'both' ? 'Both' : f[0].toUpperCase() + f.slice(1));
const nameOf = (id) => buildings[id]?.name ?? units[id]?.name ?? id;
const write = (file, title, body) => emit(join(DOCS, file), `${DOC_HEADER}# ${title}\n\n${body.trim()}\n`);
const yn = (v) => (v === true ? 'yes' : v === false ? '' : '');
const notesList = (rows) => rows.filter((r) => r.ruleNotes).map((r) => `- **${r.name}:** ${r.ruleNotes}`).join('\n');

write('economy.md', 'Economy', mdTable([['Setting', (r) => r[0]], ['Value', (r) => r[1], 'r'], ['Notes', (r) => r[2]]], [
  ['Starting credits', fmt(economy.startingCredits), ''],
  ['Harvester capacity', fmt(economy.harvesterCapacity), 'resource units per load'],
  ['Common resource value', fmt(economy.commonResourceValue), 'credits per unit'],
  ['Rare resource value', fmt(economy.rareResourceValue), 'credits per unit'],
  ['Common full load', fmt(economy.harvesterCapacity * economy.commonResourceValue), 'calculated: capacity × value'],
  ['Rare full load', fmt(economy.harvesterCapacity * economy.rareResourceValue), 'calculated: capacity × value'],
  ['Sell / cancel refund', `${economy.refundFraction * 100}%`, 'of cost'],
  ['Structure full repair', `${economy.structureFullRepairFraction * 100}%`, 'of cost, from 0 to full HP'],
  ['Unit full repair', `${economy.unitFullRepairFraction * 100}%`, 'of cost, from 0 to full HP'],
  ['Resource regrowth', economy.resourceRegrowth ? 'on' : 'off', ''],
  ['Resource spread', economy.resourceSpread ? 'on' : 'off', ''],
  ['Resource per tile (full)', fmt(economy.resourceTileMaxUnits), 'resource units; rocks show it in steps of 4'],
  ['Starting field density', `${economy.resourceStartDensity * 100}%`, 'of full, on average: centre full, edges thinner'],
  ['Growth tick', `${economy.resourceGrowthIntervalSec} s`, 'how often fields grow and spread'],
  ['Growth chance', `${economy.resourceGrowthChance * 100}%`, 'per partly harvested tile per tick: +1 unit, up to full'],
  ['Spread chance', `${economy.resourceSpreadChance * 100}%`, 'per emptied tile next to one at least half full: +1 unit; never past the original field'],
  ['Root regrowth chance', `${economy.resourceRootRegrowthChance * 100}%`, 'per emptied tile at the heart of a field: +1 unit on its own, so fields thin but never vanish'],
  ['AI first attack (target)', `${economy.aiFirstAttackMinutes} min`, 'pacing target, not a rigid timer'],
  ['AI attack interval (target)', `${economy.aiAttackIntervalMinutes} min`, 'average'],
  ['AI desired power surplus', fmt(economy.aiDesiredPowerSurplus), 'power'],
]) + `

**No storage cap:** harvester unloads become credits immediately. One spendable currency (credits), plus power.

## Core rules

${coreRules.map((c) => `- **${c.topic}:** ${c.rule}`).join('\n')}

## Normalization

Values in the spreadsheet are already normalized. **Do not reapply these in code.**

${mdTable([['Scale', (r) => r[0]], ['Factor', (r) => r[1], 'r']], Object.entries(normalization))}
`);

const bRows = Object.values(buildings);
write('buildings.md', 'Buildings', `
${bRows.length} buildings. Power: positive produces, negative consumes. "Requires power" buildings stop working on low power.

${mdTable([
  ['ID', (b) => `\`${b.id}\``], ['Name', (b) => b.name], ['Faction', (b) => fac(b.faction)], ['Stage', (b) => b.stage],
  ['Cost', (b) => fmt(b.cost), 'r'], ['HP', (b) => fmt(b.hp), 'r'], ['Armor', (b) => b.armor], ['Sight', (b) => b.sight, 'r'],
  ['Power', (b) => (b.power > 0 ? `+${b.power}` : b.power), 'r'], ['Build (s)', (b) => fmt(b.buildTimeSec), 'r'],
  ['Prerequisites', (b) => b.prerequisites.map(nameOf).join(', ')], ['Needs power', (b) => (b.requiresPower ? 'yes' : '')],
  ['Weapons', (b) => b.weapons.join(', ')],
], bRows)}

## What each does

${bRows.filter((b) => b.description).map((b) => `- **${b.name}:** ${b.description}`).join('\n')}

## Notes

${bRows.filter((b) => b.notes).map((b) => `- **${b.name}:** ${b.notes}`).join('\n')}

## Rules

Data only for now (the simulation does not read these yet). See engine-rules.md for the rules behind them.

${mdTable([
  ['Name', (b) => b.name], ['Capturable', (b) => yn(b.capturable)], ['Survivors', (b) => b.survivors ?? '', 'r'], ['Repairable', (b) => yn(b.repairable)],
  ['Adjacency', (b) => b.placementAdjacency ?? '', 'r'], ['Extends base', (b) => yn(b.extendsBase)], ['Water', (b) => yn(b.waterPlacement)],
  ['Turret °/s', (b) => b.turretTurnDegPerSec ?? '', 'r'], ['Ammo', (b) => b.ammo ?? '', 'r'],
  ['Wall levels', (b) => b.wallDamageLevels ?? '', 'r'], ['Wall dmg/level', (b) => b.wallDamagePerLevel ?? '', 'r'],
  ['Crushable wall', (b) => yn(b.crushableWall)], ['Blocks low shots', (b) => yn(b.blocksLowShots)],
], bRows)}

${notesList(bRows)}
`);

const uRows = Object.values(units);
write('units.md', 'Units', `
${uRows.length} units. Speed, sight and range use the spreadsheet's units (see calculations.md for how the simulation converts speed).

${mdTable([
  ['ID', (u) => `\`${u.id}\``], ['Name', (u) => u.name], ['Faction', (u) => fac(u.faction)], ['Category', (u) => u.category],
  ['Cost', (u) => fmt(u.cost), 'r'], ['HP', (u) => fmt(u.hp), 'r'], ['Armor', (u) => u.armor], ['Speed', (u) => u.speed, 'r'],
  ['Sight', (u) => u.sight, 'r'], ['Build (s)', (u) => fmt(u.buildTimeSec), 'r'], ['Built at', (u) => u.producedAt.map(nameOf).join(' or ')],
  ['Also needs', (u) => u.prerequisites.map((alts) => alts.map(nameOf).join(' or ')).join(', ')], ['Weapons', (u) => u.weapons.join(', ')],
  ['Ammo', (u) => u.ammo ?? '', 'r'], ['Seats', (u) => u.passengers || '', 'r'],
], uRows)}

## What each does

${uRows.filter((u) => u.description).map((u) => `- **${u.name}:** ${u.description}`).join('\n')}

## Traits

${uRows.filter((u) => u.notes).map((u) => `- **${u.name}:** ${u.notes}`).join('\n')}

## Rules

Data only for now (the simulation does not read these yet). See engine-rules.md for the rules behind them.

${mdTable([
  ['Name', (u) => u.name], ['Turn °/s', (u) => u.turnDegPerSec ?? '', 'r'], ['Crushable', (u) => yn(u.crushable)], ['Crushes', (u) => yn(u.crushes)],
  ['Survivor', (u) => (u.survivorChance ? `${u.survivorChance * 100}%` : ''), 'r'], ['Self-heals', (u) => yn(u.selfHeals)],
  ['Death blast', (u) => (u.explodesOnDeath ? `${fmt(u.deathExplosionDamage)} / ${u.deathExplosionRadiusTiles} t` : '')],
  ['Cloaks', (u) => yn(u.cloaks)], ['Detects cloaked', (u) => yn(u.detectsCloaked)], ["Can't fire moving", (u) => yn(u.cantFireMoving)],
  ['Guard range', (u) => u.guardRangeTiles ?? '', 'r'],
], uRows)}

${notesList(uRows)}
`);

const wRows = Object.values(weapons);
write('weapons.md', 'Weapons', `
Damage already includes the HP/damage scale. Raw DPS = damage × burst ÷ fire interval (before armor; see damage-matrix.md).

${mdTable([
  ['ID', (w) => `\`${w.id}\``], ['Name', (w) => w.name], ['Damage', (w) => fmt(w.damage), 'r'], ['Interval (s)', (w) => w.fireIntervalSec, 'r'],
  ['Burst', (w) => w.burst, 'r'], ['Raw DPS', (w) => fmt((w.damage * w.burst) / w.fireIntervalSec), 'r'], ['Range', (w) => w.rangeTiles, 'r'],
  ['Damage class', (w) => w.damageClass], ['Effect', (w) => w.projectile], ['Targets', (w) => w.targeting],
], wRows)}

## Projectiles

Data only for now (the simulation does not read these yet). Speed in tiles per second; homing turn in degrees per second.

${mdTable([
  ['Name', (w) => w.name], ['Speed', (w) => (w.instantHit ? 'instant' : w.projectileSpeedTilesPerSec ?? ''), 'r'], ['Homing °/s', (w) => w.homingTurnDegPerSec ?? '', 'r'],
  ['Inaccurate', (w) => yn(w.inaccurate)], ['Arcing', (w) => yn(w.arcing)], ['Over walls', (w) => yn(w.fliesOverWalls)],
  ['Air', (w) => yn(w.hitsAir)], ['Ground', (w) => yn(w.hitsGround)], ['Submerged', (w) => yn(w.hitsSubmerged)],
  ['Faster vs air', (w) => yn(w.fasterVsAircraft)], ['Charge-up', (w) => yn(w.chargeUp)],
], wRows)}

${notesList(wRows)}
`);

write('damage-matrix.md', 'Damage matrix', `
Multiplier applied to a weapon's damage depending on its damage class and the target's armor:
**final damage = weapon damage × multiplier**. Negative damage (Field Heal) heals.

${mdTable([
  ['Damage class', (r) => `${r[1].name} (\`${r[0]}\`)`], ['Unarmored', (r) => r[1].vs.unarmored, 'r'], ['Structure', (r) => r[1].vs.structure, 'r'],
  ['Light', (r) => r[1].vs.light, 'r'], ['Heavy', (r) => r[1].vs.heavy, 'r'], ['Fortified', (r) => r[1].vs.fortified, 'r'],
], Object.entries(damageMatrix))}

## Splash and walls

Data only for now. Damage at distance r from a blast = damage ÷ (r ÷ falloff step), up to ÷16, within 1.5 tiles (engine-rules.md).

${mdTable([
  ['Damage class', (r) => r[1].name], ['Falloff step (tiles)', (r) => r[1].falloffStepTiles ?? '', 'r'], ['Walls', (r) => yn(r[1].damagesWalls)],
  ['Wooden walls', (r) => yn(r[1].damagesWoodenWalls)], ['Ore', (r) => yn(r[1].damagesOre)],
], Object.entries(damageMatrix))}
`);

write('abilities.md', 'Abilities', mdTable([
  ['ID', (a) => `\`${a.id}\``], ['Name', (a) => a.name], ['Faction', (a) => fac(a.faction)], ['Granted by', (a) => nameOf(a.grantedBy)],
  ['Recharge', (a) => `${a.rechargeSec / 60} min`, 'r'], ['Notes', (a) => a.notes],
], Object.values(abilities)) + `

## Parameters

Data only for now. Damage is already ×4; radius in tiles.

${mdTable([
  ['Name', (a) => a.name], ['Targets', (a) => a.targets], ['Damage', (a) => (a.damage ? `${fmt(a.damage)} ${a.damageClass ?? ''}` : '')],
  ['Radius', (a) => a.radiusTiles ?? '', 'r'], ['Duration (s)', (a) => a.durationSec ?? '', 'r'], ['Arrives', (a) => (a.arrives ? `${a.count ?? ''} × ${a.arrives}` : '')],
  ['Delay (s)', (a) => a.delaySec ?? '', 'r'], ['Warns', (a) => (a.warnsOpponent === null ? '?' : yn(a.warnsOpponent))], ['Pauses on low power', (a) => yn(a.pausesOnLowPower)],
], Object.values(abilities))}

${notesList(Object.values(abilities))}

Do not invent extra abilities during implementation.`);

const erRows = Object.values(engineRules);
const erTopics = [...new Set(erRows.map((r) => r.topic))];
const erValue = (v) => (v === true ? 'yes' : v === false ? 'no' : typeof v === 'number' ? fmt(v, 4) : v ?? '');
write('engine-rules.md', 'Engine rules', `
How the rules behave: formulas, rates and effects. **Data only for now: the simulation does not read these yet.**
Scaled like the rest of the workbook (credits ×1.5, HP and damage ×4, distances in tiles, times in seconds).
"In our game" says whether our game already works this way.

${erTopics.map((t) => `## ${t}\n\n${mdTable([
  ['ID', (r) => `\`${r.id}\``], ['Rule', (r) => r.rule], ['Value', (r) => erValue(r.value), 'r'], ['Unit', (r) => r.unit], ['In our game', (r) => r.inGame], ['Notes', (r) => r.notes],
], erRows.filter((r) => r.topic === t))}`).join('\n\n')}
`);

write('crates.md', 'Crates', `
Crate pick-ups. **Not in the game yet.** Chance = shares ÷ total shares; spawning rules are in engine-rules.md (Crates).

${mdTable([
  ['ID', (c) => `\`${c.id}\``], ['Crate', (c) => c.name], ['Shares', (c) => c.shares, 'r'], ['Chance', (c) => `${fmt(c.chance * 100, 1)}%`, 'r'],
  ['Effect', (c) => c.effect], ['Value', (c) => (c.value === null ? '' : `${fmt(c.value)} ${c.unit ?? ''}`)], ['Notes', (c) => c.notes],
], Object.values(crates))}
`);

// Tech tree: stages + a dependency graph (buildings → what they unlock; producers → units)
const stageOrder = ['establish', 'economy', 'warfare', 'advanced', 'strategic'];
const nodeId = (id) => id.replace(/[^a-z0-9_]/g, '_');
const edges = [];
for (const b of bRows) for (const p of b.prerequisites) edges.push(`  ${nodeId(p)} --> ${nodeId(b.id)}`);
const graphB = `\`\`\`mermaid\nflowchart LR\n${bRows.map((b) => `  ${nodeId(b.id)}["${b.name}"]`).join('\n')}\n${edges.join('\n')}\n\`\`\``;
write('tech-tree.md', 'Tech tree', `
Progression: **Establish → Economy → Warfare → Advanced → Strategic**. Prerequisites are building IDs; a building
or unit is available once you own (a finished copy of) every prerequisite. \`a | b\` means either.

${stageOrder.map((st) => {
  const bs = bRows.filter((b) => b.stage === st);
  const us = uRows.filter((u) => u.stage === st);
  return `## ${st[0].toUpperCase() + st.slice(1)}\n\n` +
    (bs.length ? `**Buildings:** ${bs.map((b) => `${b.name}${b.faction !== 'both' ? ` (${fac(b.faction)})` : ''}${b.prerequisites.length ? ` ← ${b.prerequisites.map(nameOf).join(' + ')}` : ''}`).join('; ')}\n\n` : '') +
    (us.length ? `**Units:** ${us.map((u) => `${u.name}${u.faction !== 'both' ? ` (${fac(u.faction)})` : ''} @ ${u.producedAt.map(nameOf).join('/')}${u.prerequisites.length ? ` + ${u.prerequisites.map((a) => a.map(nameOf).join('/')).join(' + ')}` : ''}`).join('; ')}\n` : '');
}).join('\n')}

## Building dependency graph

${graphB}
`);

write('decisions.md', 'Design decisions (from the spreadsheet)', mdTable([
  ['Decision', (d) => d.decision], ['Status', (d) => d.status], ['Why', (d) => d.why], ['Effect', (d) => d.effect],
  ['Revisit?', (d) => d.revisit], ['Implementation', (d) => d.implementation],
], decisions) + '\n\nDeferred ideas are not baseline mechanics.');

// Calculations: the formulas the code uses (packages/rules/src/calc.ts), with values worked out from the sheet.
const armors = ['unarmored', 'structure', 'light', 'heavy', 'fortified'];
const effDps = (w, a) => (w.damage * w.burst * damageMatrix[w.damageClass].vs[a]) / w.fireIntervalSec;
write('calculations.md', 'Calculations', `
Every number the game derives from the spreadsheet comes from one function in \`packages/rules/src/calc.ts\`.
Spreadsheet values are already normalized; no code re-applies scale factors.

## Formulas

| Quantity | Formula | Function |
|---|---|---|
| Damage per hit | weapon damage × matrix[damage class][target armor] | \`hitDamage\` |
| Damage per volley | hit damage × burst | \`volleyDamage\` |
| Raw DPS | damage × burst ÷ fire interval | \`rawDps\` |
| DPS vs armor | volley damage ÷ fire interval | \`effectiveDps\` |
| Unit DPS | sum of its weapons' DPS | \`loadoutDps\` |
| Time to kill | (⌈HP ÷ volley damage⌉ − 1) × fire interval (first volley immediate) | \`timeToKillSec\` |
| Unload credits | resource units × value (no storage cap) | \`creditsFor\` |
| Full load | harvester capacity × value | \`fullLoadCredits\` |
| Refund (sell / cancel) | ⌊cost × ${economy.refundFraction}⌋ | \`refundFor\` |
| Repair | cost × ${economy.structureFullRepairFraction} (structures) or ${economy.unitFullRepairFraction} (units) × HP fraction repaired | \`repairCost\` |
| Power | Σ positive deltas − Σ consumption; low when consumption > production | \`powerBalance\` |
| Operational | not (requires power and power is low) | \`isOperational\` |
| Movement | speed × 0.35 tiles/s (engine constant, not in the sheet) | \`speedToTilesPerSec\` |

## Weapon DPS against each armor

${mdTable([['Weapon', (w) => w.name], ...armors.map((a) => [a[0].toUpperCase() + a.slice(1), (w) => fmt(effDps(w, a), 1), 'r'])], wRows)}

## Dependency helpers

\`packages/rules/src/deps.ts\` answers "what depends on what" for both the full rules (server) and the public
subset (browser): \`missingRequirements\`, \`canBuild\`, \`producersOf\`, \`productionOf\`, \`directlyUnlocks\`,
\`dependentsOf\` (what you lose access to if a building dies), \`prerequisiteClosure\` (the full path to unlock
something), \`buildOrder\` and \`validateCatalog\`. See tech-tree.md for the graph.
`);

emit(join(DOCS, 'README.md'), `${DOC_HEADER}# Rules and economy

Generated from \`design/balance.xlsx\`, the source of truth. To change a number, edit the spreadsheet and run
\`npm run import --workspace @gravity-harvest/rules\`; this regenerates the typed data and these pages.

- [Economy](economy.md): credits, harvesting, refunds, repairs, AI pacing
- [Buildings](buildings.md) and [Units](units.md)
- [Weapons](weapons.md) and the [damage matrix](damage-matrix.md)
- [Abilities](abilities.md)
- [Engine rules](engine-rules.md): formulas, rates and effects (data only for now) and [crates](crates.md)
- [Tech tree](tech-tree.md): stages and the dependency graph
- [Calculations](calculations.md): every formula and the function that implements it
- [Design decisions](decisions.md)

Only the public subset (names, costs, power, build times, prerequisites) is ever shipped to the browser;
everything else stays on the server. See docs/DECISIONS.md, "Rules and protection".
`);

if (CHECK) {
  if (stale.length) {
    console.error(`Out of date with design/balance.xlsx (run \`npm run import\`):\n${stale.map((p) => `  ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log('Generated rules and docs are up to date.');
} else console.log(`Imported ${Object.keys(buildings).length} buildings, ${Object.keys(units).length} units, ${Object.keys(weapons).length} weapons, ` +
  `${Object.keys(damageMatrix).length} damage classes, ${Object.keys(abilities).length} abilities, ${Object.keys(engineRules).length} engine rules, ` +
  `${Object.keys(crates).length} crates, ${decisions.length} decisions.`);
