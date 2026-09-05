import { Controller, Get, Header, Param, Post, Query, Body, Res } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '@/auth/decorators';
import { AreasService } from '@/modules/areas/areas.service';
import { SpecialtiesService } from '@/modules/specialties/specialties.service';
import { VacancyApplicationsService } from '@/modules/vacancies/applications.service';
import { BoardService } from './board.service';
import { BoardQueryDto, ApplyDto } from './dto/board.dto';

/**
 * The board's public origin, for absolute sitemap URLs.
 *
 * A sitemap must state full URLs and the API is on a different host from the
 * site it describes, so this cannot be derived from the request. Overridable
 * for a staging host; the same convention as SITE in the salons controller.
 */
const SITE = process.env.VACANCIES_URL || 'https://vacancies.reserva.am';

/**
 * The public vacancies board — everything vacancies.reserva.am reads.
 *
 * Entirely unauthenticated: there are no professional accounts yet, so a job
 * seeker is an anonymous visitor from a search engine. That makes this the most
 * exposed surface in the product, hence three deliberate choices:
 *
 *  - it is a separate controller from `public/*` (the salon booking surface),
 *    so the vacancies app talks to one prefix and nothing else
 *  - reads carry cache headers, because a board is read thousands of times
 *    between writes and a CDN in front of it should be allowed to help
 *  - the catalogs are served from HERE rather than by relaxing the
 *    authenticated `/areas` and `/specialties` endpoints, which belong to the
 *    backoffice. Two consumers, two contracts, no widened auth.
 */
@ApiTags('Vacancies board (public)')
@Public()
@Controller('board')
export class BoardController {
  constructor(
    private readonly board: BoardService,
    private readonly areas: AreasService,
    private readonly specialties: SpecialtiesService,
    private readonly applications: VacancyApplicationsService,
  ) {}

  /**
   * Everything the filter panel needs, in one request: the area tree, the
   * specialty taxonomy, the facet counts and the real money bounds.
   *
   * One call rather than four because the panel cannot render usefully with
   * three quarters of it — a filter whose options arrive one list at a time
   * reflows under the visitor's cursor.
   */
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Header('Cache-Control', 'public, max-age=120, stale-while-revalidate=600')
  @Get('meta')
  @ApiOperation({ summary: 'Filter options, taxonomies and facet counts' })
  async meta() {
    const [facets, areas, specialties] = await Promise.all([
      this.board.meta(),
      this.areas.catalog(),
      this.specialties.catalog(),
    ]);
    return { ...facets, areaTree: areas, specialtyGroups: specialties };
  }

  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Header('Cache-Control', 'public, max-age=30, stale-while-revalidate=120')
  @Get('vacancies')
  @ApiOperation({ summary: 'Search the board' })
  list(@Query() q: BoardQueryDto) {
    return this.board.list(q);
  }

  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  @Get('vacancies/:id')
  @ApiOperation({ summary: 'One listing, with more from the same salon' })
  get(@Param('id') id: string) {
    return this.board.get(id);
  }

  /**
   * The listings sitemap for vacancies.reserva.am.
   *
   * Served from HERE rather than shipped as a file with the frontend, because
   * only the database knows which listings are live right now. The board's
   * static sitemap covers the pages that do not change between deploys (the
   * board itself and its keyword landing pages); this covers the ones that
   * change hourly. Both are declared in the site's robots.txt.
   *
   * Cross-host on purpose, which is allowed: a sitemap named in robots.txt may
   * live on another host, and this one is the only place the answer exists.
   *
   * Written to `res` directly to bypass the JSON transform interceptor — the
   * same arrangement as the salons sitemap.
   */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('sitemap.xml')
  @ApiOperation({ summary: 'XML sitemap of every live listing' })
  async sitemap(@Res() res: Response) {
    const rows = await this.board.sitemapEntries();

    const urls = rows
      .map(
        (row) =>
          `  <url><loc>${SITE}/v/${encodeURIComponent(row.id)}</loc>` +
          `<lastmod>${row.updatedAt.toISOString().slice(0, 10)}</lastmod>` +
          `<changefreq>daily</changefreq><priority>0.8</priority></url>`,
      )
      .join('\n');

    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

    res.set('Content-Type', 'application/xml');
    res.set('Cache-Control', 'public, max-age=600, stale-while-revalidate=3600');
    res.send(xml);
  }

  /**
   * Apply.
   *
   * Rate limited hard: it is an unauthenticated write that creates work for a
   * real salon, so five a minute per address is generous for a person and
   * useless for a script. De-duplication by phone does the rest.
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('vacancies/:id/apply')
  @ApiOperation({ summary: 'Apply to a listing (name + phone, no account)' })
  apply(@Param('id') id: string, @Body() dto: ApplyDto) {
    return this.applications.applyFromBoard(id, dto);
  }
}
