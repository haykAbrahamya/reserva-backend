import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SpecialtiesService } from './specialties.service';

/**
 * The shared specialty vocabulary.
 *
 * Authenticated but NOT product-gated: this is organization-level vocabulary,
 * not one product's data. Vacancies picks a role from it today; services and
 * specialist titles will read the same rows, and gating it behind any single
 * product would make the taxonomy unreachable from the others.
 */
@ApiTags('Specialties')
@ApiBearerAuth()
@Controller('specialties')
export class SpecialtiesController {
  constructor(private readonly specialties: SpecialtiesService) {}

  @Get()
  @ApiOperation({ summary: 'The active specialty catalog, grouped' })
  catalog() {
    return this.specialties.catalog();
  }
}
