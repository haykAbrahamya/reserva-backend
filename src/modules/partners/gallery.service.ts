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

/** A gallery / works tile. Three shapes:
 *  - simple photo: `{ url }` (older items have no `type` → treated as simple)
 *  - before/after: `{ type: 'beforeAfter', beforeUrl, afterUrl }`
 *  - legacy seed tile: color `tone` + label, no url. */
export interface GalleryItem {
  type?: 'simple' | 'beforeAfter';
  url?: string;
  beforeUrl?: string;
  afterUrl?: string;
  label?: string;
  tone?: string;
}

/** The two independent photo lists on a presentation. */
export type GalleryList = 'gallery' | 'works';

const MAX_TILES = 12;

/**
 * A partner's photo lists.
 *
 * What is left here after the image pipeline moved to ImageStorageService is
 * the part that is genuinely about galleries: the tile shapes, the cap, what a
 * before/after pair means, and how a reorder is applied without losing a tile
 * the client did not mention.
 */
@Injectable()
export class GalleryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly images: ImageStorageService,
  ) {}

  private async readGallery(partnerId: string, list: GalleryList = 'gallery'): Promise<GalleryItem[]> {
    const pres = await this.prisma.partnerPresentation.findUnique({
      where: { partnerId },
      select: { gallery: true, works: true },
    });
    const raw = (pres?.[list] as unknown as GalleryItem[] | null) ?? [];
    return Array.isArray(raw) ? raw : [];
  }

  private async writeGallery(partnerId: string, items: GalleryItem[], list: GalleryList = 'gallery') {
    const value = items as unknown as Prisma.InputJsonValue;
    await this.prisma.partnerPresentation.upsert({
      where: { partnerId },
      create: { partnerId, [list]: value },
      update: { [list]: value },
    });
  }

  /** Reject a write that would take a list past its cap. */
  private assertRoom(gallery: GalleryItem[]) {
    if (gallery.length >= MAX_TILES) {
      throw AppException.badRequest(
        ErrorCode.UPLOAD_FAILED,
        `You can upload up to ${MAX_TILES} images`,
      );
    }
  }

  /**
   * Process + persist an uploaded image, append it to the list and return the
   * updated list.
   */
  async addImage(
    partnerId: string,
    file: UploadedImage,
    label = '',
    list: GalleryList = 'gallery',
  ): Promise<GalleryItem[]> {
    // Checked before the cap so "that is not an image" wins over "you are full"
    // — the more useful of the two messages when both are true.
    assertImage(file);

    const gallery = await this.readGallery(partnerId, list);
    this.assertRoom(gallery);

    const url = await this.images.store(partnerId, file, IMAGE_PRESETS.photo);
    const next: GalleryItem[] = [...gallery, { type: 'simple', url, label: label.slice(0, 80) }];
    await this.writeGallery(partnerId, next, list);
    return next;
  }

  /**
   * Add a before/after "works" tile: process both images and store them as one
   * tile `{ type: 'beforeAfter', beforeUrl, afterUrl }` so the public page can
   * render a draggable comparison slider.
   */
  async addBeforeAfter(
    partnerId: string,
    before: UploadedImage,
    after: UploadedImage,
    label = '',
    list: GalleryList = 'works',
  ): Promise<GalleryItem[]> {
    if (!before?.buffer?.length || !after?.buffer?.length) {
      throw AppException.badRequest(
        ErrorCode.UPLOAD_FAILED,
        'Both before and after images are required',
      );
    }
    const gallery = await this.readGallery(partnerId, list);
    this.assertRoom(gallery);

    const beforeUrl = await this.images.store(partnerId, before, IMAGE_PRESETS.photo);
    const afterUrl = await this.images.store(partnerId, after, IMAGE_PRESETS.photo);
    const next: GalleryItem[] = [
      ...gallery,
      { type: 'beforeAfter', beforeUrl, afterUrl, label: label.slice(0, 80) },
    ];
    await this.writeGallery(partnerId, next, list);
    return next;
  }

  /** Process + persist a brand logo; store its url on the presentation. */
  async setLogo(partnerId: string, file: UploadedImage): Promise<{ logoUrl: string }> {
    const existing = await this.prisma.partnerPresentation.findUnique({
      where: { partnerId },
      select: { logoUrl: true },
    });

    const logoUrl = await this.images.store(partnerId, file, IMAGE_PRESETS.logo);
    await this.prisma.partnerPresentation.upsert({
      where: { partnerId },
      create: { partnerId, logoUrl },
      update: { logoUrl },
    });

    // Drop the old mark only after the new one is committed.
    if (existing?.logoUrl) await this.images.remove(partnerId, existing.logoUrl);

    return { logoUrl };
  }

  /** Clear the logo (file best-effort deleted) → falls back to the name initial. */
  async removeLogo(partnerId: string): Promise<{ logoUrl: string }> {
    const pres = await this.prisma.partnerPresentation.findUnique({
      where: { partnerId },
      select: { logoUrl: true },
    });
    await this.prisma.partnerPresentation.update({ where: { partnerId }, data: { logoUrl: '' } });
    if (pres?.logoUrl) await this.images.remove(partnerId, pres.logoUrl);
    return { logoUrl: '' };
  }

  /**
   * Remove a tile by its url. Deletes the file(s) from disk too (best-effort — a
   * missing file never blocks the DB update). Returns the updated list.
   */
  async removeImage(
    partnerId: string,
    url: string,
    list: GalleryList = 'gallery',
  ): Promise<GalleryItem[]> {
    const gallery = await this.readGallery(partnerId, list);
    // A tile matches if the given url is its photo OR either before/after image.
    const matches = (g: GalleryItem) => g.url === url || g.beforeUrl === url || g.afterUrl === url;
    const removed = gallery.filter(matches);
    const next = gallery.filter((g) => !matches(g));

    await this.writeGallery(partnerId, next, list);

    // Every file belonging to the removed tile(s). `removeMany` is scoped to
    // this partner's folder, so a crafted url cannot reach outside it.
    for (const tile of removed) {
      await this.images.removeMany(partnerId, [tile.url, tile.beforeUrl, tile.afterUrl]);
    }

    return next;
  }

  /**
   * Reorder a photo list to the given list of urls (drag-to-reorder in the UI).
   * Matches a tile by its url OR its beforeUrl (before/after tiles). Unknown urls
   * are dropped; un-keyed tiles (legacy tone-only) are appended.
   */
  async reorder(partnerId: string, urls: string[], list: GalleryList = 'gallery'): Promise<GalleryItem[]> {
    const gallery = await this.readGallery(partnerId, list);
    const keyOf = (g: GalleryItem) => g.url ?? g.beforeUrl;
    const byKey = new Map(gallery.filter((g) => keyOf(g)).map((g) => [keyOf(g)!, g]));
    const next: GalleryItem[] = [];
    for (const u of urls) {
      const item = byKey.get(u);
      if (item) {
        next.push(item);
        byKey.delete(u);
      }
    }
    // Append any tiles not mentioned (e.g. legacy tone-only tiles) so nothing is
    // silently lost.
    for (const leftover of byKey.values()) next.push(leftover);
    for (const g of gallery) if (!keyOf(g)) next.push(g);

    await this.writeGallery(partnerId, next, list);
    return next;
  }
}
