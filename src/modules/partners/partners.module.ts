import { Module } from '@nestjs/common';
import { PartnersService } from './partners.service';
import { GalleryService } from './gallery.service';
import { PartnersController } from './partners.controller';
import { InternalApiGuard } from '@/auth/guards/internal-api.guard';

@Module({
  controllers: [PartnersController],
  providers: [PartnersService, GalleryService, InternalApiGuard],
  exports: [PartnersService],
})
export class PartnersModule {}
