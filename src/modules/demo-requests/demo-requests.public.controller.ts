import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '@/auth/decorators';
import { DemoRequestsService } from './demo-requests.service';
import { CreateDemoRequestDto } from './dto/demo-request.dto';

/** Public "Book a demo" submission from the marketing landing page. */
@ApiTags('Public · Demo requests')
@Public()
@Controller('public/demo-requests')
export class DemoRequestsPublicController {
  constructor(private readonly service: DemoRequestsService) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Submit a demo request' })
  create(@Body() dto: CreateDemoRequestDto) {
    return this.service.create(dto);
  }
}
