import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SaveGameEntity } from './entities/save-game.entity.js';
import { SavesController } from './saves.controller.js';
import { SavesService } from './saves.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([SaveGameEntity])],
  controllers: [SavesController],
  providers: [SavesService],
  exports: [SavesService],
})
export class SavesModule {}
