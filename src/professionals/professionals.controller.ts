import { Body, Controller, Get, HttpCode, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '@/auth/decorators';
import { ProfessionalsService } from './professionals.service';
import { ProfessionalAuthGuard } from './guards/professional-auth.guard';
import { CurrentProfessional } from './professional.decorators';
import type { ProfessionalAuthUser } from './professional.types';
import {
  ProfessionalLoginDto,
  ProfessionalRefreshDto,
  RegisterProfessionalDto,
  UpdateProfessionalDto,
} from './dto/professional.dto';

/**
 * Professional accounts — everything the job-seeking side of
 * vacancies.reserva.am needs.
 *
 * Its own prefix, deliberately: the board reads from `/board/*`, partners work
 * under the tenant routes, staff under `/platform/*`. One prefix per audience
 * means a guard is never the only thing standing between two of them.
 *
 * Registration and login are hard rate-limited. They are unauthenticated writes
 * on a public website, which makes them the two endpoints most worth guessing
 * at — and a login limit is the difference between a password being weak and a
 * password being brute-forceable.
 */
@ApiTags('Professionals')
@Controller('professionals')
export class ProfessionalsController {
  constructor(private readonly professionals: ProfessionalsService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a professional account (signed in immediately)' })
  register(@Body() dto: RegisterProfessionalDto) {
    return this.professionals.register(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in with an email or phone number' })
  login(@Body() dto: ProfessionalLoginDto) {
    return this.professionals.login(dto.identifier, dto.password);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange a refresh token for a new pair' })
  refresh(@Body() dto: ProfessionalRefreshDto) {
    return this.professionals.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke a refresh token' })
  async logout(@Body() dto: ProfessionalRefreshDto) {
    await this.professionals.logout(dto.refreshToken);
  }

  @Public()
  @UseGuards(ProfessionalAuthGuard)
  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'The signed-in professional' })
  me(@CurrentProfessional() pro: ProfessionalAuthUser) {
    return this.professionals.me(pro.id);
  }

  @Public()
  @UseGuards(ProfessionalAuthGuard)
  @ApiBearerAuth()
  @Patch('me')
  @ApiOperation({ summary: 'Update your own profile' })
  update(@CurrentProfessional() pro: ProfessionalAuthUser, @Body() dto: UpdateProfessionalDto) {
    return this.professionals.update(pro.id, dto);
  }

  @Public()
  @UseGuards(ProfessionalAuthGuard)
  @ApiBearerAuth()
  @Get('me/applications')
  @ApiOperation({ summary: 'Listings you have applied to' })
  applications(@CurrentProfessional() pro: ProfessionalAuthUser) {
    return this.professionals.applications(pro.id);
  }
}
