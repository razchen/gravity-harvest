import type { SaveKind } from '@gravity-harvest/shared';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A persisted saved game.
 *
 * Column names are explicit snake_case so future migrations (and a possible
 * move to another SQL engine) don't depend on TypeORM naming defaults.
 * Timestamps are set by the service (millisecond precision) rather than by
 * SQLite's `datetime('now')`, which only has second precision.
 */
@Entity({ name: 'save_games' })
@Index('idx_save_games_updated_at', ['updatedAt'])
@Index('idx_save_games_scenario_updated_at', ['scenario', 'updatedAt'])
export class SaveGameEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

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
