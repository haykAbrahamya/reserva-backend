import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '@/auth/decorators';
import { AnalyticsService } from './analytics.service';
import { CreateVisitorEventDto } from './dto/visitor-event.dto';

/**
 * Public page-view tracking from the client app (reserva.am). Fired once per
 * page view, so the throttle is looser than the booking/demo forms — it still
 * caps abuse from a single IP. IP + User-Agent are read from the request.
 */
@ApiTags('Public · Visits')
@Public()
@Controller('public/visits')
export class AnalyticsPublicController {
  constructor(private readonly service: AnalyticsService) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Record a page view' })
  record(@Body() dto: CreateVisitorEventDto, @Req() req: Request) {
    return this.service.record(dto, req.ip, req.headers['user-agent']);
  }
}
