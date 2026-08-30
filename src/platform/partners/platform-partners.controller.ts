import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PlatformPartnersService } from './platform-partners.service';
import { Public } from '@/auth/decorators';
import { PlatformAuthGuard } from '../guards/platform-auth.guard';
import { PlatformRolesGuard } from '../guards/platform-roles.guard';
import { PlatformRoles, CurrentPlatformUser } from '../platform.decorators';
import type { PlatformAuthUser } from '../platform.types';
import { CreatePartnerDto, UpdatePartnerDto } from '@/modules/partners/dto/partner.dto';
import {
  ListPlatformPartnersQueryDto,
  SetPartnerActiveDto,
  SetPartnerMarketplaceDto,
  SetPartnerBookingsDto,
  SetPartnerCoursesDto,
  SetPartnerKindDto,
  PlatformUpdateUserDto,
  PlatformResetPasswordDto,
} from './dto/platform-partner.dto';

@ApiTags('Platform · Partners')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformAuthGuard, PlatformRolesGuard)
@Controller('platform/partners')
export class PlatformPartnersController {
  constructor(private readonly partners: PlatformPartnersService) {}

  @Get()
  @ApiOperation({ summary: 'List partners (paginated, searchable)' })
  list(@Query() q: ListPlatformPartnersQueryDto) {
    return this.partners.list(q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a partner with counts + admins' })
  get(@Param('id') id: string) {
    return this.partners.get(id);
  }

  @Post()
  @ApiOperation({ summary: 'Provision a partner + first admin user' })
  create(@Body() dto: CreatePartnerDto) {
    return this.partners.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update partner profile + branding/presentation' })
  update(@Param('id') id: string, @Body() dto: UpdatePartnerDto) {
    return this.partners.update(id, dto);
  }

  @Patch(':id/active')
  @ApiOperation({ summary: 'Enable or disable a partner' })
  setActive(@Param('id') id: string, @Body() dto: SetPartnerActiveDto) {
    return this.partners.setActive(id, dto.active);
  }

  @Patch(':id/marketplace')
  @ApiOperation({ summary: 'Feature/unfeature a salon in the public marketplace' })
  setMarketplace(@Param('id') id: string, @Body() dto: SetPartnerMarketplaceDto) {
    return this.partners.setMarketplace(id, dto.listed);
  }

  @Patch(':id/bookings')
  @ApiOperation({ summary: 'Enable/disable the public booking flow (contact-only mode)' })
  setBookings(@Param('id') id: string, @Body() dto: SetPartnerBookingsDto) {
    return this.partners.setBookings(id, dto.enabled);
  }

  @Patch(':id/courses')
  @ApiOperation({ summary: 'Enable/disable the Courses (academy) feature for a partner' })
  setCourses(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Param('id') id: string,
    @Body() dto: SetPartnerCoursesDto,
  ) {
    // The acting operator is recorded on the entitlement for audit.
    return this.partners.setCourses(id, dto.enabled, user.id);
  }

  @Patch(':id/kind')
  @ApiOperation({ summary: 'Switch partner between salon and single (solo) mode' })
  setKind(@Param('id') id: string, @Body() dto: SetPartnerKindDto) {
    return this.partners.setKind(id, dto.kind);
  }

  @Delete(':id')
  @HttpCode(204)
  @PlatformRoles('owner')
  @ApiOperation({ summary: 'PERMANENTLY delete a partner and all connected data (owner only)' })
  async hardDelete(@Param('id') id: string) {
    await this.partners.hardDelete(id);
  }

  @Get(':id/users')
  @ApiOperation({ summary: "List a partner's users (admins + managers)" })
  listUsers(@Param('id') id: string) {
    return this.partners.listUsers(id);
  }

  @Patch(':id/users/:userId')
  @ApiOperation({ summary: "Update a partner user's profile" })
  updateUser(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: PlatformUpdateUserDto,
  ) {
    return this.partners.updateUser(id, userId, dto);
  }

  @Post(':id/users/:userId/reset-password')
  @ApiOperation({ summary: "Reset a partner user's password (returns it once)" })
  resetUserPassword(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: PlatformResetPasswordDto,
  ) {
    return this.partners.resetUserPassword(id, userId, dto);
  }
}
