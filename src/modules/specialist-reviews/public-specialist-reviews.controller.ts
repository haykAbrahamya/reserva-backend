import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SpecialistReviewsService } from './specialist-reviews.service';
import { Public } from '@/auth/decorators';
import {
  CreateSpecialistReviewDto,
  ListSpecialistReviewsDto,
} from './dto/specialist-review.dto';

/**
 * Public review surface for the booking page. Anyone can read a specialist's
 * reviews and submit one (no auth). Rate-limited since it's open to the internet.
 */
@ApiTags('Public booking')
@Public()
@Controller('public/partners/:slug/specialists/:specialistId/reviews')
export class PublicSpecialistReviewsController {
  constructor(private readonly reviews: SpecialistReviewsService) {}

  @Get()
  @ApiOperation({ summary: "A specialist's public reviews (paginated, newest first)" })
  list(
    @Param('specialistId') specialistId: string,
    @Query() query: ListSpecialistReviewsDto,
  ) {
    return this.reviews.listPublic(specialistId, { cursor: query.cursor, take: query.take });
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  @ApiOperation({ summary: 'Leave a public review for a specialist' })
  create(
    @Param('slug') slug: string,
    @Param('specialistId') specialistId: string,
    @Body() dto: CreateSpecialistReviewDto,
  ) {
    return this.reviews.createPublic(slug, specialistId, dto);
  }
}
