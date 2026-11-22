/**
 * main.ts — بوت NestJS: پیشوند /api/v1 (نسخه‌دار — سند ۰۵)، اعتبارسنجی، Swagger، رصد.
 */
import 'reflect-metadata';
import './bigint-json';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { startTelemetry } from './telemetry/instrumentation';
import { config as loadEnv } from 'dotenv';

async function bootstrap() {
  loadEnv();
  const logger = new Logger('Bootstrap');
  startTelemetry();

  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({ origin: true, credentials: true });
  app.enableShutdownHooks();

  const swaggerCfg = new DocumentBuilder()
    .setTitle('Hotel ERP Core API')
    .setDescription('فاز ۱ — هسته: auth، RBAC، رزرو PoC، POS PoC، موتور سند خودکار')
    .setVersion('v1')
    .addBearerAuth()
    .build();
  const doc = SwaggerModule.createDocument(app, swaggerCfg);
  SwaggerModule.setup('docs', app, doc);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  logger.log(`API ready on http://0.0.0.0:${port}/api/v1 — Swagger: /docs`);
}
void bootstrap();
