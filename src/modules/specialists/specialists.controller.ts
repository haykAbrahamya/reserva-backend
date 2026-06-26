import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SpecialistsService } from './specialists.service';
import { TimeOffService } from './time-off.service';
import { SpecialistReviewsService } from '@/modules/specialist-reviews/specialist-reviews.service';
import { CurrentUser } from '@/auth/decorators';
import type { AuthUser } from '@/auth/auth.types';
import {
  CreateSpecialistDto,
  UpdateSpecialistDto,
  ListSpecialistQueryDto,
} from './dto/specialist.dto';
import { CreateTimeOffDto, UpdateTimeOffDto } from './dto/time-off.dto';

@ApiTags('Specialists')
@ApiBearerAuth()
@Controller('specialists')
export class SpecialistsController {
  constructor(
    private readonly specialists: SpecialistsService,
    private readonly timeOff: TimeOffService,
    private readonly reviews: SpecialistReviewsService,
  ) {}

  // ── Specialists ───────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: "List the partner's specialists" })
  list(@CurrentUser() user: AuthUser, @Query() q: ListSpecialistQueryDto) {
    return this.specialists.list(user.partnerId, q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specialist' })
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.specialists.get(user.partnerId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a specialist' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSpecialistDto) {
    return this.specialists.create(user.partnerId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a specialist (services, schedule, etc.)' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateSpecialistDto) {
    return this.specialists.update(user.partnerId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-delete a specialist' })
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.specialists.remove(user.partnerId, id);
  }

  // ── Reviews (nested under a specialist) ───────────────────

  @Get(':id/reviews')
  @ApiOperation({ summary: "List a specialist's reviews" })
  listReviews(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.reviews.listForPartner(user.partnerId, id);
  }

  @Delete(':id/reviews/:reviewId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a review from a specialist' })
  async removeReview(
    @CurrentUser() user: AuthUser,
    @Param('id') _id: string,
    @Param('reviewId') reviewId: string,
  ) {
    await this.reviews.deleteForPartner(user.partnerId, reviewId);
  }

  // ── Time off (nested under a specialist) ──────────────────

  @Get(':id/time-off')
  @ApiOperation({ summary: 'List a specialist’s time-off entries' })
  listTimeOff(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.timeOff.list(user.partnerId, id);
  }

  @Get(':id/time-off/conflicts')
  @ApiOperation({ summary: 'Bookings that would conflict with a prospective time-off window' })
  conflicts(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('startAt') startAt: string,
    @Query('endAt') endAt: string,
  ) {
    return this.timeOff.findConflicts(user.partnerId, id, new Date(startAt), new Date(endAt));
  }

  @Post(':id/time-off')
  @ApiOperation({ summary: 'Add time off (rejects on booking conflicts unless force=true)' })
  createTimeOff(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CreateTimeOffDto) {
    return this.timeOff.create(user.partnerId, id, dto, user.id);
  }

  @Patch(':id/time-off/:timeOffId')
  @ApiOperation({ summary: 'Update a time-off entry' })
  updateTimeOff(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('timeOffId') timeOffId: string,
    @Body() dto: UpdateTimeOffDto,
  ) {
    return this.timeOff.update(user.partnerId, id, timeOffId, dto);
  }

  @Delete(':id/time-off/:timeOffId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a time-off entry' })
  async removeTimeOff(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('timeOffId') timeOffId: string,
  ) {
    await this.timeOff.remove(user.partnerId, id, timeOffId);
  }
}
