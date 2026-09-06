import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '@/prisma/prisma.service';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import {
  ImageStorageService,
  IMAGE_PRESETS,
  assertImage,
  type UploadedImage,
} from '@/common/media/image-storage.service';
import {
  readPhotos,
  toPublicProfessional,
  type ProfilePhoto,
  type PublicProfessional,
} from './professional.view';

/**
 * A portfolio is a sample, not an archive.
 *
 * Twelve is the same cap a partner's gallery uses, and for the same reason: a
 * salon deciding whether to call someone looks at the first handful, and an
 * unbounded list is a slow page plus an invitation to upload a camera roll.
 */
const MAX_PHOTOS = 12;

/**
 * A professional's own images: the profile photo and the portfolio.
 *
 * Scope is `pro/<id>` rather than a bare id, which keeps every professional's
 * files in one namespace that cannot collide with a partner folder — the two
 * id spaces are independent, and a shared directory root is exactly where that
 * stops being theoretical.
 *
 * Ownership needs no check here beyond existence: unlike the partner-side
 * services, the id is not taken from the request path. It comes from the access
 * token, so the caller IS the subject and there is no other row they could
 * reach.
 */
@Injectable()
export class ProfessionalMediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly images: ImageStorageService,
  ) {}

  private scope(id: string): string {
    return `pro/${id}`;
  }

  private async load(id: string) {
    const pro = await this.prisma.professional.findUnique({ where: { id } });
    if (!pro || pro.deletedAt) throw AppException.notFound('Account not found');
    return pro;
  }

  // ── Profile photo ─────────────────────────────────────────

  async setAvatar(id: string, file: UploadedImage): Promise<PublicProfessional> {
    const existing = await this.load(id);

    const avatarUrl = await this.images.store(this.scope(id), file, IMAGE_PRESETS.avatar);
    const updated = await this.prisma.professional.update({ where: { id }, data: { avatarUrl } });

    // Drop the old photo only after the new one is committed — a failed write
    // must never leave the account with no picture at all.
    if (existing.avatarUrl) await this.images.remove(this.scope(id), existing.avatarUrl);

    return toPublicProfessional(updated);
  }

  async removeAvatar(id: string): Promise<PublicProfessional> {
    const existing = await this.load(id);
    const updated = await this.prisma.professional.update({
      where: { id },
      data: { avatarUrl: '' },
    });
    if (existing.avatarUrl) await this.images.remove(this.scope(id), existing.avatarUrl);
    return toPublicProfessional(updated);
  }

  // ── Portfolio ─────────────────────────────────────────────

  async addPhoto(id: string, file: UploadedImage, label = ''): Promise<PublicProfessional> {
    // Before the cap check, so "that is not an image" wins over "you are full".
    assertImage(file);

    const existing = await this.load(id);
    const photos = readPhotos(existing.photos);
    if (photos.length >= MAX_PHOTOS) {
      throw AppException.badRequest(
        ErrorCode.UPLOAD_FAILED,
        `You can upload up to ${MAX_PHOTOS} photos`,
      );
    }

    const url = await this.images.store(this.scope(id), file, IMAGE_PRESETS.photo);
    const next: ProfilePhoto[] = [...photos, { url, ...(label ? { label: label.slice(0, 80) } : {}) }];

    return this.writePhotos(id, next);
  }

  async removePhoto(id: string, url: string): Promise<PublicProfessional> {
    const existing = await this.load(id);
    const photos = readPhotos(existing.photos);
    const next = photos.filter((p) => p.url !== url);

    // The row is updated first: a file that outlives its reference is litter,
    // while a reference that outlives its file is a broken image on a profile
    // someone is being judged by.
    const updated = await this.writePhotos(id, next);
    if (next.length !== photos.length) await this.images.remove(this.scope(id), url);
    return updated;
  }

  /**
   * Apply a new order, given as the urls in the order they should appear.
   *
   * Anything the client did not mention keeps its relative position at the end
   * rather than being dropped: a reorder request built from a stale list would
   * otherwise silently delete the photo that was uploaded while it was open.
   */
  async reorderPhotos(id: string, urls: string[]): Promise<PublicProfessional> {
    const existing = await this.load(id);
    const photos = readPhotos(existing.photos);
    const byUrl = new Map(photos.map((p) => [p.url, p]));

    const next: ProfilePhoto[] = [];
    for (const url of urls) {
      const photo = byUrl.get(url);
      if (photo) {
        next.push(photo);
        byUrl.delete(url);
      }
    }
    for (const leftover of byUrl.values()) next.push(leftover);

    return this.writePhotos(id, next);
  }

  private async writePhotos(id: string, photos: ProfilePhoto[]): Promise<PublicProfessional> {
    const updated = await this.prisma.professional.update({
      where: { id },
      data: { photos: photos as unknown as Prisma.InputJsonValue },
    });
    return toPublicProfessional(updated);
  }
}
