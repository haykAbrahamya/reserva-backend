import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '@/auth/decorators';
import { ProfessionalsService } from './professionals.service';
import { ProfessionalMediaService } from './professional-media.service';
import { ProfessionalAuthGuard } from './guards/professional-auth.guard';
import { CurrentProfessional } from './professional.decorators';
import type { ProfessionalAuthUser } from './professional.types';
import {
  PhotoLabelDto,
  ProfessionalLoginDto,
  ProfessionalRefreshDto,
  RegisterProfessionalDto,
  RemovePhotoDto,
  ReorderPhotosDto,
  UpdateProfessionalDto,
} from './dto/professional.dto';

/**
 * Matches the cap the other upload routes use. Enforced by multer BEFORE the
 * bytes reach the handler, so an oversized file is refused without ever being
 * buffered in full.
 */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

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
  constructor(
    private readonly professionals: ProfessionalsService,
    private readonly media: ProfessionalMediaService,
  ) {}

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

  // ── Media ─────────────────────────────────────────────────
  //
  // Every route below acts on `pro.id` from the access token, never on an id in
  // the path. There is no id to get wrong, so there is no ownership check to
  // forget — the partner-side upload routes need `assertOwned` precisely
  // because theirs is addressable and this one is not.
  //
  // Each returns the whole updated profile rather than just the changed url.
  // The client holds one profile object; handing back a fragment makes the
  // caller responsible for merging it correctly, and a portfolio that has
  // drifted from the server is worse than one extra field on the wire.

  @Public()
  @UseGuards(ProfessionalAuthGuard)
  @ApiBearerAuth()
  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  @ApiOperation({ summary: 'Upload your profile photo' })
  setAvatar(
    @CurrentProfessional() pro: ProfessionalAuthUser,
    @UploadedFile() file: { buffer: Buffer; mimetype: string },
  ) {
    return this.media.setAvatar(pro.id, file);
  }

  @Public()
  @UseGuards(ProfessionalAuthGuard)
  @ApiBearerAuth()
  @Delete('me/avatar')
  @ApiOperation({ summary: 'Remove your profile photo' })
  removeAvatar(@CurrentProfessional() pro: ProfessionalAuthUser) {
    return this.media.removeAvatar(pro.id);
  }

  @Public()
  @UseGuards(ProfessionalAuthGuard)
  @ApiBearerAuth()
  @Post('me/photos')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  @ApiOperation({ summary: 'Add a photo of your work' })
  addPhoto(
    @CurrentProfessional() pro: ProfessionalAuthUser,
    @UploadedFile() file: { buffer: Buffer; mimetype: string },
    @Body() dto: PhotoLabelDto,
  ) {
    return this.media.addPhoto(pro.id, file, dto.label ?? '');
  }

  @Public()
  @UseGuards(ProfessionalAuthGuard)
  @ApiBearerAuth()
  @Delete('me/photos')
  @ApiOperation({ summary: 'Remove one photo of your work' })
  removePhoto(@CurrentProfessional() pro: ProfessionalAuthUser, @Body() dto: RemovePhotoDto) {
    return this.media.removePhoto(pro.id, dto.url);
  }

  @Public()
  @UseGuards(ProfessionalAuthGuard)
  @ApiBearerAuth()
  @Patch('me/photos')
  @ApiOperation({ summary: 'Reorder your work photos' })
  reorderPhotos(@CurrentProfessional() pro: ProfessionalAuthUser, @Body() dto: ReorderPhotosDto) {
    return this.media.reorderPhotos(pro.id, dto.urls);
  }
}
