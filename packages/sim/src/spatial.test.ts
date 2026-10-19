// The indexes the systems look things up in (the unit grid, each team's buildings) must always say exactly what a scan
// of every unit or building would, in the same order: otherwise the match would play differently.
import { TEAMS } from '@gravity-harvest/shared';
import { describe, expect, it } from 'vitest';
import { Sim } from './sim.js';
import type { SimState } from './state.js';

const stateOf = (sim: Sim) => (sim as unknown as { s: SimState }).s;

/** The grid and the team indexes against the maps they index. */
function check(sim: Sim): void {
  const s = stateOf(sim);
  const units = [...s.units.values()];
  // every unit on the map, nothing else, in the map's order
  expect(s.grid.within(-10, -10, s.map.width + 10, s.map.height + 10)).toEqual(units);
  for (const u of units) {
    expect(s.grid.on(Math.floor(u.gx), Math.floor(u.gy))).toContain(u);
    // a look around it finds what a scan of every unit would, in the same order
    const scan = units.filter((o) => Math.abs(o.gx - u.gx) <= 3 && Math.abs(o.gy - u.gy) <= 3);
    expect(s.grid.near(u.gx, u.gy, 3).filter((o) => Math.abs(o.gx - u.gx) <= 3 && Math.abs(o.gy - u.gy) <= 3)).toEqual(scan);
  }
  for (const t of TEAMS) expect([...s.teamBuildingMap[t].values()]).toEqual([...s.buildings.values()].filter((b) => b.team === t));
}

describe('lookup indexes', () => {
  it('match the units and buildings through a busy fight, boarding, unloading, deaths and a save', () => {
    let sim = Sim.create('skirmish', 4, 'ordan', { computerOnly: true });
    const types = ['rifleman', 'medic', 'jackal', 'ram', 'carrier', 'engineer', 'grenadier', 'spire'];
    for (const t of TEAMS) {
      const x = t === 'a' ? 6 : 76;
      for (let i = 0; i < 40; i++) {
        const at = sim.map.nearestFree(x + (i % 8), 12 + Math.floor(i / 8))!;
        sim.debug(t, { d: 'spawn', unit: types[i % types.length], team: t, gx: at.tx + 0.5, gy: at.ty + 0.5 });
      }
    }
    // soldiers board a carrier of their side, and are let out again later; the rest charge
    for (const t of TEAMS) {
      const mine = [...sim.units.values()].filter((u) => u.team === t && u.kind === 'fighter');
      const carrier = mine.find((u) => u.type === 'carrier')!;
      const soldiers = mine.filter((u) => u.type === 'rifleman').slice(0, 3);
      sim.command(t, { c: 'board', transport: carrier.id, units: soldiers.map((u) => u.id) });
      const enemy = [...sim.buildings.values()].find((b) => b.team !== t)!;
      const rest = mine.filter((u) => u !== carrier && !soldiers.includes(u));
      sim.command(t, { c: 'attackMove', orders: rest.map((u) => ({ id: u.id, gx: enemy.tx + 2, gy: enemy.ty + 2 })) });
    }
    let boarded = 0;
    for (let tick = 0; tick < 3000; tick++) {
      sim.step();
      for (const u of sim.units.values()) if (u.kind === 'fighter') boarded = Math.max(boarded, u.passengers.length);
      if (tick === 600) {
        for (const u of sim.units.values()) if (u.kind === 'fighter' && u.passengers.length) sim.command(u.team, { c: 'unload', transport: u.id });
      }
      if (tick === 1200) sim = Sim.restore(JSON.parse(JSON.stringify(sim.snapshot())));
      if (tick === 1500) {
        const u = [...sim.units.values()][0];
        sim.debug(u.team, { d: 'teleport', units: [u.id], gx: 40, gy: 30 });
      }
      if (tick % 25 === 0) check(sim);
    }
    check(sim);
    expect(boarded).toBeGreaterThan(0);
    expect(sim.players.a.stats.unitsLost + sim.players.b.stats.unitsLost).toBeGreaterThan(10);
  });
});
