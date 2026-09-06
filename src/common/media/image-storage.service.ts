import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import sharp from 'sharp';

import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import { newId } from '@/common/ids';
import type { Env } from '@/config/env.config';

/** An uploaded file as multer hands it over. */
export interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
}

/**
 * How an image should be re-encoded before it is stored.
 *
 * `cover` crops to fill an exact square (avatars, which are always rendered in
 * a circle — letterboxing one looks broken). `inside` fits within a box and
 * never enlarges (photos and logos, where the original aspect ratio is the
 * point).
 */
export interface ImagePreset {
  width: number;
  height: number;
  fit: 'cover' | 'inside';
  quality: number;
  /** Filename prefix, so a directory listing says what a file is. */
  prefix?: string;
}

export const IMAGE_PRESETS = {
  /** Shown in a circle at modest sizes; 512² is crisp everywhere and stays small. */
  avatar: { width: 512, height: 512, fit: 'cover', quality: 88, prefix: 'av' },
  /** Gallery / portfolio photography. */
  photo: { width: 1600, height: 1600, fit: 'inside', quality: 80, prefix: 'ph' },
  /** Brand marks: small, but quality matters more than bytes. */
  logo: { width: 512, height: 512, fit: 'inside', quality: 90, prefix: 'logo' },
  /** Wide banner cards — a landscape crop that stays crisp on retina. */
  courseCover: { width: 1280, height: 720, fit: 'cover', quality: 82, prefix: 'course' },
} as const satisfies Record<string, ImagePreset>;

/**
 * One place where an uploaded image becomes a file on disk and a public URL.
 *
 * This existed three times before it existed once: GalleryService,
 * SpecialistAvatarService and CourseCoverService each carried their own copy of
 * validate → `sharp` → WebP → `<uploadsDir>/<scope>/<id>.webp`, plus their own
 * copy of the delete-by-marker routine that stops a crafted URL from unlinking
 * a file outside its own folder. Three copies of a path-traversal guard is two
 * too many: a fix to one of them is a fix to one of them.
 *
 * What stays with the callers is what is genuinely theirs — which record the
 * URL is written to, how many tiles a list may hold, what a before/after pair
 * means. This owns bytes and paths, and nothing else.
 */
@Injectable()
export class ImageStorageService {
  private readonly logger = new Logger(ImageStorageService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  private get uploadsDir(): string {
    return resolve(this.config.get('UPLOADS_DIR', { infer: true }));
  }

  /** Public base URL that maps to uploadsDir. Empty env → same-origin /uploads. */
  private get publicBase(): string {
    return this.config.get('UPLOADS_PUBLIC_URL', { infer: true }) || '/uploads';
  }

  /**
   * Validate, re-encode and write one image. Returns its public URL.
   *
   * `scope` is the directory the file lands in and the only folder a later
   * `remove` for that scope can touch — a partner id, or `pro/<id>` for a
   * professional's own files. Callers pass an id they have already
   * authorized; this makes no ownership decisions of its own.
   */
  async store(scope: string, file: UploadedImage, preset: ImagePreset): Promise<string> {
    assertImage(file);

    let webp: Buffer;
    try {
      webp = await sharp(file.buffer)
        // Honor EXIF orientation: a phone photo is otherwise stored sideways.
        .rotate()
        .resize(preset.width, preset.height, {
          fit: preset.fit,
          // `attention` crops toward the busiest region, which on a portrait is
          // reliably the face.
          ...(preset.fit === 'cover' ? { position: 'attention' } : { withoutEnlargement: true }),
        })
        .webp({ quality: preset.quality })
        .toBuffer();
    } catch (err) {
      this.logger.warn(`sharp failed to process an upload for ${scope}: ${String(err)}`);
      throw AppException.badRequest(ErrorCode.UPLOAD_FAILED, 'That image could not be processed');
    }

    const fileName = `${preset.prefix ? `${preset.prefix}-` : ''}${newId()}.webp`;
    const dir = join(this.uploadsDir, scope);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, fileName), webp);

    return `${this.publicBase}/${scope}/${fileName}`;
  }

  /**
   * Best-effort delete of a file this service stored. Never throws.
   *
   * A missing file must not block the database update that is removing its
   * reference — the failure mode to avoid is a row that still points at an
   * image nobody can delete, not a stray byte on disk.
   *
   * The URL is trusted only for the part AFTER `/<scope>/`, and only if that
   * part is a bare filename. Anything else — a different scope, a nested path,
   * a `..` — is ignored rather than resolved, so a URL from a request body can
   * never reach outside the folder it claims to be in.
   */
  async remove(scope: string, url: string): Promise<void> {
    const fileName = this.fileNameWithin(scope, url);
    if (!fileName) return;
    try {
      await unlink(join(this.uploadsDir, scope, fileName));
    } catch {
      /* already gone — ignore */
    }
  }

  /** `remove` for several URLs, each independently guarded. */
  async removeMany(scope: string, urls: (string | undefined)[]): Promise<void> {
    for (const url of urls) {
      if (url) await this.remove(scope, url);
    }
  }

  /** The bare filename a URL refers to inside `scope`, or null if it is not one. */
  private fileNameWithin(scope: string, url: string): string | null {
    if (!url) return null;
    const marker = `/${scope}/`;
    const idx = url.lastIndexOf(marker);
    if (idx === -1) return null;
    const fileName = url.slice(idx + marker.length);
    if (!fileName || fileName.includes('/') || fileName.includes('..')) return null;
    return fileName;
  }
}

/** The two rejections every upload path made on its own, now made once. */
export function assertImage(file: UploadedImage | undefined): asserts file is UploadedImage {
  if (!file?.buffer?.length) {
    throw AppException.badRequest(ErrorCode.UPLOAD_FAILED, 'No image file was provided');
  }
  if (!file.mimetype?.startsWith('image/')) {
    throw AppException.badRequest(ErrorCode.UPLOAD_FAILED, 'Only image files are allowed');
  }
}
