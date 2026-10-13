import { Module } from '@nestjs/common';
import { SavesModule } from '../saves/saves.module.js';
import { MatchGateway } from './match.gateway.js';
import { ScenariosController } from './scenarios.controller.js';

@Module({
  imports: [SavesModule],
  controllers: [ScenariosController],
  providers: [MatchGateway],
})
export class MatchModule {}
