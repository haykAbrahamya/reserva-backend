import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PlatformStaffService } from './platform-staff.service';
import { Public } from '@/auth/decorators';
import { PlatformAuthGuard } from '../guards/platform-auth.guard';
import { PlatformRolesGuard } from '../guards/platform-roles.guard';
import { PlatformRoles, CurrentPlatformUser } from '../platform.decorators';
import type { PlatformAuthUser } from '../platform.types';
import { ListStaffQueryDto, CreateStaffDto, UpdateStaffDto } from './dto/platform-staff.dto';

/** Platform staff management — restricted to owners. */
@ApiTags('Platform · Staff')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformAuthGuard, PlatformRolesGuard)
@PlatformRoles('owner')
@Controller('platform/staff')
export class PlatformStaffController {
  constructor(private readonly staff: PlatformStaffService) {}

  @Get()
  @ApiOperation({ summary: 'List platform staff (paginated)' })
  list(@Query() q: ListStaffQueryDto) {
    return this.staff.list(q);
  }

  @Post()
  @ApiOperation({ summary: 'Create a platform operator (returns OTP if generated)' })
  create(@Body() dto: CreateStaffDto) {
    return this.staff.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a platform staff member' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateStaffDto,
    @CurrentPlatformUser() me: PlatformAuthUser,
  ) {
    return this.staff.update(id, dto, me.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Deactivate (soft-delete) a platform staff member' })
  async remove(@Param('id') id: string, @CurrentPlatformUser() me: PlatformAuthUser) {
    await this.staff.remove(id, me.id);
  }
}
