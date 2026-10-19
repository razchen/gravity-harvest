// Attack-move: units on the way to a point stop to fight what they come across (buildings too), then carry on.
import { describe, expect, it } from 'vitest';
import { TICK_MS } from './layout.js';
import { Sim, type Fighter, type Unit } from './sim.js';

const run = (sim: Sim, ms: number) => {
  for (let t = 0; t < ms; t += TICK_MS) sim.step();
};
/** Where a unit is heading (the end of its path), or where it stands. */
const dest = (u: Unit) => u.path[u.path.length - 1] ?? u;
const near = (a: { gx: number; gy: number }, b: { gx: number; gy: number }, d: number) => Math.hypot(a.gx - b.gx, a.gy - b.gy) < d;

/** A skirmish with open ground of size x size tiles near the middle (as in groups.test.ts), and no enemy units. */
function openGround(seed = 3, size = 16) {
  const sim = Sim.create('skirmish', seed);
  sim.debug('player', { d: 'destroyTeam', team: 'enemy', units: true, buildings: false });
  // both sides see everything: what's tested is how far units look, not what the fog hides
  for (const t of ['player', 'enemy'] as const) sim.debug(t, { d: 'reveal', on: true });
  const world = sim.placementWorld('player');
  for (let ty = 16; ty < 40; ty++) for (let tx = 16; tx < 40; tx++) {
    let ok = true;
    for (let x = tx; x < tx + size && ok; x++) for (let y = ty; y < ty + size && ok; y++) if (world.hasOre(x, y) || world.unitOn(x, y)) ok = false;
    for (const b of sim.buildings.values()) if (b.tx < tx + size + 1 && tx < b.tx + b.size + 1 && b.ty < ty + size + 1 && ty < b.ty + b.size + 1) ok = false;
    if (!ok) continue;
    sim.map.setFootprint(tx, ty, size, false);
    const spawn = (team: 'player' | 'enemy', gx: number, gy: number, unit = 'jackal') => {
      sim.debug('player', { d: 'spawn', unit, team, gx: tx + gx, gy: ty + gy });
      return [...sim.units.values()].at(-1)! as Fighter;
    };
    return { sim, tx, ty, spawn };
  }
  throw new Error('no open ground');
}

/**
 * A jackal (weapon range 4, acquire range 7) sent along a row, past a harmless enemy 5.5 tiles to the side: out of
 * weapon range all the way, but within what an idle unit would go for.
 */
function passBy(c: 'move' | 'attackMove') {
  const { sim, tx, ty, spawn } = openGround();
  const a = spawn('player', 1.5, 2.5);
  const e = spawn('enemy', 8.5, 8);
  e.weapons = [];
  e.hp = 1; // one shot
  const to = { gx: tx + 14.5, gy: ty + 2.5 };
  sim.command('player', { c, orders: [{ id: a.id, ...to }] });
  return { sim, a, e, to };
}

describe('attack-move', () => {
  it('a plain move drives past an enemy out of weapon range', () => {
    const { sim, a, e, to } = passBy('move');
    run(sim, 20_000);
    expect(e.alive).toBe(true);
    expect(near(a, to, 0.5)).toBe(true);
  });

  it('a unit engages an enemy it comes across on the way, then carries on to its point', () => {
    const { sim, a, e, to } = passBy('attackMove');
    expect(a.attackMove).toEqual(to);
    let stopped = false;
    for (let ms = 0; ms < 20_000 && e.alive; ms += TICK_MS) {
      run(sim, TICK_MS);
      if (a.target === e.id && a.mode === 'idle') stopped = true;
    }
    expect(stopped).toBe(true); // it stopped to fight (a turret that turns on its own doesn't on a plain move)
    expect(e.alive).toBe(false);
    run(sim, 20_000);
    expect(a.alive).toBe(true);
    expect(near(a, to, 0.5)).toBe(true);
    expect(a.attackMove).toBeNull(); // there: the order is over
    expect(a.mode).toBe('idle');
  });

  it('an enemy that gets away is let go, and the unit carries on', () => {
    const { sim, a, e, to } = passBy('attackMove');
    e.hp = e.maxHp;
    for (let ms = 0; ms < 10_000 && a.target !== e.id; ms += TICK_MS) run(sim, TICK_MS);
    expect(a.target).toBe(e.id);
    // the enemy is whisked far away
    e.gx += 40;
    run(sim, 20_000);
    expect(near(a, to, 0.5)).toBe(true);
  });

  it('goes for enemy buildings on the way', () => {
    const sim = Sim.create('skirmish', 3);
    sim.debug('player', { d: 'destroyTeam', team: 'enemy', units: true, buildings: false });
    sim.debug('player', { d: 'reveal', on: true }); // it's 5 tiles off, past a jackal's sight: a spotter would have seen it
    const b = [...sim.buildings.values()].find((x) => x.team === 'enemy' && x.type !== 'assembly_yard')!;
    for (const x of sim.buildings.values()) if (x.team === 'enemy' && x !== b) sim.destroyBuilding(x, true); // no defences
    b.hp = 1;
    const mid = { gx: b.tx + b.size / 2, gy: b.ty + b.size / 2 };
    const from = sim.map.nearestFree(Math.floor(mid.gx - b.size / 2 - 5), Math.floor(mid.gy))!;
    sim.debug('player', { d: 'spawn', unit: 'jackal', team: 'player', gx: from.tx + 0.5, gy: from.ty + 0.5 });
    const a = [...sim.units.values()].at(-1)! as Fighter;
    const end = sim.map.nearestFree(from.tx, from.ty + 6)!;
    const to = { gx: end.tx + 0.5, gy: end.ty + 0.5 };
    sim.command('player', { c: 'attackMove', orders: [{ id: a.id, ...to }] });
    run(sim, 20_000);
    expect(b.alive).toBe(false); // (the enemy's last building: that's the match, so the jackal stays where it is)
    expect(a.alive).toBe(true);
  });

  it('a group spreads round the point just as for a move', () => {
    const ends = (c: 'move' | 'attackMove') => {
      const { sim, tx, ty, spawn } = openGround();
      const units = [...Array(6)].map((_, i) => spawn('player', 1.5 + (i % 3), 1.5 + Math.floor(i / 3)));
      sim.command('player', { c, orders: units.map((u) => ({ id: u.id, gx: tx + 9.5, gy: ty + 9.5 })) });
      return units.map((u) => ({ ...dest(u), attackMove: u.attackMove }));
    };
    const moved = ends('move');
    const attacked = ends('attackMove');
    expect(new Set(attacked.map((p) => `${Math.floor(p.gx)},${Math.floor(p.gy)}`)).size).toBe(6);
    attacked.forEach((p, i) => {
      expect(p.gx).toBeCloseTo(moved[i].gx);
      expect(p.gy).toBeCloseTo(moved[i].gy);
      expect(p.attackMove).toEqual({ gx: p.gx, gy: p.gy }); // each carries on to its own place in the group
    });
  });

  it('harvesters and unarmed units given it just move', () => {
    const sim = Sim.create('skirmish', 3);
    const h = [...sim.units.values()].find((u) => u.team === 'player' && u.kind === 'harvester')!;
    const to = sim.map.nearestFree(Math.floor(h.gx) + 4, Math.floor(h.gy) + 4)!;
    sim.command('player', { c: 'attackMove', orders: [{ id: h.id, gx: to.tx + 0.5, gy: to.ty + 0.5 }] });
    expect(h.kind === 'harvester' && h.state).toBe('move');
  });
});
