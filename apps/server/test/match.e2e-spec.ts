import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { MATCH_PATH, PLAYER_ID_HEADER, PLAYER_ID_PARAM, type ClientMessage, type ServerMessage, type TeamView } from '@gravity-harvest/shared';
import { SNAPSHOT_VERSION } from '@gravity-harvest/sim';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { APP_CONFIG, AppConfig, loadConfig } from '../src/config/index.js';

/** A test client: collects every message, waits for the ones it needs. */
class Client {
  readonly messages: ServerMessage[] = [];
  private waiters: (() => void)[] = [];

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (d) => {
      this.messages.push(JSON.parse(String(d)) as ServerMessage);
      for (const w of this.waiters) w();
    });
  }

  static async open(url: string, origin?: string): Promise<Client> {
    const ws = new WebSocket(url, origin ? { origin } : {});
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    return new Client(ws);
  }

  send(m: ClientMessage | Record<string, unknown>): void {
    this.ws.send(JSON.stringify(m));
  }

  /** Messages before this index have been read. */
  private cursor = 0;

  /** Resolve with the next unread message matching `pred` (messages are read in order). */
  async next<T extends ServerMessage>(pred: (m: ServerMessage) => m is T, timeout = 5000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for a message')), timeout);
      const check = () => {
        const i = this.messages.findIndex((m, idx) => idx >= this.cursor && pred(m));
        if (i < 0) return;
        clearTimeout(timer);
        this.waiters = this.waiters.filter((w) => w !== check);
        this.cursor = i + 1;
        resolve(this.messages[i] as T);
      };
      this.waiters.push(check);
      check();
    });
  }

  view(): Promise<TeamView & { t: 'view' }> {
    return this.next((m): m is TeamView & { t: 'view' } => m.t === 'view');
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }
}

/** Two players' anonymous ids. */
const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const is = <K extends ServerMessage['t']>(t: K) => (m: ServerMessage): m is Extract<ServerMessage, { t: K }> => m.t === t;

describe('Match socket (e2e)', () => {
  let app: NestExpressApplication;
  /** The socket URL without a player id; `as(id)` adds one. */
  let base: string;
  let url: string;
  const as = (player: string) => `${base}?${PLAYER_ID_PARAM}=${player}`;
  /** The saves API as player ME. */
  const saves = () => request.agent(app.getHttpServer()).set(PLAYER_ID_HEADER, ME);

  beforeAll(async () => {
    const config: AppConfig = { ...loadConfig({}), databasePath: ':memory:', debugCommands: true, dbSynchronize: false };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(APP_CONFIG).useValue(config).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app, config);
    await app.listen(0);
    const port = (app.getHttpServer().address() as AddressInfo).port;
    base = `ws://127.0.0.1:${port}${MATCH_PATH}`;
    url = as(ME);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists scenarios without their layouts', async () => {
    const res = await request(app.getHttpServer()).get('/api/scenarios').expect(200);
    expect(res.body).toEqual([expect.objectContaining({ id: 'skirmish', name: 'Skirmish', startingCredits: 15000 })]);
    expect(res.body[0]).not.toHaveProperty('buildings');
    expect(res.body[0]).not.toHaveProperty('units');
  });

  it('starts a match and streams views with only what the player may see', async () => {
    const c = await Client.open(url);
    c.send({ t: 'start', scenario: 'skirmish', autosaveOnLeave: false });
    const hello = await c.next(is('hello'));
    expect(hello).toMatchObject({ scenario: 'skirmish', you: 'a', factions: { a: 'ordan', b: 'sable' }, map: { width: 88, height: 48 }, debug: true });
    expect(hello.ore.rocks.length).toBeGreaterThan(50);
    const first = await c.view();
    expect(first.credits).toBe(15000);
    expect(first.fog).toHaveLength(88 * 48);
    expect(first.units.filter((u) => u.team === 'b')).toEqual([]);
    const later = await c.view();
    expect(later.tick).toBeGreaterThan(first.tick);
    await c.close();
  });

  it('the human can play the second seat: their own view and orders, and the computer plays the first', async () => {
    const c = await Client.open(url);
    c.send({ t: 'start', scenario: 'skirmish', seat: 'b', faction: 'ordan', autosaveOnLeave: false });
    const hello = await c.next(is('hello'));
    expect(hello).toMatchObject({ you: 'b', factions: { a: 'sable', b: 'ordan' }, camera: { gx: 77, gy: 9 } });
    expect(hello.catalog.buildings.sentry).toBeDefined(); // their own faction's catalog
    const first = await c.view();
    expect(first.units.length).toBeGreaterThan(0);
    expect(first.units.every((u) => u.team === 'b')).toBe(true);
    expect(first.buildings.every((b) => b.team === 'b')).toBe(true);

    // an order for one of their units is carried out
    const rifleman = first.units.find((u) => u.type === 'rifleman')!;
    c.send({ t: 'cmd', cmd: { c: 'move', orders: [{ id: rifleman.id, gx: rifleman.gx - 3, gy: rifleman.gy + 4 }] } });
    await expect.poll(async () => (await c.view()).units.find((u) => u.id === rifleman.id)!.gy, { timeout: 5000 }).toBeGreaterThan(rifleman.gy + 2);

    // the computer builds up the other base (seen with the fog lifted)
    c.send({ t: 'debug', cmd: { d: 'reveal', on: true } });
    await expect.poll(async () => (await c.view()).buildings.filter((b) => b.team === 'a').length, { timeout: 20_000, interval: 250 }).toBeGreaterThan(3);

    // and the match is won from this seat
    c.send({ t: 'debug', cmd: { d: 'destroyTeam', team: 'a', units: true, buildings: true } });
    expect(await c.next(is('gameOver'))).toMatchObject({ result: 'victory', stats: { buildingsDestroyed: expect.any(Number) } });
    await c.close();
  }, 30_000);

  it('accepts orders and rejects malformed or unknown messages', async () => {
    const c = await Client.open(url);
    c.send({ t: 'start', scenario: 'skirmish', autosaveOnLeave: false });
    await c.next(is('hello'));
    c.send({ t: 'cmd', cmd: { c: 'place', building: 'barracks', tx: 1, ty: 10 } });
    await expect.poll(async () => (await c.view()).credits).toBe(15000 - 450);

    c.send({ t: 'cmd', cmd: { c: 'place', building: 'gravity_lab', tx: 1, ty: 14 } }); // not in the roster: ignored
    c.send({ t: 'cmd', cmd: { c: 'nuke' } });
    expect((await c.next(is('error'))).message).toBe('Malformed message');
    c.ws.send('{not json');
    await c.next(is('error'));
    expect((await c.view()).credits).toBe(15000 - 450);
    await c.close();
  });

  it('pauses: the clock stops', async () => {
    const c = await Client.open(url);
    c.send({ t: 'start', scenario: 'skirmish', autosaveOnLeave: false });
    await c.next(is('hello'));
    c.send({ t: 'pause' });
    const paused = await c.next((m): m is TeamView & { t: 'view' } => m.t === 'view' && m.paused);
    await new Promise((r) => setTimeout(r, 300));
    const n = c.messages.length;
    await new Promise((r) => setTimeout(r, 300));
    expect(c.messages.length).toBe(n); // nothing sent while paused
    void paused;
    c.send({ t: 'resume' });
    expect((await c.view()).timeMs).toBeGreaterThan(paused.timeMs);
    await c.close();
  });

  it('saves on the server and resumes from the save', async () => {
    const c = await Client.open(url);
    c.send({ t: 'start', scenario: 'skirmish', autosaveOnLeave: false });
    await c.next(is('hello'));
    c.send({ t: 'debug', cmd: { d: 'credits', amount: 4321 } });
    c.send({ t: 'save', req: 7, name: 'Socket save', kind: 'manual', thumbnail: null });
    const saved = await c.next(is('saved'));
    expect(saved.req).toBe(7);
    expect(saved.save).toMatchObject({ name: 'Socket save', kind: 'manual', scenario: 'skirmish', version: SNAPSHOT_VERSION });

    c.send({ t: 'start', saveId: saved.save.id, autosaveOnLeave: false });
    await c.next(is('hello'));
    expect((await c.view()).credits).toBe(4321);

    c.send({ t: 'save', req: 8, name: 'x', kind: 'manual', thumbnail: 'javascript:alert(1)' });
    expect((await c.next(is('error'))).req).toBe(8);
    await c.close();
  });

  it('autosaves when the connection closes mid-match (one slot per player and scenario)', async () => {
    for (const s of (await saves().get('/api/saves').query({ kind: 'auto' })).body as { id: string }[]) {
      await saves().delete(`/api/saves/${s.id}`).expect(204);
    }
    for (let i = 0; i < 2; i++) {
      const c = await Client.open(url);
      c.send({ t: 'start', scenario: 'skirmish', autosaveOnLeave: true });
      await c.view();
      await c.close();
    }
    await expect.poll(async () => (await saves().get('/api/saves').query({ kind: 'auto' })).body).toEqual([
      expect.objectContaining({ name: 'Autosave', kind: 'auto' }),
    ]);
  });

  it('leaving on purpose ("end") does not autosave', async () => {
    for (const s of (await saves().get('/api/saves').query({ kind: 'auto' })).body as { id: string }[]) {
      await saves().delete(`/api/saves/${s.id}`).expect(204);
    }
    const c = await Client.open(url);
    c.send({ t: 'start', scenario: 'skirmish', autosaveOnLeave: true });
    await c.view();
    c.send({ t: 'end' });
    await c.close();
    await new Promise((r) => setTimeout(r, 200));
    expect((await saves().get('/api/saves').query({ kind: 'auto' })).body).toEqual([]);
  });

  it('ends the match: victory, and the autosave of a finished match is cleared', async () => {
    const c = await Client.open(url);
    c.send({ t: 'start', scenario: 'skirmish', autosaveOnLeave: false });
    await c.next(is('hello'));
    c.send({ t: 'save', req: 1, name: '', kind: 'auto', thumbnail: null });
    await c.next(is('saved'));
    c.send({ t: 'debug', cmd: { d: 'destroyTeam', team: 'b', units: true, buildings: true } });
    const over = await c.next(is('gameOver'));
    expect(over).toMatchObject({ result: 'victory', stats: { buildingsDestroyed: 3 } });
    await expect.poll(async () => (await saves().get('/api/saves').query({ kind: 'auto' })).body).toEqual([]);
    await c.close();
  });

  it('refuses sockets from origins outside CORS', async () => {
    await expect(Client.open(url, 'http://evil.test')).rejects.toThrow();
  });

  it('refuses sockets without a valid player id', async () => {
    await expect(Client.open(base)).rejects.toThrow(/400/);
    await expect(Client.open(as('not-a-uuid'))).rejects.toThrow(/400/);
  });

  it("keeps players' saves apart: no resuming another player's save, separate autosave slots", async () => {
    const mine = await Client.open(url);
    mine.send({ t: 'start', scenario: 'skirmish', autosaveOnLeave: false });
    await mine.next(is('hello'));
    mine.send({ t: 'save', req: 1, name: 'Mine', kind: 'manual', thumbnail: null });
    const saved = (await mine.next(is('saved'))).save;
    mine.send({ t: 'save', req: 2, name: '', kind: 'auto', thumbnail: null });
    const myAuto = (await mine.next(is('saved'))).save;

    const other = await Client.open(as(OTHER));
    other.send({ t: 'start', saveId: saved.id, autosaveOnLeave: false });
    expect((await other.next(is('error'))).message).toMatch(/not found/);
    other.send({ t: 'start', scenario: 'skirmish', autosaveOnLeave: false });
    await other.next(is('hello'));
    other.send({ t: 'save', req: 1, name: 'Over yours', kind: 'manual', overwriteId: saved.id, thumbnail: null });
    expect((await other.next(is('error'))).req).toBe(1);
    other.send({ t: 'save', req: 2, name: '', kind: 'auto', thumbnail: null });
    const theirAuto = (await other.next(is('saved'))).save;
    expect(theirAuto.id).not.toBe(myAuto.id);

    const autos = (await saves().get('/api/saves').query({ kind: 'auto' })).body as { id: string }[];
    expect(autos.map((a) => a.id)).toEqual([myAuto.id]);
    await mine.close();
    await other.close();
  });
});

describe('Match socket with debug commands off', () => {
  it('rejects debug commands', async () => {
    const config: AppConfig = { ...loadConfig({}), databasePath: ':memory:', debugCommands: false };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(APP_CONFIG).useValue(config).compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app, config);
    await app.listen(0);
    const port = (app.getHttpServer().address() as AddressInfo).port;
    const c = await Client.open(`ws://127.0.0.1:${port}${MATCH_PATH}?${PLAYER_ID_PARAM}=${ME}`);
    c.send({ t: 'start', scenario: 'skirmish', autosaveOnLeave: false });
    expect((await c.next(is('hello'))).debug).toBe(false);
    c.send({ t: 'debug', cmd: { d: 'credits', amount: 1e9 } });
    expect((await c.next(is('error'))).message).toBe('Debug commands are disabled');
    await c.close();
    await app.close();
  });
});
