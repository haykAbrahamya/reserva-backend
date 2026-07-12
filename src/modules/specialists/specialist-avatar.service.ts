import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import sharp from 'sharp';

import { PrismaService } from '@/prisma/prisma.service';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import { newId } from '@/common/ids';
import type { Env } from '@/config/env.config';

// Profile photos are shown in a circle at modest sizes (team card, modal
// banner, booking picker) — a 512² WebP is crisp everywhere and stays small.
const AVATAR_DIMENSION = 512;
const WEBP_QUALITY = 88;

/**
 * Upload/remove a specialist's profile photo. Mirrors the partner-logo flow in
 * GalleryService (sharp → square WebP → <uploadsDir>/<partnerId>/) so image
 * handling stays a single, consistent story across the app. Every mutation is
 * scoped: the specialist must belong to the calling partner.
 */
@Injectable()
export class SpecialistAvatarService {
  private readonly logger = new Logger(SpecialistAvatarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private get uploadsDir(): string {
    return resolve(this.config.get('UPLOADS_DIR', { infer: true }));
  }

  private get publicBase(): string {
    return this.config.get('UPLOADS_PUBLIC_URL', { infer: true }) || '/uploads';
  }

  private publicUrl(rel: string): string {
    return `${this.publicBase}/${rel}`;
  }

  /** Load a specialist that belongs to this partner, or 404. */
  private async assertOwned(partnerId: string, id: string): Promise<{ avatarUrl: string }> {
    const sp = await this.prisma.specialist.findFirst({
      where: { id, partnerId, deletedAt: null },
      select: { avatarUrl: true },
    });
    if (!sp) throw AppException.notFound('Specialist not found');
    return sp;
  }

  /** Best-effort delete a previously stored avatar file (never blocks the DB). */
  private async deleteFile(partnerId: string, url: string) {
    const marker = `/${partnerId}/`;
    const idx = url.lastIndexOf(marker);
    if (idx === -1) return;
    const fileName = url.slice(idx + marker.length);
    if (!fileName || fileName.includes('/') || fileName.includes('..')) return;
    try {
      await unlink(join(this.uploadsDir, partnerId, fileName));
    } catch {
      /* already gone — ignore */
    }
  }

  /** Process + persist a profile photo; store its url on the specialist. */
  async setAvatar(
    partnerId: string,
    id: string,
    file: { buffer: Buffer; mimetype: string },
  ): Promise<{ avatarUrl: string }> {
    const existing = await this.assertOwned(partnerId, id);

    if (!file?.buffer?.length) {
      throw AppException.badRequest(ErrorCode.UPLOAD_FAILED, 'No image file was provided');
    }
    if (!file.mimetype?.startsWith('image/')) {
      throw AppException.badRequest(ErrorCode.UPLOAD_FAILED, 'Only image files are allowed');
    }

    let webp: Buffer;
    try {
      webp = await sharp(file.buffer)
        .rotate() // honor EXIF orientation from phone photos
        .resize(AVATAR_DIMENSION, AVATAR_DIMENSION, { fit: 'cover', position: 'attention' })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer();
    } catch (err) {
      this.logger.warn(`sharp failed to process avatar for ${id}: ${String(err)}`);
      throw AppException.badRequest(ErrorCode.UPLOAD_FAILED, 'That image could not be processed');
    }

    const fileName = `sp-${newId()}.webp`;
    const dir = join(this.uploadsDir, partnerId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, fileName), webp);
    const avatarUrl = this.publicUrl(`${partnerId}/${fileName}`);

    await this.prisma.specialist.update({ where: { id }, data: { avatarUrl } });

    // Drop the old photo only after the new one is committed.
    if (existing.avatarUrl) await this.deleteFile(partnerId, existing.avatarUrl);

    return { avatarUrl };
  }

  /** Clear the photo (file best-effort deleted) → falls back to the initial. */
  async removeAvatar(partnerId: string, id: string): Promise<{ avatarUrl: string }> {
    const existing = await this.assertOwned(partnerId, id);
    await this.prisma.specialist.update({ where: { id }, data: { avatarUrl: '' } });
    if (existing.avatarUrl) await this.deleteFile(partnerId, existing.avatarUrl);
    return { avatarUrl: '' };
  }
}
