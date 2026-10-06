import type { LocationService, SpecialistPrice } from '@prisma/client';
import {
  resolveOffer,
  type BranchOverride,
  type Offer,
  type PriceOverride,
  type ServiceDefaults,
} from './resolve-offer';

const branchKey = (locationId: string, serviceId: string) => `${locationId}|${serviceId}`;
const ownKey = (specialistId: string, locationId: string, serviceId: string) =>
  `${specialistId}|${locationId}|${serviceId}`;

type BranchRow = Pick<
  LocationService,
  'locationId' | 'serviceId' | 'offered' | 'priceType' | 'price' | 'priceMax' | 'duration' | 'capacity'
>;
type OwnRow = Pick<
  SpecialistPrice,
  'specialistId' | 'locationId' | 'serviceId' | 'priceType' | 'price' | 'priceMax' | 'duration'
>;

/**
 * A partner's override rows, loaded once and resolved in memory.
 *
 * Both tables are sparse and small (a row exists only where a price differs),
 * so loading a partner's whole set costs two indexed queries and lets every
 * caller — slots for N specialists × M days, the public payload — resolve
 * without a query per combination.
 */
export class OfferBook {
  private readonly branches = new Map<string, BranchOverride>();
  private readonly own = new Map<string, PriceOverride>();

  constructor(branchRows: BranchRow[], ownRows: OwnRow[]) {
    for (const r of branchRows) {
      this.branches.set(branchKey(r.locationId, r.serviceId), {
        offered: r.offered,
        priceType: r.priceType,
        price: r.price,
        priceMax: r.priceMax,
        duration: r.duration,
        capacity: r.capacity,
      });
    }
    for (const r of ownRows) {
      this.own.set(ownKey(r.specialistId, r.locationId, r.serviceId), {
        priceType: r.priceType,
        price: r.price,
        priceMax: r.priceMax,
        duration: r.duration,
      });
    }
  }

  /** An empty book: every service at its own defaults, offered everywhere. */
  static empty(): OfferBook {
    return new OfferBook([], []);
  }

  /** The branch row for a service, if the branch overrides anything. */
  branch(locationId: string, serviceId: string): BranchOverride | null {
    return this.branches.get(branchKey(locationId, serviceId)) ?? null;
  }

  /** Whether the branch offers the service. No row = offered (the default). */
  offered(locationId: string, serviceId: string): boolean {
    return this.branch(locationId, serviceId)?.offered ?? true;
  }

  /** The specialist's own row at a branch, if any. */
  ownPrice(specialistId: string, locationId: string, serviceId: string): PriceOverride | null {
    return this.own.get(ownKey(specialistId, locationId, serviceId)) ?? null;
  }

  /** The resolved price/duration/capacity for one combination. */
  offer(
    service: ServiceDefaults & { id: string },
    locationId: string,
    specialistId?: string | null,
  ): Offer {
    return resolveOffer(
      service,
      this.branch(locationId, service.id),
      specialistId ? this.ownPrice(specialistId, locationId, service.id) : null,
    );
  }
}
