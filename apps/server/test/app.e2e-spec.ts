import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { APP_CONFIG, AppConfig, loadConfig } from '../src/config/index.js';
import { SavesService } from '../src/saves/saves.service.js';
import type { SaveGameInput } from '@gravity-harvest/shared';

const MISSING_ID = '00000000-0000-4000-8000-000000000000';
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
    const config: AppConfig = { ...loadConfig({}), databasePath: ':memory:' };
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

  /** Seed a save the way the match does (through the service). */
  const create = async (overrides: Record<string, unknown> = {}) =>
    app.get(SavesService).create({ ...validBody(), ...overrides } as SaveGameInput);

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
        .expect(204);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    });

    it('does not allow other origins', async () => {
      const res = await request(http).get('/api/health').set('Origin', 'http://evil.test');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('GET /api/saves/:id', () => {
    it('returns the summary, never the stored state', async () => {
      const created = await create();
      const res = await request(http).get(`/api/saves/${created.id}`).expect(200);
      expect(res.body).toEqual(created);
      expect(res.body).not.toHaveProperty('state');
    });

    it('404s for an unknown id', async () => {
      const res = await request(http).get(`/api/saves/${MISSING_ID}`).expect(404);
      expect(res.body).toMatchObject({ statusCode: 404, error: 'Not Found' });
    });

    it('400s for a non-UUID id', async () => {
      const res = await request(http).get('/api/saves/not-a-uuid').expect(400);
      expect(res.body).toMatchObject({ statusCode: 400, error: 'Bad Request' });
    });
  });

  describe('save kinds', () => {
    it('stores the kind (manual by default) and filters the list by it', async () => {
      const scenario = `kind-${Date.now()}`;
      const manual = await create({ scenario });
      const auto = await create({ scenario, kind: 'auto', name: 'Autosave' });
      const got = await request(http).get(`/api/saves/${auto.id}`).expect(200);
      expect(got.body.kind).toBe('auto');
      const autos = await request(http).get('/api/saves').query({ scenario, kind: 'auto' }).expect(200);
      expect(autos.body.map((s: { id: string }) => s.id)).toEqual([auto.id]);
      const manuals = await request(http).get('/api/saves').query({ scenario, kind: 'manual' }).expect(200);
      expect(manuals.body.map((s: { id: string }) => s.id)).toEqual([manual.id]);
    });

    it('rejects an unknown kind', async () => {
      await request(http).get('/api/saves').query({ kind: 'other' }).expect(400);
    });
  });

  describe('GET /api/saves', () => {
    it('lists summaries newest first, filters by scenario, honors limit', async () => {
      const scenario = `list-${Date.now()}`;
      const first = await create({ scenario, name: 'first' });
      await new Promise((r) => setTimeout(r, 5));
      const second = await create({ scenario, name: 'second' });
      await create({ scenario: `${scenario}-other` });

      const res = await request(http).get('/api/saves').query({ scenario }).expect(200);
      expect(res.body.map((s: { id: string }) => s.id)).toEqual([second.id, first.id]);
      for (const item of res.body) {
        expect(item).not.toHaveProperty('state');
        expect(Object.keys(item).sort()).toEqual(
          ['createdAt', 'gameTimeMs', 'id', 'kind', 'name', 'scenario', 'thumbnail', 'updatedAt', 'version'],
        );
      }

      const limited = await request(http).get('/api/saves').query({ scenario, limit: 1 }).expect(200);
      expect(limited.body.map((s: { id: string }) => s.id)).toEqual([second.id]);

      const all = await request(http).get('/api/saves').expect(200);
      const times = all.body.map((s: { updatedAt: string }) => Date.parse(s.updatedAt));
      expect([...times].sort((a, b) => b - a)).toEqual(times);
    });

    it.each([['0'], ['101'], ['abc'], ['1.5']])('rejects limit=%s with 400', async (limit) => {
      await request(http).get('/api/saves').query({ limit }).expect(400);
    });

    it('rejects unknown query params with 400', async () => {
      await request(http).get('/api/saves').query({ sort: 'asc' }).expect(400);
    });
  });

  describe('writing saves over HTTP', () => {
    it('is not possible: saves come only from the server\'s match', async () => {
      await request(http).post('/api/saves').send(validBody()).expect(404);
      const created = await create();
      await request(http).put(`/api/saves/${created.id}`).send(validBody()).expect(404);
    });
  });

  describe('DELETE /api/saves/:id', () => {
    it('deletes (204) and then 404s', async () => {
      const created = await create();
      const res = await request(http).delete(`/api/saves/${created.id}`).expect(204);
      expect(res.text).toBe('');
      await request(http).get(`/api/saves/${created.id}`).expect(404);
      await request(http).delete(`/api/saves/${created.id}`).expect(404);
    });

    it('400s for a non-UUID id', async () => {
      await request(http).delete('/api/saves/xyz').expect(400);
    });
  });
});
