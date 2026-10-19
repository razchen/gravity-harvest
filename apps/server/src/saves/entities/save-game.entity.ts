import type { SaveKind } from '@gravity-harvest/shared';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A persisted saved game.
 *
 * Column names are explicit snake_case so future migrations (and a possible
 * move to another SQL engine) don't depend on TypeORM naming defaults.
 * Timestamps are set by the service (millisecond precision) rather than by
 * SQLite's `datetime('now')`, which only has second precision.
 *
 * The schema is owned by the migrations in database/migrations: a change here needs a new migration
 * (database/migrations.spec.ts fails until the two match).
 */
@Entity({ name: 'save_games' })
@Index('idx_save_games_owner_updated_at', ['owner', 'updatedAt'])
@Index('idx_save_games_owner_scenario_updated_at', ['owner', 'scenario', 'updatedAt'])
export class SaveGameEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * The anonymous player id of whoever saved it (every query is scoped to it). Null only on saves made before saves
   * had owners: no player can see those.
   */
  @Column({ type: 'varchar', length: 36, nullable: true })
  owner: string | null;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 64 })
  scenario: string;

  /** 'manual' (player) or 'auto' (autosave slot). */
  @Column({ type: 'varchar', length: 16, default: 'manual' })
  kind: SaveKind;

  @Column({ type: 'integer' })
  version: number;

  @Column({ name: 'game_time_ms', type: 'integer' })
  gameTimeMs: number;

  @Column({ type: 'text', nullable: true })
  thumbnail: string | null;

  /** Full game state, serialized JSON text. */
  @Column({ name: 'state_json', type: 'text' })
  stateJson: string;

  @Column({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
