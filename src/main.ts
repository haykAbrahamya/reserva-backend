// Pin the process timezone BEFORE anything computes a Date. All booking/slot
// logic works in "Armenia-local" wall-clock time (e.g. `new Date('2026-06-30T00:00:00')`
// and `getHours()`), so the server must run in Asia/Yerevan regardless of where
// it's deployed — otherwise a UTC host shows already-passed slots as bookable.
// Overridable via the TZ env var for non-AM deployments/tests.
process.env.TZ = process.env.TZ || 'Asia/Yerevan';

import { NestFactory } from '@nestjs/core';
import { Logger, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { initSentry } from './common/monitoring/sentry';
import { buildOriginChecker } from './common/utils/cors-origin';
import type { Env } from './config/env.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // Behind nginx (single trusted hop): trust X-Forwarded-For so req.ip is the
  // real client IP, not the proxy. Needed for visitor analytics + accurate
  // per-IP throttling.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // Error monitoring — no-op if SENTRY_DSN is unset (dev/local).
  initSentry(config.get<string>('SENTRY_DSN'), config.get<string>('SENTRY_ENV'));

  // Helmet with an explicit CSP that permits the Scalar docs UI (it loads its
  // bundle + fonts from jsDelivr and uses inline styles / blob workers), while
  // keeping strict defaults for everything else.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", 'https://cdn.jsdelivr.net', "'unsafe-inline'"],
          styleSrc: ["'self'", 'https://cdn.jsdelivr.net', 'https://fonts.googleapis.com', "'unsafe-inline'"],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net', 'data:'],
          imgSrc: ["'self'", 'data:', 'https://cdn.jsdelivr.net'],
          connectSrc: ["'self'", 'https://cdn.jsdelivr.net'],
          workerSrc: ["'self'", 'blob:'],
        },
      },
      // Uploaded gallery images are served from this API origin but loaded by the
      // client apps on other origins (*.reserva.am). The default same-origin
      // resource policy would block those <img> loads, so relax it to cross-origin.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  // CORS: allow the explicit origins list (e.g. localhost in dev) plus the apex
  // and ANY subdomain of CORS_BASE_DOMAIN over https — so every tenant subdomain
  // (antheris.reserva.am, …) is permitted without listing each slug.
  const allowedOrigins = config.get<Env['CORS_ORIGINS']>('CORS_ORIGINS') ?? [];
  const baseDomain = config.get<string>('CORS_BASE_DOMAIN') ?? '';
  const isAllowedOrigin = buildOriginChecker(allowedOrigins, baseDomain);

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Disallowed: resolve without the CORS headers (browser blocks it) rather
      // than throwing — throwing turns the OPTIONS preflight into a 500.
      return callback(null, isAllowedOrigin(origin));
    },
    credentials: true,
  });

  // All routes under /api/v1.
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new TransformInterceptor());
  app.enableShutdownHooks();

  // ── OpenAPI (Zod DTOs → schema) + Scalar reference UI ──
  // nestjs-zod v5 auto-registers Zod DTO schemas with @nestjs/swagger; no
  // explicit patch call needed.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Reserva API')
    .setDescription('Multi-tenant salon booking platform — backoffice + public booking.')
    .setVersion('1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'x-internal-key', in: 'header' }, 'internal-key')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);

  // Raw OpenAPI JSON for tooling + for Scalar to fetch.
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get('/api/openapi.json', (_req: unknown, res: { json: (b: unknown) => void }) =>
    res.json(document),
  );

  // Beautiful interactive docs at /api/docs (Scalar). Point it at the JSON URL
  // (recommended over inlining `content`, which can blank the client render).
  app.use(
    '/api/docs',
    apiReference({
      url: '/api/openapi.json',
      title: 'Reserva API Reference',
    }),
  );

  const port = config.get<number>('PORT') ?? 4000;
  await app.listen(port);
  logger.log(`Reserva API ready on http://localhost:${port}/api/v1`);
  logger.log(`API docs at http://localhost:${port}/api/docs`);
}

void bootstrap();
