import { Module } from '@nestjs/common';
import { PartnersService } from './partners.service';
import { PartnersController } from './partners.controller';
import { InternalApiGuard } from '@/auth/guards/internal-api.guard';

@Module({
  controllers: [PartnersController],
  providers: [PartnersService, InternalApiGuard],
  exports: [PartnersService],
})
export class PartnersModule {}
