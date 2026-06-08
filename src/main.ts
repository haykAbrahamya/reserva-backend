import { NestFactory } from '@nestjs/core';
import { Logger, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import type { Env } from './config/env.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

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
    }),
  );
  app.enableCors({
    origin: config.get<Env['CORS_ORIGINS']>('CORS_ORIGINS') ?? [],
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
