import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { SaveGameInput } from '@gravity-harvest/shared';
import { SaveGameEntity } from './entities/save-game.entity.js';
import { SavesService } from './saves.service.js';

const input = (overrides: Partial<SaveGameInput> = {}): SaveGameInput => ({
  name: 'Slot 1',
  scenario: 'skirmish',
  version: 1,
  gameTimeMs: 1234,
  state: { tick: 42, units: [{ id: 'u1', x: 10, y: 20 }], meta: { seed: 'abc' } },
  ...overrides,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('SavesService', () => {
  let moduleRef: TestingModule;
  let service: SavesService;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [SaveGameEntity],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([SaveGameEntity]),
      ],
      providers: [SavesService],
    }).compile();
    service = moduleRef.get(SavesService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('creates a save and returns its summary with ISO timestamps (no state)', async () => {
    const created = await service.create(input());
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created).toMatchObject({
      name: 'Slot 1',
      scenario: 'skirmish',
      version: 1,
      gameTimeMs: 1234,
      thumbnail: null,
    });
    expect(created).not.toHaveProperty('state');
    expect(new Date(created.createdAt).toISOString()).toBe(created.createdAt);
    expect(created.updatedAt).toBe(created.createdAt);
  });

  it('findOne returns the summary, getState the stored state; NotFound for unknown id', async () => {
    const created = await service.create(input({ thumbnail: 'data:image/png;base64,AAAA' }));
    await expect(service.findOne(created.id)).resolves.toEqual(created);
    await expect(service.getState(created.id)).resolves.toEqual({ summary: created, state: input().state });
    await expect(service.findOne('00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lists summaries newest updatedAt first, without state, honoring scenario and limit', async () => {
    const a = await service.create(input({ name: 'A' }));
    await sleep(5);
    const b = await service.create(input({ name: 'B', scenario: 'campaign' }));
    await sleep(5);
    const c = await service.create(input({ name: 'C' }));

    const all = await service.list();
    expect(all.map((s) => s.name)).toEqual(['C', 'B', 'A']);
    expect(all[0]).not.toHaveProperty('state');

    await sleep(5);
    await service.replace(a.id, input({ name: 'A2' }));
    expect((await service.list()).map((s) => s.id)).toEqual([a.id, c.id, b.id]);

    expect((await service.list({ scenario: 'campaign' })).map((s) => s.id)).toEqual([b.id]);
    expect(await service.list({ limit: 2 })).toHaveLength(2);
    expect(await service.list({ scenario: 'nope' })).toEqual([]);
  });

  it('replace overwrites every field, keeps createdAt, bumps updatedAt', async () => {
    const created = await service.create(input({ thumbnail: 'data:image/png;base64,AAAA' }));
    await sleep(5);
    const updated = await service.replace(
      created.id,
      input({ name: 'Renamed', version: 2, gameTimeMs: 9999, state: { fresh: true } }),
    );
    expect(updated).toMatchObject({
      id: created.id,
      name: 'Renamed',
      version: 2,
      gameTimeMs: 9999,
      thumbnail: null,
      createdAt: created.createdAt,
    });
    expect((await service.getState(created.id)).state).toEqual({ fresh: true });
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
    await expect(service.findOne(created.id)).resolves.toEqual(updated);
  });

  it('replace can keep the old thumbnail when the new one is missing (autosave on disconnect)', async () => {
    const created = await service.create(input({ thumbnail: 'data:image/png;base64,AAAA' }));
    const kept = await service.replace(created.id, input({ thumbnail: null }), true);
    expect(kept.thumbnail).toBe('data:image/png;base64,AAAA');
  });

  it('rejects invalid input (name, thumbnail, state)', async () => {
    await expect(service.create(input({ name: ' ' }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(input({ thumbnail: 'javascript:alert(1)' }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(input({ state: [] as never }))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('replace and remove throw NotFound for unknown ids', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    await expect(service.replace(missing, input())).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(missing)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('remove deletes the save', async () => {
    const created = await service.create(input());
    await service.remove(created.id);
    await expect(service.findOne(created.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(await service.list()).toEqual([]);
  });
});
