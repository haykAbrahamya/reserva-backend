import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PlatformStatsService } from './platform-stats.service';
import { Public } from '@/auth/decorators';
import { PlatformAuthGuard } from '../guards/platform-auth.guard';

@ApiTags('Platform · Stats')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformAuthGuard)
@Controller('platform/stats')
export class PlatformStatsController {
  constructor(private readonly stats: PlatformStatsService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Platform-wide dashboard overview' })
  overview() {
    return this.stats.overview();
  }
}
