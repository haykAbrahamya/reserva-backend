import { Controller, Delete, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Public } from '@/auth/decorators';
import { SiteAnalyticsService } from '@/modules/site-analytics/site-analytics.service';
import { SiteSessionsService } from '@/modules/site-analytics/site-sessions.service';
import {
  AnalyticsClearQueryDto,
  AnalyticsEventsQueryDto,
  AnalyticsRangeQueryDto,
  AnalyticsSessionsQueryDto,
  AnalyticsSourcesQueryDto,
} from '@/modules/site-analytics/dto/site-analytics-query.dto';
import { PlatformAuthGuard } from '../guards/platform-auth.guard';
import { PlatformRolesGuard } from '../guards/platform-roles.guard';
import { CurrentPlatformUser, PlatformRoles } from '../platform.decorators';
import type { PlatformAuthUser } from '../platform.types';

/**
 * Internal-console "Analytics": reports over what the public site's beacon
 * records. `from`/`to` are inclusive Asia/Yerevan days; bots never count and
 * staff traffic only with includeInternal=true. Every platform user can read;
 * only the owner can delete data.
 */
@ApiTags('Platform · Analytics')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformAuthGuard, PlatformRolesGuard)
@Controller('platform/analytics')
export class PlatformSiteAnalyticsController {
  constructor(
    private readonly analytics: SiteAnalyticsService,
    private readonly visits: SiteSessionsService,
  ) {}

  @Get('bounds')
  @ApiOperation({
    summary: 'Yerevan days of the first and last recorded event (bounds the date picker)',
  })
  bounds() {
    return this.analytics.bounds();
  }

  @Get('overview')
  @ApiOperation({
    summary: 'KPIs vs the previous period, daily series, contact clicks, top partners',
  })
  overview(@Query() q: AnalyticsRangeQueryDto) {
    return this.analytics.overview(q);
  }

  @Get('partners')
  @ApiOperation({ summary: 'Per-partner views, visitors, funnel, bookings and contact clicks' })
  partners(@Query() q: AnalyticsRangeQueryDto) {
    return this.analytics.partners(q);
  }

  @Get('sources')
  @ApiOperation({ summary: 'Channels, referrers, campaigns, devices, countries, languages' })
  sources(@Query() q: AnalyticsSourcesQueryDto) {
    return this.analytics.sources(q);
  }

  @Get('events')
  @ApiOperation({ summary: 'The raw event log, newest first (paginated)' })
  events(@Query() q: AnalyticsEventsQueryDto) {
    return this.analytics.events(q);
  }

  @Get('storage')
  @ApiOperation({
    summary: 'Rows and disk space the analytics tables use, and the oldest day kept',
  })
  storage() {
    return this.analytics.storage();
  }

  @Delete('data')
  @PlatformRoles('owner')
  @ApiOperation({
    summary: 'Delete analytics data: everything, or events before a Yerevan day (owner only)',
  })
  clear(@Query() q: AnalyticsClearQueryDto, @CurrentPlatformUser() user: PlatformAuthUser) {
    return this.analytics.clear(q.before, user.id);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Visits, newest first: source, device, partners, journey, outcome' })
  listSessions(@Query() q: AnalyticsSessionsQueryDto) {
    return this.visits.list(q);
  }

  @Get('sessions/:id')
  @ApiOperation({
    summary: 'One visit: every event in order, names for its ids, other visits by the same visitor',
  })
  getSession(@Param('id') id: string) {
    return this.visits.detail(id);
  }
}
