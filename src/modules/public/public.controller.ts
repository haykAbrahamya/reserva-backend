import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PublicBookingService } from './public-booking.service';
import { PublicCoursesService } from './public-courses.service';
import { PartnersService } from '@/modules/partners/partners.service';
import { Public } from '@/auth/decorators';
import {
  SlotsQueryDto,
  AvailabilitySummaryQueryDto,
  PublicCreateBookingDto,
} from './dto/public-booking.dto';
import { PublicCourseRegisterDto } from './dto/public-course.dto';

/**
 * Unauthenticated, public-facing booking surface for the client app
 * (reserva.am/p/:slug). Tighter rate limiting since it's open to the internet.
 */
@ApiTags('Public booking')
@Public()
@Controller('public/partners/:slug')
export class PublicController {
  constructor(
    private readonly publicBooking: PublicBookingService,
    private readonly publicCourses: PublicCoursesService,
    private readonly partners: PartnersService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Public partner profile + catalog for the booking page' })
  partner(@Param('slug') slug: string) {
    return this.partners.getPublicBySlug(slug);
  }

  @Get('slots')
  @ApiOperation({ summary: 'Available time slots for a service on a date' })
  slots(@Param('slug') slug: string, @Query() q: SlotsQueryDto) {
    return this.publicBooking.slots(slug, q);
  }

  @Get('availability-summary')
  @ApiOperation({ summary: 'Per-day availability density for the booking day-strip' })
  availabilitySummary(@Param('slug') slug: string, @Query() q: AvailabilitySummaryQueryDto) {
    return this.publicBooking.availabilitySummary(slug, q);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('bookings')
  @ApiOperation({ summary: 'Create a booking from the public page' })
  create(@Param('slug') slug: string, @Body() dto: PublicCreateBookingDto) {
    return this.publicBooking.createBooking(slug, dto);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('courses/register')
  @ApiOperation({ summary: 'Register for a course from the public page (pending)' })
  registerForCourse(@Param('slug') slug: string, @Body() dto: PublicCourseRegisterDto) {
    return this.publicCourses.register(slug, dto);
  }
}
