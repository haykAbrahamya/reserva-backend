import { Injectable } from '@nestjs/common';
import { Prisma, BookingSource } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { ClientsService } from '@/modules/clients/clients.service';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import { newId } from '@/common/ids';
import { paginate, pageArgs } from '@/common/dto/pagination';
import { assertBookingAllowed } from './booking-rules';
import type {
  ListBookingsQueryDto,
  CreateBookingDto,
  UpdateBookingDto,
} from './dto/booking.dto';
import type { BookingStatus } from '@prisma/client';

interface CreateOpts {
  source: BookingSource;
  createdById?: string;
}

/**
 * Join the related rows so a booking is self-contained for list rendering —
 * the client doesn't need to fetch the catalog to show service/specialist names.
 */
const BOOKING_INCLUDE = {
  service: { select: { id: true, name: true, price: true, duration: true } },
  specialist: { select: { id: true, name: true, title: true } },
  location: { select: { id: true, name: true, address: true } },
} satisfies Prisma.BookingInclude;

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
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
    this.assertFuture(startAt);

    const timeOff = await this.timeOffWindows(dto.specialistId, startAt, endAt);
    assertBookingAllowed(
      { specialist, location, serviceId: dto.serviceId, startAt, endAt },
      timeOff,
    );

    return this.runWithOverlapGuard(() =>
      this.prisma.$transaction(async (tx) => {
        const client = await this.clients.upsertByPhone(partnerId, dto.clientName, dto.clientPhone, tx);
        return tx.booking.create({
          data: {
            id: newId(),
            partnerId,
            locationId: dto.locationId,
            specialistId: dto.specialistId,
            serviceId: dto.serviceId,
            clientId: client.id,
            clientName: dto.clientName,
            clientPhone: client.phone,
            startAt,
            endAt,
            status: dto.status,
            source: opts.source,
            notes: dto.notes,
            priceAtBooking: service.price,
            createdById: opts.createdById,
          },
          include: BOOKING_INCLUDE,
        });
      }),
    );
  }

  async update(partnerId: string, id: string, dto: UpdateBookingDto, scopeLocationId?: string | null) {
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
      this.assertFuture(startAt);
      const timeOff = await this.timeOffWindows(specialistId, startAt, endAt);
      assertBookingAllowed({ specialist, location, serviceId, startAt, endAt }, timeOff);
    }

    return this.runWithOverlapGuard(() =>
      this.prisma.booking.update({
        where: { id },
        data: {
          specialistId,
          serviceId,
          startAt,
          endAt,
          priceAtBooking: service.price,
          ...(dto.notes !== undefined && { notes: dto.notes }),
        },
        include: BOOKING_INCLUDE,
      }),
    );
  }

  async setStatus(partnerId: string, id: string, status: BookingStatus, scopeLocationId?: string | null) {
    await this.get(partnerId, id, scopeLocationId);
    return this.prisma.booking.update({
      where: { id },
      data: { status },
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
    specialistId: string,
    serviceId: string,
    locationId: string,
  ) {
    const [specialist, service, location] = await Promise.all([
      this.prisma.specialist.findFirst({
        where: { id: specialistId, partnerId, deletedAt: null },
        include: { services: { select: { serviceId: true } } },
      }),
      this.prisma.service.findFirst({ where: { id: serviceId, partnerId, deletedAt: null } }),
      this.prisma.location.findFirst({ where: { id: locationId, partnerId, deletedAt: null } }),
    ]);
    if (!specialist) throw AppException.notFound('Specialist not found');
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

  private assertFuture(startAt: Date) {
    if (startAt.getTime() < Date.now() - 60_000) {
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
