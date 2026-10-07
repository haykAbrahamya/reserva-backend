import { Injectable } from '@nestjs/common';
import type {
  BookingSource,
  BookingStatus,
  PartnerKind,
  Prisma,
  ServicePriceType,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { decodeBookingCursor, encodeBookingCursor } from './booking-cursor';
import type { RecentBookingsQuery } from './dto/recent-bookings.dto';

/** One booking as the console dashboard lists it — which partner got what, never who booked. */
export interface RecentBooking {
  id: string;
  /** ISO — when it was booked. */
  createdAt: string;
  /** ISO — the appointment. */
  startAt: string;
  status: BookingStatus;
  source: BookingSource;
  partner: { id: string; name: string; slug: string | null; kind: PartnerKind };
  location: { id: string; name: string } | null;
  service: { id: string; name: string } | null;
  specialist: { id: string; name: string } | null;
  /** The price as snapshotted onto the booking. */
  price: { type: ServicePriceType; amount: number; max: number | null } | null;
}

export interface RecentBookingsPage {
  items: RecentBooking[];
  /** Pass back as `cursor` for the next (older) page; null on the last one. */
  nextCursor: string | null;
}

/**
 * Exactly what the list shows. Selecting field by field (rather than
 * excluding) is the privacy guarantee: the client's name, phone and notes are
 * never even read, so no later change to the mapping can leak them.
 */
const RECENT_BOOKING = {
  id: true,
  createdAt: true,
  startAt: true,
  status: true,
  source: true,
  priceAtBooking: true,
  priceMaxAtBooking: true,
  priceTypeAtBooking: true,
  partner: { select: { id: true, name: true, slug: true, kind: true } },
  location: { select: { id: true, name: true } },
  service: { select: { id: true, name: true, priceType: true } },
  specialist: { select: { id: true, name: true } },
} satisfies Prisma.BookingSelect;

type RecentBookingRow = Prisma.BookingGetPayload<{ select: typeof RECENT_BOOKING }>;

/** Cross-partner booking feed for the internal console (GET /platform/bookings/recent). */
@Injectable()
export class PlatformBookingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Newest first by (createdAt, id); keyset-paginated, see booking-cursor.ts. */
  async recent(q: RecentBookingsQuery): Promise<RecentBookingsPage> {
    // The DTO has already rejected a cursor this API did not issue.
    const after = q.cursor ? decodeBookingCursor(q.cursor) : null;
    const rows = await this.prisma.booking.findMany({
      where: {
        // A soft-deleted partner is gone from the console; so are its bookings.
        partner: { deletedAt: null },
        ...(after
          ? {
              OR: [
                { createdAt: { lt: after.createdAt } },
                { createdAt: after.createdAt, id: { lt: after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      // One extra row says whether another page exists, without a count.
      take: q.limit + 1,
      select: RECENT_BOOKING,
    });

    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toRecentBooking),
      nextCursor: rows.length > q.limit && last ? encodeBookingCursor(last) : null,
    };
  }
}

function toRecentBooking(b: RecentBookingRow): RecentBooking {
  // Bookings made before the type was snapshotted fall back to the service's.
  const type = b.priceTypeAtBooking ?? b.service.priceType;
  return {
    id: b.id,
    createdAt: b.createdAt.toISOString(),
    startAt: b.startAt.toISOString(),
    status: b.status,
    source: b.source,
    partner: { id: b.partner.id, name: b.partner.name, slug: b.partner.slug, kind: b.partner.kind },
    location: { id: b.location.id, name: b.location.name },
    service: { id: b.service.id, name: b.service.name },
    specialist: b.specialist ? { id: b.specialist.id, name: b.specialist.name } : null,
    price: { type, amount: b.priceAtBooking, max: b.priceMaxAtBooking },
  };
}
