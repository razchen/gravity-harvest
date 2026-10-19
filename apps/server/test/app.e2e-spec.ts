import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { APP_CONFIG, AppConfig, loadConfig } from '../src/config/index.js';
import { SavesService } from '../src/saves/saves.service.js';
import { PLAYER_ID_HEADER, type SaveGameInput } from '@gravity-harvest/shared';
import { SaveGameEntity } from '../src/saves/entities/save-game.entity.js';
import { DataSource } from 'typeorm';

const MISSING_ID = '00000000-0000-4000-8000-000000000000';
/** Two players' anonymous ids. */
const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const validBody = () => ({
  name: 'Alpha base',
  scenario: 'skirmish',
  version: 1,
  gameTimeMs: 60_000,
  thumbnail: PNG,
  state: {
    tick: 3600,
    players: [{ id: 'p1', resources: { ore: 120, gas: 0 } }],
    units: [{ id: 'u1', type: 'harvester', pos: [1.5, -2.25], target: null }],
    flags: { fogOfWar: true },
  },
});

describe('Gravity Harvest API (e2e)', () => {
  let app: NestExpressApplication;
  let http: Server;

  beforeAll(async () => {
    // no synchronize: the schema comes from the migrations alone, as in production
    const config: AppConfig = { ...loadConfig({}), databasePath: ':memory:', dbSynchronize: false };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(config)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app, config);
    await app.init();
    http = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  /** Requests as player ME (the browser sends its id with every saves request). */
  const me = () => request.agent(http).set(PLAYER_ID_HEADER, ME);

  /** Seed a save the way the match does (through the service). */
  const create = async (overrides: Record<string, unknown> = {}, owner = ME) =>
    app.get(SavesService).create(owner, { ...validBody(), ...overrides } as SaveGameInput);

  describe('GET /api/health', () => {
    it('returns ok', async () => {
      const res = await request(http).get('/api/health').expect(200);
      expect(res.body.status).toBe('ok');
      expect(new Date(res.body.time).toISOString()).toBe(res.body.time);
    });

    it('is only served under /api', async () => {
      await request(http).get('/health').expect(404);
    });
  });

  describe('CORS', () => {
    it('allows the Vite dev origin', async () => {
      const res = await request(http)
        .options('/api/saves')
        .set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', 'DELETE')
        .set('Access-Control-Request-Headers', PLAYER_ID_HEADER)
        .expect(204);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(res.headers['access-control-allow-headers']).toContain(PLAYER_ID_HEADER);
    });

    it('does not allow other origins', async () => {
      const res = await request(http).get('/api/health').set('Origin', 'http://evil.test');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('GET /api/saves/:id', () => {
    it('returns the summary, never the stored state', async () => {
      const created = await create();
      const res = await me().get(`/api/saves/${created.id}`).expect(200);
      expect(res.body).toEqual(created);
      expect(res.body).not.toHaveProperty('state');
    });

    it('404s for an unknown id', async () => {
      const res = await me().get(`/api/saves/${MISSING_ID}`).expect(404);
      expect(res.body).toMatchObject({ statusCode: 404, error: 'Not Found' });
    });

    it('400s for a non-UUID id', async () => {
      const res = await me().get('/api/saves/not-a-uuid').expect(400);
      expect(res.body).toMatchObject({ statusCode: 400, error: 'Bad Request' });
    });
  });

  describe('save kinds', () => {
    it('stores the kind (manual by default) and filters the list by it', async () => {
      const scenario = `kind-${Date.now()}`;
      const manual = await create({ scenario });
      const auto = await create({ scenario, kind: 'auto', name: 'Autosave' });
      const got = await me().get(`/api/saves/${auto.id}`).expect(200);
      expect(got.body.kind).toBe('auto');
      const autos = await me().get('/api/saves').query({ scenario, kind: 'auto' }).expect(200);
      expect(autos.body.map((s: { id: string }) => s.id)).toEqual([auto.id]);
      const manuals = await me().get('/api/saves').query({ scenario, kind: 'manual' }).expect(200);
      expect(manuals.body.map((s: { id: string }) => s.id)).toEqual([manual.id]);
    });

    it('rejects an unknown kind', async () => {
      await me().get('/api/saves').query({ kind: 'other' }).expect(400);
    });
  });

  describe('GET /api/saves', () => {
    it('lists summaries newest first, filters by scenario, honors limit', async () => {
      const scenario = `list-${Date.now()}`;
      const first = await create({ scenario, name: 'first' });
      await new Promise((r) => setTimeout(r, 5));
      const second = await create({ scenario, name: 'second' });
      await create({ scenario: `${scenario}-other` });

      const res = await me().get('/api/saves').query({ scenario }).expect(200);
      expect(res.body.map((s: { id: string }) => s.id)).toEqual([second.id, first.id]);
      for (const item of res.body) {
        expect(item).not.toHaveProperty('state');
        expect(Object.keys(item).sort()).toEqual(
          ['createdAt', 'gameTimeMs', 'id', 'kind', 'name', 'scenario', 'thumbnail', 'updatedAt', 'version'],
        );
      }

      const limited = await me().get('/api/saves').query({ scenario, limit: 1 }).expect(200);
      expect(limited.body.map((s: { id: string }) => s.id)).toEqual([second.id]);

      const all = await me().get('/api/saves').expect(200);
      const times = all.body.map((s: { updatedAt: string }) => Date.parse(s.updatedAt));
      expect([...times].sort((a, b) => b - a)).toEqual(times);
    });

    it.each([['0'], ['101'], ['abc'], ['1.5']])('rejects limit=%s with 400', async (limit) => {
      await me().get('/api/saves').query({ limit }).expect(400);
    });

    it('rejects unknown query params with 400', async () => {
      await me().get('/api/saves').query({ sort: 'asc' }).expect(400);
    });
  });

  describe('writing saves over HTTP', () => {
    it('is not possible: saves come only from the server\'s match', async () => {
      await me().post('/api/saves').send(validBody()).expect(404);
      const created = await create();
      await me().put(`/api/saves/${created.id}`).send(validBody()).expect(404);
    });
  });

  describe('DELETE /api/saves/:id', () => {
    it('deletes (204) and then 404s', async () => {
      const created = await create();
      const res = await me().delete(`/api/saves/${created.id}`).expect(204);
      expect(res.text).toBe('');
      await me().get(`/api/saves/${created.id}`).expect(404);
      await me().delete(`/api/saves/${created.id}`).expect(404);
    });

    it('400s for a non-UUID id', async () => {
      await me().delete('/api/saves/xyz').expect(400);
    });
  });

  describe('save owners', () => {
    it('rejects saves requests without a valid player id (400)', async () => {
      const created = await create();
      for (const header of [undefined, 'not-a-uuid', ME.replaceAll('1', 'A')]) {
        const req = (r: request.Test) => (header === undefined ? r : r.set(PLAYER_ID_HEADER, header));
        const res = await req(request(http).get('/api/saves')).expect(400);
        expect(res.body.message).toMatch(PLAYER_ID_HEADER);
        await req(request(http).get(`/api/saves/${created.id}`)).expect(400);
        await req(request(http).delete(`/api/saves/${created.id}`)).expect(400);
      }
      await me().get(`/api/saves/${created.id}`).expect(200);
    });

    it("never shows, reads or deletes another player's saves", async () => {
      const theirs = await create({ name: 'Theirs' }, OTHER);
      const list = await me().get('/api/saves').expect(200);
      expect(list.body.map((s: { id: string }) => s.id)).not.toContain(theirs.id);
      await me().get(`/api/saves/${theirs.id}`).expect(404);
      await me().delete(`/api/saves/${theirs.id}`).expect(404);
      const asOther = await request(http).get(`/api/saves/${theirs.id}`).set(PLAYER_ID_HEADER, OTHER).expect(200);
      expect(asOther.body.name).toBe('Theirs');
    });

    it('hides saves from before owners existed (no owner)', async () => {
      const old = await create({ name: 'Ownerless' });
      await app.get(DataSource).getRepository(SaveGameEntity).update({ id: old.id }, { owner: null });
      const list = await me().get('/api/saves').expect(200);
      expect(list.body.map((s: { id: string }) => s.id)).not.toContain(old.id);
      await me().get(`/api/saves/${old.id}`).expect(404);
    });
  });
});
