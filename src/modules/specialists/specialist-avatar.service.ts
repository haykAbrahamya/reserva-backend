import { Injectable } from '@nestjs/common';

import { PrismaService } from '@/prisma/prisma.service';
import { AppException } from '@/common/errors/app.exception';
import { ImageStorageService, IMAGE_PRESETS, type UploadedImage } from '@/common/media/image-storage.service';

/**
 * Upload/remove a specialist's profile photo.
 *
 * The bytes are ImageStorageService's problem; what is left here is what is
 * actually this feature's: that the specialist belongs to the calling partner,
 * and that the URL lands on the right row. Every mutation is scoped — an id
 * from a request path is never trusted before `assertOwned`.
 */
@Injectable()
export class SpecialistAvatarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly images: ImageStorageService,
  ) {}

  /** Load a specialist that belongs to this partner, or 404. */
  private async assertOwned(partnerId: string, id: string): Promise<{ avatarUrl: string }> {
    const sp = await this.prisma.specialist.findFirst({
      where: { id, partnerId, deletedAt: null },
      select: { avatarUrl: true },
    });
    if (!sp) throw AppException.notFound('Specialist not found');
    return sp;
  }

  /** Process + persist a profile photo; store its url on the specialist. */
  async setAvatar(partnerId: string, id: string, file: UploadedImage): Promise<{ avatarUrl: string }> {
    const existing = await this.assertOwned(partnerId, id);

    const avatarUrl = await this.images.store(partnerId, file, IMAGE_PRESETS.avatar);
    await this.prisma.specialist.update({ where: { id }, data: { avatarUrl } });

    // Drop the old photo only after the new one is committed.
    if (existing.avatarUrl) await this.images.remove(partnerId, existing.avatarUrl);

    return { avatarUrl };
  }

  /** Clear the photo (file best-effort deleted) → falls back to the initial. */
  async removeAvatar(partnerId: string, id: string): Promise<{ avatarUrl: string }> {
    const existing = await this.assertOwned(partnerId, id);
    await this.prisma.specialist.update({ where: { id }, data: { avatarUrl: '' } });
    if (existing.avatarUrl) await this.images.remove(partnerId, existing.avatarUrl);
    return { avatarUrl: '' };
  }
}
