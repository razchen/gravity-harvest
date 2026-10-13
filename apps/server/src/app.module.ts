import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/index.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { MatchModule } from './match/match.module.js';
import { SavesModule } from './saves/saves.module.js';

@Module({
  imports: [AppConfigModule, DatabaseModule, HealthModule, SavesModule, MatchModule],
})
export class AppModule {}
