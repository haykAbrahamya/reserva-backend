import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import { OfferBook } from './offer-book';
import type { SaveServicePricingInput } from './dto/pricing.dto';

/** The `partner_products.settings` key that switches the feature on. */
export const BRANCH_PRICING_SETTING = 'branchPricing';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * Branch & specialist pricing: loading override rows for the booking engine,
 * the feature switch, and the backoffice price-grid writes.
 *
 * Resolution itself is the pure `resolveOffer` (via {@link OfferBook}), so it is
 * the same everywhere and needs no database to test.
 */
@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Reading ──────────────────────────────────────────────

  /**
   * Load a partner's overrides into an {@link OfferBook}. Optionally narrowed to
   * some services / branches — the booking path asks for one service only.
   */
  async book(
    partnerId: string,
    filter: { serviceIds?: string[]; locationIds?: string[] } = {},
    db: Db = this.prisma,
  ): Promise<OfferBook> {
    const where = {
      partnerId,
      ...(filter.serviceIds ? { serviceId: { in: filter.serviceIds } } : {}),
      ...(filter.locationIds ? { locationId: { in: filter.locationIds } } : {}),
    };
    const [branchRows, ownRows] = await Promise.all([
      db.locationService.findMany({ where }),
      db.specialistPrice.findMany({ where }),
    ]);
    return new OfferBook(branchRows, ownRows);
  }

  /** Raw override rows for the backoffice, which resolves them with the shared rule. */
  async overrides(partnerId: string) {
    const [enabled, branches, specialists] = await Promise.all([
      this.isEnabled(partnerId),
      this.prisma.locationService.findMany({
        where: { partnerId },
        orderBy: [{ serviceId: 'asc' }, { locationId: 'asc' }],
      }),
      this.prisma.specialistPrice.findMany({
        where: { partnerId },
        orderBy: [{ serviceId: 'asc' }, { locationId: 'asc' }, { specialistId: 'asc' }],
      }),
    ]);
    return { enabled, branches, specialists };
  }

  // ── Feature switch ───────────────────────────────────────

  /**
   * Whether the partner may manage branch & specialist pricing (and put one
   * specialist at several branches). Stored on the bookings grant's settings
   * and toggled from the internal console.
   *
   * It gates the EDITING of new data only. Resolution is data-driven, so prices
   * already set keep applying if the switch is turned off again — nothing a
   * client has been quoted can change underneath them.
   */
  async isEnabled(partnerId: string, db: Db = this.prisma): Promise<boolean> {
    const grant = await db.partnerProduct.findUnique({
      where: { partnerId_productKey: { partnerId, productKey: 'bookings' } },
      select: { settings: true },
    });
    const settings = grant?.settings;
    return (
      !!settings &&
      typeof settings === 'object' &&
      !Array.isArray(settings) &&
      (settings as Record<string, unknown>)[BRANCH_PRICING_SETTING] === true
    );
  }

  async assertEnabled(partnerId: string, db: Db = this.prisma): Promise<void> {
    if (!(await this.isEnabled(partnerId, db))) {
      throw new AppException(
        ErrorCode.FEATURE_NOT_ENABLED,
        'Branch & specialist pricing is not enabled for this account',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  // ── Writing ──────────────────────────────────────────────

  /**
   * Replace one service's price grid with `input`, for the branches the caller
   * may edit (a manager: their own branch; an admin: all). Rows that only repeat
   * the defaults are not stored — both tables stay sparse.
   */
  async saveServicePricing(
    partnerId: string,
    serviceId: string,
    input: SaveServicePricingInput,
    scopeLocationId: string | null,
    onlyLocationId?: string,
  ) {
    await this.assertEnabled(partnerId);

    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, partnerId, deletedAt: null },
      select: { id: true },
    });
    if (!service) throw AppException.notFound('Service not found');

    const branches = await this.prisma.location.findMany({
      where: { partnerId, deletedAt: null },
      select: { id: true },
    });
    const partnerBranches = new Set(branches.map((b) => b.id));
    if (onlyLocationId && !partnerBranches.has(onlyLocationId)) throw AppException.notFound('Location not found');
    if (scopeLocationId && onlyLocationId && onlyLocationId !== scopeLocationId) {
      throw AppException.forbidden('You can only change prices at your own branch');
    }
    const editable = new Set(
      onlyLocationId ? [onlyLocationId] : scopeLocationId ? [scopeLocationId] : partnerBranches,
    );

    const branchInput = input.branches;
    const ownInput = input.specialists;
    const assertEditable = (locationId: string) => {
      if (!partnerBranches.has(locationId)) throw AppException.notFound('Location not found');
      if (!editable.has(locationId)) throw AppException.forbidden('You can only change prices at your own branch');
    };
    branchInput?.forEach((r) => assertEditable(r.locationId));
    ownInput?.forEach((r) => assertEditable(r.locationId));

    // A personal price needs a specialist who works at that branch and does the service.
    if (ownInput?.length) {
      const links = await this.prisma.specialistLocation.findMany({
        where: {
          partnerId,
          specialist: { deletedAt: null, services: { some: { serviceId } } },
          OR: ownInput.map((r) => ({ specialistId: r.specialistId, locationId: r.locationId })),
        },
        select: { specialistId: true, locationId: true },
      });
      const ok = new Set(links.map((l) => `${l.specialistId}|${l.locationId}`));
      const bad = ownInput.find((r) => !ok.has(`${r.specialistId}|${r.locationId}`));
      if (bad) {
        throw AppException.badRequest(
          ErrorCode.SPECIALIST_NOT_AT_LOCATION,
          'A specialist price was set for a branch or service that specialist does not work with',
          { specialistId: bad.specialistId, locationId: bad.locationId },
        );
      }
    }

    const scope = [...editable];

    await this.prisma.$transaction(async (tx) => {
      if (branchInput) {
        // Keep the table sparse: a row that changes nothing is not a row.
        const rows = branchInput.filter(
          (r) => !r.offered || r.price != null || r.duration != null || r.capacity != null,
        );
        await tx.locationService.deleteMany({ where: { partnerId, serviceId, locationId: { in: scope } } });
        if (rows.length) {
          await tx.locationService.createMany({
            data: rows.map((r) => ({
              locationId: r.locationId,
              serviceId,
              partnerId,
              offered: r.offered,
              priceType: r.priceType,
              price: r.price,
              priceMax: r.priceType === 'range' ? r.priceMax : null,
              duration: r.duration,
              capacity: r.capacity,
            })),
          });
        }
      }
      if (ownInput) {
        const rows = ownInput.filter((r) => r.price != null || r.duration != null);
        await tx.specialistPrice.deleteMany({ where: { partnerId, serviceId, locationId: { in: scope } } });
        if (rows.length) {
          await tx.specialistPrice.createMany({
            data: rows.map((r) => ({
              specialistId: r.specialistId,
              locationId: r.locationId,
              serviceId,
              partnerId,
              priceType: r.priceType,
              price: r.price,
              priceMax: r.priceType === 'range' ? r.priceMax : null,
              duration: r.duration,
            })),
          });
        }
      }
    });

    return this.overrides(partnerId);
  }
}
