import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppConfig } from './config/index.js';

import { API_PREFIX as SHARED_API_PREFIX } from '@gravity-harvest/shared';

/** Nest wants the prefix without the leading slash. */
export const API_PREFIX = SHARED_API_PREFIX.replace(/^\//, '');

/**
 * Applies app-wide HTTP configuration. Shared by `main.ts` and the e2e tests so
 * tests exercise exactly the same pipeline as production.
 */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  app.setGlobalPrefix(API_PREFIX);
  app.useBodyParser('json', { limit: config.bodyLimit });
  app.enableCors({
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();
}
