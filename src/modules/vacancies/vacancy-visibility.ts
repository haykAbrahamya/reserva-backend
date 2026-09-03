import { Prisma } from '@prisma/client';
import { activeGrantWhere } from '@/modules/products/product-access';

/**
 * The single definition of "this listing is live to the public".
 *
 * It lives with the domain rather than with the board that renders it, because
 * more than one surface has to agree on it: the board lists by it, the detail
 * page reads by it, and the apply endpoint accepts by it. If those three ever
 * disagreed, the visible failure is the worst kind — a stranger applying to a
 * listing that was filled last month, because the write path was a little more
 * generous than the read path.
 *
 * Four independent conditions, all required:
 *
 *  1. the listing is published, approved, and inside its clock
 *  2. its branch still exists and has a structured area — a listing no filter
 *     can reach cannot be found on purpose, only stumbled into
 *  3. the salon is active
 *  4. the salon still holds the vacancies product, so a suspended entitlement
 *     removes its listings from the board. This is what makes the product
 *     boundary real rather than a hidden menu item.
 *
 * Composed as a list of AND clauses, not merged into one object: several of
 * these emit their own `OR`, and in a single literal the last would silently
 * overwrite the others — which would publish expired listings.
 */
export function liveVacancyWhere(now = new Date()): Prisma.VacancyWhereInput {
  return {
    AND: [
      { status: 'published', reviewStatus: 'approved', deletedAt: null },
      { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
      { location: { deletedAt: null, areaKey: { not: null } } },
      {
        partner: {
          active: true,
          deletedAt: null,
          products: { some: activeGrantWhere('vacancies', now) },
        },
      },
    ],
  };
}
