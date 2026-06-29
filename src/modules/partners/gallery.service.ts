import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import sharp from 'sharp';

import { PrismaService } from '@/prisma/prisma.service';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import { newId } from '@/common/ids';
import type { Env } from '@/config/env.config';

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
const MAX_DIMENSION = 1600; // px — downscale anything larger
const WEBP_QUALITY = 80;

@Injectable()
export class GalleryService {
  private readonly logger = new Logger(GalleryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private get uploadsDir(): string {
    return resolve(this.config.get('UPLOADS_DIR', { infer: true }));
  }

  /** Public URL base that maps to uploadsDir. Empty env → same-origin /uploads. */
  private get publicBase(): string {
    return this.config.get('UPLOADS_PUBLIC_URL', { infer: true }) || '/uploads';
  }

  /** Build the public URL for a stored file path (partnerId/file.webp). */
  private publicUrl(rel: string): string {
    return `${this.publicBase}/${rel}`;
  }

  /** Which presentation photo list a tile belongs to. */
  // (declared above the methods so callers read clearly)

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

  /**
   * Process + persist an uploaded image: downscale large photos and re-encode to
   * WebP (keeps disk small + the public page fast), write to
   * `<uploadsDir>/<partnerId>/<uuid>.webp`, append to the gallery JSON and return
   * the updated gallery.
   */
  async addImage(
    partnerId: string,
    file: { buffer: Buffer; mimetype: string },
    label = '',
    list: GalleryList = 'gallery',
  ): Promise<GalleryItem[]> {
    if (!file?.buffer?.length) {
      throw AppException.badRequest(ErrorCode.UPLOAD_FAILED, 'No image file was provided');
    }
    if (!file.mimetype?.startsWith('image/')) {
      throw AppException.badRequest(ErrorCode.UPLOAD_FAILED, 'Only image files are allowed');
    }

    const gallery = await this.readGallery(partnerId, list);
    if (gallery.length >= MAX_TILES) {
      throw AppException.badRequest(
        ErrorCode.UPLOAD_FAILED,
        `You can upload up to ${MAX_TILES} images`,
      );
    }

    const url = await this.processAndStore(partnerId, file);
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
    before: { buffer: Buffer; mimetype: string },
    after: { buffer: Buffer; mimetype: string },
    label = '',
    list: GalleryList = 'works',
  ): Promise<GalleryItem[]> {
    if (!before?.buffer?.length || !after?.buffer?.length) {
      throw AppException.badRequest(ErrorCode.UPLOAD_FAILED, 'Both before and after images are required');
    }
    const gallery = await this.readGallery(partnerId, list);
    if (gallery.length >= MAX_TILES) {
      throw AppException.badRequest(ErrorCode.UPLOAD_FAILED, `You can upload up to ${MAX_TILES} images`);
    }
    const beforeUrl = await this.processAndStore(partnerId, before);
    const afterUrl = await this.processAndStore(partnerId, after);
    const next: GalleryItem[] = [
      ...gallery,
      { type: 'beforeAfter', beforeUrl, afterUrl, label: label.slice(0, 80) },
    ];
    await this.writeGallery(partnerId, next, list);
    return next;
  }

  /** Validate, downscale + re-encode to WebP, write to disk, return public URL. */
  private async processAndStore(
    partnerId: string,
    file: { buffer: Buffer; mimetype: string },
  ): Promise<string> {
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
        .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer();
    } catch (err) {
      this.logger.warn(`sharp failed to process upload for ${partnerId}: ${String(err)}`);
      throw AppException.badRequest(ErrorCode.UPLOAD_FAILED, 'That image could not be processed');
    }
    const fileName = `${newId()}.webp`;
    const dir = join(this.uploadsDir, partnerId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, fileName), webp);
    return this.publicUrl(`${partnerId}/${fileName}`);
  }

  /**
   * Remove a tile by its url. Deletes the file from disk too (best-effort — a
   * missing file never blocks the DB update). Returns the updated gallery.
   */
  /** Process + persist a brand logo; store its url on the presentation. */
  async setLogo(
    partnerId: string,
    file: { buffer: Buffer; mimetype: string },
  ): Promise<{ logoUrl: string }> {
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
        .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 90 })
        .toBuffer();
    } catch (err) {
      this.logger.warn(`sharp failed to process logo for ${partnerId}: ${String(err)}`);
      throw AppException.badRequest(ErrorCode.UPLOAD_FAILED, 'That image could not be processed');
    }
    const fileName = `logo-${newId()}.webp`;
    const dir = join(this.uploadsDir, partnerId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, fileName), webp);
    const logoUrl = this.publicUrl(`${partnerId}/${fileName}`);
    await this.prisma.partnerPresentation.upsert({
      where: { partnerId },
      create: { partnerId, logoUrl },
      update: { logoUrl },
    });
    return { logoUrl };
  }

  /** Clear the logo (file best-effort deleted) → falls back to the name initial. */
  async removeLogo(partnerId: string): Promise<{ logoUrl: string }> {
    const pres = await this.prisma.partnerPresentation.findUnique({
      where: { partnerId },
      select: { logoUrl: true },
    });
    const url = pres?.logoUrl ?? '';
    const marker = `/${partnerId}/`;
    const idx = url.lastIndexOf(marker);
    if (idx !== -1) {
      const fileName = url.slice(idx + marker.length);
      if (fileName && !fileName.includes('/') && !fileName.includes('..')) {
        try { await unlink(join(this.uploadsDir, partnerId, fileName)); } catch { /* gone */ }
      }
    }
    await this.prisma.partnerPresentation.update({ where: { partnerId }, data: { logoUrl: '' } });
    return { logoUrl: '' };
  }

  async removeImage(partnerId: string, url: string, list: GalleryList = 'gallery'): Promise<GalleryItem[]> {
    const gallery = await this.readGallery(partnerId, list);
    // A tile matches if the given url is its photo OR either before/after image.
    const matches = (g: GalleryItem) => g.url === url || g.beforeUrl === url || g.afterUrl === url;
    const removed = gallery.filter(matches);
    const next = gallery.filter((g) => !matches(g));

    // Delete every file belonging to the removed tile(s) from this partner's
    // folder (defensive: never let a crafted url escape the partner's directory).
    const marker = `/${partnerId}/`;
    for (const tile of removed) {
      for (const u of [tile.url, tile.beforeUrl, tile.afterUrl]) {
        if (!u) continue;
        const idx = u.lastIndexOf(marker);
        if (idx === -1) continue;
        const fileName = u.slice(idx + marker.length);
        if (fileName && !fileName.includes('/') && !fileName.includes('..')) {
          try {
            await unlink(join(this.uploadsDir, partnerId, fileName));
          } catch {
            /* file already gone — ignore */
          }
        }
      }
    }

    await this.writeGallery(partnerId, next, list);
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
