import { Module } from '@nestjs/common';
import { PulseController } from './pulse.controller';
import { SiteIngestService } from './site-ingest.service';
import { PartnerSlugCache } from './partner-slug-cache.service';
import { SiteAnalyticsService } from './site-analytics.service';
import { SiteSessionsService } from './site-sessions.service';

/**
 * Public-site analytics v1: the encrypted beacon the public site posts to
 * (POST /public/pulse) and the reports over it. The console endpoints live in
 * PlatformModule, which imports this module for SiteAnalyticsService.
 *
 * Supersedes the page-view-only AnalyticsModule (/public/visits), which stays
 * for old cached clients.
 */
@Module({
  controllers: [PulseController],
  providers: [SiteIngestService, PartnerSlugCache, SiteAnalyticsService, SiteSessionsService],
  exports: [SiteAnalyticsService, SiteSessionsService],
})
export class SiteAnalyticsModule {}
