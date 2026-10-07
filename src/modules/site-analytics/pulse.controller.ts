import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '@/auth/decorators';
import { SiteIngestService } from './site-ingest.service';

/**
 * The public site's analytics beacon. The body is ONE base64url string sent as
 * text/plain (see pulse-codec.ts for the format); main.ts reads it as text for
 * this route only, because Nest parses just JSON and urlencoded bodies.
 *
 * Always 204 with no body — valid, invalid, tampered or duplicate alike — so a
 * prober learns nothing about why a payload was dropped. Only the rate limit
 * answers differently. IP and User-Agent are read from the request, used for
 * geo/device and the bot flag, and never stored.
 */
@ApiTags('Public · Site analytics')
@Public()
@Controller('public/pulse')
export class PulseController {
  constructor(private readonly ingest: SiteIngestService) {}

  // A visit flushes a batch every few seconds at most; 60/min/IP leaves room
  // for several tabs behind one NAT while capping a flood.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post()
  @HttpCode(204)
  @ApiOperation({ summary: 'Record a batch of public-site analytics events (encrypted)' })
  @ApiConsumes('text/plain')
  @ApiBody({
    schema: { type: 'string', description: 'base64url(version | nonce | ciphertext | tag)' },
  })
  @ApiNoContentResponse({ description: 'Always — stored, dropped or duplicate alike' })
  async record(@Req() req: Request): Promise<void> {
    await this.ingest.ingest(req.body, req.ip, req.headers['user-agent']);
  }
}
