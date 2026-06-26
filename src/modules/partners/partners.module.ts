import { Module } from '@nestjs/common';
import { PartnersService } from './partners.service';
import { GalleryService } from './gallery.service';
import { PartnersController } from './partners.controller';
import { InternalApiGuard } from '@/auth/guards/internal-api.guard';
import { SpecialistReviewsModule } from '@/modules/specialist-reviews/specialist-reviews.module';

@Module({
  imports: [SpecialistReviewsModule],
  controllers: [PartnersController],
  providers: [PartnersService, GalleryService, InternalApiGuard],
  exports: [PartnersService],
})
export class PartnersModule {}
