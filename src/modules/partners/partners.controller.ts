import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { PartnersService } from './partners.service';
import { Public, Roles, CurrentUser } from '@/auth/decorators';
import { InternalApiGuard } from '@/auth/guards/internal-api.guard';
import type { AuthUser } from '@/auth/auth.types';
import { CreatePartnerDto, UpdatePartnerDto } from './dto/partner.dto';

@ApiTags('Partners')
@Controller()
export class PartnersController {
  constructor(private readonly partners: PartnersService) {}

  // ── Authenticated backoffice ──────────────────────────────

  @ApiBearerAuth()
  @Get('partner')
  @ApiOperation({ summary: 'Get the current partner with its full catalog' })
  getOwn(@CurrentUser() user: AuthUser) {
    return this.partners.getOwn(user.partnerId);
  }

  @ApiBearerAuth()
  @Roles('admin')
  @Patch('partner')
  @ApiOperation({ summary: 'Update partner profile + branding/presentation (admin)' })
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdatePartnerDto) {
    return this.partners.update(user.partnerId, dto);
  }

  // Public partner read lives in PublicController (GET public/partners/:slug).

  // ── Internal provisioning (internal-backoffice only) ──────

  @Public()
  @UseGuards(InternalApiGuard)
  @ApiSecurity('internal-key')
  @Post('internal/partners')
  @ApiOperation({ summary: 'Provision a new partner + first admin user (internal)' })
  create(@Body() dto: CreatePartnerDto) {
    return this.partners.create(dto);
  }
}
