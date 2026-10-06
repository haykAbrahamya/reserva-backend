import type { ServicePriceType } from '@prisma/client';

/**
 * Price + duration resolution for one service at one branch, optionally with
 * one specialist. Pure, so the booking engine, the public payload and the tests
 * all agree by construction. The frontends run the same rule from
 * `@reserva/shared` (`resolveOffer`) — keep the two in step.
 *
 * The rule, most specific first:
 *   specialist's own price at this branch → branch price → service default
 *
 * The PRICE moves as one unit (type + amount + ceiling): a specialist who
 * charges a fixed 7 000 for a service whose default is a 5 000–9 000 range is
 * simply fixed at 7 000. DURATION falls back on its own, so a specialist can
 * take longer while still charging the branch price. CAPACITY (facility
 * services: sauna, pool) only exists per branch.
 */

/** A complete price: type + amount (+ ceiling for a range). */
export interface PriceSpec {
  priceType: ServicePriceType;
  /** Fixed amount, or the lower bound of a range. Whole AMD. */
  price: number;
  /** Range ceiling; null for fixed, or for an open-ended "from X" range. */
  priceMax: number | null;
}

/** The service row's own values — the defaults every override falls back to. */
export interface ServiceDefaults extends PriceSpec {
  duration: number;
  capacity: number;
}

/** A sparse override. Price fields are all-or-nothing (DB CHECK constraint). */
export interface PriceOverride {
  priceType: ServicePriceType | null;
  price: number | null;
  priceMax: number | null;
  duration: number | null;
}

/** A branch's settings for one service (a `location_services` row). */
export interface BranchOverride extends PriceOverride {
  offered: boolean;
  capacity: number | null;
}

/** Which level a value came from — shown to staff ("branch price", "own price"). */
export type PriceSource = 'service' | 'branch' | 'specialist';

/** What one booking costs and how long it takes, plus where each value came from. */
export interface Offer extends PriceSpec {
  duration: number;
  capacity: number;
  priceSource: PriceSource;
  durationSource: PriceSource;
}

function hasPrice(
  o: PriceOverride | null | undefined,
): o is PriceOverride & { priceType: ServicePriceType; price: number } {
  return !!o && o.price != null && o.priceType != null;
}

export function resolveOffer(
  service: ServiceDefaults,
  branch?: BranchOverride | null,
  own?: PriceOverride | null,
): Offer {
  let spec: PriceSpec;
  let priceSource: PriceSource;
  if (hasPrice(own)) {
    spec = { priceType: own.priceType, price: own.price, priceMax: own.priceMax };
    priceSource = 'specialist';
  } else if (hasPrice(branch)) {
    spec = { priceType: branch.priceType, price: branch.price, priceMax: branch.priceMax };
    priceSource = 'branch';
  } else {
    spec = { priceType: service.priceType, price: service.price, priceMax: service.priceMax };
    priceSource = 'service';
  }

  const durationSource: PriceSource =
    own?.duration != null ? 'specialist' : branch?.duration != null ? 'branch' : 'service';

  return {
    priceType: spec.priceType,
    price: spec.price,
    // A fixed price never carries a ceiling, whatever a stale row says.
    priceMax: spec.priceType === 'range' ? (spec.priceMax ?? null) : null,
    duration: own?.duration ?? branch?.duration ?? service.duration,
    capacity: branch?.capacity ?? service.capacity,
    priceSource,
    durationSource,
  };
}

/** A candidate for an "any available specialist" booking at one start time. */
export interface AssignmentCandidate {
  specialistId: string;
  name: string;
  /** Resolved price for this specialist at this branch. */
  price: number;
  /** Active bookings this specialist already has that day (any branch). */
  dayLoad: number;
}

/**
 * Who gets an "any available" booking: the least busy specialist that day, then
 * the lower price, then a stable order (name, id) so the same request always
 * picks the same person — the client is shown this choice before confirming,
 * so it must be deterministic.
 */
export function compareForAssignment(a: AssignmentCandidate, b: AssignmentCandidate): number {
  return (
    a.dayLoad - b.dayLoad ||
    a.price - b.price ||
    a.name.localeCompare(b.name) ||
    a.specialistId.localeCompare(b.specialistId)
  );
}
