import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { APP_CONFIG, AppConfig, SERVER_ROOT } from './config/index.js';

async function bootstrap(): Promise<void> {
  // Load server/.env if present (real env vars take precedence).
  const envFile = resolve(SERVER_ROOT, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get<AppConfig>(APP_CONFIG);
  configureApp(app, config);

  await app.listen(config.port);
  Logger.log(
    `Gravity Harvest server listening on http://localhost:${config.port}/api (db: ${config.databasePath})`,
    'Bootstrap',
  );
}

void bootstrap();
