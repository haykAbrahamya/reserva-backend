import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { LocationsService } from './locations.service';
import { Roles, CurrentUser } from '@/auth/decorators';
import type { AuthUser } from '@/auth/auth.types';
import { CreateLocationDto, UpdateLocationDto, ListLocationQueryDto } from './dto/location.dto';

@ApiTags('Locations')
@ApiBearerAuth()
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  @ApiOperation({ summary: "List the partner's locations" })
  list(@CurrentUser() user: AuthUser, @Query() q: ListLocationQueryDto) {
    return this.locations.list(user.partnerId, q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a location' })
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.locations.get(user.partnerId, id);
  }

  // Branch management is admin-only.
  @Roles('admin')
  @Post()
  @ApiOperation({ summary: 'Create a location (admin)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateLocationDto) {
    return this.locations.create(user.partnerId, dto);
  }

  @Roles('admin')
  @Patch(':id')
  @ApiOperation({ summary: 'Update a location (admin)' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateLocationDto) {
    return this.locations.update(user.partnerId, id, dto);
  }

  @Roles('admin')
  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-delete a location (admin)' })
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.locations.remove(user.partnerId, id);
  }
}
