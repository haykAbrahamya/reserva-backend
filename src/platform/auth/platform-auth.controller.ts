import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PlatformAuthService } from './platform-auth.service';
import { Public } from '@/auth/decorators';
import { PlatformAuthGuard } from '../guards/platform-auth.guard';
import { CurrentPlatformUser } from '../platform.decorators';
import type { PlatformAuthUser } from '../platform.types';
import {
  PlatformLoginDto,
  PlatformRefreshDto,
  PlatformChangePasswordDto,
} from './dto/platform-auth.dto';

@ApiTags('Platform · Auth')
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(private readonly auth: PlatformAuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Platform staff log in with email + password' })
  login(@Body() dto: PlatformLoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange a platform refresh token for a new pair' })
  refresh(@Body() dto: PlatformRefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke a platform refresh token' })
  async logout(@Body() dto: PlatformRefreshDto) {
    await this.auth.logout(dto.refreshToken);
  }

  @Public()
  @UseGuards(PlatformAuthGuard)
  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Get the current platform operator' })
  me(@CurrentPlatformUser() user: PlatformAuthUser) {
    return this.auth.me(user.id);
  }

  @Public()
  @UseGuards(PlatformAuthGuard)
  @ApiBearerAuth()
  @Post('change-password')
  @HttpCode(204)
  @ApiOperation({ summary: 'Change your own platform password (revokes other sessions)' })
  async changePassword(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Body() dto: PlatformChangePasswordDto,
  ) {
    await this.auth.changePassword(user.id, dto.currentPassword, dto.newPassword);
  }
}
