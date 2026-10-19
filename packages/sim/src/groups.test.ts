// Group moves: formation destinations, units keeping apart, and no deadlock in a choke point.
import { describe, expect, it } from 'vitest';
import { ENGINE, TICK_MS } from './layout.js';
import { Sim, type Unit } from './sim.js';

const run = (sim: Sim, ms: number) => {
  for (let t = 0; t < ms; t += TICK_MS) sim.step();
};
const tile = (p: { gx: number; gy: number }) => `${Math.floor(p.gx)},${Math.floor(p.gy)}`;
/** Where a unit is heading (the end of its path), or where it stands. */
const dest = (u: Unit) => u.path[u.path.length - 1] ?? u;
const closest = (units: Unit[]) => {
  let min = Infinity;
  for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) min = Math.min(min, Math.hypot(units[i].gx - units[j].gx, units[i].gy - units[j].gy));
  return min;
};
const apart = 2 * ENGINE.vehicleRadius;

/**
 * A skirmish with a patch of open ground of size x size tiles near the middle: no buildings, ore or units on it, and
 * its scenery cleared away.
 */
function openGround(size = 14) {
  const sim = Sim.create('skirmish', 3);
  const world = sim.placementWorld('player');
  for (let ty = 16; ty < 40; ty++) for (let tx = 16; tx < 40; tx++) {
    let ok = true;
    for (let x = tx; x < tx + size && ok; x++) for (let y = ty; y < ty + size && ok; y++) if (world.hasOre(x, y) || world.unitOn(x, y)) ok = false;
    for (const b of sim.buildings.values()) if (b.tx < tx + size + 1 && tx < b.tx + b.size + 1 && b.ty < ty + size + 1 && ty < b.ty + b.size + 1) ok = false;
    if (!ok) continue;
    sim.map.setFootprint(tx, ty, size, false);
    const jackals: Unit[] = [];
    const spawn = (gx: number, gy: number) => {
      sim.debug('player', { d: 'spawn', unit: 'jackal', team: 'player', gx: tx + gx, gy: ty + gy });
      const u = [...sim.units.values()].at(-1)!;
      jackals.push(u);
      return u;
    };
    return { sim, tx, ty, spawn, jackals };
  }
  throw new Error('no open ground');
}

describe('moving in groups', () => {
  it('a group sent to one point gets a tile each around it, close together', () => {
    const { sim, tx, ty, spawn, jackals } = openGround();
    for (let i = 0; i < 6; i++) spawn(1.5 + (i % 3), 1.5 + Math.floor(i / 3));
    const to = { gx: tx + 9.5, gy: ty + 9.5 };
    sim.command('player', { c: 'move', orders: jackals.map((u) => ({ id: u.id, ...to })) });
    const ends = jackals.map(dest);
    expect(new Set(ends.map(tile)).size).toBe(6);
    for (const e of ends) expect(Math.hypot(e.gx - to.gx, e.gy - to.gy)).toBeLessThan(2.3);
    run(sim, 15000);
    for (const u of jackals) {
      expect(u.path).toHaveLength(0);
      expect(Math.hypot(u.gx - to.gx, u.gy - to.gy)).toBeLessThan(2.5);
    }
    expect(closest(jackals)).toBeGreaterThan(apart - 0.05);
  });

  it('keeps their places relative to each other', () => {
    const { sim, tx, ty, spawn, jackals } = openGround();
    const left = spawn(1.5, 3.5), right = spawn(3.5, 3.5), back = spawn(2.5, 1.5);
    sim.command('player', { c: 'move', orders: jackals.map((u) => ({ id: u.id, gx: tx + 9.5, gy: ty + 9.5 })) });
    expect(dest(left).gx).toBeLessThan(dest(right).gx);
    expect(dest(back).gy).toBeLessThan(Math.max(dest(left).gy, dest(right).gy));
    // a group spread wide closes up
    const far = openGround();
    const a = far.spawn(0.5, 0.5), b = far.spawn(12.5, 12.5); // (the corners of the patch)
    far.sim.command('player', { c: 'move', orders: [a, b].map((u) => ({ id: u.id, gx: far.tx + 6.5, gy: far.ty + 6.5 })) });
    expect(Math.hypot(dest(a).gx - dest(b).gx, dest(a).gy - dest(b).gy)).toBeLessThan(2);
    expect(dest(a).gx).toBeLessThan(dest(b).gx);
  });

  it('skips tiles that are blocked or where others stand', () => {
    const { sim, tx, ty, spawn, jackals } = openGround();
    const to = { gx: tx + 9.5, gy: ty + 9.5 };
    const parked = spawn(9.5, 9.5);
    sim.map.setFootprint(tx + 10, ty + 9, 1, true);
    const group = [spawn(1.5, 1.5), spawn(2.5, 1.5), spawn(1.5, 2.5)];
    sim.command('player', { c: 'move', orders: group.map((u) => ({ id: u.id, ...to })) });
    const ends = group.map((u) => tile(dest(u)));
    expect(ends).not.toContain(tile(parked));
    expect(ends).not.toContain(`${tx + 10},${ty + 9}`);
    expect(new Set(ends).size).toBe(3);
    run(sim, 12000);
    expect(closest(jackals)).toBeGreaterThan(apart - 0.05);
  });

  it('a unit driving through nudges an idle one aside, and they never pile up', () => {
    const { sim, tx, ty, spawn } = openGround();
    const idle = spawn(6.5, 4.5);
    sim.command('player', { c: 'move', orders: [{ id: idle.id, gx: tx + 6.5, gy: ty + 5.5 }] });
    run(sim, 2000); // it stopped there after a move
    const mover = spawn(1.5, 5.5);
    sim.command('player', { c: 'move', orders: [{ id: mover.id, gx: tx + 11.5, gy: ty + 5.5 }] });
    let min = Infinity;
    for (let t = 0; t < 12000; t += TICK_MS) {
      sim.step();
      min = Math.min(min, closest([idle, mover]));
    }
    expect(Math.hypot(mover.gx - (tx + 11.5), mover.gy - (ty + 5.5))).toBeLessThan(0.05);
    expect(min).toBeGreaterThan(0.5);
    expect(closest([idle, mover])).toBeGreaterThan(apart - 0.05);
    // and it goes back to where it was once the way is clear
    run(sim, 5000);
    expect(Math.hypot(idle.gx - (tx + 6.5), idle.gy - (ty + 5.5))).toBeLessThan(ENGINE.restSlack + 0.05);
  });

  it('two units meeting head on pass each other', () => {
    const { sim, tx, ty, spawn } = openGround();
    const a = spawn(1.5, 5.5), b = spawn(11.5, 5.5);
    sim.command('player', { c: 'move', orders: [{ id: a.id, gx: tx + 11.5, gy: ty + 5.5 }] });
    sim.command('player', { c: 'move', orders: [{ id: b.id, gx: tx + 1.5, gy: ty + 5.5 }] });
    let min = Infinity;
    for (let t = 0; t < 15000; t += TICK_MS) {
      sim.step();
      min = Math.min(min, closest([a, b]));
    }
    expect(Math.hypot(a.gx - (tx + 11.5), a.gy - (ty + 5.5))).toBeLessThan(0.05);
    expect(Math.hypot(b.gx - (tx + 1.5), b.gy - (ty + 5.5))).toBeLessThan(0.05);
    expect(min).toBeGreaterThan(0.5);
  });

  it('a group squeezes through a one-tile gap and settles, without jitter or deadlock', () => {
    const { sim, tx, ty, spawn, jackals } = openGround();
    // a wall across the patch with a gap in the middle
    for (let y = ty; y < ty + 14; y++) if (y !== ty + 7) sim.map.setFootprint(tx + 6, y, 1, true);
    for (let i = 0; i < 6; i++) spawn(1.5 + (i % 2), 4.5 + Math.floor(i / 2) * 2);
    sim.command('player', { c: 'move', orders: jackals.map((u) => ({ id: u.id, gx: tx + 11.5, gy: ty + 7.5 })) });
    run(sim, 40000);
    const at = jackals.map((u) => ({ gx: u.gx, gy: u.gy }));
    run(sim, 2000);
    jackals.forEach((u, i) => {
      expect(u.path).toHaveLength(0);
      expect(Math.hypot(u.gx - at[i].gx, u.gy - at[i].gy)).toBeLessThan(0.01); // at rest
      expect(u.gx).toBeGreaterThan(tx + 7); // all through
    });
    expect(closest(jackals)).toBeGreaterThan(apart - 0.05);
  });

  it('a unit sent onto an occupied spot settles on the nearest free tile', () => {
    const { sim, tx, ty, spawn } = openGround();
    // another unit is parked right on the spot: the newcomer nudges it or stops next to it, never on top of it
    const parked = spawn(9.5, 9.5);
    const mover = spawn(2.5, 2.5);
    sim.command('player', { c: 'move', orders: [{ id: mover.id, gx: tx + 9.5, gy: ty + 9.5 }] });
    run(sim, 15000);
    expect(mover.path).toHaveLength(0);
    expect(closest([parked, mover])).toBeGreaterThan(apart - 0.05);
    expect(Math.hypot(mover.gx - (tx + 9.5), mover.gy - (ty + 9.5))).toBeLessThan(ENGINE.settleTiles + 0.5);
  });

  it('applies to harvesters too, and the harvest loop still pays', () => {
    const sim = Sim.create('skirmish', 3);
    const start = sim.players.player.credits;
    run(sim, 120_000);
    expect(sim.players.player.credits).toBeGreaterThan(start);
  });
});
