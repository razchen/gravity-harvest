import { Logger } from '@nestjs/common';
import { RULES_HASH } from '@gravity-harvest/rules';
import type { SaveGameInput, ServerMessage, TeamView } from '@gravity-harvest/shared';
import { SNAPSHOT_VERSION, replay, type SimSnapshot } from '@gravity-harvest/sim';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SavesService } from '../saves/saves.service.js';
import { MatchRooms } from './match-room.js';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const GRACE_MS = 300;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A seat's connection, as the room sees it: it just collects what it is sent. */
class Link {
  readonly messages: ServerMessage[] = [];
  send(m: ServerMessage): void {
    this.messages.push(m);
  }
  views(): TeamView[] {
    return this.messages.filter((m): m is TeamView & { t: 'view' } => m.t === 'view');
  }
}

/** Saves in memory: just what the room uses. */
function fakeSaves() {
  const stored = new Map<string, SaveGameInput>();
  const summary = (id: string, s: SaveGameInput) => ({ id, name: s.name, scenario: s.scenario, kind: s.kind, version: s.version });
  return {
    stored,
    list: vi.fn(async (_owner: string, q: { kind?: string } = {}) => [...stored].filter(([, s]) => !q.kind || s.kind === q.kind).map(([id, s]) => summary(id, s))),
    create: vi.fn(async (_owner: string, input: SaveGameInput) => {
      const id = `save-${stored.size + 1}`;
      stored.set(id, input);
      return summary(id, input);
    }),
    replace: vi.fn(async (_owner: string, id: string, input: SaveGameInput) => (stored.set(id, input), summary(id, input))),
    remove: vi.fn(async (_owner: string, id: string) => void stored.delete(id)),
    getState: vi.fn(async (_owner: string, id: string) => ({ summary: summary(id, stored.get(id)!), state: stored.get(id)!.state })),
  };
}

describe('MatchRoom', () => {
  let rooms: MatchRooms;
  let saves: ReturnType<typeof fakeSaves>;
  const setup = () => {
    saves = fakeSaves();
    rooms = new MatchRooms({ saves: saves as unknown as SavesService, debugCommands: true, graceMs: GRACE_MS });
  };

  afterEach(() => rooms.closeAll());

  it('a dropped player rejoins the same match: it waits for them, paused, and they get a fresh full view', async () => {
    setup();
    const room = await rooms.open(ME, { scenario: 'skirmish', autosaveOnLeave: true });
    const first = new Link();
    room.attach('a', first);
    expect(first.messages[0]).toMatchObject({ t: 'hello', you: 'a' });
    await wait(250);
    expect(room.sim.tick).toBeGreaterThan(0);
    expect(first.views().length).toBeGreaterThan(1);
    expect(first.views().slice(1).some((v) => v.fog === undefined)).toBe(true); // only sent when it changes

    // the connection drops: the match autosaves and stands still
    await room.detach('a', first);
    expect(saves.create).toHaveBeenCalledWith(ME, expect.objectContaining({ kind: 'auto', name: 'Autosave' }));
    const tick = room.sim.tick;
    await wait(150);
    expect(room.sim.tick).toBe(tick);
    expect(rooms.awaiting(ME)).toBe(room);
    expect(rooms.awaiting(OTHER)).toBeNull();

    // the same player comes back: hello, the whole fog, and the clock runs again; the grace period no longer applies
    const second = new Link();
    room.attach(room.seatOf(ME)!, second);
    expect(second.messages[0]).toMatchObject({ t: 'hello', you: 'a' });
    expect(second.views()[0]).toMatchObject({ tick, fog: expect.any(String) });
    expect(second.views()[0].fog).toHaveLength(room.sim.map.width * room.sim.map.height);
    expect(rooms.awaiting(ME)).toBeNull();
    await wait(GRACE_MS + 100);
    expect(room.sim.tick).toBeGreaterThan(tick);
    expect(rooms.size).toBe(1);
    expect(() => room.attach('a', new Link())).toThrow('already taken');
  });

  it('closes the match when the player does not come back in time', async () => {
    setup();
    const room = await rooms.open(ME, { scenario: 'skirmish', autosaveOnLeave: false });
    const link = new Link();
    room.attach('a', link);
    await room.detach('a', link);
    expect(saves.create).not.toHaveBeenCalled();
    expect(rooms.size).toBe(1);
    await wait(GRACE_MS + 100);
    expect(rooms.size).toBe(0);
    expect(rooms.awaiting(ME)).toBeNull();
  });

  it('queues orders for the next step and logs them, so the match can be replayed', async () => {
    setup();
    const room = await rooms.open(ME, { scenario: 'skirmish', difficulty: 'hard', autosaveOnLeave: false });
    const link = new Link();
    room.attach('a', link);
    const rifle = [...room.sim.units.values()].find((u) => u.team === 'a' && u.type === 'rifleman')!;
    room.command('a', { c: 'move', orders: [{ id: rifle.id, gx: 20, gy: 20 }] });
    expect(rifle.path).toEqual([]); // not before the next step
    room.debug('a', { d: 'credits', amount: 999 });
    await wait(1500); // the computer gives its first orders too
    const record = room.record();
    expect(record.log[0]).toMatchObject({ team: 'a', debug: { d: 'credits' } });
    expect(record.log.some((e) => e.team === 'a' && 'cmd' in e && e.cmd.c === 'move')).toBe(true);
    expect(record.log.some((e) => e.team === 'b')).toBe(true);
    expect(JSON.stringify(replay(record).snapshot())).toBe(JSON.stringify(room.sim.snapshot()));
  });

  it("saves the computer's seed and memory with the rules hash, and a loaded match carries on with them", async () => {
    setup();
    const room = await rooms.open(ME, { scenario: 'skirmish', autosaveOnLeave: false });
    room.attach('a', new Link());
    await wait(600);
    const { id } = await room.save('manual', 'Mine', null);
    const state = saves.stored.get(id)!.state as unknown as SimSnapshot;
    expect(state).toMatchObject({ version: SNAPSHOT_VERSION, rulesHash: RULES_HASH, computers: { b: { seed: expect.any(Number), state: expect.any(Object) } } });

    // a room that hasn't started its clock (nobody attached) saves the computer exactly as it loaded it
    const loaded = await rooms.open(ME, { saveId: id, autosaveOnLeave: false });
    const again = saves.stored.get((await loaded.save('manual', 'Again', null)).id)!.state as unknown as SimSnapshot;
    expect(again.computers).toEqual(JSON.parse(JSON.stringify(state.computers)));
  });

  it('loads a save made under other rules with a warning, and an older save with a fresh computer', async () => {
    setup();
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const room = await rooms.open(ME, { scenario: 'skirmish', autosaveOnLeave: false });
    const { id } = await room.save('manual', 'Mine', null);
    const state = saves.stored.get(id)!.state as unknown as SimSnapshot;
    state.rulesHash = 'something-else';
    delete state.computers;
    const loaded = await rooms.open(ME, { saveId: id, autosaveOnLeave: false });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/other rules/));
    const again = saves.stored.get((await loaded.save('manual', 'Again', null)).id)!.state as unknown as SimSnapshot;
    expect(again.computers?.b?.seed).toEqual(expect.any(Number));
    warn.mockRestore();
  });
});
