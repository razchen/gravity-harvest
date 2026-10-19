import { RULES_HASH } from '@gravity-harvest/rules';
import { TEAMS, perTeam, type MatchEvent, type TeamId } from '@gravity-harvest/shared';
import { CommandQueue, TICK_MS, TeamFeed, replay, startMatch, type Fighter, type MatchStart, type SimSnapshot } from '@gravity-harvest/sim';
import { describe, expect, it } from 'vitest';
import { AI_VIEW_EVERY_TICKS, ComputerPlayer } from './computer.js';

const minutes = (m: number) => Math.round((m * 60_000) / TICK_MS);

/**
 * A save is a continuation of the match: a busy computer-only match is saved at several points, each save goes
 * through JSON (as the server stores it) and is restored into a fresh Sim, which then plays on with the same orders
 * (the command log from that tick on). Each must end exactly as the match that went on without stopping: the same
 * snapshot, the same view from both seats, the same events on the way.
 */
describe('a saved match carries on exactly', () => {
  it('restored at several points of a busy match, it ends as the match that was never stopped', () => {
    const start: MatchStart = { scenario: 'skirmish', seed: 21, faction: 'ordan', options: { otherFaction: 'sable', computerOnly: true } };
    const sim = startMatch(start);
    const queue = new CommandQueue();
    const feeds = perTeam((t) => new TeamFeed(t));
    const ais = TEAMS.map((t, i) => new ComputerPlayer({ hello: sim.hello(t), difficulty: 'hard', seed: 500 + i }));
    // saved mid-think and between thinks; with passengers aboard (2:00) and while they get out (5:00 and a bit)
    const saveAt = [minutes(2), minutes(5) + 7, minutes(7.5), minutes(9) + 351, minutes(10.5)];
    const endTick = minutes(12);
    const saves = new Map<number, string>();
    const events = new Map<number, Record<TeamId, MatchEvent[]>>();

    // a transport for seat a, outside its base, and soldiers to ride in it (the computer doesn't use transports yet)
    const spot = sim.map.nearestFree(20, 18)!;
    const spawn = (unit: string, gx: number, gy: number) => queue.debug(sim, 'a', { d: 'spawn', unit, team: 'a', gx, gy });
    spawn('carrier', spot.tx + 0.5, spot.ty + 0.5);
    for (let i = 0; i < 5; i++) spawn('rifleman', spot.tx + 3.5 + (i % 3) * 0.8, spot.ty + 0.5 + Math.floor(i / 3) * 0.8);
    const carrier = [...sim.units.values()].find((u) => u.type === 'carrier')! as Fighter;
    const riders = [...sim.units.values()].filter((u) => u.type === 'rifleman' && u.id > carrier.id).map((u) => u.id);
    const script: Record<number, () => void> = {
      [minutes(1.5)]: () => queue.push(sim, 'a', { c: 'board', units: riders, transport: carrier.id }),
      [minutes(3)]: () => queue.push(sim, 'a', { c: 'move', orders: [{ id: carrier.id, gx: 30, gy: 24 }] }),
      [minutes(5)]: () => queue.push(sim, 'a', { c: 'unload', transport: carrier.id }),
    };

    // the way the server runs a match: orders queued for the next step, events handed out after every step
    while (sim.tick < endTick && !sim.winner) {
      queue.step(sim);
      const e = perTeam((t) => sim.takeEvents(t));
      for (const t of TEAMS) feeds[t].push(e[t]);
      events.set(sim.tick, e);
      if (saveAt.includes(sim.tick)) saves.set(sim.tick, JSON.stringify(sim.snapshot()));
      script[sim.tick]?.();
      if (sim.tick % AI_VIEW_EVERY_TICKS) continue;
      for (const ai of ais) for (const c of ai.update(feeds[ai.team].view(sim))) queue.push(sim, ai.team, c);
    }

    // it was a busy match: fights, harvesting, building and production, a transport
    expect(sim.winner).toBeNull();
    for (const t of TEAMS) {
      const s = sim.players[t].stats;
      expect(s.unitsKilled + s.buildingsDestroyed).toBeGreaterThan(0);
      expect(s.creditsEarned).toBeGreaterThan(5000);
      expect([...events.values()].flatMap((e) => e[t]).filter((e) => e.e === 'unitReady').length).toBeGreaterThan(5);
      expect(s.buildingsBuilt).toBeGreaterThan(3);
    }
    const aboard = JSON.parse(saves.get(minutes(2))!) as SimSnapshot;
    expect(aboard.units.find((u) => u.id === carrier.id)).toMatchObject({ passengers: expect.arrayContaining([expect.objectContaining({ type: 'rifleman' })]) });

    expect(saves.size).toBe(saveAt.length);
    let fighting = 0;
    for (const [at, json] of saves) {
      const saved = JSON.parse(json) as SimSnapshot;
      // what the save had in flight: units on the move and fighting, harvesters at work, production under way
      expect(saved.units.some((u) => u.kind === 'fighter' && u.path.length > 0)).toBe(true);
      expect(saved.units.some((u) => u.kind === 'harvester' && u.state !== 'idle')).toBe(true);
      if (saved.units.some((u) => u.kind === 'fighter' && u.target !== null)) fighting++;
      expect(TEAMS.some((t) => saved.players[t].queue.some((q) => q.progress > 0))).toBe(true);

      const again = replay({ rulesHash: RULES_HASH, start: { snapshot: saved }, log: queue.log.filter((e) => e.tick >= at), endTick: sim.tick });
      expect(again.tick).toBe(sim.tick);
      // every event since the save, in order (the restored match hands them out only at the end)
      const since = perTeam((t) => [...events].filter(([tick]) => tick > at).flatMap(([, e]) => e[t]));
      for (const t of TEAMS) expect(again.takeEvents(t)).toEqual(since[t]);
      expect(JSON.stringify(again.snapshot())).toBe(JSON.stringify(sim.snapshot()));
      for (const t of TEAMS) expect(again.view(t)).toEqual(sim.view(t));
    }
    expect(fighting).toBeGreaterThan(0);
  }, 120_000);
});
