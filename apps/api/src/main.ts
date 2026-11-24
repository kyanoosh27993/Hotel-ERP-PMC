/**
 * main.ts — بوت NestJS: پیشوند /api/v1 (نسخه‌دار — سند ۰۵)، اعتبارسنجی، Swagger، رصد.
 */
import 'reflect-metadata';
import './bigint-json';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { startTelemetry } from './telemetry/instrumentation';
import { config as loadEnv } from 'dotenv';
import * as express from 'express';

async function bootstrap() {
  loadEnv();
  const logger = new Logger('Bootstrap');
  startTelemetry();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });

  app.setGlobalPrefix('api/v1');

  // ── فاز ۱۳ / F13-T2: هدرهای امنیتی + محدودسازی تلاش ورود (بدون وابستگی جدید) ──
  const expressApp = app.getHttpAdapter().getInstance() as { use: (...args: unknown[]) => void };
  expressApp.use((_req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });
  // محدودسازی نرخ ورود: ۱۵ تلاش در دقیقه به‌ازای IP — پاسخ 429
  const loginHits = new Map<string, { count: number; start: number }>();
  expressApp.use('/api/v1/auth/login', (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const now = Date.now();
    const bucket = loginHits.get(ip) ?? { count: 0, start: now };
    if (now - bucket.start > 60_000) { bucket.count = 0; bucket.start = now; }
    bucket.count++;
    loginHits.set(ip, bucket);
    if (bucket.count > 15) {
      res.status(429).json({ error: { code: 'TOO_MANY_ATTEMPTS', message: 'تلاش‌های بیش از حد — یک دقیقه صبر کنید' } });
      return;
    }
    next();
  });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({ origin: true, credentials: true });
  app.enableShutdownHooks();

  // نسخهٔ دسکتاپ (نصب‌کنندهٔ ویندوز): شل وب استاتیک از WEB_DIR سرو می‌شود — همان مسیر روت
  const webDir = process.env.WEB_DIR;
  if (webDir) {
    app.useStaticAssets(webDir);
    logger.log(`Web shell served from ${webDir}`);
  }

  const swaggerCfg = new DocumentBuilder()
    .setTitle('Hotel ERP Core API')
    .setDescription('فاز ۱ — هسته: auth، RBAC، رزرو PoC، POS PoC، موتور سند خودکار')
    .setVersion('v1')
    .addBearerAuth()
    .build();
  const doc = SwaggerModule.createDocument(app, swaggerCfg);
  SwaggerModule.setup('docs', app, doc);

  // نسخه دسکتاپ: وب استاتیک قبل از روتر Nest (درخواست‌های API به Nest می‌رسند، بقیه به وب)
  if (process.env.DESKTOP_WEB_DIR) {
    expressApp.use(express.static(process.env.DESKTOP_WEB_DIR));
    logger.log(`web UI: ${process.env.DESKTOP_WEB_DIR}`);
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  logger.log(`API ready on http://0.0.0.0:${port}/api/v1 — Swagger: /docs`);
}
void bootstrap();
