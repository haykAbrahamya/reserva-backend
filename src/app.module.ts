import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ZodValidationPipe } from 'nestjs-zod';

import { validateEnv } from './config/env.config';
import { PrismaModule } from './prisma/prisma.module';
import { MailModule } from './mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';

import { PartnersModule } from './modules/partners/partners.module';
import { LocationsModule } from './modules/locations/locations.module';
import { ServicesModule } from './modules/services/services.module';
import { SpecialistsModule } from './modules/specialists/specialists.module';
import { ClientsModule } from './modules/clients/clients.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { PublicModule } from './modules/public/public.module';
import { UsersModule } from './modules/users/users.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SignupModule } from './modules/signup/signup.module';
import { PlatformModule } from './platform/platform.module';
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
    PrismaModule,
    MailModule,
    AuthModule,
    PartnersModule,
    LocationsModule,
    ServicesModule,
    SpecialistsModule,
    ClientsModule,
    BookingsModule,
    PublicModule,
    UsersModule,
    NotificationsModule,
    SignupModule,
    PlatformModule,
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
