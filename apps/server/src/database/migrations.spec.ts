import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DataSource } from 'typeorm';
import { SaveGameEntity } from '../saves/entities/save-game.entity.js';
import { InitialSchema1792281600000 } from './migrations/1792281600000-initial-schema.js';
import { MIGRATIONS } from './migrations/index.js';

const open = async (database = ':memory:', migrations: DataSource['options']['migrations'] = MIGRATIONS) => {
  const ds = new DataSource({ type: 'better-sqlite3', database, entities: [SaveGameEntity], migrations });
  return ds.initialize();
};

describe('migrations', () => {
  let ds: DataSource | null = null;
  afterEach(async () => {
    if (ds?.isInitialized) await ds.destroy();
    ds = null;
  });

  it('build exactly the schema the entities describe (an entity change needs a migration)', async () => {
    ds = await open();
    await ds.runMigrations();
    const pending = await ds.driver.createSchemaBuilder().log();
    expect(pending.upQueries.map((q) => q.query)).toEqual([]);
  });

  it('run once: a second start has nothing to do', async () => {
    ds = await open();
    expect(await ds.runMigrations()).toHaveLength(MIGRATIONS.length);
    expect(await ds.runMigrations()).toEqual([]);
  });

  it('adopt a database made by the old synchronize, keeping its saves (hidden: no owner)', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'gh-migrations-')), 'old.sqlite');
    try {
      // a database from before migrations: the pre-owner table with a save in it, and no migrations table
      ds = await open(file, [InitialSchema1792281600000]);
      await ds.runMigrations();
      await ds.query(`DROP TABLE "migrations"`);
      await ds.query(
        `INSERT INTO "save_games" ("id", "name", "scenario", "version", "game_time_ms", "state_json", "created_at", "updated_at") ` +
          `VALUES ('00000000-0000-4000-8000-000000000001', 'Old', 'skirmish', 1, 0, '{}', '2026-01-01', '2026-01-01')`,
      );
      await ds.destroy();

      ds = await open(file);
      expect(await ds.runMigrations()).toHaveLength(MIGRATIONS.length);
      expect((await ds.getRepository(SaveGameEntity).findOneByOrFail({ name: 'Old' })).owner).toBeNull();
      expect((await ds.driver.createSchemaBuilder().log()).upQueries).toEqual([]);
    } finally {
      if (ds?.isInitialized) await ds.destroy();
      ds = null;
      rmSync(dirname(file), { recursive: true, force: true });
    }
  });
});
