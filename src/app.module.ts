import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ZodValidationPipe } from 'nestjs-zod';
import { resolve } from 'node:path';

import { validateEnv } from './config/env.config';
import { PrismaModule } from './prisma/prisma.module';
import { MailModule } from './mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';

import { PartnersModule } from './modules/partners/partners.module';
import { LocationsModule } from './modules/locations/locations.module';
import { ServicesModule } from './modules/services/services.module';
import { CoursesModule } from './modules/courses/courses.module';
import { SpecialistsModule } from './modules/specialists/specialists.module';
import { SpecialistReviewsModule } from './modules/specialist-reviews/specialist-reviews.module';
import { ClientsModule } from './modules/clients/clients.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { PublicModule } from './modules/public/public.module';
import { UsersModule } from './modules/users/users.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SignupModule } from './modules/signup/signup.module';
import { DemoRequestsModule } from './modules/demo-requests/demo-requests.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { PlatformModule } from './platform/platform.module';
import { SupportModule } from './modules/support/support.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    ThrottlerModule.forRootAsync({
      useFactory: () => [
        {
          ttl: Number(process.env.THROTTLE_TTL ?? 60) * 1000,
          limit: Number(process.env.THROTTLE_LIMIT ?? 120),
        },
      ],
    }),
    // Serve uploaded partner images as static files under /uploads. In prod
    // nginx serves this path directly (faster); this keeps it working in dev and
    // as a fallback. `serveStaticOptions` sets a long cache since filenames are
    // content-unique (uuid per upload).
    ServeStaticModule.forRoot({
      rootPath: resolve(process.env.UPLOADS_DIR ?? 'uploads'),
      serveRoot: '/uploads',
      serveStaticOptions: { index: false, maxAge: '30d', immutable: true },
    }),
    PrismaModule,
    MailModule,
    AuthModule,
    PartnersModule,
    LocationsModule,
    ServicesModule,
    CoursesModule,
    SpecialistsModule,
    SpecialistReviewsModule,
    ClientsModule,
    BookingsModule,
    PublicModule,
    UsersModule,
    NotificationsModule,
    SignupModule,
    DemoRequestsModule,
    AnalyticsModule,
    PlatformModule,
    SupportModule,
  ],
  controllers: [HealthController],
  providers: [
    // Validate every DTO with its Zod schema.
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    // Order matters: throttle → authenticate → authorize.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
