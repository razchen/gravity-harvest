import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Saves get an owner: the anonymous player id of whoever made them, which every query is scoped to.
 *
 * Saves from before this have no owner (NULL) and stay hidden: there is no way to tell whose they were, and showing
 * them to everyone is what this change stops. They are kept rather than deleted so nothing is lost for good.
 * The indexes now lead with the owner, since every list is per player.
 */
export class SaveOwner1792281660000 implements MigrationInterface {
  name = 'SaveOwner1792281660000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "save_games" ADD COLUMN "owner" varchar(36)`);
    await q.query(`DROP INDEX IF EXISTS "idx_save_games_updated_at"`);
    await q.query(`DROP INDEX IF EXISTS "idx_save_games_scenario_updated_at"`);
    await q.query(`CREATE INDEX "idx_save_games_owner_updated_at" ON "save_games" ("owner", "updated_at")`);
    await q.query(
      `CREATE INDEX "idx_save_games_owner_scenario_updated_at" ON "save_games" ("owner", "scenario", "updated_at")`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "idx_save_games_owner_scenario_updated_at"`);
    await q.query(`DROP INDEX "idx_save_games_owner_updated_at"`);
    await q.query(`CREATE INDEX "idx_save_games_updated_at" ON "save_games" ("updated_at")`);
    await q.query(`CREATE INDEX "idx_save_games_scenario_updated_at" ON "save_games" ("scenario", "updated_at")`);
    await q.query(`ALTER TABLE "save_games" DROP COLUMN "owner"`);
  }
}
