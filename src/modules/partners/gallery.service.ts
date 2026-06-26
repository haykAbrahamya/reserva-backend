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

/** A gallery tile. New tiles carry an uploaded image `url`; older seed tiles may
 *  carry only a color `tone` + label. */
export interface GalleryItem {
  url?: string;
  label?: string;
  tone?: string;
}

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

  private async readGallery(partnerId: string): Promise<GalleryItem[]> {
    const pres = await this.prisma.partnerPresentation.findUnique({
      where: { partnerId },
      select: { gallery: true },
    });
    const raw = (pres?.gallery as unknown as GalleryItem[] | null) ?? [];
    return Array.isArray(raw) ? raw : [];
  }

  private async writeGallery(partnerId: string, gallery: GalleryItem[]) {
    await this.prisma.partnerPresentation.upsert({
      where: { partnerId },
      create: { partnerId, gallery: gallery as unknown as Prisma.InputJsonValue },
      update: { gallery: gallery as unknown as Prisma.InputJsonValue },
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
  ): Promise<GalleryItem[]> {
    if (!file?.buffer?.length) {
      throw AppException.badRequest(ErrorCode.UPLOAD_FAILED, 'No image file was provided');
    }
    if (!file.mimetype?.startsWith('image/')) {
      throw AppException.badRequest(ErrorCode.UPLOAD_FAILED, 'Only image files are allowed');
    }

    const gallery = await this.readGallery(partnerId);
    if (gallery.length >= MAX_TILES) {
      throw AppException.badRequest(
        ErrorCode.UPLOAD_FAILED,
        `You can upload up to ${MAX_TILES} images`,
      );
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

    const rel = `${partnerId}/${fileName}`;
    const next = [...gallery, { url: this.publicUrl(rel), label: label.slice(0, 80) }];
    await this.writeGallery(partnerId, next);
    return next;
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

  async removeImage(partnerId: string, url: string): Promise<GalleryItem[]> {
    const gallery = await this.readGallery(partnerId);
    const next = gallery.filter((g) => g.url !== url);

    // Only delete the file if it belonged to this partner's folder (defensive:
    // never let a crafted url escape the partner's directory).
    const marker = `/${partnerId}/`;
    const idx = url.lastIndexOf(marker);
    if (idx !== -1) {
      const fileName = url.slice(idx + marker.length);
      if (fileName && !fileName.includes('/') && !fileName.includes('..')) {
        try {
          await unlink(join(this.uploadsDir, partnerId, fileName));
        } catch {
          /* file already gone — ignore */
        }
      }
    }

    await this.writeGallery(partnerId, next);
    return next;
  }

  /**
   * Reorder the gallery to the given list of urls (drag-to-reorder in the UI).
   * Only known urls are kept, in the order provided; unknown urls are dropped.
   */
  async reorder(partnerId: string, urls: string[]): Promise<GalleryItem[]> {
    const gallery = await this.readGallery(partnerId);
    const byUrl = new Map(gallery.filter((g) => g.url).map((g) => [g.url!, g]));
    const next: GalleryItem[] = [];
    for (const u of urls) {
      const item = byUrl.get(u);
      if (item) {
        next.push(item);
        byUrl.delete(u);
      }
    }
    // Append any tiles not mentioned (e.g. legacy tone-only tiles) so nothing is
    // silently lost.
    for (const leftover of byUrl.values()) next.push(leftover);
    for (const g of gallery) if (!g.url) next.push(g);

    await this.writeGallery(partnerId, next);
    return next;
  }
}
