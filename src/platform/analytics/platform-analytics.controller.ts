import { Controller, Delete, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Public } from '@/auth/decorators';
import { AnalyticsService } from '@/modules/analytics/analytics.service';
import { ListVisitorEventsQueryDto } from '@/modules/analytics/dto/visitor-event.dto';
import { PlatformAuthGuard } from '../guards/platform-auth.guard';

/** Internal-console view of public site visits. */
@ApiTags('Platform · Visits')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformAuthGuard)
@Controller('platform/visits')
export class PlatformAnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  @Get()
  @ApiOperation({ summary: 'List page-view visits (paginated, newest first)' })
  list(@Query() q: ListVisitorEventsQueryDto) {
    return this.service.list(q);
  }

  @Delete()
  @ApiOperation({ summary: 'Clear the entire visit history' })
  clearAll() {
    return this.service.clearAll();
  }
}
