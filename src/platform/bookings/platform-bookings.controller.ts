import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Public } from '@/auth/decorators';
import { PlatformAuthGuard } from '../guards/platform-auth.guard';
import { RecentBookingsQueryDto } from './dto/recent-bookings.dto';
import { PlatformBookingsService } from './platform-bookings.service';

/** Bookings across all partners, for the internal console's dashboard. Any platform role. */
@ApiTags('Platform · Bookings')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformAuthGuard)
@Controller('platform/bookings')
export class PlatformBookingsController {
  constructor(private readonly bookings: PlatformBookingsService) {}

  @Get('recent')
  @ApiOperation({ summary: 'Newest bookings across all partners, with partner (cursor-paginated)' })
  recent(@Query() q: RecentBookingsQueryDto) {
    return this.bookings.recent(q);
  }
}
