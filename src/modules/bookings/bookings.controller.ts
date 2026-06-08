import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BookingSource } from '@prisma/client';
import { BookingsService } from './bookings.service';
import { CurrentUser } from '@/auth/decorators';
import type { AuthUser } from '@/auth/auth.types';
import {
  ListBookingsQueryDto,
  CreateBookingDto,
  UpdateBookingDto,
  UpdateStatusDto,
} from './dto/booking.dto';
import { RAW_RESPONSE } from '@/common/interceptors/transform.interceptor';

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
  calendar(
    @CurrentUser() user: AuthUser,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.bookings.calendar(user.partnerId, new Date(from), new Date(to), user.locationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a booking' })
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookings.get(user.partnerId, id, user.locationId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a booking (backoffice)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBookingDto) {
    return this.bookings.create(user.partnerId, dto, {
      source: BookingSource.backoffice,
      createdById: user.id,
    });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Reschedule / reassign a booking' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateBookingDto) {
    return this.bookings.update(user.partnerId, id, dto, user.locationId);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Change booking status (confirm, complete, cancel, no-show)' })
  setStatus(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateStatusDto) {
    return this.bookings.setStatus(user.partnerId, id, dto.status, user.locationId);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a booking' })
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.bookings.remove(user.partnerId, id, user.locationId);
  }
}
