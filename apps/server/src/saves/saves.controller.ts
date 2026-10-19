import { Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ListSavesQueryDto, SaveGameSummary } from './dto/index.js';
import { PlayerId } from './player-id.decorator.js';
import { SavesService } from './saves.service.js';

/**
 * Saves are read and deleted over HTTP; they are written only by the server's match (see match/), so a
 * player can't upload a doctored state. The state itself is never returned. Each request only sees the saves of
 * the player id it carries.
 */
@Controller('saves')
export class SavesController {
  constructor(private readonly saves: SavesService) {}

  @Get()
  list(@PlayerId() owner: string, @Query() query: ListSavesQueryDto): Promise<SaveGameSummary[]> {
    return this.saves.list(owner, query);
  }

  @Get(':id')
  findOne(@PlayerId() owner: string, @Param('id', ParseUUIDPipe) id: string): Promise<SaveGameSummary> {
    return this.saves.findOne(owner, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@PlayerId() owner: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.saves.remove(owner, id);
  }
}
