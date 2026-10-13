import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_CONFIG, AppConfig } from '../config/index.js';

/**
 * TypeORM + SQLite (better-sqlite3 driver).
 *
 * Entities are registered per feature module via `TypeOrmModule.forFeature`
 * and picked up through `autoLoadEntities`. `synchronize` is on by default for
 * development; set DB_SYNCHRONIZE=false and add `migrations` here when the
 * schema needs to be versioned.
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
