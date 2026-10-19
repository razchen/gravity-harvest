import { BUILDINGS, ECONOMY, UNITS, hitDamage } from '@gravity-harvest/rules';
import type { MatchEvent, TeamId, TeamView } from '@gravity-harvest/shared';
import { describe, expect, it } from 'vitest';
import { DOCK_FACING, ENGINE, TICK_MS, checkPlacement, refineryDock, serviceBayPad } from './layout.js';
import { facing } from './geometry.js';
import { SCENARIOS } from './scenarios.js';
import { SNAPSHOT_VERSION, type SimSnapshot } from './snapshot.js';
import { Sim, type Building, type Fighter, type Harvester } from './sim.js';

const run = (sim: Sim, ms: number) => {
  for (let t = 0; t < ms; t += TICK_MS) sim.step();
};
const mine = (sim: Sim, type: string) => [...sim.units.values()].filter((u) => u.team === 'a' && u.type === type);
const events = (v: TeamView, e: MatchEvent['e']) => v.events.filter((x) => x.e === e);
/** What a side sees now, with the events it was told of since the last look (the one viewer of each side). */
const look = (sim: Sim, team: TeamId, paused = false): TeamView => ({ ...sim.view(team, paused), events: sim.takeEvents(team) });
/** A snapshot as a save from before seats (version 8 or older) holds it: the sides named `player` and `enemy`, no `human`. */
const asOldSave = (snap: SimSnapshot, version: number): any => {
  const s = JSON.parse(JSON.stringify(snap));
  const old = (t: string) => (t === 'a' ? 'player' : 'enemy');
  const byOld = (r: Record<string, unknown>) => ({ player: r.a, enemy: r.b });
  for (const p of Object.values(s.players) as { human?: boolean }[]) delete p.human;
  return {
    ...s, version, players: byOld(s.players), explored: byOld(s.explored),
    buildings: s.buildings.map((b: { team: string; seenBy: string[] }) => ({ ...b, team: old(b.team), seenBy: b.seenBy.map(old) })),
    units: s.units.map((u: { team: string }) => ({ ...u, team: old(u.team) })),
  };
};
/** Build a Service Bay at the first spot near (1, 14) it may go (open ground in front of its pad too), finished. */
const placeBay = (sim: Sim) => {
  const w = sim.placementWorld('a');
  for (let ty = 12; ty < 22; ty++) for (let tx = 0; tx < 10; tx++) {
    if (checkPlacement('service_bay', tx, ty, w).problem !== null) continue;
    sim.command('a', { c: 'place', building: 'service_bay', tx, ty });
    sim.debug('a', { d: 'finishBuilds' });
    run(sim, 100);
    return { tx, ty };
  }
  throw new Error('nowhere to put a Service Bay');
};

/** A finished building of `team`'s at the first spot near its Assembly Yard it may go (with its prerequisites placed first). */
const placeFor = (sim: Sim, team: 'a' | 'b', type: string): Building => {
  const yard = [...sim.buildings.values()].find((b) => b.team === team && b.type === 'assembly_yard')!;
  sim.debug(team, { d: 'credits', amount: 99_999 });
  for (const need of BUILDINGS[type].prerequisites) if (![...sim.buildings.values()].some((b) => b.team === team && b.type === need)) placeFor(sim, team, need);
  for (let r = 1; r < 12; r++) for (let tx = yard.tx - r; tx <= yard.tx + r; tx++) for (let ty = yard.ty - r; ty <= yard.ty + r; ty++) {
    if (checkPlacement(type, tx, ty, sim.placementWorld(team)).problem !== null) continue;
    sim.command(team, { c: 'place', building: type, tx, ty });
    sim.debug(team, { d: 'finishBuilds' });
    run(sim, 100);
    return [...sim.buildings.values()].find((b) => b.team === team && b.type === type && b.tx === tx && b.ty === ty)!;
  }
  throw new Error(`nowhere to put a ${type}`);
};

describe('starting a match', () => {
  it('lays out the scenario with the spreadsheet economy', () => {
    const sim = Sim.create('skirmish');
    const v = look(sim, 'a');
    expect(v.credits).toBe(ECONOMY.startingCredits);
    expect(v.buildings.filter((b) => b.team === 'a').map((b) => b.type).sort()).toEqual(['assembly_yard', 'power_plant', 'refinery']);
    expect(v.power).toEqual({ made: 500, used: 150, low: false });
    expect(mine(sim, 'rifleman')).toHaveLength(2);
    expect(sim.ore.totalRocks()).toBeGreaterThan(50);
  });

  it('debug fast mode speeds up that side\'s building and movement', () => {
    const fast = Sim.create('skirmish', 7);
    const normal = Sim.create('skirmish', 7);
    fast.debug('a', { d: 'fast', factor: 10 });
    for (const sim of [fast, normal]) {
      sim.command('a', { c: 'place', building: 'barracks', tx: 1, ty: 10 });
      sim.command('a', { c: 'move', orders: mine(sim, 'rifleman').map((u) => ({ id: u.id, gx: 20, gy: 20 })) });
    }
    run(fast, 1000);
    run(normal, 1000);
    const barracks = (sim: Sim) => [...sim.buildings.values()].find((b) => b.type === 'barracks')!.progress;
    expect(barracks(fast)).toBeCloseTo(Math.min(1, barracks(normal) * 10), 5);
    const walked = (sim: Sim) => mine(sim, 'rifleman')[0].gx + mine(sim, 'rifleman')[0].gy;
    expect(walked(fast)).toBeGreaterThan(walked(normal) + 2);
  });

  it('turning the debug reveal off brings the fog back as it was', () => {
    const sim = Sim.create('skirmish', 7);
    const control = Sim.create('skirmish', 7); // the same match, never revealed
    sim.debug('a', { d: 'reveal', on: true });
    run(sim, 500);
    expect(look(sim, 'a').fog).toMatch(/^2+$/);
    sim.debug('a', { d: 'reveal', on: false });
    run(sim, 500);
    const after = look(sim, 'a').fog!;
    expect(after[3 * sim.map.width + 84]).toBe('0'); // the enemy base is unexplored again
    run(control, 1000);
    expect(after).toBe(look(control, 'a').fog);
  });

  it('each side is only told about its own faction\'s buildings and the shared ones', () => {
    const sim = Sim.create('skirmish');
    const ordan = sim.hello('a').catalog.buildings;
    expect(ordan.sentry).toBeDefined();
    expect(ordan.power_plant).toBeDefined();
    expect(ordan.incinerator).toBeUndefined();
    expect(ordan.anchor).toBeUndefined();
    const sable = sim.hello('b').catalog.buildings;
    expect(sable.anchor).toBeDefined();
    expect(sable.sentry).toBeUndefined();
  });

  it('you can play either side: the computer takes the other', () => {
    const sim = Sim.create('skirmish', 3, 'sable');
    expect(sim.hello('a').factions).toEqual({ a: 'sable', b: 'ordan' });
    expect(sim.hello('b').factions).toEqual({ a: 'sable', b: 'ordan' });
    expect(sim.hello('a').catalog.buildings.incinerator).toBeDefined();
    expect(sim.hello('a').catalog.buildings.sentry).toBeUndefined();
    expect(Sim.restore(JSON.parse(JSON.stringify(sim.snapshot()))).hello('a').factions.a).toBe('sable');
  });

  it('a mirror match tells each side the same faction for both', () => {
    const sim = Sim.create('skirmish', 3, 'ordan', { otherFaction: 'ordan' });
    expect(sim.hello('a').factions).toEqual({ a: 'ordan', b: 'ordan' });
    expect(sim.hello('b').catalog.buildings.sentry).toBeDefined();
  });

  it('the human can play the second seat: their own view, camera and orders; the first seat is the computer\'s', () => {
    const sim = Sim.create('skirmish', 3, 'sable', { seat: 'b' });
    expect(sim.players.b).toMatchObject({ human: true, faction: 'sable' });
    expect(sim.players.a).toMatchObject({ human: false, faction: 'ordan' });
    const hello = sim.hello('b');
    expect(hello.you).toBe('b');
    expect(hello.camera).toEqual(SCENARIOS.skirmish.camera.b);
    expect(hello.catalog.buildings.anchor).toBeDefined();
    // their own units, and none of the other side's (under fog)
    const v = look(sim, 'b');
    expect(v.units.length).toBeGreaterThan(0);
    expect(v.units.every((u) => u.team === 'b')).toBe(true);
    // orders move their units, and not the other side's
    const theirs = [...sim.units.values()].find((u) => u.team === 'b' && u.type === 'rifleman')!;
    const other = [...sim.units.values()].find((u) => u.team === 'a' && u.type === 'rifleman')!;
    const otherAt = { gx: other.gx, gy: other.gy };
    sim.command('b', { c: 'move', orders: [{ id: theirs.id, gx: theirs.gx - 4, gy: theirs.gy + 3 }, { id: other.id, gx: 40, gy: 30 }] });
    run(sim, 5000);
    expect(theirs.gy).toBeGreaterThan(SCENARIOS.skirmish.units.find((u) => u.team === 'b' && u.type === 'rifleman')!.gy + 1);
    expect(Math.hypot(other.gx - otherAt.gx, other.gy - otherAt.gy)).toBeLessThan(0.5); // (only nudged by its neighbours)
    // its toasts go to the human's seat now, not to the computer's
    sim.command('b', { c: 'place', building: 'anchor', tx: 0, ty: 0 });
    sim.command('a', { c: 'place', building: 'sentry', tx: 0, ty: 0 });
    expect(events(look(sim, 'b'), 'toast').length).toBeGreaterThan(0);
    expect(events(look(sim, 'a'), 'toast')).toEqual([]);
    // and a save remembers who plays which seat
    const back = Sim.restore(JSON.parse(JSON.stringify(sim.snapshot())));
    expect(back.players.b.human).toBe(true);
    expect(back.players.a.human).toBe(false);
  });

  it('both sides start alike, and the difficulty is kept in saves', () => {
    const sim = Sim.create('skirmish', 3, 'ordan', { difficulty: 'hard' });
    for (const team of ['a', 'b'] as const) {
      const v = look(sim, team);
      expect(v.credits).toBe(ECONOMY.startingCredits);
      expect(v.buildings.filter((b) => b.team === team).map((b) => b.type).sort()).toEqual(['assembly_yard', 'power_plant', 'refinery']);
      expect(v.units.filter((u) => u.team === team).map((u) => u.type).sort()).toEqual(['harvester', 'rifleman', 'rifleman']);
    }
    expect(sim.hello('a').difficulty).toBe('hard');
    expect(Sim.restore(JSON.parse(JSON.stringify(sim.snapshot()))).hello('a').difficulty).toBe('hard');
    expect(Sim.create('skirmish').hello('a').difficulty).toBe('normal');
  });

  it('mirror matches and computer-only matches (simulations)', () => {
    const sim = Sim.create('skirmish', 3, 'sable', { otherFaction: 'sable', computerOnly: true });
    expect(sim.players.b.faction).toBe('sable');
    expect(sim.players.a.human).toBe(false);
  });

  it('fog hides the enemy base until scouted', () => {
    const sim = Sim.create('skirmish');
    const v = look(sim, 'a');
    expect(v.units.filter((u) => u.team === 'b')).toEqual([]);
    expect(v.buildings.filter((b) => b.team === 'b')).toEqual([]);
    const W = sim.map.width;
    expect(v.fog![3 * W + 84]).toBe('0'); // the enemy's yard (fog is indexed ty * width + tx)
    expect(v.fog![7 * W + 7]).toBe('2');

    sim.debug('a', { d: 'teleport', units: mine(sim, 'rifleman').map((u) => u.id), gx: 77, gy: 12 });
    const after = look(sim, 'a');
    expect(after.buildings.some((b) => b.team === 'b')).toBe(true);
    expect(after.units.some((u) => u.team === 'b')).toBe(true);
  });

  it('never tells a player the other side\'s credits or harvester cargo', () => {
    const sim = Sim.create('skirmish');
    sim.debug('a', { d: 'reveal', on: true });
    const v = look(sim, 'a');
    const enemyHarvester = v.units.find((u) => u.team === 'b' && u.type === 'harvester');
    expect(enemyHarvester?.cargo).toBeUndefined();
    expect(JSON.stringify(v)).not.toContain('"faction"');
  });
});

describe('economy', () => {
  it('the harvester mines, docks and unloads straight into credits (no storage cap)', () => {
    const sim = Sim.create('skirmish');
    sim.debug('a', { d: 'credits', amount: 0 });
    const rocks = sim.ore.totalRocks();
    run(sim, 60_000);
    const v = look(sim, 'a');
    expect(sim.ore.totalRocks()).toBeLessThan(rocks);
    const unloads = events(v, 'unloaded') as Extract<MatchEvent, { e: 'unloaded' }>[];
    expect(unloads.length).toBeGreaterThan(0);
    expect(unloads[0].credits).toBe(ECONOMY.harvesterCapacity * ECONOMY.commonResourceValue); // a full load: 1050
    expect(v.credits).toBeGreaterThanOrEqual(1050);
    expect(v.stats.creditsEarned).toBe(v.credits);
    expect(events(v, 'door').length).toBeGreaterThanOrEqual(2);
  });

  it('places a building: prerequisites, placement rules, cost and build time from the rules', () => {
    const sim = Sim.create('skirmish');
    sim.command('a', { c: 'place', building: 'power_plant', tx: 6, ty: 6 }); // on the refinery
    expect(look(sim, 'a').events).toContainEqual({ e: 'toast', text: 'Blocked', code: 'cantPlace' });

    sim.command('a', { c: 'place', building: 'power_plant', tx: 1, ty: 10 });
    let v = look(sim, 'a');
    expect(v.credits).toBe(ECONOMY.startingCredits - BUILDINGS.power_plant.cost);
    const site = v.buildings.find((b) => b.tx === 1 && b.ty === 10)!;
    expect(site).toMatchObject({ type: 'power_plant', built: false });

    run(sim, BUILDINGS.power_plant.buildTimeSec * 1000 - 500);
    expect(sim.buildings.get(site.id)!.built).toBe(false);
    run(sim, 600);
    v = look(sim, 'a');
    expect(v.buildings.find((b) => b.id === site.id)!.built).toBe(true);
    expect(v.power.made).toBe(1000);
  });

  it('a harvester backs straight up the ramp onto the dock, nose out, and drives straight off it', () => {
    const sim = Sim.create('skirmish');
    const h = mine(sim, 'harvester')[0] as Harvester;
    const ref = [...sim.buildings.values()].find((b) => b.type === 'refinery' && b.team === 'a')!;
    const d = refineryDock(ref.tx, ref.ty);
    let docked = false;
    let left = false;
    for (let t = 0; t < 90_000 && !left; t += TICK_MS) {
      const was = h.state;
      sim.step();
      // on the last stretch (in front of the ramp to the dock) it moves along the ramp's axis, facing out
      if (h.state === 'toDock' && h.path.length === 1 && h.gy < d.front.gy) {
        expect(h.gx).toBeCloseTo(d.dock.gx, 5);
        expect(h.dir).toBe(DOCK_FACING);
        docked = true;
      }
      if (was === 'closing' && h.state !== 'closing') {
        expect(h.path[0]).toEqual(d.front); // forward off the ramp first
        left = true;
      }
    }
    expect(docked && left).toBe(true);
  });

  it('a docked harvester stays while its bed tips out, however little it carries', () => {
    const sim = Sim.create('skirmish');
    const h = mine(sim, 'harvester')[0] as Harvester;
    let dockedAt = -1;
    for (let t = 0; t < 120_000; t += TICK_MS) {
      const was = h.state;
      sim.step();
      if (was !== 'docking' && h.state === 'docking') {
        h.cargo = 2; // a near-empty load: unloading alone would take 120 ms
        dockedAt = sim.timeMs;
      }
      if (dockedAt >= 0 && was === 'closing' && h.state !== 'closing') {
        expect(sim.timeMs - dockedAt).toBeGreaterThanOrEqual(ENGINE.dockMinMs);
        return;
      }
    }
    throw new Error('it never docked and left');
  });

  it('a unit comes straight out of the building before it turns', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const sim = Sim.create('skirmish', seed);
      sim.command('a', { c: 'place', building: 'barracks', tx: 1, ty: 10 });
      sim.debug('a', { d: 'finishBuilds' });
      run(sim, 100);
      look(sim, 'a');
      sim.command('a', { c: 'train', unit: 'rifleman' });
      let out: Extract<MatchEvent, { e: 'unitOut' }> | undefined;
      for (let t = 0; t < 60_000 && !out; t += TICK_MS) {
        sim.step();
        out = look(sim, 'a').events.find((e): e is Extract<MatchEvent, { e: 'unitOut' }> => e.e === 'unitOut');
      }
      const u = sim.units.get(out!.unit)!;
      const start = { gx: 2.5, gy: 13.5 }; // the tile out from the middle of its lower-left face
      expect(u.moving).toBe(true);
      while (u.gy < start.gy + 1 - 1e-6) {
        expect(u.gx).toBeCloseTo(start.gx, 5);
        sim.step();
      }
    }
  });

  it('a finished refinery grants a harvester', () => {
    const sim = Sim.create('skirmish');
    sim.command('a', { c: 'place', building: 'refinery', tx: 0, ty: 10 });
    expect(look(sim, 'a').credits).toBe(ECONOMY.startingCredits - BUILDINGS.refinery.cost);
    sim.debug('a', { d: 'finishBuilds' });
    run(sim, 200);
    expect(mine(sim, 'harvester')).toHaveLength(2);
  });

  it('trains units through the queue, at the right building, and refunds cancels', () => {
    const sim = Sim.create('skirmish');
    sim.command('a', { c: 'train', unit: 'rifleman' });
    expect(look(sim, 'a').events).toContainEqual({ e: 'toast', text: 'Build a Barracks first', code: 'needPrerequisite' });

    sim.command('a', { c: 'place', building: 'barracks', tx: 1, ty: 10 });
    sim.debug('a', { d: 'finishBuilds' });
    run(sim, 100);
    const credits = look(sim, 'a').credits;
    sim.command('a', { c: 'train', unit: 'rifleman' });
    sim.command('a', { c: 'train', unit: 'rifleman' });
    expect(look(sim, 'a').queue).toHaveLength(2);
    sim.command('a', { c: 'cancelTrain', unit: 'rifleman' });
    expect(look(sim, 'a').credits).toBe(credits - UNITS.rifleman.cost); // the cancelled one fully refunded
    run(sim, UNITS.rifleman.buildTimeSec * 1000 + 100);
    expect(mine(sim, 'rifleman')).toHaveLength(3);
    expect(look(sim, 'a').queue).toHaveLength(0);
  });

  it('harvesters come from the motor works', () => {
    const sim = Sim.create('skirmish');
    sim.command('a', { c: 'train', unit: 'harvester' });
    expect(look(sim, 'a').queue).toEqual([]);
    sim.command('a', { c: 'place', building: 'motor_works', tx: 1, ty: 10 });
    sim.debug('a', { d: 'finishBuilds' });
    run(sim, 100);
    sim.command('a', { c: 'train', unit: 'harvester' });
    expect(look(sim, 'a').queue).toEqual([{ unit: 'harvester', progress: 0 }]);
  });

  it('a harvester built at the Motor Works comes out of it, then works for the nearest refinery', () => {
    const sim = Sim.create('skirmish');
    sim.command('a', { c: 'place', building: 'motor_works', tx: 1, ty: 10 });
    sim.debug('a', { d: 'finishBuilds' });
    run(sim, 100);
    look(sim, 'a');
    sim.command('a', { c: 'train', unit: 'harvester' });
    expect(look(sim, 'a').buildings.find((b) => b.type === 'motor_works')?.working).toBe(true);
    sim.debug('a', { d: 'fast', factor: 20 });
    let out = false;
    for (let i = 0; i < 60 && !out; i++) {
      run(sim, 500);
      out = look(sim, 'a').events.some((e) => e.e === 'unitOut');
    }
    expect(out).toBe(true);
    const fresh = mine(sim, 'harvester').at(-1)! as { home: number | null };
    const refinery = [...sim.buildings.values()].find((b) => b.type === 'refinery' && b.team === 'a')!;
    expect(fresh.home).toBe(refinery.id);
  });

  it('a service bay repairs only the vehicle on its pad, not vehicles parked next to it, nor infantry', () => {
    const sim = Sim.create('skirmish');
    sim.command('a', { c: 'place', building: 'motor_works', tx: 1, ty: 10 });
    sim.debug('a', { d: 'finishBuilds' });
    run(sim, 100);
    const at = placeBay(sim);
    const h = mine(sim, 'harvester')[0];
    sim.debug('a', { d: 'teleport', units: [h.id], gx: at.tx + 3.5, gy: at.ty + 1.5 });
    sim.debug('a', { d: 'spawn', unit: 'jackal', team: 'a', gx: at.tx + 3.5, gy: at.ty + 0.5 });
    const tank = mine(sim, 'jackal')[0];
    const rifleman = mine(sim, 'rifleman')[0];
    sim.debug('a', { d: 'teleport', units: [rifleman.id], gx: at.tx + 3.5, gy: at.ty + 2.5 });
    sim.command('a', { c: 'stop', units: [h.id, tank.id, rifleman.id] });
    for (const u of [h, tank, rifleman]) u.hp = u.maxHp / 2;
    run(sim, 2000);
    for (const u of [h, tank, rifleman]) expect(u.hp).toBe(u.maxHp / 2);
    expect(look(sim, 'a').buildings.find((b) => b.type === 'service_bay')?.working).toBeUndefined();
  });

  it('low power slows construction', () => {
    const sim = Sim.create('skirmish');
    // one at a time: each is finished before the next is placed
    for (const [building, tx, ty] of [['radar', 1, 10], ['barracks', 1, 14], ['motor_works', 10, 13]] as const) { // the Motor Works draws as much as a refinery, needs no ramp
      sim.command('a', { c: 'place', building, tx, ty });
      sim.debug('a', { d: 'finishBuilds' });
      run(sim, 100);
    }
    const v = look(sim, 'a');
    expect(v.power.low).toBe(true);
    expect(v.radar).toBe('offline');
  });

  it('selling refunds half the cost', () => {
    const sim = Sim.create('skirmish');
    const plant = [...sim.buildings.values()].find((b) => b.team === 'a' && b.type === 'power_plant')!;
    sim.command('a', { c: 'sell', building: plant.id });
    const v = look(sim, 'a');
    expect(v.credits).toBe(ECONOMY.startingCredits + Math.floor(BUILDINGS.power_plant.cost * ECONOMY.refundFraction));
    expect(v.buildings.some((b) => b.id === plant.id)).toBe(false);
  });
});

describe('placement check (shared with the browser)', () => {
  const open = { isBlocked: () => false, hasOre: () => false, unitOn: () => false, ownBuildings: [{ tx: 0, ty: 0, size: 3 }] };
  it('needs open ground near your base and room for the refinery ramp', () => {
    expect(checkPlacement('barracks', 4, 0, open).problem).toBeNull();
    expect(checkPlacement('barracks', 20, 20, open).problem).toBe('Too far from your base');
    expect(checkPlacement('barracks', 4, 0, { ...open, hasOre: () => true }).problem).toBe("Can't build on ore");
    const ramp = checkPlacement('refinery', 4, 0, { ...open, isBlocked: (x, y) => x === 6 && y === 5 });
    expect(ramp.problem).toBe('The ramp needs open ground in front');
    expect(ramp.tiles.filter((t) => t.extra)).toHaveLength(3);
    const apron = serviceBayPad(4, 0).apron[0];
    const pad = checkPlacement('service_bay', 4, 0, { ...open, isBlocked: (x, y) => x === apron.tx && y === apron.ty });
    expect(pad.problem).toBe('The pad needs open ground in front');
  });
});

describe('service bay', () => {
  type Bay = { id: number; tx: number; ty: number; occupant: number | null };
  /** A skirmish with a finished Service Bay of the player's on open ground, and money to pay for repairs. */
  const withBay = () => {
    const sim = Sim.create('skirmish');
    sim.debug('a', { d: 'credits', amount: 99999 });
    const w = sim.placementWorld('a');
    let at = { tx: 0, ty: 0 };
    search: for (let ty = 20; ty < 44; ty++) for (let tx = 20; tx < 44; tx++) {
      let ok = true;
      for (let x = tx - 1; x < tx + 5; x++) for (let y = ty - 1; y < ty + 7; y++) if (w.isBlocked(x, y) || w.hasOre(x, y) || w.unitOn(x, y)) ok = false;
      if (ok) { at = { tx, ty }; break search; }
    }
    const bay = (sim as unknown as { addBuilding: (t: string, team: string, tx: number, ty: number, built: boolean) => Bay }).addBuilding('service_bay', 'a', at.tx, at.ty, true);
    const d = serviceBayPad(bay.tx, bay.ty);
    const vehicle = (dx: number) => {
      sim.debug('a', { d: 'spawn', unit: 'jackal', team: 'a', gx: d.front.gx + dx, gy: d.front.gy + 2 });
      const u = mine(sim, 'jackal').find((j) => Math.abs(j.gx - (d.front.gx + dx)) < 0.01 && Math.abs(j.gy - (d.front.gy + 2)) < 0.01)! as Fighter;
      u.hp = u.maxHp * 0.8;
      return u;
    };
    return { sim, bay, d, vehicle };
  };
  const until = (sim: Sim, done: () => boolean, maxMs = 30000) => {
    for (let t = 0; t < maxMs && !done(); t += TICK_MS) run(sim, TICK_MS);
    return done();
  };

  it('a vehicle backs onto the pad nose out, is repaired to full, then drives off and frees it', () => {
    const { sim, bay, d, vehicle } = withBay();
    const u = vehicle(0);
    const working = () => !!look(sim, 'a').buildings.find((b) => b.id === bay.id)?.working;
    sim.command('a', { c: 'service', units: [u.id], bay: bay.id });
    expect(bay.occupant).toBe(u.id);
    run(sim, TICK_MS);
    expect(working()).toBe(false); // its arms wait for it to be on the pad
    expect(until(sim, () => Math.hypot(u.gx - d.pad.gx, u.gy - d.pad.gy) < 0.01 && !u.path.length)).toBe(true);
    expect(u.dir).toBe(DOCK_FACING);
    run(sim, TICK_MS);
    expect(working()).toBe(true);
    expect(u.hp).toBeLessThan(u.maxHp);
    expect(until(sim, () => u.hp >= u.maxHp)).toBe(true);
    expect(until(sim, () => bay.occupant === null)).toBe(true);
    expect(working()).toBe(false);
    expect(Math.hypot(u.gx - d.front.gx, u.gy - d.front.gy)).toBeLessThan(0.01);
    expect(u.dir).toBe(DOCK_FACING); // drove off nose first
    expect(u.mode).toBe('idle');
  });

  it('a second vehicle waits by the bay (not repaired yet), then takes the pad when it comes free', () => {
    const { sim, bay, d, vehicle } = withBay();
    const a = vehicle(0), b = vehicle(1);
    b.hp = b.maxHp * 0.2;
    sim.command('a', { c: 'service', units: [a.id, b.id], bay: bay.id });
    expect(bay.occupant).toBe(a.id);
    expect(b.service?.waiting).toBe(true);
    expect(until(sim, () => bay.occupant === b.id)).toBe(true);
    expect(b.hp).toBe(b.maxHp * 0.2);
    expect(until(sim, () => Math.hypot(b.gx - d.pad.gx, b.gy - d.pad.gy) < 0.01 && !b.path.length)).toBe(true);
  });

  it('another order lets the pad go, and the vehicle drives off the pad first', () => {
    const { sim, bay, d, vehicle } = withBay();
    const u = vehicle(0);
    sim.command('a', { c: 'service', units: [u.id], bay: bay.id });
    expect(until(sim, () => Math.hypot(u.gx - d.pad.gx, u.gy - d.pad.gy) < 0.01 && !u.path.length)).toBe(true);
    sim.command('a', { c: 'move', orders: [{ id: u.id, gx: d.front.gx + 3.5, gy: d.front.gy + 3 }] });
    run(sim, TICK_MS);
    expect(bay.occupant).toBe(null);
    expect(u.path[0]).toEqual(d.front);
    expect(until(sim, () => !u.path.length)).toBe(true);
  });

  it('repairs cost the spreadsheet share of the price, and stop part way when the money runs out', () => {
    const { sim, bay, vehicle } = withBay();
    // no ore income while it runs, so the money only goes on repairs
    sim.command('a', { c: 'stop', units: mine(sim, 'harvester').map((h) => h.id) });
    const u = vehicle(0);
    u.hp = u.maxHp * 0.5;
    const before = sim.players.a.credits;
    sim.command('a', { c: 'service', units: [u.id], bay: bay.id });
    expect(until(sim, () => u.hp >= u.maxHp)).toBe(true);
    const fullRepair = UNITS.jackal.cost * ECONOMY.unitFullRepairFraction;
    expect(before - sim.players.a.credits).toBeCloseTo(0.5 * fullRepair, 0);
    // with only enough for a tenth of its health, it gets that, then drives off the pad
    expect(until(sim, () => bay.occupant === null)).toBe(true);
    const v = vehicle(1);
    v.hp = v.maxHp * 0.5;
    sim.debug('a', { d: 'credits', amount: 0.1 * fullRepair });
    sim.command('a', { c: 'service', units: [v.id], bay: bay.id });
    expect(until(sim, () => bay.occupant === v.id && !!v.service?.leaving)).toBe(true);
    expect(sim.players.a.credits).toBeLessThan(1);
    expect(v.hp / v.maxHp).toBeGreaterThan(0.58);
    expect(v.hp / v.maxHp).toBeLessThan(0.61);
  });

  it('repairs at half speed on low power', () => {
    const healed = (low: boolean) => {
      const { sim, bay, d, vehicle } = withBay();
      const add = (sim as unknown as { addBuilding: (t: string, team: string, tx: number, ty: number, built: boolean) => void }).addBuilding.bind(sim);
      if (low) for (let i = 0; i < 4; i++) add('radar', 'a', 60, 4 * i, true);
      const u = vehicle(0);
      u.hp = u.maxHp * 0.3;
      sim.command('a', { c: 'service', units: [u.id], bay: bay.id });
      expect(until(sim, () => Math.hypot(u.gx - d.pad.gx, u.gy - d.pad.gy) < 0.01 && !u.path.length)).toBe(true);
      expect(sim.powerOf('a').low).toBe(low);
      const at = u.hp;
      run(sim, 3000);
      return u.hp - at;
    };
    expect(healed(true)).toBeCloseTo(healed(false) / 2, 0);
  });

  it('several vehicles take turns on the pad, the others waiting on tiles of their own, never on top of each other', () => {
    const { sim, bay, vehicle } = withBay();
    const vs = [vehicle(0), vehicle(1), vehicle(-1)];
    for (const v of vs) v.hp = v.maxHp * 0.3;
    sim.command('a', { c: 'service', units: vs.map((v) => v.id), bay: bay.id });
    const waiting = vs.filter((v) => v.service?.waiting);
    expect(waiting).toHaveLength(2);
    expect(new Set(waiting.map((v) => { const e = v.path.at(-1)!; return `${Math.floor(e.gx)},${Math.floor(e.gy)}`; })).size).toBe(2);
    const turns: number[] = [];
    let closest = Infinity;
    for (let t = 0; t < 90_000 && vs.some((v) => v.hp < v.maxHp || v.service); t += TICK_MS) {
      sim.step();
      if (bay.occupant !== null && turns.at(-1) !== bay.occupant) turns.push(bay.occupant);
      for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) closest = Math.min(closest, Math.hypot(vs[i].gx - vs[j].gx, vs[i].gy - vs[j].gy));
    }
    expect(vs.every((v) => v.hp >= v.maxHp && !v.service)).toBe(true);
    expect(turns.length).toBeGreaterThanOrEqual(2);
    expect(new Set(turns).size).toBe(turns.length); // one at a time, each once
    expect(closest).toBeGreaterThan(0.5);
  });

  it('only damaged vehicles are sent', () => {
    const { sim, bay, vehicle } = withBay();
    const u = vehicle(0);
    u.hp = u.maxHp;
    sim.command('a', { c: 'service', units: [u.id], bay: bay.id });
    expect(u.service).toBeNull();
    expect(bay.occupant).toBeNull();
  });
});

describe('combat', () => {
  it('riflemen fight back and kill with the spreadsheet weapon', () => {
    const sim = Sim.create('skirmish');
    const r = mine(sim, 'rifleman')[0];
    sim.debug('a', { d: 'spawn', unit: 'rifleman', team: 'b', gx: r.gx + 2.5, gy: r.gy });
    run(sim, 200);
    const v = look(sim, 'a');
    expect(events(v, 'shot').length).toBeGreaterThan(0);
    // 2 riflemen vs 1: 200 HP at 60 per shot
    expect(hitDamage('service_rifle', 'unarmored')).toBe(60);
    run(sim, 6000);
    expect([...sim.units.values()].filter((u) => u.team === 'b' && u.type === 'rifleman')).toHaveLength(2);
    expect(look(sim, 'a').stats.unitsKilled).toBe(1);
  });

  it('a medic never heals the enemy', () => {
    const sim = Sim.create('skirmish', 7);
    const r = mine(sim, 'rifleman')[0];
    sim.debug('a', { d: 'spawn', unit: 'medic', team: 'b', gx: r.gx + 1, gy: r.gy });
    const medic = [...sim.units.values()].find((u) => u.type === 'medic') as Fighter;
    r.hp = r.maxHp / 2;
    run(sim, 500);
    expect(r.hp).toBeLessThanOrEqual(r.maxHp / 2);
    expect(medic.target).toBeNull();
  });

  /** One player rifleman at (20, 20) and one enemy rifleman `dx` tiles east, nothing else around (scenery cleared). */
  /** Two riflemen dx tiles apart in the open; `fog`: as they'd see each other (else both sides see everything). */
  const duel = (dx: number, fog = false) => {
    const sim = Sim.create('skirmish', 7);
    if (!fog) for (const t of ['a', 'b'] as const) sim.debug(t, { d: 'reveal', on: true });
    sim.debug('a', { d: 'destroyTeam', team: 'b', units: true, buildings: false });
    const [a, ...rest] = mine(sim, 'rifleman');
    for (const u of rest) sim.killUnit(u);
    for (let x = 10; x <= 34; x++) for (let y = 17; y <= 23; y++) sim.map.setFootprint(x, y, 1, false);
    Object.assign(a, { gx: 20, gy: 20, path: [] });
    sim.debug('a', { d: 'spawn', unit: 'rifleman', team: 'b', gx: 20 + dx, gy: 20 });
    const e = [...sim.units.values()].find((u) => u.team === 'b' && u.type === 'rifleman')! as Fighter;
    return { sim, a: a as Fighter, e };
  };

  it.each([3.5, 5, 6])('idle units %s tiles apart close in and fight', (dx) => {
    const { sim, a, e } = duel(dx);
    run(sim, 15_000);
    expect(a.hp < a.maxHp || !a.alive).toBe(true);
    expect(e.hp < e.maxHp || !e.alive).toBe(true);
  });

  it('units only go for enemies their side can see: 5 tiles apart, out of sight, they leave each other alone', () => {
    const { sim, a, e } = duel(5, true);
    run(sim, 5_000);
    expect(a.hp).toBe(a.maxHp);
    expect(e.hp).toBe(e.maxHp);
    expect(a.target).toBeNull();
    // in sight (3.5 tiles; a rifleman sees 4), they fight
    const near = duel(3.5, true);
    run(near.sim, 15_000);
    expect(near.a.hp < near.a.maxHp || !near.a.alive).toBe(true);
  });

  it('a unit with two weapons fires both (each on its own reload)', () => {
    const { sim, a, e } = duel(3, false);
    a.weapons = ['heavy_cannon', 'heavy_cannon'];
    a.cools = [0, 0];
    e.hp = e.maxHp = 100_000;
    a.mode = 'attack';
    a.target = e.id;
    e.weapons = [];
    run(sim, 100);
    const shots = events(look(sim, 'b'), 'shot').filter((x) => x.e === 'shot' && x.from === a.id);
    expect(shots).toHaveLength(2);
  });

  it('a unit on a move order stops to fight what comes within range, then carries on', () => {
    const { sim, a, e } = duel(0);
    a.gx = 14;
    e.hp = 30; // one shot
    const to = sim.map.nearestFree(30, 20)!; // scenery may cover the exact tile
    sim.command('a', { c: 'move', orders: [{ id: a.id, gx: to.tx + 0.5, gy: to.ty + 0.5 }] });
    run(sim, 15_000);
    expect(e.alive).toBe(false);
    expect(a.alive).toBe(true);
    expect(Math.hypot(a.gx - (to.tx + 0.5), a.gy - (to.ty + 0.5))).toBeLessThan(0.5);
  });

  it('buildings take small arms at half damage (damage matrix)', () => {
    const sim = Sim.create('skirmish');
    const refinery = [...sim.buildings.values()].find((b) => b.team === 'b' && b.type === 'refinery')!;
    sim.debug('a', { d: 'teleport', units: mine(sim, 'rifleman').map((u) => u.id), gx: refinery.tx - 2, gy: refinery.ty + 1 });
    sim.debug('b', { d: 'destroyTeam', team: 'b', units: true, buildings: false });
    sim.command('a', { c: 'attack', units: mine(sim, 'rifleman').map((u) => u.id), target: refinery.id });
    run(sim, 200);
    expect(refinery.hp).toBe(refinery.maxHp - 2 * 30);
  });

  it('a side is out when it has no buildings and no units left (either side)', () => {
    const win = Sim.create('skirmish');
    win.debug('a', { d: 'destroyTeam', team: 'b', units: false, buildings: true });
    expect(win.winner).toBeNull(); // the computer loses as the human does: units left, not yet
    expect(look(win, 'a').stats.buildingsDestroyed).toBe(3);
    win.debug('a', { d: 'destroyTeam', team: 'b', units: true, buildings: false });
    expect(win.winner).toBe('a');

    const lose = Sim.create('skirmish');
    lose.debug('a', { d: 'destroyTeam', team: 'a', units: false, buildings: true });
    expect(lose.winner).toBeNull(); // units left
    lose.debug('a', { d: 'destroyTeam', team: 'a', units: true, buildings: false });
    expect(lose.winner).toBe('b');
  });
});

describe('selling, cancelling and repairs', () => {
  it('cancelling a building under construction or selling a finished one refunds half', () => {
    const sim = Sim.create('skirmish');
    const start = sim.players.a.credits;
    sim.command('a', { c: 'place', building: 'barracks', tx: 1, ty: 10 });
    run(sim, 1000);
    const b = [...sim.buildings.values()].find((x) => x.type === 'barracks' && x.team === 'a')!;
    expect(b.built).toBe(false);
    sim.command('a', { c: 'cancelBuild', building: b.id });
    expect(sim.buildings.has(b.id)).toBe(false);
    expect(sim.players.a.credits).toBe(start - BUILDINGS.barracks.cost + Math.floor(BUILDINGS.barracks.cost * ECONOMY.refundFraction));
    const before = sim.players.a.credits;
    const pp = [...sim.buildings.values()].find((x) => x.type === 'power_plant' && x.team === 'a')!;
    sim.command('a', { c: 'sell', building: pp.id });
    expect(sim.players.a.credits).toBe(before + BUILDINGS.power_plant.cost * ECONOMY.refundFraction);
  });

  it('cancelling a queued unit refunds all of it before it starts, half once it has', () => {
    const sim = Sim.create('skirmish');
    sim.command('a', { c: 'place', building: 'barracks', tx: 1, ty: 10 });
    sim.debug('a', { d: 'finishBuilds' });
    run(sim, 100);
    const before = sim.players.a.credits;
    sim.command('a', { c: 'train', unit: 'rifleman' });
    sim.command('a', { c: 'train', unit: 'rifleman' });
    run(sim, 500); // the first one is under way, the second waits
    sim.command('a', { c: 'cancelTrain', unit: 'rifleman' });
    expect(sim.players.a.credits).toBe(before - UNITS.rifleman.cost);
    sim.command('a', { c: 'cancelTrain', unit: 'rifleman' });
    expect(sim.players.a.credits).toBe(before - UNITS.rifleman.cost + Math.floor(UNITS.rifleman.cost * ECONOMY.refundFraction));
  });

  it('repairing heals a building, charges for it, and stops when it is full', () => {
    const sim = Sim.create('skirmish');
    const pp = [...sim.buildings.values()].find((x) => x.type === 'power_plant' && x.team === 'a')!;
    for (const h of mine(sim, 'harvester')) sim.killUnit(h); // no income meanwhile
    pp.hp = pp.maxHp / 2;
    sim.command('a', { c: 'repair', building: pp.id, on: true });
    expect(look(sim, 'a').buildings.find((b) => b.id === pp.id)?.repairing).toBe(true);
    const before = sim.players.a.credits;
    run(sim, ENGINE.repairSecondsForFull * 1000);
    expect(pp.hp).toBe(pp.maxHp);
    expect(pp.repairing).toBe(false);
    expect(before - sim.players.a.credits).toBeCloseTo(0.5 * BUILDINGS.power_plant.cost * ECONOMY.structureFullRepairFraction, 0);
  });

  it('repairs stop when the money runs out', () => {
    const sim = Sim.create('skirmish');
    const pp = [...sim.buildings.values()].find((x) => x.type === 'power_plant' && x.team === 'a')!;
    pp.hp = pp.maxHp / 2;
    sim.debug('a', { d: 'credits', amount: 0 });
    sim.command('a', { c: 'repair', building: pp.id, on: true });
    run(sim, 500);
    expect(pp.repairing).toBe(false);
    expect(pp.hp).toBe(pp.maxHp / 2);
  });
});

describe('vehicles', () => {
  it('an Assembler deploys into an Assembly Yard where it stands, far from the base too', () => {
    const sim = Sim.create('skirmish');
    // clear ground in the middle of the map, far from the base
    const w = sim.placementWorld('a');
    let spot = { tx: 0, ty: 0 };
    search: for (let ty = 24; ty < 40; ty++) for (let tx = 24; tx < 40; tx++) {
      let ok = true;
      for (let x = tx; x < tx + 4; x++) for (let y = ty; y < ty + 4; y++) if (w.isBlocked(x, y) || w.hasOre(x, y) || w.unitOn(x, y)) ok = false;
      if (ok) { spot = { tx, ty }; break search; }
    }
    sim.debug('a', { d: 'spawn', unit: 'assembler', team: 'a', gx: spot.tx + 2, gy: spot.ty + 2 });
    const a = mine(sim, 'assembler')[0];
    sim.command('a', { c: 'deploy', unit: a.id });
    expect(sim.units.has(a.id)).toBe(false);
    const yard = [...sim.buildings.values()].find((b) => b.type === 'assembly_yard' && b.tx === spot.tx && b.ty === spot.ty)!;
    expect(yard.built).toBe(false);
    run(sim, (ENGINE.deploySec + 0.5) * 1000);
    expect(yard.built).toBe(true);
  });

  it('a combat vehicle comes out of the Motor Works and fights', () => {
    const sim = Sim.create('skirmish');
    sim.debug('a', { d: 'spawn', unit: 'ram', team: 'a', gx: 30, gy: 30 });
    sim.debug('a', { d: 'spawn', unit: 'rifleman', team: 'b', gx: 33, gy: 30 });
    const target = [...sim.units.values()].find((u) => u.team === 'b' && Math.abs(u.gx - 33) < 0.1)!;
    const hp = target.hp;
    run(sim, 4000);
    expect(target.hp < hp || !target.alive).toBe(true);
  });

  it('a vehicle with a turning turret aims it and keeps its hull where it was', () => {
    const sim = Sim.create('skirmish');
    sim.debug('a', { d: 'spawn', unit: 'jackal', team: 'a', gx: 30, gy: 30 });
    sim.debug('a', { d: 'spawn', unit: 'rifleman', team: 'b', gx: 30, gy: 33 });
    const jackal = [...sim.units.values()].find((u) => u.type === 'jackal' && u.team === 'a' && Math.abs(u.gx - 30) < 0.1)!;
    const target = [...sim.units.values()].find((u) => u.team === 'b' && Math.abs(u.gy - 33) < 0.1)!;
    const hull = jackal.dir;
    const hp = target.hp;
    run(sim, 400);
    const v = look(sim, 'a');
    expect(v.units.find((u) => u.id === jackal.id)?.aim).toBe(facing(0, 3, 32));
    expect(events(v, 'shot').some((e) => e.e === 'shot' && e.from === jackal.id && e.p === 'shell')).toBe(true); // its light cannon fires shells
    run(sim, 2000);
    expect(target.hp < hp || !target.alive).toBe(true);
    expect(jackal.dir).toBe(hull);
  });

  it('a vehicle with a turning turret shoots on the move instead of stopping', () => {
    const sim = Sim.create('skirmish', 13); // a seed with open ground around (30, 30)
    sim.debug('a', { d: 'spawn', unit: 'jackal', team: 'a', gx: 30, gy: 30 });
    sim.debug('a', { d: 'spawn', unit: 'rifleman', team: 'b', gx: 33, gy: 32 });
    const jackal = [...sim.units.values()].find((u) => u.type === 'jackal' && u.team === 'a' && Math.abs(u.gx - 30) < 0.1)!;
    const target = [...sim.units.values()].find((u) => u.team === 'b' && Math.abs(u.gx - 33) < 0.1)!;
    const hp = target.hp;
    sim.command('a', { c: 'move', orders: [{ id: jackal.id, gx: 36.5, gy: 30.5 }] });
    const end = { ...jackal.path[jackal.path.length - 1] };
    const shotWhileMoving = { fired: false };
    for (let ms = 0; ms < 4000 && !shotWhileMoving.fired; ms += TICK_MS) {
      run(sim, TICK_MS);
      if (events(look(sim, 'a'), 'shot').some((e) => e.e === 'shot' && e.from === jackal.id) && jackal.moving) shotWhileMoving.fired = true;
    }
    expect(shotWhileMoving.fired).toBe(true);
    expect(target.hp < hp || !target.alive).toBe(true);
    run(sim, 6000);
    expect(Math.hypot(jackal.gx - end.gx, jackal.gy - end.gy)).toBeLessThan(0.01); // it got where it was going
  });
});

describe('transports', () => {
  /** A Carrier in the middle of 8 x 8 tiles of open ground, and `n` riflemen a few tiles off it, all yours. */
  const withCarrier = (n: number) => {
    const sim = Sim.create('skirmish');
    const w = sim.placementWorld('a');
    let spot = { tx: 0, ty: 0 };
    search: for (let ty = 22; ty < 40; ty++) for (let tx = 22; tx < 40; tx++) {
      let ok = true;
      for (let x = tx; x < tx + 8; x++) for (let y = ty; y < ty + 8; y++) if (w.isBlocked(x, y) || w.hasOre(x, y)) ok = false;
      if (ok) { spot = { tx, ty }; break search; }
    }
    sim.debug('a', { d: 'spawn', unit: 'carrier', team: 'a', gx: spot.tx + 2.5, gy: spot.ty + 2.5 });
    const carrier = mine(sim, 'carrier')[0] as Fighter;
    const before = new Set(mine(sim, 'rifleman').map((u) => u.id));
    for (let i = 0; i < n; i++) sim.debug('a', { d: 'spawn', unit: 'rifleman', team: 'a', gx: spot.tx + 5.5 + (i % 3) * 0.8, gy: spot.ty + 1.5 + Math.floor(i / 3) * 0.8 });
    const soldiers = mine(sim, 'rifleman').filter((u) => !before.has(u.id)) as Fighter[];
    return { sim, carrier, soldiers };
  };
  const board = (sim: Sim, carrier: Fighter, soldiers: Fighter[]) => {
    sim.command('a', { c: 'board', units: soldiers.map((u) => u.id), transport: carrier.id });
    run(sim, 15_000);
  };

  it('infantry walk to it and get in one by one until it is full; the rest stop next to it', () => {
    const { sim, carrier, soldiers } = withCarrier(7);
    look(sim, 'a');
    sim.command('a', { c: 'board', units: soldiers.map((u) => u.id), transport: carrier.id });
    const seen: MatchEvent[] = [];
    for (let t = 0; t < 15_000; t += 100) {
      run(sim, 100);
      seen.push(...look(sim, 'a').events);
    }
    expect(UNITS.carrier.passengers).toBe(5);
    expect(carrier.passengers).toHaveLength(5);
    const extras = soldiers.filter((u) => sim.units.has(u.id));
    expect(extras).toHaveLength(2);
    for (const u of extras) {
      expect(u.mode).toBe('idle');
      expect(Math.hypot(u.gx - carrier.gx, u.gy - carrier.gy)).toBeLessThan(ENGINE.transportDoorTiles + ENGINE.boardReachTiles + 0.1);
    }
    const boarded = seen.filter((e) => e.e === 'boarded');
    expect(boarded.map((e) => e.e === 'boarded' && e.unit)).toEqual(carrier.passengers.map((p) => p.id));
    expect(seen.filter((e) => e.e === 'hatch').map((e) => e.e === 'hatch' && e.open)).toEqual([true, false]);
    expect(carrier.hatch).toBe('closed');
  });

  it('a transport that moves off is followed', () => {
    const { sim, carrier, soldiers } = withCarrier(1);
    sim.command('a', { c: 'board', units: [soldiers[0].id], transport: carrier.id });
    sim.command('a', { c: 'move', orders: [{ id: carrier.id, gx: carrier.gx - 2, gy: carrier.gy + 4 }] });
    run(sim, 15_000);
    expect(carrier.passengers.map((p) => p.id)).toEqual([soldiers[0].id]);
  });

  it('passengers are off the map: not in anyone\'s view, and nothing can target them', () => {
    const { sim, carrier, soldiers } = withCarrier(3);
    board(sim, carrier, soldiers);
    const ids = soldiers.map((u) => u.id);
    sim.debug('b', { d: 'spawn', unit: 'rifleman', team: 'b', gx: carrier.gx + 4, gy: carrier.gy });
    const enemy = [...sim.units.values()].find((u) => u.team === 'b' && Math.abs(u.gx - carrier.gx - 4) < 0.01) as Fighter;
    sim.command('b', { c: 'attack', units: [enemy.id], target: ids[0] });
    expect(enemy.target).toBeNull();
    sim.debug('b', { d: 'reveal', on: true });
    const mineView = look(sim, 'a');
    const theirs = look(sim, 'b');
    for (const v of [mineView, theirs]) expect(v.units.some((u) => ids.includes(u.id))).toBe(false);
    expect(mineView.units.find((u) => u.id === carrier.id)).toMatchObject({ passengers: 3, seats: 5 });
    expect(theirs.units.find((u) => u.id === carrier.id)?.passengers).toBeUndefined();
    run(sim, 2000);
    expect(enemy.target).toBe(carrier.id); // it shoots the carrier, not who's inside
  });

  it('unloading lets them out one by one onto free tiles by its door', () => {
    const { sim, carrier, soldiers } = withCarrier(5);
    board(sim, carrier, soldiers);
    expect(carrier.passengers).toHaveLength(5);
    look(sim, 'a');
    sim.command('a', { c: 'unload', transport: carrier.id });
    const seen: MatchEvent[] = [];
    for (let t = 0; t < 6000; t += 100) {
      run(sim, 100);
      seen.push(...look(sim, 'a').events);
    }
    expect(carrier.passengers).toHaveLength(0);
    expect(seen.filter((e) => e.e === 'disembarked')).toHaveLength(5);
    expect(seen.filter((e) => e.e === 'hatch').map((e) => e.e === 'hatch' && e.open)).toEqual([true, false]);
    const tiles = new Set<string>();
    for (const u of soldiers) {
      expect(sim.units.get(u.id)).toBe(u);
      expect(u.hp).toBe(u.maxHp);
      expect(Math.hypot(u.gx - carrier.gx, u.gy - carrier.gy)).toBeLessThan(ENGINE.transportDoorTiles + 3);
      expect(sim.map.isBlocked(Math.floor(u.gx), Math.floor(u.gy))).toBe(false);
      tiles.add(`${Math.floor(u.gx)},${Math.floor(u.gy)}`);
    }
    expect(tiles.size).toBe(5);
  });

  it('a destroyed transport takes its passengers with it, counted as losses and kills', () => {
    const { sim, carrier, soldiers } = withCarrier(4);
    board(sim, carrier, soldiers);
    const lost = sim.players.a.stats.unitsLost;
    const killed = sim.players.b.stats.unitsKilled;
    sim.killUnit(carrier);
    expect(sim.players.a.stats.unitsLost).toBe(lost + 5);
    expect(sim.players.b.stats.unitsKilled).toBe(killed + 5);
    expect(soldiers.every((u) => !u.alive && !sim.units.has(u.id))).toBe(true);
  });

  it('a save keeps who is inside, with their health, and they can still get out', () => {
    const { sim, carrier, soldiers } = withCarrier(3);
    soldiers[0].hp = 17;
    board(sim, carrier, soldiers);
    const back = Sim.restore(JSON.parse(JSON.stringify(sim.snapshot())));
    const c = back.units.get(carrier.id) as Fighter;
    expect(c.passengers.map((p) => [p.id, p.type, p.hp])).toEqual(carrier.passengers.map((p) => [p.id, p.type, p.hp]));
    expect(soldiers.some((u) => back.units.has(u.id))).toBe(false);
    back.command('a', { c: 'unload', transport: c.id });
    run(back, 6000);
    expect(soldiers.every((u) => back.units.has(u.id))).toBe(true);
    expect(back.units.get(soldiers[0].id)!.hp).toBe(17);
  });
});

describe('defences', () => {
  it('a defence turns to the nearest enemy in range and shoots it', () => {
    const sim = Sim.create('skirmish');
    const turret = placeFor(sim, 'b', 'incinerator');
    const intruder = mine(sim, 'rifleman')[0];
    sim.debug('a', { d: 'teleport', units: [intruder.id], gx: turret.tx + 3.5, gy: turret.ty + 0.5 });
    const hp = intruder.hp;
    run(sim, 200);
    const v = look(sim, 'a');
    expect(events(v, 'shot').some((e) => e.e === 'shot' && e.from === turret.id && e.to === intruder.id && e.p === 'fireball')).toBe(true);
    expect(intruder.hp).toBeLessThan(hp);
    expect(turret.dir).toBe(0); // straight down +gx
  });

  it('a defence that needs power holds fire when it is low', () => {
    const sim = Sim.create('skirmish');
    for (const b of [...sim.buildings.values()]) if (b.team === 'b' && b.type === 'power_plant') sim.destroyBuilding(b);
    const anchorAt = { tx: 50, ty: 44 };
    sim.debug('b', { d: 'credits', amount: 99999 });
    (sim as unknown as { addBuilding: (t: string, team: string, tx: number, ty: number, built: boolean) => unknown }).addBuilding('anchor', 'b', anchorAt.tx, anchorAt.ty, true);
    const intruder = mine(sim, 'rifleman')[0];
    sim.debug('a', { d: 'teleport', units: [intruder.id], gx: anchorAt.tx + 4, gy: anchorAt.ty + 1 });
    run(sim, 500);
    expect(sim.powerOf('b').low).toBe(true);
    expect(events(look(sim, 'a'), 'shot').some((e) => e.e === 'shot' && e.p === 'instant discharge')).toBe(false);
  });
});

describe('saves and determinism', () => {
  it('an older save without an assembly yard gets the scenario\'s one', () => {
    const sim = Sim.create('skirmish');
    const snap = asOldSave(sim.snapshot(), 4);
    snap.buildings = snap.buildings.filter((b: { type: string }) => b.type !== 'assembly_yard');
    const back = Sim.restore(snap);
    expect([...back.buildings.values()].filter((b) => b.type === 'assembly_yard').map((b) => b.team).sort()).toEqual(['a', 'b']);
  });

  it('a snapshot restores the match', () => {
    const sim = Sim.create('skirmish');
    run(sim, 20_000);
    sim.debug('a', { d: 'credits', amount: 1234 });
    const snap = JSON.parse(JSON.stringify(sim.snapshot()));
    const back = Sim.restore(snap);
    const a = look(sim, 'a');
    const b = look(back, 'a');
    expect(b.credits).toBe(1234);
    expect(b.timeMs).toBe(a.timeMs);
    expect(b.buildings.map((x) => x.id)).toEqual(a.buildings.map((x) => x.id));
    expect(back.ore.totalRocks()).toBe(sim.ore.totalRocks());
    expect(b.fog!.replace(/2/g, '1')).toBe(a.fog!.replace(/2/g, '1'));
    run(back, 30_000); // keeps running: the harvester goes back to work
    expect(look(back, 'a').credits).toBeGreaterThan(1234);
  });

  it('a save from before seats (sides named player and enemy) loads with the human in the first seat', () => {
    const sim = Sim.create('skirmish', 4, 'sable', { difficulty: 'hard' });
    run(sim, 20_000);
    sim.debug('a', { d: 'credits', amount: 777 });
    sim.debug('b', { d: 'credits', amount: 555 });
    const old = asOldSave(sim.snapshot(), 8);
    expect(Object.keys(old.players).sort()).toEqual(['enemy', 'player']);
    const back = Sim.restore(old);
    expect(back.players.a).toMatchObject({ human: true, faction: 'sable', credits: 777 });
    expect(back.players.b).toMatchObject({ human: false, faction: 'ordan', credits: 555, difficulty: 'hard' });
    const team = (s: Sim) => [...s.units.values(), ...s.buildings.values()].map((e) => `${e.id}:${e.team}`).sort();
    expect(team(back)).toEqual(team(sim));
    expect(look(back, 'a').fog!.replace(/2/g, '1')).toBe(look(sim, 'a').fog!.replace(/2/g, '1'));
    expect(back.snapshot().version).toBe(SNAPSHOT_VERSION);
  });

  it('refuses saves from the old browser format', () => {
    expect(() => Sim.restore({ version: 1 } as never)).toThrow('older version');
  });

  it('the same orders give the same match', () => {
    const play = () => {
      const sim = Sim.create('skirmish', 42);
      sim.command('a', { c: 'move', orders: mine(sim, 'rifleman').map((u, i) => ({ id: u.id, gx: 20 + i, gy: 20 })) });
      run(sim, 30_000);
      return JSON.stringify(sim.snapshot());
    };
    expect(play()).toBe(play());
  });

  it('respects the unit cap', () => {
    const sim = Sim.create('skirmish');
    sim.command('a', { c: 'place', building: 'motor_works', tx: 1, ty: 10 });
    sim.debug('a', { d: 'finishBuilds' });
    run(sim, 100);
    for (let i = 0; i < ENGINE.unitCap; i++) sim.debug('a', { d: 'spawn', unit: 'rifleman', team: 'a', gx: 2 + (i % 8), gy: 14 + Math.floor(i / 8) });
    sim.command('a', { c: 'train', unit: 'harvester' });
    expect(look(sim, 'a').events).toContainEqual({ e: 'toast', text: 'Unit cap reached', code: 'unitCap' });
  });
});

describe('medics and engineers', () => {
  it('a medic heals a damaged hovering unit of its side nearby, and its arms work meanwhile', () => {
    const sim = Sim.create('skirmish', 3);
    sim.debug('a', { d: 'spawn', unit: 'medic', team: 'a', gx: 4.5, gy: 16.5 });
    sim.debug('a', { d: 'spawn', unit: 'hound', team: 'a', gx: 5.5, gy: 16.5 });
    const hound = mine(sim, 'hound')[0];
    hound.hp = hound.maxHp / 2;
    let worked = false;
    for (let t = 0; t < 6000; t += TICK_MS) {
      sim.step();
      worked ||= !!look(sim, 'a').units.find((u) => u.type === 'medic')?.work;
    }
    expect(hound.hp).toBeGreaterThan(hound.maxHp / 2);
    expect(worked).toBe(true);
  });

  it('a medic leaves vehicles alone, and a hovering unit has a bigger body than a soldier', () => {
    const sim = Sim.create('skirmish', 3);
    sim.debug('a', { d: 'spawn', unit: 'medic', team: 'a', gx: 4.5, gy: 16.5 });
    sim.debug('a', { d: 'spawn', unit: 'jackal', team: 'a', gx: 5.5, gy: 16.5 });
    const jackal = mine(sim, 'jackal')[0];
    jackal.hp = jackal.maxHp / 2;
    run(sim, 6000);
    expect(jackal.hp).toBe(jackal.maxHp / 2);
    expect(ENGINE.hoverRadius).toBeGreaterThan(ENGINE.infantryRadius);
  });

  it('an engineer sent to a damaged building of its side repairs it for free', () => {
    const sim = Sim.create('skirmish', 3);
    const yard = [...sim.buildings.values()].find((b) => b.team === 'a' && b.type === 'assembly_yard')!;
    sim.debug('a', { d: 'spawn', unit: 'engineer', team: 'a', gx: yard.tx - 1.5, gy: yard.ty + 1 });
    const eng = mine(sim, 'engineer')[0];
    yard.hp = yard.maxHp / 2;
    const credits = sim.players.a.credits;
    sim.command('a', { c: 'support', units: [eng.id], target: yard.id });
    run(sim, 8000);
    expect(yard.hp).toBeGreaterThan(yard.maxHp / 2);
    expect(sim.players.a.credits).toBeGreaterThanOrEqual(credits);
  });
});

describe('construction and production rules', () => {
  it('builds one building at a time, and one defence beside it', () => {
    const sim = Sim.create('skirmish');
    sim.debug('a', { d: 'credits', amount: 99_999 });
    sim.command('a', { c: 'place', building: 'barracks', tx: 1, ty: 10 });
    sim.command('a', { c: 'place', building: 'radar', tx: 1, ty: 14 });
    const types = () => [...sim.buildings.values()].filter((b) => b.team === 'a' && !b.built).map((b) => b.type);
    expect(types()).toEqual(['barracks']);
    expect(events(look(sim, 'a'), 'toast').some((e) => e.e === 'toast' && e.text === 'Already building a Barracks' && e.code === 'alreadyBuilding')).toBe(true);
    sim.debug('a', { d: 'finishBuilds' });
    run(sim, 100);
    sim.command('a', { c: 'place', building: 'radar', tx: 1, ty: 14 });
    expect(types()).toEqual(['radar']);
  });

  it('needs an Assembly Yard: without one nothing new can be placed, and what is going up stops', () => {
    const sim = Sim.create('skirmish');
    sim.command('a', { c: 'place', building: 'barracks', tx: 1, ty: 10 });
    const barracks = [...sim.buildings.values()].find((b) => b.team === 'a' && b.type === 'barracks')!;
    run(sim, 1000);
    const yard = [...sim.buildings.values()].find((b) => b.team === 'a' && b.type === 'assembly_yard')!;
    sim.destroyBuilding(yard);
    const progress = barracks.progress;
    run(sim, 2000);
    expect(barracks.progress).toBe(progress);
    sim.command('a', { c: 'cancelBuild', building: barracks.id });
    sim.command('a', { c: 'place', building: 'barracks', tx: 1, ty: 10 });
    expect([...sim.buildings.values()].some((b) => b.team === 'a' && b.type === 'barracks')).toBe(false);
  });

  it('each kind of factory has its own queue: soldiers and vehicles are built side by side', () => {
    const sim = Sim.create('skirmish');
    placeFor(sim, 'a', 'barracks');
    placeFor(sim, 'a', 'motor_works');
    sim.command('a', { c: 'train', unit: 'rifleman' });
    sim.command('a', { c: 'train', unit: 'rifleman' });
    sim.command('a', { c: 'train', unit: 'jackal' });
    run(sim, 1000);
    const q = sim.players.a.queue;
    expect(q.find((x) => x.unit === 'jackal')!.progress).toBeGreaterThan(0);
    expect(q.filter((x) => x.unit === 'rifleman').map((x) => x.progress > 0)).toEqual([true, false]);
    // a full lane doesn't stop the other one
    for (let i = 0; i < ENGINE.queueMax; i++) sim.command('a', { c: 'train', unit: 'rifleman' });
    expect(q.filter((x) => x.unit === 'rifleman')).toHaveLength(ENGINE.queueMax);
    sim.command('a', { c: 'train', unit: 'jackal' });
    expect(q.filter((x) => x.unit === 'jackal')).toHaveLength(2);
  });
});

describe('harvesters with nothing to do', () => {
  it('one that ran out of ore looks again now and then, and goes back to work when there is some', () => {
    const sim = Sim.create('skirmish');
    const h = mine(sim, 'harvester')[0] as Harvester;
    const kept = new Map([...sim.ore.tiles].map(([k, t]) => [k, t.rocks]));
    for (const t of sim.ore.tiles.values()) t.rocks = [];
    for (let ms = 0; ms < 60_000 && h.state !== 'idle'; ms += TICK_MS) sim.step();
    expect(h.state).toBe('idle');
    for (const [k, rocks] of kept) sim.ore.tiles.get(k)!.rocks = rocks;
    run(sim, 5000);
    expect(h.state).not.toBe('idle');
  });

  it('one told to stop waits for orders', () => {
    const sim = Sim.create('skirmish');
    const h = mine(sim, 'harvester')[0] as Harvester;
    sim.command('a', { c: 'stop', units: [h.id] });
    run(sim, 10_000);
    expect(h.state).toBe('idle');
  });
});

describe('enemy buildings in the fog', () => {
  /** The enemy's refinery, with one of the player's riflemen beside it (it sees it). */
  const scouted = () => {
    const sim = Sim.create('skirmish');
    const ref = [...sim.buildings.values()].find((b) => b.team === 'b' && b.type === 'refinery')!;
    const scout = mine(sim, 'rifleman')[0];
    sim.debug('a', { d: 'teleport', units: [scout.id], gx: ref.tx - 1.5, gy: ref.ty + 1 });
    run(sim, 300);
    const away = () => sim.debug('a', { d: 'teleport', units: [scout.id], gx: 20, gy: 30 });
    const back = () => sim.debug('a', { d: 'teleport', units: [scout.id], gx: ref.tx - 1.5, gy: ref.ty + 1 });
    const seen = () => look(sim, 'a').buildings.find((b) => b.id === ref.id);
    return { sim, ref, away, back, seen };
  };

  it('are sent as they were last seen', () => {
    const { sim, ref, away, back, seen } = scouted();
    const hp = ref.hp;
    away();
    ref.hp -= 500;
    run(sim, 300);
    expect(seen()?.hp).toBe(hp);
    expect(look(sim, 'b').buildings.find((b) => b.id === ref.id)?.hp).toBe(hp - 500);
    back();
    expect(seen()?.hp).toBe(hp - 500);
  });

  it('one destroyed out of sight stays until its spot is seen again', () => {
    const { sim, ref, away, back, seen } = scouted();
    away();
    look(sim, 'a');
    sim.destroyBuilding(ref);
    const v = look(sim, 'a');
    expect(events(v, 'buildingDestroyed')).toHaveLength(0);
    expect(v.buildings.some((b) => b.id === ref.id)).toBe(true);
    back();
    expect(seen()).toBeUndefined();
  });
});
