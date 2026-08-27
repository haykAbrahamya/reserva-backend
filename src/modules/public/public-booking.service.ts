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
  openRangesForDate,
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

    const slots = await this.specialistDaySlots(candidates, service.duration, day, dayEnd, notBefore);
    return [...slots].sort();
  }

  /**
   * Union of bookable 'HH:MM' start times for a service on a single day across a
   * set of eligible specialists. The SINGLE source of truth used by both the
   * live slots endpoint and the day-strip summary, so the two can never disagree
   * (a summary that reported "no slots" for a day that actually had them was the
   * result of these paths drifting). Queries the per-specialist location hours,
   * time-off and bookings, then layers them via the shared `computeSlots` engine.
   */
  private async specialistDaySlots(
    candidates: { id: string; locationId: string; schedule: unknown }[],
    durationMin: number,
    day: Date,
    dayEnd: Date,
    notBefore: Date | undefined,
  ): Promise<Set<string>> {
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
        durationMin,
        specialistSchedule: sp.schedule as WeekScheduleInput | null,
        locationHours: (location?.hours ?? null) as WeekScheduleInput | null,
        timeOff,
        busy,
        notBefore,
      })) {
        all.add(slot);
      }
    }
    return all;
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

    // Location hours per specialist, to decide "closed" (weekday not worked)
    // vs. "open but fully booked" (0 slots). Fetched once for the whole window.
    const locationIds = [...new Set(candidates.map((c) => c.locationId))];
    const locations = await this.prisma.location.findMany({
      where: { id: { in: locationIds }, deletedAt: null },
      select: { id: true, hours: true },
    });
    const hoursByLocation = new Map(
      locations.map((l) => [l.id, (l.hours ?? null) as WeekScheduleInput | null]),
    );

    // Compute each day through the SAME per-day slot function the live slots
    // endpoint uses — so a day's dots can never disagree with its actual slots.
    const perDay = await Promise.all(
      days.map(async (day) => {
        const dayEnd = new Date(day); dayEnd.setHours(23, 59, 59, 999);
        const notBefore = isToday(day) ? now : undefined;

        // A day is "open" when at least one specialist's effective window is
        // enabled that weekday: their own schedule if they have one, else the
        // location's hours (a null personal schedule = follows location hours).
        const anyOpenWindow = candidates.some((sp) => {
          const locHours = hoursByLocation.get(sp.locationId) ?? null;
          const spSchedule = sp.schedule as WeekScheduleInput | null;
          return spSchedule
            ? openOnDay(spSchedule, day) && openOnDay(locHours, day)
            : openOnDay(locHours, day);
        });

        const slots = await this.specialistDaySlots(candidates, service.duration, day, dayEnd, notBefore);
        return {
          date: fmtLocalDay(day),
          // Closed only when no specialist works this weekday at all (vs.
          // open-but-fully-booked → closed:false, openDots:0).
          closed: !anyOpenWindow,
          openDots: slotCountToDots(slots.size),
        };
      }),
    );
    return perDay;
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

/**
 * Whether a weekly schedule leaves the venue open at any point during the day.
 * Uses the range helper rather than the raw window so a day that is only
 * reachable through the PREVIOUS day's overnight shift (open 00:00–02:30
 * because yesterday ran 18:00→02:30) is reported as open, not closed.
 */
function openOnDay(schedule: WeekScheduleInput | null | undefined, day: Date): boolean {
  return openRangesForDate(schedule, day).length > 0;
}
