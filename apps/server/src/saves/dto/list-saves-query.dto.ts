import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

import { SAVE_KINDS, SAVE_LIMITS, type ListSavesQuery, type SaveKind } from '@gravity-harvest/shared';

export const DEFAULT_LIST_LIMIT = SAVE_LIMITS.listDefault;
export const MAX_LIST_LIMIT = SAVE_LIMITS.listMax;

export class ListSavesQueryDto implements ListSavesQuery {
  @IsOptional()
  @IsString()
  @Length(1, SAVE_LIMITS.scenarioMax)
  scenario?: string;

  @IsOptional()
  @IsIn(SAVE_KINDS)
  kind?: SaveKind;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIST_LIMIT)
  limit?: number;
}
