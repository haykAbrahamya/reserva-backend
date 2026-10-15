import { Module } from '@nestjs/common';
import { LeadsModule } from '@/modules/leads/leads.module';
import { PulseController } from './pulse.controller';
import { SiteIngestService } from './site-ingest.service';
import { PartnerSlugCache } from './partner-slug-cache.service';
import { SiteAnalyticsService } from './site-analytics.service';
import { SiteSessionsService } from './site-sessions.service';
import { SiteToolsService } from './site-tools.service';

/**
 * Public-site analytics v1: the encrypted beacon the public sites post to
 * (POST /public/pulse — reserva.am and tools.reserva.am) and the reports over it. The console endpoints live in
 * PlatformModule, which imports this module for SiteAnalyticsService.
 *
 * Supersedes the page-view-only AnalyticsModule (/public/visits), which stays
 * for old cached clients.
 */
@Module({
  // A tools export signed with a contact line becomes a lead.
  imports: [LeadsModule],
  controllers: [PulseController],
  providers: [
    SiteIngestService,
    PartnerSlugCache,
    SiteAnalyticsService,
    SiteSessionsService,
    SiteToolsService,
  ],
  exports: [SiteAnalyticsService, SiteSessionsService, SiteToolsService],
})
export class SiteAnalyticsModule {}
