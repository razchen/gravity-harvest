import { Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ListSavesQueryDto, SaveGameSummary } from './dto/index.js';
import { SavesService } from './saves.service.js';

/**
 * Saves are read and deleted over HTTP; they are written only by the server's match (see match/), so a
 * player can't upload a doctored state. The state itself is never returned.
 */
@Controller('saves')
export class SavesController {
  constructor(private readonly saves: SavesService) {}

  @Get()
  list(@Query() query: ListSavesQueryDto): Promise<SaveGameSummary[]> {
    return this.saves.list(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<SaveGameSummary> {
    return this.saves.findOne(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.saves.remove(id);
  }
}
