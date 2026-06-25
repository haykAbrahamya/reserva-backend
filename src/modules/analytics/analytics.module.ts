import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsPublicController } from './analytics.public.controller';

/**
 * Visitor analytics. The public page-view tracking endpoint lives here; the
 * internal-console list endpoint lives in PlatformModule (which imports this
 * module to reuse the service).
 */
@Module({
  controllers: [AnalyticsPublicController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
