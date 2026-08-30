import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PlatformSpecialtiesService } from './platform-specialties.service';
import { Public } from '@/auth/decorators';
import { PlatformAuthGuard } from '../guards/platform-auth.guard';
import { PlatformRolesGuard } from '../guards/platform-roles.guard';
import {
  CreateSpecialtyDto,
  UpdateSpecialtyDto,
  CreateSpecialtyGroupDto,
  UpdateSpecialtyGroupDto,
} from './dto/platform-specialty.dto';

/**
 * Staff administration of the shared specialty vocabulary.
 *
 * Routes are ordered groups-before-:key so `/specialty-groups` can live under
 * the same controller without a param route swallowing it.
 */
@ApiTags('Platform · Specialties')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformAuthGuard, PlatformRolesGuard)
@Controller('platform')
export class PlatformSpecialtiesController {
  constructor(private readonly specialties: PlatformSpecialtiesService) {}

  // ── Groups ────────────────────────────────────────────────

  @Get('specialty-groups')
  @ApiOperation({ summary: 'List specialty groups (including inactive)' })
  listGroups() {
    return this.specialties.listGroups();
  }

  @Post('specialty-groups')
  @ApiOperation({ summary: 'Create a specialty group' })
  createGroup(@Body() dto: CreateSpecialtyGroupDto) {
    return this.specialties.createGroup(dto);
  }

  @Patch('specialty-groups/:key')
  @ApiOperation({ summary: 'Update a specialty group' })
  updateGroup(@Param('key') key: string, @Body() dto: UpdateSpecialtyGroupDto) {
    return this.specialties.updateGroup(key, dto);
  }

  @Delete('specialty-groups/:key')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete an empty specialty group' })
  async removeGroup(@Param('key') key: string) {
    await this.specialties.removeGroup(key);
  }

  // ── Specialties ───────────────────────────────────────────

  @Get('specialties')
  @ApiOperation({ summary: 'List specialties with usage counts' })
  list(@Query('search') search?: string) {
    return this.specialties.list(search);
  }

  @Post('specialties')
  @ApiOperation({ summary: 'Create a specialty' })
  create(@Body() dto: CreateSpecialtyDto) {
    return this.specialties.create(dto);
  }

  @Patch('specialties/:key')
  @ApiOperation({ summary: 'Update a specialty' })
  update(@Param('key') key: string, @Body() dto: UpdateSpecialtyDto) {
    return this.specialties.update(key, dto);
  }

  @Delete('specialties/:key')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete an unused specialty' })
  async remove(@Param('key') key: string) {
    await this.specialties.remove(key);
  }
}
