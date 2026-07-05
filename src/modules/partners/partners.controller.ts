import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiSecurity, ApiConsumes } from '@nestjs/swagger';
import { PartnersService } from './partners.service';
import { GalleryService } from './gallery.service';
import { Public, Roles, CurrentUser } from '@/auth/decorators';
import { InternalApiGuard } from '@/auth/guards/internal-api.guard';
import type { AuthUser } from '@/auth/auth.types';
import {
  CreatePartnerDto,
  UpdatePartnerDto,
  GalleryReorderDto,
} from './dto/partner.dto';

// 8 MB cap on the raw upload (sharp shrinks it to WebP afterwards).
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Narrow an untrusted `list` string to a valid photo list (default fallback). */
function toList(v: unknown, fallback: 'gallery' | 'works'): 'gallery' | 'works' {
  return v === 'works' ? 'works' : v === 'gallery' ? 'gallery' : fallback;
}

@ApiTags('Partners')
@Controller()
export class PartnersController {
  constructor(
    private readonly partners: PartnersService,
    private readonly gallery: GalleryService,
  ) {}

  // ── Authenticated backoffice ──────────────────────────────

  @ApiBearerAuth()
  @Get('partner')
  @ApiOperation({ summary: 'Get the current partner with its full catalog' })
  getOwn(@CurrentUser() user: AuthUser) {
    // Fire-and-forget "last active" heartbeat — this endpoint is fetched on
    // every backoffice load/refresh. Never block or fail the profile fetch.
    void this.partners.touchLastSeen(user.id).catch(() => undefined);
    return this.partners.getOwn(user.partnerId);
  }

  @ApiBearerAuth()
  @Roles('admin')
  @Patch('partner')
  @ApiOperation({ summary: 'Update partner profile + branding/presentation (admin)' })
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdatePartnerDto) {
    return this.partners.update(user.partnerId, dto);
  }

  // ── Storefront gallery (admin) ────────────────────────────

  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @Roles('admin')
  @Post('partner/gallery')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  @ApiOperation({ summary: 'Upload a gallery/works image (admin)' })
  uploadGalleryImage(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: { buffer: Buffer; mimetype: string },
    @Body('label') label?: string,
    @Body('list') list?: string,
  ) {
    return this.gallery.addImage(user.partnerId, file, label ?? '', toList(list, 'gallery'));
  }

  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @Roles('admin')
  @Post('partner/gallery/before-after')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'before', maxCount: 1 },
        { name: 'after', maxCount: 1 },
      ],
      { limits: { fileSize: MAX_UPLOAD_BYTES } },
    ),
  )
  @ApiOperation({ summary: 'Upload a before/after works tile (admin)' })
  uploadBeforeAfter(
    @CurrentUser() user: AuthUser,
    @UploadedFiles()
    files: {
      before?: { buffer: Buffer; mimetype: string }[];
      after?: { buffer: Buffer; mimetype: string }[];
    },
    @Body('label') label?: string,
    @Body('list') list?: string,
  ) {
    return this.gallery.addBeforeAfter(
      user.partnerId,
      files.before?.[0] as { buffer: Buffer; mimetype: string },
      files.after?.[0] as { buffer: Buffer; mimetype: string },
      label ?? '',
      toList(list, 'works'),
    );
  }

  @ApiBearerAuth()
  @Roles('admin')
  @Delete('partner/gallery')
  @ApiOperation({ summary: 'Remove a gallery/works image by url (admin)' })
  removeGalleryImage(
    @CurrentUser() user: AuthUser,
    @Body('url') url: string,
    @Body('list') list?: string,
  ) {
    return this.gallery.removeImage(user.partnerId, url, toList(list, 'gallery'));
  }

  @ApiBearerAuth()
  @Roles('admin')
  @Patch('partner/gallery/order')
  @ApiOperation({ summary: 'Reorder gallery/works images (admin)' })
  reorderGallery(@CurrentUser() user: AuthUser, @Body() dto: GalleryReorderDto) {
    return this.gallery.reorder(user.partnerId, dto.urls, toList(dto.list, 'gallery'));
  }

  // ── Brand logo (admin) ────────────────────────────────────

  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @Roles('admin')
  @Post('partner/logo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  @ApiOperation({ summary: 'Upload the partner brand logo (admin)' })
  uploadLogo(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: { buffer: Buffer; mimetype: string },
  ) {
    return this.gallery.setLogo(user.partnerId, file);
  }

  @ApiBearerAuth()
  @Roles('admin')
  @Delete('partner/logo')
  @ApiOperation({ summary: 'Remove the partner brand logo (admin)' })
  removeLogo(@CurrentUser() user: AuthUser) {
    return this.gallery.removeLogo(user.partnerId);
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
