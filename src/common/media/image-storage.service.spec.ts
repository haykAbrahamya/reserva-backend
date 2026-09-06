import { unlink, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ImageStorageService } from './image-storage.service';
import { IMAGE_PRESETS } from './image-storage.service';

jest.mock('node:fs/promises', () => ({
  unlink: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
}));

const config = (uploadsDir = 'uploads', publicUrl = '') =>
  ({ get: (key: string) => (key === 'UPLOADS_DIR' ? uploadsDir : publicUrl) }) as never;

describe('ImageStorageService', () => {
  const service = new ImageStorageService(config());
  const dir = resolve('uploads');

  beforeEach(() => jest.clearAllMocks());

  describe('remove — the path-traversal guard', () => {
    // Each of these used to be re-implemented per feature. They are the reason
    // this service exists, so they are tested once, here.

    it('deletes a file that really is inside the scope', async () => {
      await service.remove('partner-1', '/uploads/partner-1/av-abc.webp');
      expect(unlink).toHaveBeenCalledWith(join(dir, 'partner-1', 'av-abc.webp'));
    });

    it('ignores a url belonging to a different scope', async () => {
      await service.remove('partner-1', '/uploads/partner-2/av-abc.webp');
      expect(unlink).not.toHaveBeenCalled();
    });

    it('ignores a traversal attempt dressed as a filename', async () => {
      await service.remove('partner-1', '/uploads/partner-1/../../../etc/passwd');
      expect(unlink).not.toHaveBeenCalled();
    });

    it('ignores a nested path inside the scope', async () => {
      await service.remove('partner-1', '/uploads/partner-1/nested/file.webp');
      expect(unlink).not.toHaveBeenCalled();
    });

    it('ignores an empty url rather than unlinking the directory', async () => {
      await service.remove('partner-1', '');
      expect(unlink).not.toHaveBeenCalled();
    });

    it('takes the LAST occurrence, so a scope named inside the host is not spoofed', async () => {
      await service.remove('pro/p1', 'https://cdn.example/pro/p1/uploads/pro/p1/ph-x.webp');
      expect(unlink).toHaveBeenCalledWith(join(dir, 'pro/p1', 'ph-x.webp'));
    });

    it('never throws when the file is already gone', async () => {
      (unlink as jest.Mock).mockRejectedValueOnce(new Error('ENOENT'));
      await expect(service.remove('partner-1', '/uploads/partner-1/gone.webp')).resolves.toBeUndefined();
    });
  });

  describe('store', () => {
    // A 1x1 PNG — small enough to inline, real enough for sharp to decode.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );

    it('writes into the scope directory and returns a same-origin url by default', async () => {
      const url = await service.store('pro/p1', { buffer: png, mimetype: 'image/png' }, IMAGE_PRESETS.avatar);
      expect(mkdir).toHaveBeenCalledWith(join(dir, 'pro/p1'), { recursive: true });
      expect(url).toMatch(/^\/uploads\/pro\/p1\/av-[0-9a-f-]+\.webp$/);
      expect(writeFile).toHaveBeenCalled();
    });

    it('honours UPLOADS_PUBLIC_URL when one is configured', async () => {
      const remote = new ImageStorageService(config('uploads', 'https://api.reserva.am/uploads'));
      const url = await remote.store('p1', { buffer: png, mimetype: 'image/png' }, IMAGE_PRESETS.photo);
      expect(url).toMatch(/^https:\/\/api\.reserva\.am\/uploads\/p1\/ph-/);
    });

    it('rejects a non-image before it reaches sharp', async () => {
      await expect(
        service.store('p1', { buffer: Buffer.from('%PDF-'), mimetype: 'application/pdf' }, IMAGE_PRESETS.photo),
      ).rejects.toMatchObject({ status: 400 });
      expect(writeFile).not.toHaveBeenCalled();
    });

    it('rejects an empty upload', async () => {
      await expect(
        service.store('p1', { buffer: Buffer.alloc(0), mimetype: 'image/png' }, IMAGE_PRESETS.photo),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('turns undecodable bytes into a 400, not a 500', async () => {
      await expect(
        service.store('p1', { buffer: Buffer.from('not an image'), mimetype: 'image/png' }, IMAGE_PRESETS.photo),
      ).rejects.toMatchObject({ status: 400 });
    });
  });
});
