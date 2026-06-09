import { Injectable } from '@nestjs/common';
import { BookingSource } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { BookingsService } from '@/modules/bookings/bookings.service';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import { computeSlots } from '@/common/utils/availability';
import type { WeekScheduleInput } from '@/common/schemas/week-schedule.schema';
import type { SlotsQueryDto, PublicCreateBookingDto } from './dto/public-booking.dto';

@Injectable()
export class PublicBookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
  ) {}

  /** Available 'HH:MM' start times for a service on a date (optionally for a
   *  specific specialist; otherwise the union across eligible specialists). */
  async slots(slug: string, q: SlotsQueryDto): Promise<string[]> {
    const partner = await this.resolvePartner(slug);
    const service = await this.prisma.service.findFirst({
      where: { id: q.serviceId, partnerId: partner.id, deletedAt: null, active: true },
    });
    if (!service) throw AppException.notFound('Service not found');

    const candidates = await this.eligibleSpecialists(
      partner.id,
      q.serviceId,
      q.specialistId,
      q.locationId,
    );
    if (candidates.length === 0) return [];

    const day = new Date(`${q.date}T00:00:00`);
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);
    const notBefore = isToday(day) ? new Date() : undefined;

    // Per specialist: open window − their time-off − their bookings. Union the
    // resulting slot sets so "any specialist" shows every offerable time.
    const all = new Set<string>();
    for (const sp of candidates) {
      const location = await this.prisma.location.findFirst({
        where: { id: sp.locationId, deletedAt: null },
        select: { hours: true },
      });
      const [timeOff, busy] = await Promise.all([
        this.prisma.specialistTimeOff.findMany({
          where: { specialistId: sp.id, startAt: { lt: dayEnd }, endAt: { gt: day } },
          select: { startAt: true, endAt: true },
        }),
        this.prisma.booking.findMany({
          where: {
            specialistId: sp.id,
            status: { in: ['pending', 'confirmed', 'completed'] },
            startAt: { lt: dayEnd },
            endAt: { gt: day },
          },
          select: { startAt: true, endAt: true },
        }),
      ]);

      for (const slot of computeSlots({
        day,
        durationMin: service.duration,
        specialistSchedule: sp.schedule as WeekScheduleInput | null,
        locationHours: (location?.hours ?? null) as WeekScheduleInput | null,
        timeOff,
        busy,
        notBefore,
      })) {
        all.add(slot);
      }
    }

    return [...all].sort();
  }

  /** Create a booking from the public page (auto-assigns a specialist if none). */
  async createBooking(slug: string, dto: PublicCreateBookingDto) {
    const partner = await this.resolvePartner(slug);

    const candidates = await this.eligibleSpecialists(
      partner.id,
      dto.serviceId,
      dto.specialistId,
      dto.locationId,
    );
    if (candidates.length === 0) {
      throw AppException.badRequest(
        ErrorCode.SERVICE_NOT_OFFERED,
        'No specialist is available for this service',
      );
    }

    const startAt = new Date(`${dto.date}T${dto.time}:00`);

    // Try each eligible specialist until one slot isn't taken (handles the
    // "any specialist" case + races, where the DB overlap guard rejects).
    let lastErr: unknown;
    for (const sp of candidates) {
      try {
        return await this.bookings.create(
          partner.id,
          {
            locationId: sp.locationId,
            specialistId: sp.id,
            serviceId: dto.serviceId,
            clientName: dto.clientName,
            clientPhone: dto.clientPhone,
            startAt,
            notes: dto.notes,
            // Honour the partner's setting: auto-confirm, else leave pending for
            // staff to confirm manually in the backoffice.
            status: partner.autoConfirmBookings ? 'confirmed' : 'pending',
          },
          { source: BookingSource.public },
        );
      } catch (e) {
        if (e instanceof AppException && e.code === ErrorCode.BOOKING_OVERLAP) {
          lastErr = e;
          continue; // try the next specialist
        }
        throw e;
      }
    }
    throw (
      lastErr ??
      AppException.conflict(ErrorCode.BOOKING_OVERLAP, 'That time is no longer available')
    );
  }

  // ── helpers ───────────────────────────────────────────────

  private async resolvePartner(slug: string) {
    const partner = await this.prisma.partner.findFirst({
      where: { slug, active: true, deletedAt: null },
      select: { id: true, autoConfirmBookings: true },
    });
    if (!partner) throw AppException.notFound('Salon not found');
    return partner;
  }

  /** Active specialists at the partner who offer the service (filtered by the
   *  chosen specialist/branch when provided). */
  private async eligibleSpecialists(
    partnerId: string,
    serviceId: string,
    specialistId?: string,
    locationId?: string,
  ) {
    return this.prisma.specialist.findMany({
      where: {
        partnerId,
        deletedAt: null,
        active: true,
        ...(specialistId ? { id: specialistId } : {}),
        ...(locationId ? { locationId } : {}),
        services: { some: { serviceId } },
      },
      select: { id: true, locationId: true, schedule: true },
    });
  }
}

function isToday(day: Date): boolean {
  const now = new Date();
  return (
    day.getFullYear() === now.getFullYear() &&
    day.getMonth() === now.getMonth() &&
    day.getDate() === now.getDate()
  );
}
