import { Prisma, PartnerProductStatus } from '@prisma/client';
import type { ProductKey } from './product-keys';

/**
 * What "this partner may use this product" means — in the two forms the
 * codebase needs it, deliberately in one file.
 *
 * `grantConfersAccess` answers it for a row already in hand (the guard, which
 * reads one grant by its compound key). `activeGrantWhere` answers it as SQL,
 * for queries that filter across partners — the public vacancies board, which
 * must drop a suspended salon's listings without loading every grant into
 * memory first.
 *
 * They are two expressions of a single rule, so they live side by side: a
 * change to one that forgets the other is visible in the same diff. Keeping
 * them in separate modules is how a suspended partner ends up hidden from the
 * backoffice but still advertising on the public board.
 */

/** A grant only confers access while it is active (or inside a live trial). */
export const USABLE_STATUSES: readonly PartnerProductStatus[] = [
  PartnerProductStatus.active,
  PartnerProductStatus.trialing,
];

/** The fields the rule reads. Anything with these can be tested against it. */
export interface GrantAccessFields {
  status: PartnerProductStatus;
  disabledAt: Date | null;
  trialEndsAt: Date | null;
}

/**
 * Row form. An expired trial is not access, whatever the status column says —
 * nothing sweeps `trialing` to `expired`, so the clock is the truth.
 */
export function grantConfersAccess(row: GrantAccessFields | null, now = Date.now()): boolean {
  if (!row || row.disabledAt !== null) return false;
  if (!USABLE_STATUSES.includes(row.status)) return false;
  if (row.status === PartnerProductStatus.trialing && row.trialEndsAt !== null) {
    return row.trialEndsAt.getTime() > now;
  }
  return true;
}

/**
 * SQL form of the same rule, plus the requirement that the product itself is
 * still in the catalog and active.
 *
 * `productKey` is optional so the same predicate serves both "does this partner
 * hold vacancies?" and "every product this partner can use".
 */
export function activeGrantWhere(
  productKey?: ProductKey,
  now = new Date(),
): Prisma.PartnerProductWhereInput {
  return {
    ...(productKey ? { productKey } : {}),
    disabledAt: null,
    product: { active: true },
    OR: [
      { status: PartnerProductStatus.active },
      // Open-ended and still-running trials both count; an elapsed one does not.
      { status: PartnerProductStatus.trialing, trialEndsAt: null },
      { status: PartnerProductStatus.trialing, trialEndsAt: { gt: now } },
    ],
  };
}
