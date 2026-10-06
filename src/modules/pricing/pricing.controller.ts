import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PricingService } from './pricing.service';
import { CurrentUser, RequiresProduct } from '@/auth/decorators';
import type { AuthUser } from '@/auth/auth.types';
import { SaveServicePricingDto, SaveServicePricingQueryDto } from './dto/pricing.dto';

@ApiTags('Pricing')
@ApiBearerAuth()
@RequiresProduct('bookings')
@Controller('pricing')
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Get()
  @ApiOperation({
    summary: "The partner's branch and specialist price overrides (sparse), plus whether the feature is on",
  })
  overrides(@CurrentUser() user: AuthUser) {
    return this.pricing.overrides(user.partnerId);
  }

  @Put('services/:serviceId')
  @ApiOperation({
    summary: "Replace one service's price grid (branch rows + specialist rows) for the branches you manage",
  })
  saveService(
    @CurrentUser() user: AuthUser,
    @Param('serviceId') serviceId: string,
    @Body() dto: SaveServicePricingDto,
    @Query() q: SaveServicePricingQueryDto,
  ) {
    return this.pricing.saveServicePricing(user.partnerId, serviceId, dto, user.locationId, q.locationId);
  }
}
