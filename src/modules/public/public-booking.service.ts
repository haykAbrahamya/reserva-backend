import { Injectable } from '@nestjs/common';
import { BookingSource } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { BookingsService } from '@/modules/bookings/bookings.service';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import {
  computeSlots,
  computeCapacitySlots,
  slotCountToDots,
  openWindowForDate,
} from '@/common/utils/availability';
import type { WeekScheduleInput } from '@/common/schemas/week-schedule.schema';
import type {
  SlotsQueryDto,
  AvailabilitySummaryQueryDto,
  PublicCreateBookingDto,
} from './dto/public-booking.dto';

/** One day's availability signal for the booking page day-strip. */
export interface PublicDayAvailability {
  /** yyyy-mm-dd (local salon day). */
  date: string;
  /** The venue/specialists are all closed this day. */
  closed: boolean;
  /** Slot-density bucket 0–3 → dots under the day chip. */
  openDots: 0 | 1 | 2 | 3;
}

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

    const day = new Date(`${q.date}T00:00:00`);
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);
    const notBefore = isToday(day) ? new Date() : undefined;

    // ── Facility / entry service (spa): location hours + capacity, no specialist.
    if (!service.requiresSpecialist) {
      return this.facilitySlots(partner.id, service, q.locationId, day, dayEnd, notBefore);
    }

    const candidates = await this.eligibleSpecialists(
      partner.id,
      q.serviceId,
      q.specialistId,
      q.locationId,
    );
    if (candidates.length === 0) return [];

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

  /**
   * Per-day availability for the booking page day-strip over an N-day window.
   * Mirrors {@link slots} (same open-window − time-off − bookings − past logic
   * via the shared engine) but for a range, and returns a compact density bucket
   * per day instead of full slot lists.
   *
   * Batched: bookings and time-off for the whole window are fetched in one query
   * each (grouped in memory), so cost is O(1) round-trips, not O(days).
   */
  async availabilitySummary(
    slug: string,
    q: AvailabilitySummaryQueryDto,
  ): Promise<PublicDayAvailability[]> {
    const partner = await this.resolvePartner(slug);
    const service = await this.prisma.service.findFirst({
      where: { id: q.serviceId, partnerId: partner.id, deletedAt: null, active: true },
    });
    if (!service) throw AppException.notFound('Service not found');

    const dayCount = q.days ?? 7;
    const days = buildDayRange(q.from, dayCount); // local-midnight Date per day
    const windowStart = days[0];
    const windowEnd = new Date(days[days.length - 1]);
    windowEnd.setHours(23, 59, 59, 999);
    const now = new Date();

    // ── Facility / entry service (spa): location hours + capacity, no specialist.
    if (!service.requiresSpecialist) {
      const location = await this.resolveFacilityLocation(partner.id, q.locationId);
      if (!location) return days.map((d) => ({ date: fmtLocalDay(d), closed: true, openDots: 0 as const }));

      // One query for the whole window; filter per day in memory.
      const busyAll = await this.prisma.booking.findMany({
        where: {
          locationId: location.id,
          serviceId: service.id,
          status: { in: ['pending', 'confirmed', 'completed'] },
          startAt: { lt: windowEnd },
          endAt: { gt: windowStart },
        },
        select: { startAt: true, endAt: true },
      });

      const hours = (location.hours ?? null) as WeekScheduleInput | null;
      return days.map((day) => {
        const dayEnd = new Date(day); dayEnd.setHours(23, 59, 59, 999);
        const busy = busyAll.filter((b) => b.startAt < dayEnd && b.endAt > day);
        const slots = computeCapacitySlots({
          day,
          durationMin: service.duration,
          locationHours: hours,
          busy,
          capacity: service.capacity,
          notBefore: isToday(day) ? now : undefined,
        });
        return { date: fmtLocalDay(day), closed: !openOnDay(hours, day), openDots: slotCountToDots(slots.length) };
      });
    }

    // ── Specialist service: union of eligible specialists' availability. ──
    const candidates = await this.eligibleSpecialists(
      partner.id,
      q.serviceId,
      q.specialistId,
      q.locationId,
    );
    if (candidates.length === 0) {
      return days.map((d) => ({ date: fmtLocalDay(d), closed: false, openDots: 0 as const }));
    }

    const specialistIds = candidates.map((c) => c.id);
    const locationIds = [...new Set(candidates.map((c) => c.locationId))];

    // Fetch locations' hours, and ALL time-off + bookings across the window, in
    // batched queries — then group in memory. No per-day / per-specialist trips.
    const [locations, timeOffAll, busyAll] = await Promise.all([
      this.prisma.location.findMany({
        where: { id: { in: locationIds }, deletedAt: null },
        select: { id: true, hours: true },
      }),
      this.prisma.specialistTimeOff.findMany({
        where: { specialistId: { in: specialistIds }, startAt: { lt: windowEnd }, endAt: { gt: windowStart } },
        select: { specialistId: true, startAt: true, endAt: true },
      }),
      this.prisma.booking.findMany({
        where: {
          specialistId: { in: specialistIds },
          status: { in: ['pending', 'confirmed', 'completed'] },
          startAt: { lt: windowEnd },
          endAt: { gt: windowStart },
        },
        select: { specialistId: true, startAt: true, endAt: true },
      }),
    ]);

    const hoursByLocation = new Map(locations.map((l) => [l.id, (l.hours ?? null) as WeekScheduleInput | null]));

    return days.map((day) => {
      const dayEnd = new Date(day); dayEnd.setHours(23, 59, 59, 999);
      const notBefore = isToday(day) ? now : undefined;
      const daySlots = new Set<string>();
      let anyOpenWindow = false;

      for (const sp of candidates) {
        const locHours = hoursByLocation.get(sp.locationId) ?? null;
        const spSchedule = sp.schedule as WeekScheduleInput | null;
        // Mirror computeSlots' window logic exactly: the effective window is the
        // specialist's own schedule when they have one, else the location hours.
        // A null personal schedule means "follows location hours" — NOT closed.
        // (The earlier `spSchedule && location both open` check wrongly marked a
        //  schedule-less specialist's day as closed, so real open days lost dots.)
        const effectiveOpen = spSchedule
          ? openOnDay(spSchedule, day) && openOnDay(locHours, day)
          : openOnDay(locHours, day);
        if (effectiveOpen) anyOpenWindow = true;

        const timeOff = timeOffAll.filter(
          (o) => o.specialistId === sp.id && o.startAt < dayEnd && o.endAt > day,
        );
        const busy = busyAll.filter(
          (b) => b.specialistId === sp.id && b.startAt < dayEnd && b.endAt > day,
        );

        for (const slot of computeSlots({
          day,
          durationMin: service.duration,
          specialistSchedule: spSchedule,
          locationHours: locHours,
          timeOff,
          busy,
          notBefore,
        })) {
          daySlots.add(slot);
        }
      }

      return {
        date: fmtLocalDay(day),
        // Closed only when no specialist's window is open that weekday at all
        // (vs. open-but-fully-booked, which is openDots 0 with closed false).
        closed: !anyOpenWindow,
        openDots: slotCountToDots(daySlots.size),
      };
    });
  }

  /** Create a booking from the public page (auto-assigns a specialist if none). */
  async createBooking(slug: string, dto: PublicCreateBookingDto) {
    const partner = await this.resolvePartner(slug);

    // Contact-only salons can't take public bookings (defense in depth — the UI
    // already hides the CTAs, but the endpoint must reject too).
    if (!partner.bookingsEnabled) {
      throw AppException.badRequest(ErrorCode.SERVICE_NOT_OFFERED, 'Online booking is not available for this salon');
    }

    const service = await this.prisma.service.findFirst({
      where: { id: dto.serviceId, partnerId: partner.id, deletedAt: null, active: true },
      select: { id: true, duration: true, requiresSpecialist: true, capacity: true },
    });
    if (!service) throw AppException.notFound('Service not found');

    // ── Facility / entry service: no specialist, capacity-gated. ──
    if (!service.requiresSpecialist) {
      const location = await this.resolveFacilityLocation(partner.id, dto.locationId);
      if (!location) {
        throw AppException.badRequest(ErrorCode.SERVICE_NOT_OFFERED, 'This service is not available');
      }
      const startAt = new Date(`${dto.date}T${dto.time}:00`);
      const endAt = new Date(startAt.getTime() + service.duration * 60_000);

      const overlapping = await this.prisma.booking.findMany({
        where: {
          locationId: location.id,
          serviceId: service.id,
          status: { in: ['pending', 'confirmed', 'completed'] },
          startAt: { lt: endAt },
          endAt: { gt: startAt },
        },
        select: { id: true },
      });
      if (overlapping.length >= service.capacity) {
        throw AppException.conflict(ErrorCode.BOOKING_OVERLAP, 'That time is fully booked');
      }

      return this.bookings.create(
        partner.id,
        {
          locationId: location.id,
          specialistId: null,
          serviceId: service.id,
          clientName: dto.clientName,
          clientPhone: dto.clientPhone,
          startAt,
          notes: dto.notes,
          locale: dto.locale,
          status: partner.autoConfirmBookings ? 'confirmed' : 'pending',
        },
        { source: BookingSource.public },
      );
    }

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
            locale: dto.locale,
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
      select: { id: true, autoConfirmBookings: true, bookingsEnabled: true },
    });
    if (!partner) throw AppException.notFound('Salon not found');
    return partner;
  }

  /** A bookable location for a facility service: the chosen one, else the
   *  partner's first branch. Facility services aren't tied to a specialist. */
  private async resolveFacilityLocation(partnerId: string, locationId?: string) {
    return this.prisma.location.findFirst({
      where: { partnerId, deletedAt: null, ...(locationId ? { id: locationId } : {}) },
      orderBy: { name: 'asc' },
      select: { id: true, hours: true },
    });
  }

  /** Slots for a facility/entry service: location hours + concurrent capacity. */
  private async facilitySlots(
    partnerId: string,
    service: { id: string; duration: number; capacity: number },
    locationId: string | undefined,
    day: Date,
    dayEnd: Date,
    notBefore: Date | undefined,
  ): Promise<string[]> {
    const location = await this.resolveFacilityLocation(partnerId, locationId);
    if (!location) return [];

    const busy = await this.prisma.booking.findMany({
      where: {
        locationId: location.id,
        serviceId: service.id,
        status: { in: ['pending', 'confirmed', 'completed'] },
        startAt: { lt: dayEnd },
        endAt: { gt: day },
      },
      select: { startAt: true, endAt: true },
    });

    return computeCapacitySlots({
      day,
      durationMin: service.duration,
      locationHours: (location.hours ?? null) as WeekScheduleInput | null,
      busy,
      capacity: service.capacity,
      notBefore,
    });
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

/** `count` consecutive local-midnight days starting at the yyyy-mm-dd `from`. */
function buildDayRange(from: string, count: number): Date[] {
  const [y, m, d] = from.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => new Date(y, m - 1, d + i));
}

/** yyyy-mm-dd for a local Date (timezone-safe, avoids toISOString UTC shift). */
function fmtLocalDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Whether a weekly schedule has an enabled window on the given day. */
function openOnDay(schedule: WeekScheduleInput | null | undefined, day: Date): boolean {
  return openWindowForDate(schedule, day) != null;
}
