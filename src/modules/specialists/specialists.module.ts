import { Module } from '@nestjs/common';
import { SpecialistsService } from './specialists.service';
import { TimeOffService } from './time-off.service';
import { SpecialistsController } from './specialists.controller';
import { SpecialistReviewsModule } from '@/modules/specialist-reviews/specialist-reviews.module';

@Module({
  imports: [SpecialistReviewsModule],
  controllers: [SpecialistsController],
  providers: [SpecialistsService, TimeOffService],
  exports: [SpecialistsService, TimeOffService],
})
export class SpecialistsModule {}
