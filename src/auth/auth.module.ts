import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PasswordService } from './password.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';

/**
 * Global so JwtModule, PasswordService and the guards are available app-wide.
 * The guards are registered as APP_GUARD in AppModule so every route is
 * protected by default unless flagged @Public().
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, JwtAuthGuard, RolesGuard],
  exports: [AuthService, PasswordService, JwtModule, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
