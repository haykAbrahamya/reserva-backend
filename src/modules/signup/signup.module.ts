import { Module } from '@nestjs/common';
import { SignupService } from './signup.service';
import { SignupController } from './signup.controller';

/**
 * Public self-serve signup. AuthService + PasswordService come from the global
 * AuthModule; MailService from the global MailModule.
 */
@Module({
  controllers: [SignupController],
  providers: [SignupService],
  // Exported so the platform module can manually activate a pending signup.
  exports: [SignupService],
})
export class SignupModule {}
