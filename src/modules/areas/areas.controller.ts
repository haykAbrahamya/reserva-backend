import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AreasService } from './areas.service';

/**
 * The shared area catalog.
 *
 * Authenticated but NOT product-gated: a branch's place is organization-level
 * data, not one product's. Vacancies filters on it today; the client
 * marketplace and course cohorts will read the same rows, and gating it behind
 * any single product would make it unreachable from the others.
 */
@ApiTags('Areas')
@ApiBearerAuth()
@Controller('areas')
export class AreasController {
  constructor(private readonly areas: AreasService) {}

  @Get()
  @ApiOperation({ summary: 'The active area catalog, as a tree' })
  catalog() {
    return this.areas.catalog();
  }
}
