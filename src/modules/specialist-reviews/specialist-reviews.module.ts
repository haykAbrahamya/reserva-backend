import { Module } from '@nestjs/common';
import { SpecialistReviewsService } from './specialist-reviews.service';
import { PublicSpecialistReviewsController } from './public-specialist-reviews.controller';

/**
 * Specialist reviews. The service is exported so the public partner serializer
 * (PartnersService) can enrich specialists with rating aggregates, and the
 * specialists (backoffice) controller can list/delete reviews.
 */
@Module({
  controllers: [PublicSpecialistReviewsController],
  providers: [SpecialistReviewsService],
  exports: [SpecialistReviewsService],
})
export class SpecialistReviewsModule {}
