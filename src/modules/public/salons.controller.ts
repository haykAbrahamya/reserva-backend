import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SalonsService } from './salons.service';
import { Public } from '@/auth/decorators';
import { SalonSearchDto } from './dto/salons.dto';

/**
 * Public marketplace directory (reserva.am/salons). Unauthenticated; lists the
 * curated, listed salons with optional search. Open to the internet, so rate
 * limited a touch tighter than authenticated routes.
 */
@ApiTags('Public marketplace')
@Public()
@Controller('public/salons')
export class SalonsController {
  constructor(private readonly salons: SalonsService) {}

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get()
  @ApiOperation({ summary: 'List marketplace salons (with optional search)' })
  list(@Query() q: SalonSearchDto) {
    return this.salons.list(q);
  }
}
