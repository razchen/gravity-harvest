import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The schema as it was before migrations existed (save games, no owner).
 *
 * `IF NOT EXISTS` because databases made by the old always-on `synchronize` already have exactly this table: they
 * adopt this migration instead of failing on it.
 */
export class InitialSchema1792281600000 implements MigrationInterface {
  name = 'InitialSchema1792281600000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE IF NOT EXISTS "save_games" ("id" varchar PRIMARY KEY NOT NULL, "name" varchar(80) NOT NULL, ` +
        `"scenario" varchar(64) NOT NULL, "kind" varchar(16) NOT NULL DEFAULT ('manual'), "version" integer NOT NULL, ` +
        `"game_time_ms" integer NOT NULL, "thumbnail" text, "state_json" text NOT NULL, "created_at" datetime NOT NULL, ` +
        `"updated_at" datetime NOT NULL)`,
    );
    await q.query(`CREATE INDEX IF NOT EXISTS "idx_save_games_updated_at" ON "save_games" ("updated_at")`);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "idx_save_games_scenario_updated_at" ON "save_games" ("scenario", "updated_at")`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "idx_save_games_scenario_updated_at"`);
    await q.query(`DROP INDEX IF EXISTS "idx_save_games_updated_at"`);
    await q.query(`DROP TABLE IF EXISTS "save_games"`);
  }
}
