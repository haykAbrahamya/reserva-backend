import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../decorators';
import { SuperAdminService } from './super-admin.service';
import { CurrentSuperAdmin, SuperAdminGuard, type SuperAdminPrincipal } from './super-admin.guard';
import {
  SuperEnterDto,
  SuperLoginDto,
  SuperLogoutDto,
  SuperPartnersQueryDto,
  SuperRefreshDto,
} from './dto/super-admin.dto';

/**
 * Super admin sign-in to the partner backoffice. @Public() so the partner
 * JwtAuthGuard skips these routes; the ones that need a session add
 * SuperAdminGuard, which accepts only a super admin's tokens.
 */
@ApiTags('Auth · Super admin')
@Public()
@Controller('auth/super')
export class SuperAdminController {
  constructor(private readonly superAdmins: SuperAdminService) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Super admin: sign in with internal-console credentials' })
  login(@Body() dto: SuperLoginDto) {
    return this.superAdmins.login(dto.email, dto.password);
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: "Super admin: rotate the session (and renew the token inside a partner)" })
  refresh(@Body() dto: SuperRefreshDto) {
    return this.superAdmins.refresh(dto.refreshToken, dto.partnerId);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Super admin: end the session' })
  async logout(@Body() dto: SuperLogoutDto) {
    await this.superAdmins.logout(dto.refreshToken);
  }

  @ApiBearerAuth()
  @UseGuards(SuperAdminGuard)
  @Get('partners')
  @ApiOperation({ summary: 'Super admin: the partners to choose from' })
  partners(@Query() q: SuperPartnersQueryDto) {
    return this.superAdmins.partners(q.search);
  }

  @ApiBearerAuth()
  @UseGuards(SuperAdminGuard)
  @Post('enter')
  @HttpCode(200)
  @ApiOperation({ summary: "Super admin: enter (or switch to) a partner's backoffice" })
  enter(@CurrentSuperAdmin() staff: SuperAdminPrincipal, @Body() dto: SuperEnterDto) {
    return this.superAdmins.enter(staff.id, dto.partnerId);
  }
}
