import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { SalonsService } from './salons.service';
import { Public } from '@/auth/decorators';
import { SalonSearchDto } from './dto/salons.dto';

const SITE = 'https://reserva.am';

/**
 * Public marketplace directory (reserva.am/salons). Unauthenticated; lists the
 * curated, listed salons with optional search. Open to the internet, so rate
 * limited a touch tighter than authenticated routes.
 */
@ApiTags('Public marketplace')
@Public()
@Controller('public/salons')
export class SalonsController {
  constructor(private readonly salons: SalonsService) {}

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get()
  @ApiOperation({ summary: 'List marketplace salons (with optional search)' })
  list(@Query() q: SalonSearchDto) {
    return this.salons.list(q);
  }

  /**
   * Dynamic sitemap: static marketing routes + every publicly-listed salon page,
   * so Google discovers and indexes all salon pages. Served as raw XML (writes
   * to res directly to bypass the JSON transform interceptor).
   */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('sitemap.xml')
  @ApiOperation({ summary: 'XML sitemap of marketing pages + all salon pages' })
  async sitemap(@Res() res: Response) {
    const slugs = await this.salons.sitemapSlugs();
    const today = new Date().toISOString().slice(0, 10);

    // No trailing slashes (except root): the SPA serves /salons & /signup
    // WITHOUT a trailing slash and the runtime canonical points there, so the
    // sitemap URL must match exactly — otherwise Google reports the crawled
    // slashed URL as an "Alternate page with proper canonical tag".
    const staticUrls = [
      { loc: `${SITE}/`, priority: '1.0', changefreq: 'weekly' },
      { loc: `${SITE}/salons`, priority: '0.9', changefreq: 'daily' },
      { loc: `${SITE}/signup`, priority: '0.7', changefreq: 'monthly' },
    ];

    const urls = [
      ...staticUrls.map(
        (u) =>
          `  <url><loc>${u.loc}</loc><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`,
      ),
      ...slugs.map(
        (slug) =>
          `  <url><loc>${SITE}/p/${encodeURIComponent(slug)}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`,
      ),
    ].join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

    res.set('Content-Type', 'application/xml');
    res.send(xml);
  }
}
