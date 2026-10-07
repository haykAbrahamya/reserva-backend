import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '@/auth/decorators';
import type { SiteIngestService } from './site-ingest.service';
import { PulseController } from './pulse.controller';

/**
 * The beacon's HTTP contract: public, 204 always, 60 requests / minute / IP.
 * Read from the decorators, so the limit is pinned without flooding a server.
 */
describe('PulseController', () => {
  const handler = PulseController.prototype.record;

  it('is public and answers 204', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, PulseController)).toBe(true);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(204);
  });

  it('is rate-limited to 60 requests per minute', () => {
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(60);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(60_000);
  });

  it('hands the raw body, IP and User-Agent to ingestion and returns nothing', async () => {
    const ingest = { ingest: jest.fn(async () => undefined) };
    const controller = new PulseController(ingest as unknown as SiteIngestService);
    const req = { body: 'AQAB', ip: '203.0.113.7', headers: { 'user-agent': 'UA' } };
    await expect(controller.record(req as never)).resolves.toBeUndefined();
    expect(ingest.ingest).toHaveBeenCalledWith('AQAB', '203.0.113.7', 'UA');
  });
});
