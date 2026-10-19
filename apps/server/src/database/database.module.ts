import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_CONFIG, AppConfig } from '../config/index.js';
import { MIGRATIONS } from './migrations/index.js';

/**
 * TypeORM + SQLite (better-sqlite3 driver).
 *
 * Entities are registered per feature module via `TypeOrmModule.forFeature`
 * and picked up through `autoLoadEntities`. The schema is versioned by the
 * migrations in `migrations/`, which run on every start (`migrationsRun`), so a
 * production database is only ever changed by them. Outside production
 * `synchronize` also runs, after the migrations; it finds nothing to do as long
 * as the entities and migrations agree (migrations.spec.ts checks that).
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        if (config.databasePath !== ':memory:') {
          mkdirSync(dirname(config.databasePath), { recursive: true });
        }
        return {
          type: 'better-sqlite3' as const,
          database: config.databasePath,
          autoLoadEntities: true,
          migrations: MIGRATIONS,
          migrationsRun: true,
          synchronize: config.dbSynchronize,
          logging: config.dbLogging,
          // WAL gives better concurrency for a file DB; meaningless for :memory:.
          enableWAL: config.databasePath !== ':memory:',
        };
      },
    }),
  ],
})
export class DatabaseModule {}
