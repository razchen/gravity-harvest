import { BUILDINGS, ECONOMY, UNITS, hitDamage } from '@gravity-harvest/rules';
import type { MatchEvent, TeamView } from '@gravity-harvest/shared';
import { describe, expect, it } from 'vitest';
import { DOCK_FACING, ENGINE, TICK_MS, checkPlacement, refineryDock } from './layout.js';
import { facing } from './geometry.js';
import { Sim, type Fighter, type Harvester } from './sim.js';

const run = (sim: Sim, ms: number) => {
  for (let t = 0; t < ms; t += TICK_MS) sim.step();
};
const mine = (sim: Sim, type: string) => [...sim.units.values()].filter((u) => u.team === 'player' && u.type === type);
const events = (v: TeamView, e: MatchEvent['e']) => v.events.filter((x) => x.e === e);

describe('starting a match', () => {
  it('lays out the scenario with the spreadsheet economy', () => {
    const sim = Sim.create('skirmish');
    const v = sim.view('player');
    expect(v.credits).toBe(ECONOMY.startingCredits);
    expect(v.buildings.filter((b) => b.team === 'player').map((b) => b.type).sort()).toEqual(['assembly_yard', 'power_plant', 'refinery']);
    expect(v.power).toEqual({ made: 500, used: 150, low: false });
    expect(mine(sim, 'rifleman')).toHaveLength(2);
    expect(sim.ore.totalRocks()).toBeGreaterThan(50);
  });

  it('debug fast mode speeds up that side\'s building and movement', () => {
    const fast = Sim.create('skirmish', 7);
    const normal = Sim.create('skirmish', 7);
    fast.debug('player', { d: 'fast', factor: 10 });
    for (const sim of [fast, normal]) {
      sim.command('player', { c: 'place', building: 'barracks', tx: 1, ty: 10 });
      sim.command('player', { c: 'move', orders: mine(sim, 'rifleman').map((u) => ({ id: u.id, gx: 20, gy: 20 })) });
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
    sim.debug('player', { d: 'reveal', on: true });
    run(sim, 500);
    expect(sim.view('player').fog).toMatch(/^2+$/);
    sim.debug('player', { d: 'reveal', on: false });
    run(sim, 500);
    const after = sim.view('player').fog!;
    expect(after[60 * 64 + 60]).toBe('0'); // the enemy base is unexplored again
    run(control, 1000);
    expect(after).toBe(control.view('player').fog);
  });

  it('each side is only told about its own faction\'s buildings and the shared ones', () => {
    const sim = Sim.create('skirmish');
    const ordan = sim.hello('player').catalog.buildings;
    expect(ordan.sentry).toBeDefined();
    expect(ordan.power_plant).toBeDefined();
    expect(ordan.incinerator).toBeUndefined();
    expect(ordan.anchor).toBeUndefined();
    const sable = sim.hello('enemy').catalog.buildings;
    expect(sable.anchor).toBeDefined();
    expect(sable.sentry).toBeUndefined();
  });

  it('you can play either side: the computer takes the other, and its base swaps to its own buildings', () => {
    const sim = Sim.create('skirmish', 3, 'sable');
    expect(sim.hello('player').faction).toBe('sable');
    expect(sim.hello('player').catalog.buildings.incinerator).toBeDefined();
    expect(sim.hello('player').catalog.buildings.sentry).toBeUndefined();
    const enemy = [...sim.buildings.values()].filter((b) => b.team === 'enemy').map((b) => b.type);
    expect(enemy).toContain('sentry');
    expect(enemy).not.toContain('incinerator');
    expect(Sim.restore(JSON.parse(JSON.stringify(sim.snapshot()))).hello('player').faction).toBe('sable');
  });

  it('fog hides the enemy base until scouted', () => {
    const sim = Sim.create('skirmish');
    const v = sim.view('player');
    expect(v.units.filter((u) => u.team === 'enemy')).toEqual([]);
    expect(v.buildings.filter((b) => b.team === 'enemy')).toEqual([]);
    expect(v.fog![60 * 64 + 60]).toBe('0');
    expect(v.fog![7 * 64 + 7]).toBe('2');
    expect(sim.view('player').fog).toBeUndefined(); // unchanged: not resent

    sim.debug('player', { d: 'teleport', units: mine(sim, 'rifleman').map((u) => u.id), gx: 45, gy: 48 });
    const after = sim.view('player');
    expect(after.buildings.some((b) => b.team === 'enemy')).toBe(true);
    expect(after.units.some((u) => u.team === 'enemy')).toBe(true);
  });

  it('never tells a player the other side\'s credits or harvester cargo', () => {
    const sim = Sim.create('skirmish');
    sim.debug('player', { d: 'reveal', on: true });
    const v = sim.view('player');
    const enemyHarvester = v.units.find((u) => u.team === 'enemy' && u.type === 'harvester');
    expect(enemyHarvester?.cargo).toBeUndefined();
    expect(JSON.stringify(v)).not.toContain('"faction"');
  });
});

describe('economy', () => {
  it('the harvester mines, docks and unloads straight into credits (no storage cap)', () => {
    const sim = Sim.create('skirmish');
    sim.debug('player', { d: 'credits', amount: 0 });
    const rocks = sim.ore.totalRocks();
    run(sim, 60_000);
    const v = sim.view('player');
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
    sim.command('player', { c: 'place', building: 'power_plant', tx: 6, ty: 6 }); // on the refinery
    expect(sim.view('player').events).toContainEqual({ e: 'toast', text: 'Blocked' });

    sim.command('player', { c: 'place', building: 'power_plant', tx: 1, ty: 10 });
    let v = sim.view('player');
    expect(v.credits).toBe(ECONOMY.startingCredits - BUILDINGS.power_plant.cost);
    const site = v.buildings.find((b) => b.tx === 1 && b.ty === 10)!;
    expect(site).toMatchObject({ type: 'power_plant', built: false });

    run(sim, BUILDINGS.power_plant.buildTimeSec * 1000 - 500);
    expect(sim.buildings.get(site.id)!.built).toBe(false);
    run(sim, 600);
    v = sim.view('player');
    expect(v.buildings.find((b) => b.id === site.id)!.built).toBe(true);
    expect(v.power.made).toBe(1000);
  });

  it('a harvester backs straight up the ramp onto the dock, nose out, and drives straight off it', () => {
    const sim = Sim.create('skirmish');
    const h = mine(sim, 'harvester')[0] as Harvester;
    const ref = [...sim.buildings.values()].find((b) => b.type === 'refinery' && b.team === 'player')!;
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

  it('a unit comes straight out of the building before it turns', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const sim = Sim.create('skirmish', seed);
      sim.command('player', { c: 'place', building: 'barracks', tx: 1, ty: 10 });
      sim.debug('player', { d: 'finishBuilds' });
      run(sim, 100);
      sim.view('player');
      sim.command('player', { c: 'train', unit: 'rifleman' });
      let out: Extract<MatchEvent, { e: 'unitOut' }> | undefined;
      for (let t = 0; t < 60_000 && !out; t += TICK_MS) {
        sim.step();
        out = sim.view('player').events.find((e): e is Extract<MatchEvent, { e: 'unitOut' }> => e.e === 'unitOut');
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
    sim.command('player', { c: 'place', building: 'refinery', tx: 0, ty: 10 });
    expect(sim.view('player').credits).toBe(ECONOMY.startingCredits - BUILDINGS.refinery.cost);
    sim.debug('player', { d: 'finishBuilds' });
    run(sim, 200);
    expect(mine(sim, 'harvester')).toHaveLength(2);
  });

  it('trains units through the queue, at the right building, and refunds cancels', () => {
    const sim = Sim.create('skirmish');
    sim.command('player', { c: 'train', unit: 'rifleman' });
    expect(sim.view('player').events).toContainEqual({ e: 'toast', text: 'Build a Barracks first' });

    sim.command('player', { c: 'place', building: 'barracks', tx: 1, ty: 10 });
    sim.debug('player', { d: 'finishBuilds' });
    run(sim, 100);
    const credits = sim.view('player').credits;
    sim.command('player', { c: 'train', unit: 'rifleman' });
    sim.command('player', { c: 'train', unit: 'rifleman' });
    expect(sim.view('player').queue).toHaveLength(2);
    sim.command('player', { c: 'cancelTrain', unit: 'rifleman' });
    expect(sim.view('player').credits).toBe(credits - UNITS.rifleman.cost); // the cancelled one fully refunded
    run(sim, UNITS.rifleman.buildTimeSec * 1000 + 100);
    expect(mine(sim, 'rifleman')).toHaveLength(3);
    expect(sim.view('player').queue).toHaveLength(0);
  });

  it('harvesters come from the motor works', () => {
    const sim = Sim.create('skirmish');
    sim.command('player', { c: 'train', unit: 'harvester' });
    expect(sim.view('player').queue).toEqual([]);
    sim.command('player', { c: 'place', building: 'motor_works', tx: 1, ty: 10 });
    sim.debug('player', { d: 'finishBuilds' });
    run(sim, 100);
    sim.command('player', { c: 'train', unit: 'harvester' });
    expect(sim.view('player').queue).toEqual([{ unit: 'harvester', progress: 0 }]);
  });

  it('a harvester built at the Motor Works comes out of it, then works for the nearest refinery', () => {
    const sim = Sim.create('skirmish');
    sim.command('player', { c: 'place', building: 'motor_works', tx: 1, ty: 10 });
    sim.debug('player', { d: 'finishBuilds' });
    run(sim, 100);
    sim.view('player');
    sim.command('player', { c: 'train', unit: 'harvester' });
    expect(sim.view('player').buildings.find((b) => b.type === 'motor_works')?.working).toBe(true);
    sim.debug('player', { d: 'fast', factor: 20 });
    let out = false;
    for (let i = 0; i < 60 && !out; i++) {
      run(sim, 500);
      out = sim.view('player').events.some((e) => e.e === 'unitOut');
    }
    expect(out).toBe(true);
    const fresh = mine(sim, 'harvester').at(-1)! as { home: number | null };
    const refinery = [...sim.buildings.values()].find((b) => b.type === 'refinery' && b.team === 'player')!;
    expect(fresh.home).toBe(refinery.id);
  });

  it('a service bay repairs vehicles parked next to it', () => {
    const sim = Sim.create('skirmish');
    sim.command('player', { c: 'place', building: 'motor_works', tx: 1, ty: 10 });
    sim.debug('player', { d: 'finishBuilds' });
    run(sim, 100);
    sim.command('player', { c: 'place', building: 'service_bay', tx: 1, ty: 14 });
    sim.debug('player', { d: 'finishBuilds' });
    run(sim, 100);
    const h = mine(sim, 'harvester')[0];
    sim.debug('player', { d: 'teleport', units: [h.id], gx: 4.5, gy: 15.5 });
    sim.command('player', { c: 'stop', units: [h.id] });
    h.hp = h.maxHp / 2;
    run(sim, 2000);
    expect(h.hp).toBeGreaterThan(h.maxHp / 2);
  });

  it('a service bay repairs combat vehicles too, but not infantry', () => {
    const sim = Sim.create('skirmish');
    sim.command('player', { c: 'place', building: 'motor_works', tx: 1, ty: 10 });
    sim.debug('player', { d: 'finishBuilds' });
    run(sim, 100);
    sim.command('player', { c: 'place', building: 'service_bay', tx: 1, ty: 14 });
    sim.debug('player', { d: 'finishBuilds' });
    run(sim, 100);
    sim.debug('player', { d: 'spawn', unit: 'jackal', team: 'player', gx: 4.5, gy: 15.5 });
    const tank = mine(sim, 'jackal')[0];
    const rifleman = mine(sim, 'rifleman')[0];
    sim.debug('player', { d: 'teleport', units: [rifleman.id], gx: 4.5, gy: 14.5 });
    sim.command('player', { c: 'stop', units: [tank.id, rifleman.id] });
    tank.hp = tank.maxHp / 2;
    rifleman.hp = rifleman.maxHp / 2;
    run(sim, 2000);
    expect(tank.hp).toBeGreaterThan(tank.maxHp / 2);
    expect(rifleman.hp).toBe(rifleman.maxHp / 2);
  });

  it('low power slows construction', () => {
    const sim = Sim.create('skirmish');
    sim.command('player', { c: 'place', building: 'radar', tx: 1, ty: 10 });
    sim.command('player', { c: 'place', building: 'barracks', tx: 1, ty: 14 });
    sim.command('player', { c: 'place', building: 'refinery', tx: 10, ty: 13 });
    sim.debug('player', { d: 'finishBuilds' });
    run(sim, 100);
    const v = sim.view('player');
    expect(v.power.low).toBe(true);
    expect(v.radar).toBe('offline');
  });

  it('selling refunds half the cost', () => {
    const sim = Sim.create('skirmish');
    const plant = [...sim.buildings.values()].find((b) => b.team === 'player' && b.type === 'power_plant')!;
    sim.command('player', { c: 'sell', building: plant.id });
    const v = sim.view('player');
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
  });
});

describe('combat', () => {
  it('riflemen fight back and kill with the spreadsheet weapon', () => {
    const sim = Sim.create('skirmish');
    const r = mine(sim, 'rifleman')[0];
    sim.debug('player', { d: 'spawn', unit: 'rifleman', team: 'enemy', gx: r.gx + 2.5, gy: r.gy });
    run(sim, 200);
    const v = sim.view('player');
    expect(events(v, 'shot').length).toBeGreaterThan(0);
    // 2 riflemen vs 1: 200 HP at 60 per shot
    expect(hitDamage('service_rifle', 'unarmored')).toBe(60);
    run(sim, 6000);
    expect([...sim.units.values()].filter((u) => u.team === 'enemy' && u.type === 'rifleman')).toHaveLength(6);
    expect(sim.view('player').stats.unitsKilled).toBe(1);
  });

  it('a medic never heals the enemy', () => {
    const sim = Sim.create('skirmish', 7);
    const r = mine(sim, 'rifleman')[0];
    sim.debug('player', { d: 'spawn', unit: 'medic', team: 'enemy', gx: r.gx + 1, gy: r.gy });
    const medic = [...sim.units.values()].find((u) => u.type === 'medic') as Fighter;
    r.hp = r.maxHp / 2;
    run(sim, 500);
    expect(r.hp).toBeLessThanOrEqual(r.maxHp / 2);
    expect(medic.target).toBeNull();
  });

  /** One player rifleman at (20, 20) and one enemy rifleman `dx` tiles east, nothing else around. */
  const duel = (dx: number) => {
    const sim = Sim.create('skirmish', 7);
    sim.debug('player', { d: 'destroyTeam', team: 'enemy', units: true, buildings: false });
    const [a, ...rest] = mine(sim, 'rifleman');
    for (const u of rest) sim.killUnit(u);
    Object.assign(a, { gx: 20, gy: 20, path: [] });
    sim.debug('player', { d: 'spawn', unit: 'rifleman', team: 'enemy', gx: 20 + dx, gy: 20 });
    const e = [...sim.units.values()].find((u) => u.team === 'enemy' && u.type === 'rifleman')!;
    return { sim, a, e };
  };

  it.each([3.5, 5, 6])('idle units %s tiles apart close in and fight', (dx) => {
    const { sim, a, e } = duel(dx);
    run(sim, 15_000);
    expect(a.hp < a.maxHp || !a.alive).toBe(true);
    expect(e.hp < e.maxHp || !e.alive).toBe(true);
  });

  it('a unit on a move order stops to fight what comes within range, then carries on', () => {
    const { sim, a, e } = duel(0);
    a.gx = 14;
    e.hp = 30; // one shot
    const to = sim.map.nearestFree(30, 20)!; // scenery may cover the exact tile
    sim.command('player', { c: 'move', orders: [{ id: a.id, gx: to.tx + 0.5, gy: to.ty + 0.5 }] });
    run(sim, 15_000);
    expect(e.alive).toBe(false);
    expect(a.alive).toBe(true);
    expect(Math.hypot(a.gx - (to.tx + 0.5), a.gy - (to.ty + 0.5))).toBeLessThan(0.5);
  });

  it('buildings take small arms at half damage (damage matrix)', () => {
    const sim = Sim.create('skirmish');
    const radar = [...sim.buildings.values()].find((b) => b.team === 'enemy' && b.type === 'radar')!;
    sim.debug('player', { d: 'teleport', units: mine(sim, 'rifleman').map((u) => u.id), gx: radar.tx - 2, gy: radar.ty + 1 });
    sim.debug('enemy', { d: 'destroyTeam', team: 'enemy', units: true, buildings: false });
    sim.command('player', { c: 'attack', units: mine(sim, 'rifleman').map((u) => u.id), target: radar.id });
    run(sim, 200);
    expect(radar.hp).toBe(radar.maxHp - 2 * 30);
  });

  it('victory when every enemy building is gone; defeat when you have nothing left', () => {
    const win = Sim.create('skirmish');
    win.debug('player', { d: 'destroyTeam', team: 'enemy', units: false, buildings: true });
    expect(win.winner).toBe('player');
    expect(win.view('player').stats.buildingsDestroyed).toBe(7);

    const lose = Sim.create('skirmish');
    lose.debug('player', { d: 'destroyTeam', team: 'player', units: false, buildings: true });
    expect(lose.winner).toBeNull(); // units left
    lose.debug('player', { d: 'destroyTeam', team: 'player', units: true, buildings: false });
    expect(lose.winner).toBe('enemy');
  });
});

describe('selling, cancelling and repairs', () => {
  it('cancelling a building under construction refunds all of it; selling a finished one half', () => {
    const sim = Sim.create('skirmish');
    const start = sim.players.player.credits;
    sim.command('player', { c: 'place', building: 'barracks', tx: 1, ty: 10 });
    run(sim, 1000);
    const b = [...sim.buildings.values()].find((x) => x.type === 'barracks' && x.team === 'player')!;
    expect(b.built).toBe(false);
    sim.command('player', { c: 'cancelBuild', building: b.id });
    expect(sim.buildings.has(b.id)).toBe(false);
    expect(sim.players.player.credits).toBe(start);
    const pp = [...sim.buildings.values()].find((x) => x.type === 'power_plant' && x.team === 'player')!;
    sim.command('player', { c: 'sell', building: pp.id });
    expect(sim.players.player.credits).toBe(start + BUILDINGS.power_plant.cost * ECONOMY.refundFraction);
  });

  it('cancelling a unit in production refunds all of it', () => {
    const sim = Sim.create('skirmish');
    sim.command('player', { c: 'place', building: 'barracks', tx: 1, ty: 10 });
    sim.debug('player', { d: 'finishBuilds' });
    run(sim, 100);
    const before = sim.players.player.credits;
    sim.command('player', { c: 'train', unit: 'rifleman' });
    sim.command('player', { c: 'cancelTrain', unit: 'rifleman' });
    expect(sim.players.player.credits).toBe(before);
  });

  it('repairing heals a building, charges for it, and stops when it is full', () => {
    const sim = Sim.create('skirmish');
    const pp = [...sim.buildings.values()].find((x) => x.type === 'power_plant' && x.team === 'player')!;
    for (const h of mine(sim, 'harvester')) sim.killUnit(h); // no income meanwhile
    pp.hp = pp.maxHp / 2;
    sim.command('player', { c: 'repair', building: pp.id, on: true });
    expect(sim.view('player').buildings.find((b) => b.id === pp.id)?.repairing).toBe(true);
    const before = sim.players.player.credits;
    run(sim, ENGINE.repairSecondsForFull * 1000);
    expect(pp.hp).toBe(pp.maxHp);
    expect(pp.repairing).toBe(false);
    expect(before - sim.players.player.credits).toBeCloseTo(0.5 * BUILDINGS.power_plant.cost * ECONOMY.structureFullRepairFraction, 0);
  });

  it('repairs stop when the money runs out', () => {
    const sim = Sim.create('skirmish');
    const pp = [...sim.buildings.values()].find((x) => x.type === 'power_plant' && x.team === 'player')!;
    pp.hp = pp.maxHp / 2;
    sim.debug('player', { d: 'credits', amount: 0 });
    sim.command('player', { c: 'repair', building: pp.id, on: true });
    run(sim, 500);
    expect(pp.repairing).toBe(false);
    expect(pp.hp).toBe(pp.maxHp / 2);
  });
});

describe('vehicles', () => {
  it('an Assembler deploys into an Assembly Yard where it stands, far from the base too', () => {
    const sim = Sim.create('skirmish');
    // clear ground in the middle of the map, far from the base
    const w = sim.placementWorld('player');
    let spot = { tx: 0, ty: 0 };
    search: for (let ty = 24; ty < 40; ty++) for (let tx = 24; tx < 40; tx++) {
      let ok = true;
      for (let x = tx; x < tx + 4; x++) for (let y = ty; y < ty + 4; y++) if (w.isBlocked(x, y) || w.hasOre(x, y) || w.unitOn(x, y)) ok = false;
      if (ok) { spot = { tx, ty }; break search; }
    }
    sim.debug('player', { d: 'spawn', unit: 'assembler', team: 'player', gx: spot.tx + 2, gy: spot.ty + 2 });
    const a = mine(sim, 'assembler')[0];
    sim.command('player', { c: 'deploy', unit: a.id });
    expect(sim.units.has(a.id)).toBe(false);
    const yard = [...sim.buildings.values()].find((b) => b.type === 'assembly_yard' && b.tx === spot.tx && b.ty === spot.ty)!;
    expect(yard.built).toBe(false);
    run(sim, (ENGINE.deploySec + 0.5) * 1000);
    expect(yard.built).toBe(true);
  });

  it('a combat vehicle comes out of the Motor Works and fights', () => {
    const sim = Sim.create('skirmish');
    sim.debug('player', { d: 'spawn', unit: 'ram', team: 'player', gx: 30, gy: 30 });
    sim.debug('player', { d: 'spawn', unit: 'rifleman', team: 'enemy', gx: 33, gy: 30 });
    const target = [...sim.units.values()].find((u) => u.team === 'enemy' && Math.abs(u.gx - 33) < 0.1)!;
    const hp = target.hp;
    run(sim, 4000);
    expect(target.hp < hp || !target.alive).toBe(true);
  });

  it('a vehicle with a turning turret aims it and keeps its hull where it was', () => {
    const sim = Sim.create('skirmish');
    sim.debug('player', { d: 'spawn', unit: 'jackal', team: 'player', gx: 30, gy: 30 });
    sim.debug('player', { d: 'spawn', unit: 'rifleman', team: 'enemy', gx: 30, gy: 33 });
    const jackal = [...sim.units.values()].find((u) => u.type === 'jackal' && u.team === 'player' && Math.abs(u.gx - 30) < 0.1)!;
    const target = [...sim.units.values()].find((u) => u.team === 'enemy' && Math.abs(u.gy - 33) < 0.1)!;
    const hull = jackal.dir;
    const hp = target.hp;
    run(sim, 400);
    const v = sim.view('player');
    expect(v.units.find((u) => u.id === jackal.id)?.aim).toBe(facing(0, 3, 32));
    expect(events(v, 'shot').some((e) => e.e === 'shot' && e.from === jackal.id && e.p === 'shell')).toBe(true); // its light cannon fires shells
    run(sim, 2000);
    expect(target.hp < hp || !target.alive).toBe(true);
    expect(jackal.dir).toBe(hull);
  });

  it('a vehicle with a turning turret shoots on the move instead of stopping', () => {
    const sim = Sim.create('skirmish');
    sim.debug('player', { d: 'spawn', unit: 'jackal', team: 'player', gx: 30, gy: 30 });
    sim.debug('player', { d: 'spawn', unit: 'rifleman', team: 'enemy', gx: 33, gy: 32 });
    const jackal = [...sim.units.values()].find((u) => u.type === 'jackal' && u.team === 'player' && Math.abs(u.gx - 30) < 0.1)!;
    const target = [...sim.units.values()].find((u) => u.team === 'enemy' && Math.abs(u.gx - 33) < 0.1)!;
    const hp = target.hp;
    sim.command('player', { c: 'move', orders: [{ id: jackal.id, gx: 36.5, gy: 30.5 }] });
    const end = { ...jackal.path[jackal.path.length - 1] };
    const shotWhileMoving = { fired: false };
    for (let ms = 0; ms < 4000 && !shotWhileMoving.fired; ms += TICK_MS) {
      run(sim, TICK_MS);
      if (events(sim.view('player'), 'shot').some((e) => e.e === 'shot' && e.from === jackal.id) && jackal.moving) shotWhileMoving.fired = true;
    }
    expect(shotWhileMoving.fired).toBe(true);
    expect(target.hp < hp || !target.alive).toBe(true);
    run(sim, 6000);
    expect(Math.hypot(jackal.gx - end.gx, jackal.gy - end.gy)).toBeLessThan(0.01); // it got where it was going
  });
});

describe('defences', () => {
  it('a defence turns to the nearest enemy in range and shoots it', () => {
    const sim = Sim.create('skirmish');
    const turret = [...sim.buildings.values()].find((b) => b.type === 'incinerator')!;
    const intruder = mine(sim, 'rifleman')[0];
    sim.debug('player', { d: 'teleport', units: [intruder.id], gx: turret.tx + 3.5, gy: turret.ty + 0.5 });
    const hp = intruder.hp;
    run(sim, 200);
    const v = sim.view('player');
    expect(events(v, 'shot').some((e) => e.e === 'shot' && e.from === turret.id && e.to === intruder.id && e.p === 'fireball')).toBe(true);
    expect(intruder.hp).toBeLessThan(hp);
    expect(v.buildings.find((b) => b.id === turret.id)?.facing).toBe(0); // straight down +gx
  });

  it('a defence that needs power holds fire when it is low', () => {
    const sim = Sim.create('skirmish');
    for (const b of [...sim.buildings.values()]) if (b.team === 'enemy' && b.type === 'power_plant') sim.destroyBuilding(b);
    const anchorAt = { tx: 50, ty: 44 };
    sim.debug('enemy', { d: 'credits', amount: 99999 });
    (sim as unknown as { addBuilding: (t: string, team: string, tx: number, ty: number, built: boolean) => unknown }).addBuilding('anchor', 'enemy', anchorAt.tx, anchorAt.ty, true);
    const intruder = mine(sim, 'rifleman')[0];
    sim.debug('player', { d: 'teleport', units: [intruder.id], gx: anchorAt.tx + 4, gy: anchorAt.ty + 1 });
    run(sim, 500);
    expect(sim.powerOf('enemy').low).toBe(true);
    expect(events(sim.view('player'), 'shot').some((e) => e.e === 'shot' && e.p === 'instant discharge')).toBe(false);
  });
});

describe('saves and determinism', () => {
  it('an older save without an assembly yard gets the scenario\'s one', () => {
    const sim = Sim.create('skirmish');
    const snap = JSON.parse(JSON.stringify(sim.snapshot()));
    snap.version = 4;
    snap.buildings = snap.buildings.filter((b: { type: string }) => b.type !== 'assembly_yard');
    const back = Sim.restore(snap);
    expect([...back.buildings.values()].filter((b) => b.type === 'assembly_yard').map((b) => b.team).sort()).toEqual(['enemy', 'player']);
  });

  it('a snapshot restores the match', () => {
    const sim = Sim.create('skirmish');
    run(sim, 20_000);
    sim.debug('player', { d: 'credits', amount: 1234 });
    const snap = JSON.parse(JSON.stringify(sim.snapshot()));
    const back = Sim.restore(snap);
    const a = sim.view('player');
    const b = back.view('player');
    expect(b.credits).toBe(1234);
    expect(b.timeMs).toBe(a.timeMs);
    expect(b.buildings.map((x) => x.id)).toEqual(a.buildings.map((x) => x.id));
    expect(back.ore.totalRocks()).toBe(sim.ore.totalRocks());
    expect(b.fog!.replace(/2/g, '1')).toBe(a.fog!.replace(/2/g, '1'));
    run(back, 30_000); // keeps running: the harvester goes back to work
    expect(back.view('player').credits).toBeGreaterThan(1234);
  });

  it('refuses saves from the old browser format', () => {
    expect(() => Sim.restore({ version: 1 } as never)).toThrow('older version');
  });

  it('the same orders give the same match', () => {
    const play = () => {
      const sim = Sim.create('skirmish', 42);
      sim.command('player', { c: 'move', orders: mine(sim, 'rifleman').map((u, i) => ({ id: u.id, gx: 20 + i, gy: 20 })) });
      run(sim, 30_000);
      return JSON.stringify(sim.snapshot());
    };
    expect(play()).toBe(play());
  });

  it('respects the unit cap', () => {
    const sim = Sim.create('skirmish');
    sim.command('player', { c: 'place', building: 'motor_works', tx: 1, ty: 10 });
    sim.debug('player', { d: 'finishBuilds' });
    run(sim, 100);
    for (let i = 0; i < ENGINE.unitCap; i++) sim.debug('player', { d: 'spawn', unit: 'rifleman', team: 'player', gx: 2 + (i % 8), gy: 14 + Math.floor(i / 8) });
    sim.command('player', { c: 'train', unit: 'harvester' });
    expect(sim.view('player').events).toContainEqual({ e: 'toast', text: 'Unit cap reached' });
  });
});
