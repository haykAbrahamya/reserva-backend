import { Injectable } from '@nestjs/common';

import { PrismaService } from '@/prisma/prisma.service';
import { AppException } from '@/common/errors/app.exception';
import { ImageStorageService, IMAGE_PRESETS, type UploadedImage } from '@/common/media/image-storage.service';

/**
 * Upload/remove a course cover image.
 *
 * Tenant-scoped: the course must belong to the calling partner. The image
 * pipeline itself lives in ImageStorageService — this file is ownership and
 * one column.
 */
@Injectable()
export class CourseCoverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly images: ImageStorageService,
  ) {}

  private async assertOwned(partnerId: string, id: string): Promise<{ coverUrl: string }> {
    const course = await this.prisma.course.findFirst({
      where: { id, partnerId, deletedAt: null },
      select: { coverUrl: true },
    });
    if (!course) throw AppException.notFound('Course not found');
    return course;
  }

  async setCover(partnerId: string, id: string, file: UploadedImage): Promise<{ coverUrl: string }> {
    const existing = await this.assertOwned(partnerId, id);

    const coverUrl = await this.images.store(partnerId, file, IMAGE_PRESETS.courseCover);
    await this.prisma.course.update({ where: { id }, data: { coverUrl } });
    if (existing.coverUrl) await this.images.remove(partnerId, existing.coverUrl);

    return { coverUrl };
  }

  async removeCover(partnerId: string, id: string): Promise<{ coverUrl: string }> {
    const existing = await this.assertOwned(partnerId, id);
    await this.prisma.course.update({ where: { id }, data: { coverUrl: '' } });
    if (existing.coverUrl) await this.images.remove(partnerId, existing.coverUrl);
    return { coverUrl: '' };
  }
}
