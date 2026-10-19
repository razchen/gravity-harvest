import { BadRequestException, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { isPlayerId, PLAYER_ID_HEADER } from '@gravity-harvest/shared';

/**
 * The anonymous player id from the PLAYER_ID_HEADER header. There are no accounts; each browser makes one id and
 * sends it, and saves are scoped to it. A missing or malformed id is a 400, never "everyone's saves".
 */
export const PlayerId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const value = ctx.switchToHttp().getRequest<Request>().headers[PLAYER_ID_HEADER];
  if (!isPlayerId(value)) {
    throw new BadRequestException(`Missing or invalid ${PLAYER_ID_HEADER} header: expected the player's id (a lowercase UUID)`);
  }
  return value;
});
