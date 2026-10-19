import { BUILDINGS, RULES_HASH } from '@gravity-harvest/rules';
import { describe, expect, it } from 'vitest';
import { DOCK_FACING } from './layout.js';
import { MIGRATIONS, migrateSnapshot, type RawSave } from './migrations.js';
import { SCENARIOS, scenarioHash } from './scenarios.js';
import { Sim } from './sim.js';
import { SNAPSHOT_VERSION, saveWarnings } from './snapshot.js';

const step = (from: number, s: RawSave) => MIGRATIONS[from]({ ...s, version: from });
const stats = { gameTimeMs: 0, creditsEarned: 0, unitsKilled: 0, unitsLost: 0, buildingsDestroyed: 0, buildingsLost: 0, buildingsBuilt: 0 };
const oldPlayers = { player: { credits: 100, queue: [], stats }, enemy: { credits: 200, queue: [], stats } };
const skirmishYard = (team: 'a' | 'b') => SCENARIOS.skirmish.buildings.find((b) => b.type === 'assembly_yard' && b.team === team)!;

describe('save migrations, one version at a time', () => {
  it('there is a step from every loadable version to the next', () => {
    for (let v = 2; v < SNAPSHOT_VERSION; v++) expect(MIGRATIONS[v], `version ${v}`).toBeTypeOf('function');
  });

  it('2 → 3: no scenery yet, so an empty landscape', () => {
    expect(step(2, { scenario: 'skirmish' })).toEqual({ scenario: 'skirmish', version: 3, trees: [] });
  });

  it('3 → 4: trees become scenery', () => {
    const tree = { id: 5, kind: 'tree_pine_a', tx: 1, ty: 2, gx: 1.5, gy: 2.5, scale: 1 };
    expect(step(3, { trees: [tree] })).toEqual({ version: 4, scenery: [tree] });
  });

  it('4 → 5: each side gets the scenario\'s Assembly Yard where it fits, and plays the scenario\'s faction', () => {
    const ya = skirmishYard('a');
    const yb = skirmishYard('b');
    // seat b's yard spot is taken by a refinery: it gets none
    const s = step(4, {
      scenario: 'skirmish', nextId: 50, players: oldPlayers, scenery: [],
      buildings: [{ id: 1, type: 'refinery', team: 'enemy', tx: yb.tx, ty: yb.ty, hp: 900, progress: 1, constructed: false, seenBy: ['enemy'] }],
    });
    expect(s.version).toBe(5);
    expect(s.buildings).toEqual([
      expect.objectContaining({ type: 'refinery' }),
      { id: 50, type: 'assembly_yard', team: 'player', tx: ya.tx, ty: ya.ty, hp: BUILDINGS.assembly_yard.hp, progress: 1, constructed: false, seenBy: ['player'] },
    ]);
    expect(s.nextId).toBe(51);
    expect(s.players.player.faction).toBe(SCENARIOS.skirmish.players.a.faction);
    expect(s.players.enemy.faction).toBe(SCENARIOS.skirmish.players.b.faction);
  });

  it('5 → 6 and 9 → 10 only added things older saves can do without', () => {
    expect(step(5, { units: [] })).toEqual({ version: 6, units: [] });
    expect(step(9, { units: [] })).toEqual({ version: 10, units: [] });
  });

  it('6 → 7: older saves play Normal', () => {
    expect(step(6, { players: oldPlayers }).players.enemy.difficulty).toBe('normal');
  });

  it('7 → 8: no gravity vents', () => {
    expect(step(7, {}).vents).toEqual([]);
  });

  it('8 → 9: the sides are named by seat, the human in seat a', () => {
    const s = step(8, {
      players: oldPlayers, explored: { player: '1', enemy: '0' },
      buildings: [{ id: 1, team: 'enemy', seenBy: ['enemy', 'player'] }], units: [{ id: 2, team: 'player' }],
    });
    expect(s.players.a).toMatchObject({ credits: 100, human: true });
    expect(s.players.b).toMatchObject({ credits: 200, human: false });
    expect(s.explored).toEqual({ a: '1', b: '0' });
    expect(s.buildings[0]).toMatchObject({ team: 'b', seenBy: ['b', 'a'] });
    expect(s.units[0].team).toBe('a');
  });

  it('10 → 11: everything at rest, harvesters looking for work, passengers inside their transport', () => {
    const s = step(10, {
      live: 'not yet',
      ore: [{ tx: 30, ty: 30, field: 4, richness: 1, rocks: [{ id: 9, gx: 30.5, gy: 30.5, shape: 0, amount: 4 }] }],
      buildings: [{ id: 1, type: 'power_plant', team: 'a', tx: 0, ty: 0, hp: 500, progress: 1, constructed: true, seenBy: ['b'] }],
      units: [
        { id: 2, type: 'harvester', team: 'a', gx: 28, gy: 28, hp: 600, cargo: 7 },
        { id: 3, type: 'carrier', team: 'b', gx: 10, gy: 11, hp: 400, post: { gx: 10, gy: 11 }, passengers: [{ id: 4, type: 'rifleman', hp: 90 }] },
      ],
    });
    expect(s.version).toBe(11);
    expect(s.live).toBeUndefined();
    expect(s.buildings[0]).toMatchObject({ built: true, seenBy: ['a', 'b'], occupant: null, boost: 1, dir: -1, target: null, cools: [], repairing: false });
    expect(s.units[0]).toMatchObject({ kind: 'harvester', state: 'idle', parked: false, retry: 0, cargo: 7, field: 4, home: null, dir: DOCK_FACING, path: [] });
    expect(s.units[1]).toMatchObject({ kind: 'fighter', mode: 'idle', target: null, post: { gx: 10, gy: 11 }, hatch: 'closed', path: [] });
    expect(s.units[1].passengers).toEqual([expect.objectContaining({ id: 4, type: 'rifleman', team: 'b', gx: 10, gy: 11, hp: 90, kind: 'fighter', passengers: [] })]);
  });

  it('runs the steps in order up to the current version, and leaves a current save as it is', () => {
    const current = Sim.create('skirmish').snapshot();
    expect(migrateSnapshot(current)).toBe(current);
    const old = migrateSnapshot({ ...current, version: 9, live: undefined });
    expect(old.version).toBe(SNAPSHOT_VERSION);
    expect(old.units.every((u) => u.path.length === 0)).toBe(true);
  });

  it('refuses saves from a newer version, and from the browser\'s old format', () => {
    expect(() => migrateSnapshot({ version: SNAPSHOT_VERSION + 1 })).toThrow('newer version');
    expect(() => migrateSnapshot({ version: 1 })).toThrow('older version');
    expect(() => migrateSnapshot({})).toThrow('older version');
  });
});

describe('the scenario a save was made on', () => {
  it('is recorded, and a save made on a map that has changed since warns but still loads', () => {
    const snap = Sim.create('skirmish').snapshot();
    expect(snap.scenarioHash).toBe(scenarioHash(SCENARIOS.skirmish));
    expect(saveWarnings(snap)).toEqual([]);
    const changed = { ...snap, scenarioHash: 'deadbeef' };
    expect(saveWarnings(changed)).toEqual([expect.stringContaining('earlier version of the "skirmish" map')]);
    expect(() => Sim.restore(changed)).not.toThrow();
    expect(saveWarnings({ ...snap, rulesHash: 'abc' })).toEqual([expect.stringContaining('other rules')]);
    expect(saveWarnings({ scenario: 'skirmish', rulesHash: RULES_HASH })).toEqual([]); // older saves record no map
  });

  it('changes with what is on the field, not with the name or description', () => {
    const sc = SCENARIOS.skirmish;
    expect(scenarioHash({ ...sc, name: 'Other', description: 'Other' })).toBe(scenarioHash(sc));
    expect(scenarioHash({ ...sc, units: sc.units.slice(1) })).not.toBe(scenarioHash(sc));
  });
});
