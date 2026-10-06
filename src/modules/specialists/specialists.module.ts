import { Module } from '@nestjs/common';
import { SpecialistsService } from './specialists.service';
import { SpecialistAvatarService } from './specialist-avatar.service';
import { TimeOffService } from './time-off.service';
import { SpecialistsController } from './specialists.controller';
import { SpecialistReviewsModule } from '@/modules/specialist-reviews/specialist-reviews.module';
import { PricingModule } from '@/modules/pricing/pricing.module';

@Module({
  imports: [SpecialistReviewsModule, PricingModule],
  controllers: [SpecialistsController],
  providers: [SpecialistsService, SpecialistAvatarService, TimeOffService],
  exports: [SpecialistsService, TimeOffService],
})
export class SpecialistsModule {}
