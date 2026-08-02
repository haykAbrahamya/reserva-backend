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

// Course covers are shown as wide banner cards, so we keep a 16:9-ish landscape
// crop at a size that's crisp on retina without bloating the payload.
const COVER_WIDTH = 1280;
const COVER_HEIGHT = 720;
const WEBP_QUALITY = 82;

/**
 * Upload/remove a course cover image. Mirrors SpecialistAvatarService (sharp →
 * WebP → <uploadsDir>/<partnerId>/) so image handling stays one consistent story.
 * Tenant-scoped: the course must belong to the calling partner.
 */
@Injectable()
export class CourseCoverService {
  private readonly logger = new Logger(CourseCoverService.name);

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

  private async assertOwned(partnerId: string, id: string): Promise<{ coverUrl: string }> {
    const course = await this.prisma.course.findFirst({
      where: { id, partnerId, deletedAt: null },
      select: { coverUrl: true },
    });
    if (!course) throw AppException.notFound('Course not found');
    return course;
  }

  /** Best-effort delete a previously stored cover (never blocks the DB). */
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

  async setCover(
    partnerId: string,
    id: string,
    file: { buffer: Buffer; mimetype: string },
  ): Promise<{ coverUrl: string }> {
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
        .rotate()
        .resize(COVER_WIDTH, COVER_HEIGHT, { fit: 'cover', position: 'attention' })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer();
    } catch (err) {
      this.logger.warn(`sharp failed to process course cover for ${id}: ${String(err)}`);
      throw AppException.badRequest(ErrorCode.UPLOAD_FAILED, 'That image could not be processed');
    }

    const fileName = `course-${newId()}.webp`;
    const dir = join(this.uploadsDir, partnerId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, fileName), webp);
    const coverUrl = this.publicUrl(`${partnerId}/${fileName}`);

    await this.prisma.course.update({ where: { id }, data: { coverUrl } });
    if (existing.coverUrl) await this.deleteFile(partnerId, existing.coverUrl);

    return { coverUrl };
  }

  async removeCover(partnerId: string, id: string): Promise<{ coverUrl: string }> {
    const existing = await this.assertOwned(partnerId, id);
    await this.prisma.course.update({ where: { id }, data: { coverUrl: '' } });
    if (existing.coverUrl) await this.deleteFile(partnerId, existing.coverUrl);
    return { coverUrl: '' };
  }
}
