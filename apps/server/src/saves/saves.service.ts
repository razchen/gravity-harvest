import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { validateSaveInput, type SaveGameInput } from '@gravity-harvest/shared';
import { DEFAULT_LIST_LIMIT, ListSavesQueryDto, SaveGameSummary } from './dto/index.js';
import { SaveGameEntity } from './entities/save-game.entity.js';

@Injectable()
export class SavesService {
  constructor(
    @InjectRepository(SaveGameEntity)
    private readonly repo: Repository<SaveGameEntity>,
  ) {}

  async list(query: ListSavesQueryDto = {}): Promise<SaveGameSummary[]> {
    const rows = await this.repo.find({
      select: {
        id: true,
        name: true,
        scenario: true,
        kind: true,
        version: true,
        gameTimeMs: true,
        thumbnail: true,
        createdAt: true,
        updatedAt: true,
      },
      where: {
        ...(query.scenario !== undefined && { scenario: query.scenario }),
        ...(query.kind !== undefined && { kind: query.kind }),
      },
      order: { updatedAt: 'DESC', createdAt: 'DESC', id: 'ASC' },
      take: query.limit ?? DEFAULT_LIST_LIMIT,
    });
    return rows.map((row) => toSummary(row));
  }

  async findOne(id: string): Promise<SaveGameSummary> {
    return toSummary(await this.getEntity(id));
  }

  /** The stored match state. Server-side only: it is never sent to players. */
  async getState(id: string): Promise<{ summary: SaveGameSummary; state: unknown }> {
    const entity = await this.getEntity(id);
    return { summary: toSummary(entity), state: JSON.parse(entity.stateJson) as unknown };
  }

  /** Saves are written by the server's match (players can't upload state). */
  async create(input: SaveGameInput): Promise<SaveGameSummary> {
    check(input);
    const now = new Date();
    const entity = this.repo.create({ ...fromInput(input), createdAt: now, updatedAt: now });
    return toSummary(await this.repo.save(entity));
  }

  /** Overwrite a save. With `keepThumbnail`, a missing thumbnail keeps the old one (autosave on disconnect). */
  async replace(id: string, input: SaveGameInput, keepThumbnail = false): Promise<SaveGameSummary> {
    check(input);
    const entity = await this.getEntity(id);
    const next = fromInput(input);
    if (keepThumbnail && !next.thumbnail) next.thumbnail = entity.thumbnail ?? null;
    this.repo.merge(entity, { ...next, updatedAt: new Date() });
    return toSummary(await this.repo.save(entity));
  }

  async remove(id: string): Promise<void> {
    const result = await this.repo.delete({ id });
    if (!result.affected) throw notFound(id);
  }

  private async getEntity(id: string): Promise<SaveGameEntity> {
    const entity = await this.repo.findOneBy({ id });
    if (!entity) throw notFound(id);
    return entity;
  }
}

function notFound(id: string): NotFoundException {
  return new NotFoundException(`Save game "${id}" not found`);
}

function check(input: SaveGameInput): void {
  const errors = validateSaveInput(input);
  if (errors.length) throw new BadRequestException(errors);
}

function fromInput(dto: SaveGameInput): Omit<SaveGameEntity, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: dto.name,
    scenario: dto.scenario,
    kind: dto.kind ?? 'manual',
    version: dto.version,
    gameTimeMs: dto.gameTimeMs,
    thumbnail: dto.thumbnail ?? null,
    stateJson: JSON.stringify(dto.state),
  };
}

function toSummary(entity: SaveGameEntity): SaveGameSummary {
  return {
    id: entity.id,
    name: entity.name,
    scenario: entity.scenario,
    kind: entity.kind ?? 'manual',
    version: entity.version,
    gameTimeMs: entity.gameTimeMs,
    thumbnail: entity.thumbnail ?? null,
    createdAt: toIso(entity.createdAt),
    updatedAt: toIso(entity.updatedAt),
  };
}


function toIso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}
