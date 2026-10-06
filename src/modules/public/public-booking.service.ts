import { Injectable } from '@nestjs/common';
import { BookingSource, type Service } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { BookingsService } from '@/modules/bookings/bookings.service';
import { PricingService } from '@/modules/pricing/pricing.service';
import type { OfferBook } from '@/modules/pricing/offer-book';
import { compareForAssignment, type Offer } from '@/modules/pricing/resolve-offer';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import {
  computeSlots,
  computeCapacitySlots,
  slotCountToDots,
  openRangesForDate,
  scheduleIsSet,
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

/**
 * A start time for "any available specialist", with who would be booked and
 * what it costs — shown to the client BEFORE they confirm.
 */
export interface SlotOption {
  time: string;
  specialistId: string;
  locationId: string;
  priceType: Offer['priceType'];
  /** Null when the service hides its price publicly. */
  price: number | null;
  priceMax: number | null;
  duration: number;
}

/**
 * Someone who could take the booking: one specialist at one branch. A
 * specialist who works at two branches is two candidates, each with that
 * branch's hours (and price).
 */
interface Candidate {
  id: string;
  name: string;
  locationId: string;
  schedule: unknown;
  /** Works at several branches → a day closed in these hours is closed here. */
  strict: boolean;
}

const ACTIVE = ['pending', 'confirmed', 'completed'] as const;

@Injectable()
export class PublicBookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly pricing: PricingService,
  ) {}

  /** Available 'HH:MM' start times for a service on a date (optionally for a
   *  specific specialist; otherwise the union across eligible specialists). */
  async slots(slug: string, q: SlotsQueryDto): Promise<string[]> {
    const partner = await this.resolvePartner(slug);
    const service = await this.activeService(partner.id, q.serviceId);
    const book = await this.pricing.book(partner.id, { serviceIds: [service.id] });

    const day = new Date(`${q.date}T00:00:00`);
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);
    const notBefore = isToday(day) ? new Date() : undefined;

    // ── Facility / entry service (spa): location hours + capacity, no specialist.
    if (!service.requiresSpecialist) {
      return this.facilitySlots(partner.id, service, book, q.locationId, day, dayEnd, notBefore);
    }

    const candidates = await this.eligibleSpecialists(partner.id, service.id, book, q.specialistId, q.locationId);
    if (candidates.length === 0) return [];

    const perCandidate = await this.specialistDaySlots(candidates, service, book, day, dayEnd, notBefore);
    const all = new Set<string>();
    for (const slots of perCandidate.values()) slots.forEach((s) => all.add(s));
    return [...all].sort();
  }

  /**
   * Start times for "any available specialist", each paired with the specialist
   * the booking would go to (least busy that day, then the lower price) and
   * their price at this branch. The page shows "14:30 with Hasmik · 5 000 ֏"
   * before the client confirms, and sends that choice back with the booking.
   */
  async slotOptions(slug: string, q: SlotsQueryDto): Promise<SlotOption[]> {
    const partner = await this.resolvePartner(slug);
    const service = await this.activeService(partner.id, q.serviceId);
    if (!service.requiresSpecialist) return [];
    const book = await this.pricing.book(partner.id, { serviceIds: [service.id] });

    const day = new Date(`${q.date}T00:00:00`);
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);
    const notBefore = isToday(day) ? new Date() : undefined;

    const candidates = await this.eligibleSpecialists(partner.id, service.id, book, q.specialistId, q.locationId);
    if (candidates.length === 0) return [];

    const [perCandidate, load] = await Promise.all([
      this.specialistDaySlots(candidates, service, book, day, dayEnd, notBefore),
      this.dayLoad(candidates.map((c) => c.id), day, dayEnd),
    ]);

    const times = new Set<string>();
    for (const slots of perCandidate.values()) slots.forEach((s) => times.add(s));

    const options: SlotOption[] = [];
    for (const time of [...times].sort()) {
      const free = candidates.filter((c) => perCandidate.get(keyOf(c))?.has(time));
      const ranked = free
        .map((c) => ({ c, offer: book.offer(service, c.locationId, c.id) }))
        .sort((a, b) =>
          compareForAssignment(
            { specialistId: a.c.id, name: a.c.name, price: a.offer.price, dayLoad: load.get(a.c.id) ?? 0 },
            { specialistId: b.c.id, name: b.c.name, price: b.offer.price, dayLoad: load.get(b.c.id) ?? 0 },
          ),
        );
      const pick = ranked[0];
      if (!pick) continue;
      options.push({
        time,
        specialistId: pick.c.id,
        locationId: pick.c.locationId,
        priceType: pick.offer.priceType,
        // A hidden price stays hidden here too — the server never sends it.
        price: service.hidePrice ? null : pick.offer.price,
        priceMax: service.hidePrice ? null : pick.offer.priceMax,
        duration: pick.offer.duration,
      });
    }
    return options;
  }

  /**
   * Per-specialist bookable times for one day, through the shared `computeSlots`
   * engine — the SINGLE source of truth behind the live slots, the day-strip
   * summary and the any-specialist options, so they can never disagree. Each
   * candidate uses their own hours at their branch and their own duration
   * there; busy windows are the specialist's bookings at EVERY branch, so being
   * booked at one branch blocks the same time at another.
   */
  private async specialistDaySlots(
    candidates: Candidate[],
    service: Service,
    book: OfferBook,
    day: Date,
    dayEnd: Date,
    notBefore: Date | undefined,
  ): Promise<Map<string, Set<string>>> {
    const locationIds = [...new Set(candidates.map((c) => c.locationId))];
    const specialistIds = [...new Set(candidates.map((c) => c.id))];
    const [locations, timeOffRows, busyRows] = await Promise.all([
      this.prisma.location.findMany({
        where: { id: { in: locationIds }, deletedAt: null },
        select: { id: true, hours: true },
      }),
      this.prisma.specialistTimeOff.findMany({
        where: { specialistId: { in: specialistIds }, startAt: { lt: dayEnd }, endAt: { gt: day } },
        select: { specialistId: true, startAt: true, endAt: true },
      }),
      this.prisma.booking.findMany({
        where: {
          specialistId: { in: specialistIds },
          status: { in: [...ACTIVE] },
          startAt: { lt: dayEnd },
          endAt: { gt: day },
        },
        select: { specialistId: true, startAt: true, endAt: true },
      }),
    ]);
    const hoursOf = new Map(locations.map((l) => [l.id, (l.hours ?? null) as WeekScheduleInput | null]));

    const out = new Map<string, Set<string>>();
    for (const c of candidates) {
      const offer = book.offer(service, c.locationId, c.id);
      const slots = computeSlots({
        day,
        durationMin: offer.duration,
        specialistSchedule: c.schedule as WeekScheduleInput | null,
        locationHours: hoursOf.get(c.locationId) ?? null,
        timeOff: timeOffRows.filter((t) => t.specialistId === c.id),
        busy: busyRows.filter((b) => b.specialistId === c.id),
        notBefore,
        strictSchedule: c.strict,
      });
      out.set(keyOf(c), new Set(slots));
    }
    return out;
  }

  /**
   * Per-day availability for the booking page day-strip over an N-day window.
   * Mirrors {@link slots} (same open-window − time-off − bookings − past logic
   * via the shared engine) but for a range, and returns a compact density bucket
   * per day instead of full slot lists.
   */
  async availabilitySummary(
    slug: string,
    q: AvailabilitySummaryQueryDto,
  ): Promise<PublicDayAvailability[]> {
    const partner = await this.resolvePartner(slug);
    const service = await this.activeService(partner.id, q.serviceId);
    const book = await this.pricing.book(partner.id, { serviceIds: [service.id] });

    const dayCount = q.days ?? 7;
    const days = buildDayRange(q.from, dayCount); // local-midnight Date per day
    const windowStart = days[0];
    const windowEnd = new Date(days[days.length - 1]);
    windowEnd.setHours(23, 59, 59, 999);
    const now = new Date();

    // ── Facility / entry service (spa): location hours + capacity, no specialist.
    if (!service.requiresSpecialist) {
      const location = await this.resolveFacilityLocation(partner.id, service.id, book, q.locationId);
      if (!location) return days.map((d) => ({ date: fmtLocalDay(d), closed: true, openDots: 0 as const }));
      const offer = book.offer(service, location.id);

      // One query for the whole window; filter per day in memory.
      const busyAll = await this.prisma.booking.findMany({
        where: {
          locationId: location.id,
          serviceId: service.id,
          status: { in: [...ACTIVE] },
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
          durationMin: offer.duration,
          locationHours: hours,
          busy,
          capacity: offer.capacity,
          notBefore: isToday(day) ? now : undefined,
        });
        return { date: fmtLocalDay(day), closed: !openOnDay(hours, day), openDots: slotCountToDots(slots.length) };
      });
    }

    // ── Specialist service: union of eligible specialists' availability. ──
    const candidates = await this.eligibleSpecialists(partner.id, service.id, book, q.specialistId, q.locationId);
    if (candidates.length === 0) {
      return days.map((d) => ({ date: fmtLocalDay(d), closed: false, openDots: 0 as const }));
    }

    // Location hours per candidate, to decide "closed" (weekday not worked)
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
    return Promise.all(
      days.map(async (day) => {
        const dayEnd = new Date(day); dayEnd.setHours(23, 59, 59, 999);
        const notBefore = isToday(day) ? now : undefined;

        // A day is "open" when at least one candidate's effective window is
        // enabled that weekday: their own hours at that branch if they have
        // them, else the branch's hours (no personal hours = follows the branch).
        const anyOpenWindow = candidates.some((c) => {
          const locHours = hoursByLocation.get(c.locationId) ?? null;
          const own = c.schedule as WeekScheduleInput | null;
          // A multi-branch specialist is only here on days their hours here open.
          if (c.strict) return openOnDay(own, day) && openOnDay(locHours, day);
          // Hours never set (`{}`) → they follow the branch, as the slots do.
          return scheduleIsSet(own) ? openOnDay(own, day) && openOnDay(locHours, day) : openOnDay(locHours, day);
        });

        const perCandidate = await this.specialistDaySlots(candidates, service, book, day, dayEnd, notBefore);
        let count = 0;
        const union = new Set<string>();
        for (const slots of perCandidate.values()) slots.forEach((s) => union.add(s));
        count = union.size;
        return {
          date: fmtLocalDay(day),
          // Closed only when no specialist works this weekday at all (vs.
          // open-but-fully-booked → closed:false, openDots:0).
          closed: !anyOpenWindow,
          openDots: slotCountToDots(count),
        };
      }),
    );
  }

  /** Create a booking from the public page (auto-assigns a specialist if none). */
  async createBooking(slug: string, dto: PublicCreateBookingDto) {
    const partner = await this.resolvePartner(slug);

    // Contact-only salons can't take public bookings (defense in depth — the UI
    // already hides the CTAs, but the endpoint must reject too).
    if (!partner.bookingsEnabled) {
      throw AppException.badRequest(ErrorCode.SERVICE_NOT_OFFERED, 'Online booking is not available for this salon');
    }

    const service = await this.activeService(partner.id, dto.serviceId);
    const book = await this.pricing.book(partner.id, { serviceIds: [service.id] });
    const startAt = new Date(`${dto.date}T${dto.time}:00`);
    const status = partner.autoConfirmBookings ? 'confirmed' : 'pending';

    // ── Facility / entry service: no specialist, capacity-gated. ──
    if (!service.requiresSpecialist) {
      const location = await this.resolveFacilityLocation(partner.id, service.id, book, dto.locationId);
      if (!location) {
        throw AppException.badRequest(ErrorCode.SERVICE_NOT_OFFERED, 'This service is not available');
      }
      const offer = book.offer(service, location.id);
      this.assertExpectedPrice(service, offer, dto.expectedPrice);
      const endAt = new Date(startAt.getTime() + offer.duration * 60_000);

      const overlapping = await this.prisma.booking.count({
        where: {
          locationId: location.id,
          serviceId: service.id,
          status: { in: [...ACTIVE] },
          startAt: { lt: endAt },
          endAt: { gt: startAt },
        },
      });
      if (overlapping >= offer.capacity) {
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
          status,
        },
        { source: BookingSource.public, book },
      );
    }

    let candidates = await this.eligibleSpecialists(
      partner.id,
      service.id,
      book,
      dto.specialistId,
      dto.locationId,
    );
    if (candidates.length === 0) {
      throw AppException.badRequest(
        ErrorCode.SERVICE_NOT_OFFERED,
        'No specialist is available for this service',
      );
    }

    // "Any available": the same order the page previewed — the preferred
    // (previewed) specialist first, then least busy that day, then cheapest.
    if (!dto.specialistId && candidates.length > 1) {
      const dayStart = new Date(`${dto.date}T00:00:00`);
      const dayEnd = new Date(dayStart); dayEnd.setHours(23, 59, 59, 999);
      const load = await this.dayLoad(candidates.map((c) => c.id), dayStart, dayEnd);
      const rank = (c: Candidate) => ({
        specialistId: c.id,
        name: c.name,
        price: book.offer(service, c.locationId, c.id).price,
        dayLoad: load.get(c.id) ?? 0,
      });
      candidates = [...candidates].sort((a, b) => {
        if (dto.preferredSpecialistId) {
          const pa = a.id === dto.preferredSpecialistId ? 0 : 1;
          const pb = b.id === dto.preferredSpecialistId ? 0 : 1;
          if (pa !== pb) return pa - pb;
        }
        return compareForAssignment(rank(a), rank(b));
      });
    }

    // Never book at a price the client wasn't shown: keep only the candidates
    // whose price is the one on their screen.
    if (dto.expectedPrice != null && !service.hidePrice) {
      const atShownPrice = candidates.filter(
        (c) => book.offer(service, c.locationId, c.id).price === dto.expectedPrice,
      );
      if (atShownPrice.length === 0) {
        const offer = book.offer(service, candidates[0].locationId, candidates[0].id);
        throw AppException.conflict(ErrorCode.PRICE_CHANGED, 'The price for this booking has changed', {
          price: offer.price,
          priceMax: offer.priceMax,
          priceType: offer.priceType,
        });
      }
      candidates = atShownPrice;
    }

    // Try each candidate until one slot isn't taken (handles the "any
    // specialist" case + races, where the DB overlap guard rejects).
    let lastErr: unknown;
    for (const c of candidates) {
      try {
        return await this.bookings.create(
          partner.id,
          {
            locationId: c.locationId,
            specialistId: c.id,
            serviceId: service.id,
            clientName: dto.clientName,
            clientPhone: dto.clientPhone,
            startAt,
            notes: dto.notes,
            locale: dto.locale,
            // Honour the partner's setting: auto-confirm, else leave pending for
            // staff to confirm manually in the backoffice.
            status,
          },
          { source: BookingSource.public, book },
        );
      } catch (e) {
        if (
          e instanceof AppException &&
          (e.code === ErrorCode.BOOKING_OVERLAP ||
            e.code === ErrorCode.OUTSIDE_WORKING_HOURS ||
            e.code === ErrorCode.SPECIALIST_TIME_OFF)
        ) {
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

  private async activeService(partnerId: string, serviceId: string) {
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, partnerId, deletedAt: null, active: true },
    });
    if (!service) throw AppException.notFound('Service not found');
    return service;
  }

  /**
   * A bookable branch for a facility service: the chosen one, else the
   * partner's first branch (by name) that offers it. Facility services aren't
   * tied to a specialist, so the branch's own switch decides.
   */
  private async resolveFacilityLocation(
    partnerId: string,
    serviceId: string,
    book: OfferBook,
    locationId?: string,
  ) {
    const locations = await this.prisma.location.findMany({
      where: { partnerId, deletedAt: null, ...(locationId ? { id: locationId } : {}) },
      orderBy: { name: 'asc' },
      select: { id: true, hours: true },
    });
    return locations.find((l) => book.offered(l.id, serviceId)) ?? null;
  }

  /** Slots for a facility/entry service: location hours + concurrent capacity. */
  private async facilitySlots(
    partnerId: string,
    service: Service,
    book: OfferBook,
    locationId: string | undefined,
    day: Date,
    dayEnd: Date,
    notBefore: Date | undefined,
  ): Promise<string[]> {
    const location = await this.resolveFacilityLocation(partnerId, service.id, book, locationId);
    if (!location) return [];
    const offer = book.offer(service, location.id);

    const busy = await this.prisma.booking.findMany({
      where: {
        locationId: location.id,
        serviceId: service.id,
        status: { in: [...ACTIVE] },
        startAt: { lt: dayEnd },
        endAt: { gt: day },
      },
      select: { startAt: true, endAt: true },
    });

    return computeCapacitySlots({
      day,
      durationMin: offer.duration,
      locationHours: (location.hours ?? null) as WeekScheduleInput | null,
      busy,
      capacity: offer.capacity,
      notBefore,
    });
  }

  /**
   * Who could take the service: active specialists who do it, at each branch
   * they work at (filtered to the chosen specialist/branch when given), where
   * the branch offers the service. One candidate per specialist × branch, with
   * their hours at that branch.
   */
  private async eligibleSpecialists(
    partnerId: string,
    serviceId: string,
    book: OfferBook,
    specialistId?: string,
    locationId?: string,
  ): Promise<Candidate[]> {
    const links = await this.prisma.specialistLocation.findMany({
      where: {
        partnerId,
        ...(locationId ? { locationId } : {}),
        ...(specialistId ? { specialistId } : {}),
        specialist: { deletedAt: null, active: true, services: { some: { serviceId } } },
        location: { deletedAt: null },
      },
      select: {
        specialistId: true,
        locationId: true,
        schedule: true,
        specialist: { select: { name: true, _count: { select: { locations: true } } } },
      },
      orderBy: [{ specialist: { name: 'asc' } }, { specialistId: 'asc' }],
    });
    return links
      .filter((l) => book.offered(l.locationId, serviceId))
      .map((l) => ({
        id: l.specialistId,
        name: l.specialist.name,
        locationId: l.locationId,
        schedule: l.schedule,
        strict: l.specialist._count.locations > 1,
      }));
  }

  /** Active bookings per specialist on a day, at any branch (for fair assignment). */
  private async dayLoad(specialistIds: string[], day: Date, dayEnd: Date): Promise<Map<string, number>> {
    const rows = await this.prisma.booking.groupBy({
      by: ['specialistId'],
      where: {
        specialistId: { in: [...new Set(specialistIds)] },
        status: { in: [...ACTIVE] },
        startAt: { gte: day, lte: dayEnd },
      },
      _count: { _all: true },
    });
    return new Map(rows.filter((r) => r.specialistId).map((r) => [r.specialistId as string, r._count._all]));
  }

  /** PRICE_CHANGED when the client was shown a different price than would be booked. */
  private assertExpectedPrice(service: Service, offer: Offer, expected: number | undefined) {
    if (expected == null || service.hidePrice) return;
    if (offer.price !== expected) {
      throw AppException.conflict(ErrorCode.PRICE_CHANGED, 'The price for this booking has changed', {
        price: offer.price,
        priceMax: offer.priceMax,
        priceType: offer.priceType,
      });
    }
  }
}

/** Map key for one candidate (a specialist at one branch). */
function keyOf(c: Candidate): string {
  return `${c.id}|${c.locationId}`;
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
