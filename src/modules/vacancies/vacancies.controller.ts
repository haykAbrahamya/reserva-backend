import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { VacanciesService } from './vacancies.service';
import { CurrentUser, RequiresProduct } from '@/auth/decorators';
import type { AuthUser } from '@/auth/auth.types';
import {
  CreateVacancyDto,
  UpdateVacancyDto,
  VacancyActionDto,
  ListVacancyQueryDto,
} from './dto/vacancy.dto';

/**
 * Backoffice vacancy management.
 *
 * `@RequiresProduct('vacancies')` sits on the controller, so every route below
 * is refused for a partner without the entitlement — hiding the nav item is
 * cosmetic, this is the actual boundary.
 *
 * `user.locationId` is passed through on every call: it is null for admins and
 * a manager's own branch otherwise, which scopes them to hiring for the branch
 * they run, exactly as bookings does.
 */
@ApiTags('Vacancies')
@ApiBearerAuth()
@RequiresProduct('vacancies')
@Controller('vacancies')
export class VacanciesController {
  constructor(private readonly vacancies: VacanciesService) {}

  @Get()
  @ApiOperation({ summary: "List the partner's vacancies" })
  list(@CurrentUser() user: AuthUser, @Query() q: ListVacancyQueryDto) {
    return this.vacancies.list(user.partnerId, q, user.locationId);
  }

  @Get('counts')
  @ApiOperation({ summary: 'Vacancy counts per status (filter chips)' })
  counts(@CurrentUser() user: AuthUser) {
    return this.vacancies.counts(user.partnerId, user.locationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one vacancy' })
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.vacancies.get(user.partnerId, id, user.locationId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a vacancy (starts as a draft)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateVacancyDto) {
    return this.vacancies.create(user.partnerId, dto, user.id, user.locationId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a vacancy' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateVacancyDto) {
    return this.vacancies.update(user.partnerId, id, dto, user.locationId);
  }

  @Post(':id/actions')
  @ApiOperation({ summary: 'Publish / pause / close / renew a vacancy' })
  act(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: VacancyActionDto) {
    return this.vacancies.act(user.partnerId, id, dto.action, user.locationId);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a vacancy (soft delete)' })
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.vacancies.remove(user.partnerId, id, user.locationId);
  }
}
