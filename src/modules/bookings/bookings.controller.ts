import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BookingSource } from '@prisma/client';
import { BookingsService } from './bookings.service';
import { CurrentUser } from '@/auth/decorators';
import type { AuthUser } from '@/auth/auth.types';
import { AppException } from '@/common/errors/app.exception';
import {
  ListBookingsQueryDto,
  CalendarQueryDto,
  BookingSlotsQueryDto,
  BookingQuoteQueryDto,
  BusyElsewhereQueryDto,
  CreateBookingDto,
  UpdateBookingDto,
  UpdateStatusDto,
  SetFinalPriceDto,
} from './dto/booking.dto';
import { RAW_RESPONSE } from '@/common/interceptors/transform.interceptor';

/**
 * A manager works at one branch: they may only look up times and book there.
 * Reads and edits of existing bookings are scoped in the service (by the
 * booking's branch); these two take the branch from the request, so they are
 * checked here.
 */
function assertOwnBranch(user: AuthUser, locationId: string) {
  if (user.locationId && user.locationId !== locationId) {
    throw AppException.forbidden('You can only book at your own branch');
  }
}

@ApiTags('Bookings')
@ApiBearerAuth()
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  @ApiOperation({ summary: 'List bookings (filters: status, specialist, date range, search)' })
  async list(@CurrentUser() user: AuthUser, @Query() q: ListBookingsQueryDto) {
    const result = await this.bookings.list(user.partnerId, q, user.locationId);
    return { ...result, [RAW_RESPONSE]: true as const };
  }

  @Get('calendar')
  @ApiOperation({ summary: 'Bookings in a date window for the calendar view' })
  calendar(@CurrentUser() user: AuthUser, @Query() q: CalendarQueryDto) {
    return this.bookings.calendar(user.partnerId, q.from, q.to, user.locationId);
  }

  @Get('slots')
  @ApiOperation({ summary: 'Bookable start times for a service on a date (backoffice pickers)' })
  slots(@CurrentUser() user: AuthUser, @Query() q: BookingSlotsQueryDto) {
    assertOwnBranch(user, q.locationId);
    return this.bookings.slots(user.partnerId, q);
  }

  @Get('quote')
  @ApiOperation({ summary: 'Price and duration a booking would get (service at a branch, ± specialist)' })
  quote(@CurrentUser() user: AuthUser, @Query() q: BookingQuoteQueryDto) {
    return this.bookings.quote(user.partnerId, q);
  }

  @Get('busy-elsewhere')
  @ApiOperation({ summary: "This branch's specialists' bookings at OTHER branches (no client details)" })
  busyElsewhere(@CurrentUser() user: AuthUser, @Query() q: BusyElsewhereQueryDto) {
    return this.bookings.busyElsewhere(user.partnerId, q.from, q.to, user.locationId ?? q.locationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a booking' })
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookings.get(user.partnerId, id, user.locationId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a booking (backoffice)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBookingDto) {
    assertOwnBranch(user, dto.locationId);
    return this.bookings.create(user.partnerId, dto, {
      source: BookingSource.backoffice,
      createdById: user.id,
    });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Reschedule / reassign a booking' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateBookingDto) {
    return this.bookings.update(user.partnerId, id, dto, user.locationId, user.id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Change booking status (confirm, complete, cancel, no-show)' })
  setStatus(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateStatusDto) {
    return this.bookings.setStatus(user.partnerId, id, dto.status, user.locationId, user.id, dto.finalPrice);
  }

  @Patch(':id/final-price')
  @ApiOperation({ summary: 'Set/correct the exact charged price for a range-priced booking' })
  setFinalPrice(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SetFinalPriceDto) {
    return this.bookings.setFinalPrice(user.partnerId, id, dto.finalPrice, user.locationId);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a booking' })
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.bookings.remove(user.partnerId, id, user.locationId);
  }
}
