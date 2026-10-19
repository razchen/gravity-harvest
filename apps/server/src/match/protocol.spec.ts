import { describe, expect, it } from 'vitest';
import type { Command } from '@gravity-harvest/shared';
import { isCommand, parseClientMessage, type CommandChecks } from './protocol.js';

// @ts-expect-error every command needs a check: a map missing one doesn't compile
const missing: CommandChecks = { move: () => true };
void missing;

/** For each command: a well-formed example, and malformed variants that must be refused. */
const CASES: { [K in Command['c']]: { valid: Extract<Command, { c: K }>[]; malformed: Record<string, unknown>[] } } = {
  move: {
    valid: [{ c: 'move', orders: [{ id: 1, gx: 2.5, gy: 3 }] }, { c: 'move', orders: [] }],
    malformed: [
      { c: 'move' },
      { c: 'move', orders: [{ id: 1.5, gx: 2, gy: 3 }] },
      { c: 'move', orders: [{ id: 1, gx: 'x', gy: 3 }] },
      { c: 'move', orders: [{ id: 1, gx: Infinity, gy: 3 }] },
      { c: 'move', orders: Array.from({ length: 201 }, (_, id) => ({ id, gx: 0, gy: 0 })) },
    ],
  },
  attackMove: {
    valid: [{ c: 'attackMove', orders: [{ id: 1, gx: 2, gy: 3 }] }],
    malformed: [{ c: 'attackMove', orders: 'all' }, { c: 'attackMove', orders: [null] }],
  },
  attack: {
    valid: [{ c: 'attack', units: [1, 2], target: 9 }],
    malformed: [{ c: 'attack', units: [1] }, { c: 'attack', units: [1.5], target: 9 }, { c: 'attack', units: 1, target: 9 }],
  },
  harvest: {
    valid: [{ c: 'harvest', units: [1], tx: 4, ty: 5 }],
    malformed: [{ c: 'harvest', units: [1], tx: 4.5, ty: 5 }, { c: 'harvest', units: [1], tx: 4 }],
  },
  dock: {
    valid: [{ c: 'dock', units: [1], refinery: 3 }],
    malformed: [{ c: 'dock', units: [1], refinery: '3' }, { c: 'dock', refinery: 3 }],
  },
  service: {
    valid: [{ c: 'service', units: [1], bay: 3 }],
    malformed: [{ c: 'service', units: [1] }, { c: 'service', units: ['1'], bay: 3 }],
  },
  stop: {
    valid: [{ c: 'stop', units: [1, 2, 3] }],
    malformed: [{ c: 'stop' }, { c: 'stop', units: Array.from({ length: 201 }, (_, i) => i) }],
  },
  place: {
    valid: [{ c: 'place', building: 'barracks', tx: 1, ty: 10 }],
    malformed: [
      { c: 'place', building: '', tx: 1, ty: 10 },
      { c: 'place', building: 'x'.repeat(65), tx: 1, ty: 10 },
      { c: 'place', building: 'barracks', tx: 1 },
    ],
  },
  train: {
    valid: [{ c: 'train', unit: 'tank' }, { c: 'train', unit: 'tank', near: { gx: 3, gy: 4 } }],
    malformed: [{ c: 'train' }, { c: 'train', unit: 'tank', near: { gx: 3 } }, { c: 'train', unit: 'tank', near: null }],
  },
  cancelTrain: {
    valid: [{ c: 'cancelTrain', unit: 'tank' }],
    malformed: [{ c: 'cancelTrain', unit: 7 }],
  },
  sell: {
    valid: [{ c: 'sell', building: 4 }],
    malformed: [{ c: 'sell' }, { c: 'sell', building: 'b4' }],
  },
  cancelBuild: {
    valid: [{ c: 'cancelBuild', building: 4 }],
    malformed: [{ c: 'cancelBuild', building: 4.2 }],
  },
  repair: {
    valid: [{ c: 'repair', building: 4, on: true }, { c: 'repair', building: 4, on: false }],
    malformed: [{ c: 'repair', building: 4 }, { c: 'repair', building: 4, on: 1 }],
  },
  support: {
    valid: [{ c: 'support', units: [1], target: 2 }],
    malformed: [{ c: 'support', units: [1] }, { c: 'support', target: 2 }],
  },
  deploy: {
    valid: [{ c: 'deploy', unit: 5 }],
    malformed: [{ c: 'deploy' }, { c: 'deploy', unit: [5] }],
  },
  board: {
    valid: [{ c: 'board', units: [1, 2], transport: 6 }],
    malformed: [{ c: 'board', units: [1, 2] }, { c: 'board', units: null, transport: 6 }],
  },
  unload: {
    valid: [{ c: 'unload', transport: 6 }],
    malformed: [{ c: 'unload' }, { c: 'unload', transport: '6' }],
  },
};

describe('isCommand', () => {
  describe.each(Object.entries(CASES))('%s', (_name, { valid, malformed }) => {
    it.each(valid.map((c) => [JSON.stringify(c), c]))('accepts %s', (_label, c) => {
      expect(isCommand(c)).toBe(true);
      expect(parseClientMessage(JSON.stringify({ t: 'cmd', cmd: c }))).toEqual({ t: 'cmd', cmd: c });
    });

    it.each(malformed.map((c) => [JSON.stringify(c).slice(0, 80), c]))('refuses %s', (_label, c) => {
      expect(isCommand(c)).toBe(false);
      expect(parseClientMessage(JSON.stringify({ t: 'cmd', cmd: c }))).toBeNull();
    });
  });

  it('refuses unknown commands and non-objects', () => {
    for (const c of [null, 3, 'move', [], {}, { c: 'nuke' }, { c: 'toString' }, { c: '__proto__' }, { c: 7 }]) {
      expect(isCommand(c)).toBe(false);
    }
  });
});

describe('parseClientMessage', () => {
  it('refuses text that is not a JSON object', () => {
    for (const raw of ['{not json', '[]', 'null', '"cmd"', '{"t":"nope"}']) expect(parseClientMessage(raw)).toBeNull();
  });

  it('checks start, save and debug messages', () => {
    const ok = (m: unknown) => parseClientMessage(JSON.stringify(m)) !== null;
    expect(ok({ t: 'start', scenario: 'skirmish', autosaveOnLeave: false })).toBe(true);
    expect(ok({ t: 'start', scenario: 'skirmish', saveId: 'x', autosaveOnLeave: false })).toBe(false);
    expect(ok({ t: 'start', scenario: 'skirmish' })).toBe(false);
    expect(ok({ t: 'start', scenario: 'skirmish', autosaveOnLeave: true, difficulty: 'insane' })).toBe(false);
    expect(ok({ t: 'start', scenario: 'skirmish', autosaveOnLeave: true, seat: 'b' })).toBe(true);
    expect(ok({ t: 'start', scenario: 'skirmish', autosaveOnLeave: true, seat: 'player' })).toBe(false);
    expect(ok({ t: 'debug', cmd: { d: 'spawn', unit: 'rifleman', team: 'enemy', gx: 1, gy: 1 } })).toBe(false);
    expect(ok({ t: 'save', req: 1, name: 'a', kind: 'manual', thumbnail: null })).toBe(true);
    expect(ok({ t: 'save', req: 1, name: 'a', kind: 'other', thumbnail: null })).toBe(false);
    expect(ok({ t: 'debug', cmd: { d: 'credits', amount: 5 } })).toBe(true);
    expect(ok({ t: 'debug', cmd: { d: 'fast', factor: 50 } })).toBe(false);
    expect(ok({ t: 'debug', cmd: { d: 'hasOwnProperty' } })).toBe(false);
    expect(ok({ t: 'pause' })).toBe(true);
    expect(ok({ t: 'rejoin' })).toBe(true);
  });
});
