import { Controller, Get, Header, Param, Post, Query, Body } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '@/auth/decorators';
import { AreasService } from '@/modules/areas/areas.service';
import { SpecialtiesService } from '@/modules/specialties/specialties.service';
import { VacancyApplicationsService } from '@/modules/vacancies/applications.service';
import { BoardService } from './board.service';
import { BoardQueryDto, ApplyDto } from './dto/board.dto';

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
