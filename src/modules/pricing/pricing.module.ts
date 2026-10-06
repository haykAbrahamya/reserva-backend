import { Module } from '@nestjs/common';
import { PricingService } from './pricing.service';
import { PricingController } from './pricing.controller';

/**
 * Branch & specialist pricing. Exported because the booking engine, the public
 * page and the specialists module all resolve prices through it.
 */
@Module({
  controllers: [PricingController],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
