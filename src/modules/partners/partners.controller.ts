import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
  @ApiOperation({ summary: 'Upload a gallery image (admin)' })
  uploadGalleryImage(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: { buffer: Buffer; mimetype: string },
    @Body('label') label?: string,
  ) {
    return this.gallery.addImage(user.partnerId, file, label ?? '');
  }

  @ApiBearerAuth()
  @Roles('admin')
  @Delete('partner/gallery')
  @ApiOperation({ summary: 'Remove a gallery image by url (admin)' })
  removeGalleryImage(@CurrentUser() user: AuthUser, @Body('url') url: string) {
    return this.gallery.removeImage(user.partnerId, url);
  }

  @ApiBearerAuth()
  @Roles('admin')
  @Patch('partner/gallery/order')
  @ApiOperation({ summary: 'Reorder gallery images (admin)' })
  reorderGallery(@CurrentUser() user: AuthUser, @Body() dto: GalleryReorderDto) {
    return this.gallery.reorder(user.partnerId, dto.urls);
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
