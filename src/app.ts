import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { config } from './config';

/** Shared by the local server (main.ts) and the Vercel function (serverless.ts). */
export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['log', 'warn', 'error'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({ origin: config.corsOrigins, methods: ['GET', 'POST', 'PATCH', 'DELETE'] });
  app.disable('x-powered-by');
  // Behind Vercel's proxy: use the visitor's real IP for rate limiting and the chat log.
  app.set('trust proxy', 1);
  return app;
}
