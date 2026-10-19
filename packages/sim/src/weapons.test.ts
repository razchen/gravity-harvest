// Weapons by target: each shot uses the weapon that reaches the target (ground or air), never an anti-air one on the ground.
import { UNITS, volleyDamage, weaponFor } from '@gravity-harvest/rules';
import { describe, expect, it } from 'vitest';
import { TICK_MS } from './layout.js';
import { Sim, type Fighter } from './sim.js';

const run = (sim: Sim, ms: number) => {
  for (let t = 0; t < ms; t += TICK_MS) sim.step();
};

/** A skirmish with no enemy units, and a spawner on open ground near the middle. */
function field() {
  const sim = Sim.create('skirmish', 3);
  sim.debug('player', { d: 'destroyTeam', team: 'enemy', units: true, buildings: false });
  const spawn = (team: 'player' | 'enemy', unit: string, gx: number, gy: number) => {
    sim.debug('player', { d: 'spawn', unit, team, gx, gy });
    return [...sim.units.values()].at(-1)! as Fighter;
  };
  return { sim, spawn };
}

describe('weapons', () => {
  it('picks the first weapon that reaches the target', () => {
    expect(weaponFor(UNITS.lancer.weapons, 'ground')).toBe('armor_missile');
    expect(weaponFor(UNITS.lancer.weapons, 'air')).toBe('sky_missile');
    expect(weaponFor(UNITS.jackal.weapons, 'air')).toBe(null);
    expect(weaponFor(UNITS.anvil.weapons, 'ground')).toBe('anvil_cannon');
    expect(weaponFor(UNITS.anvil.weapons, 'air')).toBe('support_missiles');
  });

  it('a Lancer fires its anti-armour missile at a vehicle, not its anti-air one', () => {
    const { sim, spawn } = field();
    const l = spawn('player', 'lancer', 30.5, 30.5);
    const j = spawn('enemy', 'jackal', 33.5, 30.5);
    j.weapons = [];
    const hp = j.hp;
    for (let t = 0; t < 5000 && j.hp === hp; t += TICK_MS) sim.step();
    expect(hp - j.hp).toBeCloseTo(volleyDamage('armor_missile', j.armor), 5);
    expect(l.target).toBe(j.id);
  });

  it('a ground-only unit ignores aircraft, and gives up an order to attack one', () => {
    const { sim, spawn } = field();
    const j = spawn('player', 'jackal', 30.5, 30.5);
    const a = spawn('enemy', 'drift', 32.5, 30.5);
    a.weapons = [];
    run(sim, 2000);
    expect(j.target).toBe(null);
    expect(a.hp).toBe(a.maxHp);
    sim.command('player', { c: 'attack', units: [j.id], target: a.id });
    run(sim, 1000);
    expect(j.target).toBe(null);
    expect(a.hp).toBe(a.maxHp);
  });

  it('an anti-air defence leaves ground units alone', () => {
    const { sim, spawn } = field();
    (sim as unknown as { addBuilding: (t: string, team: string, tx: number, ty: number, built: boolean) => unknown }).addBuilding('flak_array', 'player', 30, 30, true);
    const j = spawn('enemy', 'jackal', 34.5, 31.5);
    j.weapons = [];
    run(sim, 3000);
    expect(j.hp).toBe(j.maxHp);
  });
});
