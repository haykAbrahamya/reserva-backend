import { Injectable } from '@nestjs/common';
import { Prisma, BookingSource } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { ClientsService } from '@/modules/clients/clients.service';
import { BookingNotifier } from '@/modules/notifications/booking-notifier.service';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import { newId } from '@/common/ids';
import { paginate, pageArgs } from '@/common/dto/pagination';
import { assertBookingAllowed } from './booking-rules';
import { computeSlots, computeCapacitySlots } from '@/common/utils/availability';
import type { WeekScheduleInput } from '@/common/schemas/week-schedule.schema';
import type {
  ListBookingsQueryDto,
  BookingSlotsQueryDto,
  CreateBookingDto,
  UpdateBookingDto,
} from './dto/booking.dto';
import type { BookingStatus } from '@prisma/client';

/** One day in ms — used to widen slot queries so overnight windows aren't clipped. */
const DAY_MS = 24 * 60 * 60 * 1000;

interface CreateOpts {
  source: BookingSource;
  createdById?: string;
}

/**
 * Join the related rows so a booking is self-contained for list rendering —
 * the client doesn't need to fetch the catalog to show service/specialist names.
 */
const BOOKING_INCLUDE = {
  service: { select: { id: true, name: true, price: true, priceType: true, priceMax: true, duration: true, capacity: true } },
  specialist: { select: { id: true, name: true, title: true } },
  location: { select: { id: true, name: true, address: true } },
} satisfies Prisma.BookingInclude;

/** A booking row with the joined refs (what every mutation returns). */
type BookingWithRefs = Prisma.BookingGetPayload<{ include: typeof BOOKING_INCLUDE }>;

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
    private readonly notifier: BookingNotifier,
  ) {}

  // ── Queries ───────────────────────────────────────────────

  async list(partnerId: string, q: ListBookingsQueryDto, scopeLocationId?: string | null) {
    const where: Prisma.BookingWhereInput = {
      partnerId,
      ...(scopeLocationId ? { locationId: scopeLocationId } : {}),
      ...(q.locationId ? { locationId: q.locationId } : {}),
      ...(q.specialistId ? { specialistId: q.specialistId } : {}),
      ...(q.clientId ? { clientId: q.clientId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.from || q.to
        ? {
            startAt: {
              ...(q.from ? { gte: new Date(`${q.from}T00:00:00`) } : {}),
              ...(q.to ? { lte: new Date(`${q.to}T23:59:59`) } : {}),
            },
          }
        : {}),
      ...(q.search
        ? {
            OR: [
              { clientName: { contains: q.search, mode: 'insensitive' } },
              { clientPhone: { contains: q.search } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({
        where,
        orderBy: { startAt: 'desc' },
        include: BOOKING_INCLUDE,
        ...pageArgs(q.page, q.pageSize),
      }),
      this.prisma.booking.count({ where }),
    ]);
    return paginate(items, total, q.page, q.pageSize);
  }

  /** Calendar feed: all bookings in a [from, to] window (no pagination). */
  async calendar(partnerId: string, from: Date, to: Date, scopeLocationId?: string | null) {
    const items = await this.prisma.booking.findMany({
      where: {
        partnerId,
        ...(scopeLocationId ? { locationId: scopeLocationId } : {}),
        startAt: { gte: from, lte: to },
      },
      orderBy: { startAt: 'asc' },
      include: BOOKING_INCLUDE,
    });
    return items;
  }

  async get(partnerId: string, id: string, scopeLocationId?: string | null) {
    const booking = await this.prisma.booking.findFirst({
      where: { id, partnerId, ...(scopeLocationId ? { locationId: scopeLocationId } : {}) },
      include: BOOKING_INCLUDE,
    });
    if (!booking) throw AppException.notFound('Booking not found');
    return booking;
  }

  /**
   * Bookable 'HH:MM' start times for a service on one date, for the backoffice
   * booking / reschedule pickers.
   *
   * Runs the SAME `computeSlots` engine the public booking page uses, so staff
   * and clients can never be offered different times — and so overnight shifts
   * (18:00 → 02:30, whose tail lands on the next date) are handled in exactly
   * one place. Before this existed the pickers invented a fixed hourly grid that
   * ignored working hours entirely, offering times the server then rejected.
   */
  async slots(partnerId: string, q: BookingSlotsQueryDto): Promise<string[]> {
    const { specialist, service, location } = await this.loadRefs(
      partnerId,
      q.specialistId,
      q.serviceId,
      q.locationId,
    );

    // Local midnight → midnight for the requested calendar date.
    const [y, m, d] = q.date.split('-').map(Number);
    const day = new Date(y, m - 1, d);
    const dayEnd = new Date(y, m - 1, d + 1);

    /*
     * `create` refuses past times, so don't offer them either — unless the
     * caller asked for them.
     *
     * This is the BACKOFFICE slots endpoint; the public app has its own
     * (`PublicBookingService.slots`) with its own hard-coded floor, so opening
     * this one cannot leak past times to clients. That separation is the reason
     * a query flag is safe here rather than a privilege check.
     */
    const notBefore = q.includePast ? undefined : new Date(Date.now() - 60_000);

    const activeBookings = await this.prisma.booking.findMany({
      where: {
        partnerId,
        status: { in: ['pending', 'confirmed', 'completed'] },
        // An overnight slot can start today and finish tomorrow, so widen the
        // window by a day on each side rather than clipping to the date.
        startAt: { lt: new Date(dayEnd.getTime() + DAY_MS) },
        endAt: { gt: new Date(day.getTime() - DAY_MS) },
        ...(q.excludeBookingId ? { id: { not: q.excludeBookingId } } : {}),
        ...(specialist
          ? { specialistId: specialist.id }
          : { serviceId: service.id, locationId: location.id }),
      },
      select: { startAt: true, endAt: true },
    });

    if (!specialist) {
      // Facility/entry service (spa, pool): location hours + concurrent capacity.
      return computeCapacitySlots({
        day,
        durationMin: service.duration,
        locationHours: location.hours as WeekScheduleInput | null,
        busy: activeBookings,
        capacity: Math.max(1, service.capacity),
        notBefore,
      });
    }

    const timeOff = await this.prisma.specialistTimeOff.findMany({
      where: {
        specialistId: specialist.id,
        startAt: { lt: new Date(dayEnd.getTime() + DAY_MS) },
        endAt: { gt: new Date(day.getTime() - DAY_MS) },
      },
      select: { startAt: true, endAt: true },
    });

    return computeSlots({
      day,
      durationMin: service.duration,
      specialistSchedule: specialist.schedule as WeekScheduleInput | null,
      locationHours: location.hours as WeekScheduleInput | null,
      timeOff,
      busy: activeBookings,
      notBefore,
    });
  }

  // ── Mutations ─────────────────────────────────────────────

  async create(partnerId: string, dto: CreateBookingDto, opts: CreateOpts) {
    const { specialist, service, location } = await this.loadRefs(
      partnerId,
      dto.specialistId,
      dto.serviceId,
      dto.locationId,
    );

    const startAt = dto.startAt;
    const endAt = new Date(startAt.getTime() + service.duration * 60_000);

    /*
     * Only staff may backdate, and that is derived from the SOURCE rather than
     * passed in as an option.
     *
     * `BookingSource` has exactly two values and each entry point sets its own
     * — the JWT-guarded controller says `backoffice`, the public flow says
     * `public` — so this cannot be got wrong by forgetting an argument, and a
     * new client-facing path cannot opt itself in. A boolean parameter would
     * have had to be passed correctly at every present and future call site to
     * mean the same thing.
     */
    const mayBackdate = opts.source === BookingSource.backoffice;
    this.assertStartAllowed(startAt, mayBackdate);
    const historical = mayBackdate && this.isPast(startAt);

    if (specialist) {
      // Specialist booking: enforce the specialist's offer/schedule/time-off.
      const timeOff = await this.timeOffWindows(specialist.id, startAt, endAt);
      assertBookingAllowed(
        { specialist, location, serviceId: dto.serviceId, startAt, endAt },
        timeOff,
        { historical },
      );
    } else {
      // Facility/entry service (spa): no specialist → enforce concurrent capacity.
      // Capacity still applies to a past booking: two people cannot have
      // occupied one chair, whenever it was.
      await this.assertCapacity(service.id, dto.locationId, startAt, endAt, service.capacity);
    }

    const booking = await this.runWithOverlapGuard<BookingWithRefs>(() =>
      this.prisma.$transaction(async (tx) => {
        // No phone → no CRM client: phone is the per-partner client identity key,
        // so there is nothing to key a row on, and inventing one would either
        // collide on the unique index or pollute the client list. The booking
        // still carries the client's NAME, so staff never lose who it's for.
        const phone = dto.clientPhone.trim();
        const client = phone
          ? await this.clients.upsertByPhone(partnerId, dto.clientName, phone, tx)
          : null;
        return tx.booking.create({
          data: {
            id: newId(),
            partnerId,
            locationId: dto.locationId,
            specialistId: dto.specialistId ?? null,
            serviceId: dto.serviceId,
            clientId: client?.id ?? null,
            clientName: dto.clientName,
            clientPhone: client?.phone ?? '',
            startAt,
            endAt,
            status: dto.status,
            source: opts.source,
            notes: dto.notes,
            locale: dto.locale ?? null,
            priceAtBooking: service.price,
            priceMaxAtBooking: service.priceType === 'range' ? service.priceMax : null,
            createdById: opts.createdById,
          },
          include: BOOKING_INCLUDE,
        });
      }),
    );

    /*
     * Best-effort notify admins + the branch's managers (never blocks the
     * write). Skip the creator if it was a backoffice user (public bookings
     * have none).
     *
     * A BACKDATED booking notifies staff but not the client. The customer copy
     * for a new booking reads "We've got your request — give us a moment to
     * confirm it", and sending that about a haircut that happened last Tuesday
     * is worse than sending nothing: it invites the client to expect an
     * appointment that is already over. Staff still get theirs, because someone
     * adding history to the calendar is exactly what a manager wants to see.
     */
    this.notifier.notify('created', booking, opts.createdById, { skipCustomer: historical });
    return booking;
  }

  async update(
    partnerId: string,
    id: string,
    dto: UpdateBookingDto,
    scopeLocationId?: string | null,
    actorId?: string,
  ) {
    const existing = await this.get(partnerId, id, scopeLocationId);

    const specialistId = dto.specialistId ?? existing.specialistId;
    const serviceId = dto.serviceId ?? existing.serviceId;
    const startAt = dto.startAt ?? existing.startAt;

    const { specialist, service, location } = await this.loadRefs(
      partnerId,
      specialistId,
      serviceId,
      existing.locationId,
    );
    const endAt = new Date(startAt.getTime() + service.duration * 60_000);

    // Only re-validate rules when the time/specialist/service actually changed.
    const reschedule =
      dto.startAt !== undefined || dto.specialistId !== undefined || dto.serviceId !== undefined;
    if (reschedule) {
      /*
       * Rescheduling INTO the past is allowed, because only staff can get here:
       * this method is reachable only from the JWT-guarded backoffice
       * controller, and the public flow has no reschedule at all. Correcting a
       * time that was entered wrong is the common case, and it is the same
       * privilege as creating a past booking in the first place.
       */
      const historical = this.isPast(startAt);
      if (specialist) {
        const timeOff = await this.timeOffWindows(specialist.id, startAt, endAt);
        assertBookingAllowed(
          { specialist, location, serviceId, startAt, endAt },
          timeOff,
          { historical },
        );
      } else {
        // Facility/entry service: capacity check (exclude this booking itself).
        await this.assertCapacity(serviceId, existing.locationId, startAt, endAt, service.capacity, id);
      }
    }

    const booking = await this.runWithOverlapGuard<BookingWithRefs>(() =>
      this.prisma.booking.update({
        where: { id },
        data: {
          specialistId,
          serviceId,
          startAt,
          endAt,
          priceAtBooking: service.price,
          priceMaxAtBooking: service.priceType === 'range' ? service.priceMax : null,
          // If the service itself changed, the captured final price no longer
          // applies — clear it so completion re-prompts when needed.
          ...(dto.serviceId !== undefined && dto.serviceId !== existing.serviceId
            ? { finalPrice: null }
            : {}),
          ...(dto.notes !== undefined && { notes: dto.notes }),
        },
        include: BOOKING_INCLUDE,
      }),
    );

    // Notify only when the appointment actually moved (not on a notes-only edit).
    if (dto.startAt !== undefined) this.notifier.notify('rescheduled', booking, actorId);
    return booking;
  }

  async setStatus(
    partnerId: string,
    id: string,
    status: BookingStatus,
    scopeLocationId?: string | null,
    actorId?: string,
    finalPrice?: number | null,
  ) {
    const existing = await this.get(partnerId, id, scopeLocationId);

    // Completing a RANGE-priced booking must capture the exact amount charged, so
    // revenue is never ambiguous. Fixed-price bookings need nothing extra.
    const isRange = existing.service.priceType === 'range';
    let finalPriceUpdate: number | null | undefined;
    if (status === 'completed' && isRange) {
      if (finalPrice == null) {
        throw AppException.badRequest(
          ErrorCode.VALIDATION_FAILED,
          'Enter the final price to complete this range-priced booking',
        );
      }
      finalPriceUpdate = finalPrice;
    }

    const booking = await this.prisma.booking.update({
      where: { id },
      data: {
        status,
        ...(finalPriceUpdate !== undefined && { finalPrice: finalPriceUpdate }),
      },
      include: BOOKING_INCLUDE,
    });

    // Map each status transition to a notification event (pending has none).
    const statusEvent = {
      cancelled: 'cancelled',
      confirmed: 'confirmed',
      completed: 'completed',
      noshow: 'noshow',
    } as const;
    const event = statusEvent[status as keyof typeof statusEvent];
    if (event) this.notifier.notify(event, booking, actorId);
    return booking;
  }

  /** Edit the exact charged amount for a (range-priced) booking after the fact —
   *  e.g. correcting a typo from the completion popup. */
  async setFinalPrice(
    partnerId: string,
    id: string,
    finalPrice: number,
    scopeLocationId?: string | null,
  ) {
    const existing = await this.get(partnerId, id, scopeLocationId);
    if (existing.service.priceType !== 'range') {
      throw AppException.badRequest(
        ErrorCode.VALIDATION_FAILED,
        'Only range-priced bookings have an editable final price',
      );
    }
    return this.prisma.booking.update({
      where: { id },
      data: { finalPrice },
      include: BOOKING_INCLUDE,
    });
  }

  async remove(partnerId: string, id: string, scopeLocationId?: string | null) {
    await this.get(partnerId, id, scopeLocationId);
    await this.prisma.booking.delete({ where: { id } });
  }

  // ── Internals ─────────────────────────────────────────────

  /** Load + tenant-check the specialist (with services), service and location. */
  private async loadRefs(
    partnerId: string,
    specialistId: string | null | undefined,
    serviceId: string,
    locationId: string,
  ) {
    const [specialist, service, location] = await Promise.all([
      // Facility/entry services have no specialist → skip the lookup.
      specialistId
        ? this.prisma.specialist.findFirst({
            where: { id: specialistId, partnerId, deletedAt: null },
            include: { services: { select: { serviceId: true } } },
          })
        : Promise.resolve(null),
      this.prisma.service.findFirst({ where: { id: serviceId, partnerId, deletedAt: null } }),
      this.prisma.location.findFirst({ where: { id: locationId, partnerId, deletedAt: null } }),
    ]);
    if (specialistId && !specialist) throw AppException.notFound('Specialist not found');
    if (!service) throw AppException.notFound('Service not found');
    if (!location) throw AppException.notFound('Location not found');
    return { specialist, service, location };
  }

  private async timeOffWindows(specialistId: string, startAt: Date, endAt: Date) {
    return this.prisma.specialistTimeOff.findMany({
      where: { specialistId, startAt: { lt: endAt }, endAt: { gt: startAt } },
      select: { startAt: true, endAt: true },
    });
  }

  /** Facility services: reject when the slot is already at capacity (concurrent
   *  bookings for this service + location overlapping the window). */
  private async assertCapacity(
    serviceId: string,
    locationId: string,
    startAt: Date,
    endAt: Date,
    capacity: number,
    excludeBookingId?: string,
  ) {
    const concurrent = await this.prisma.booking.count({
      where: {
        serviceId,
        locationId,
        status: { in: ['pending', 'confirmed', 'completed'] },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
        ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
      },
    });
    if (concurrent >= capacity) {
      throw AppException.conflict(ErrorCode.BOOKING_OVERLAP, 'That time is fully booked');
    }
  }

  /**
   * A start time is in the past once it is more than a minute behind the clock.
   *
   * The minute of slack absorbs clock skew between the client picking a slot and
   * the server validating it — without it, booking the current slot at :00
   * intermittently failed.
   */
  private isPast(startAt: Date): boolean {
    return startAt.getTime() < Date.now() - 60_000;
  }

  /**
   * Refuse a past start time UNLESS the caller is allowed to backdate.
   *
   * Staff need to record what actually happened — a walk-in served this morning,
   * a visit someone forgot to enter last week — and a system that cannot be told
   * about the past forces them to either lie about the time or keep the books
   * somewhere else. Clients get no such latitude: a self-service booking is a
   * request for a future slot, and one placed in the past is either a mistake or
   * an attempt to occupy a slot that cannot be honoured.
   */
  private assertStartAllowed(startAt: Date, allowPast: boolean) {
    if (allowPast) return;
    if (this.isPast(startAt)) {
      throw AppException.badRequest(ErrorCode.PAST_DATE, 'Cannot book a time in the past');
    }
  }

  /**
   * Run a write and translate the Postgres EXCLUDE-constraint violation (raised
   * when two active bookings for one specialist overlap) into a clean domain
   * error. This is the hard, race-proof double-booking guarantee.
   */
  private async runWithOverlapGuard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (isOverlapViolation(e)) {
        throw AppException.conflict(
          ErrorCode.BOOKING_OVERLAP,
          'That time slot is no longer available for this specialist',
        );
      }
      throw e;
    }
  }
}

/** Detect the booking overlap EXCLUDE constraint (see init migration). */
function isOverlapViolation(e: unknown): boolean {
  if (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    (e.code === 'P2010' || e.code === 'P2034')
  ) {
    return JSON.stringify(e.meta ?? {}).includes('bookings_no_overlap');
  }
  // Raw driver error (exclusion_violation = SQLSTATE 23P01).
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes('bookings_no_overlap') || msg.includes('23P01');
}
