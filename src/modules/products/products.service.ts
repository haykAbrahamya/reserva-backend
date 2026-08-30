import { Injectable } from '@nestjs/common';
import { Prisma, PartnerProductStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import { newId } from '@/common/ids';
import type { ProductKey } from './product-keys';

/** A product as exposed to clients (catalog metadata + this partner's grant). */
export interface PartnerProductView {
  key: string;
  name: string;
  status: PartnerProductStatus;
  plan: string | null;
  trialEndsAt: Date | null;
  settings: Prisma.JsonValue;
}

/**
 * Per-product provisioning, run once inside the same transaction that creates
 * the grant. This is the seam that makes "enable a product later" behave
 * identically to "signed up for it" — e.g. a future `vacancies` hook could seed
 * default listing categories.
 */
type ProductSetupHook = (partnerId: string, tx: Prisma.TransactionClient) => Promise<void>;

/** A grant only confers access while it is active (or inside a live trial). */
const USABLE_STATUSES: readonly PartnerProductStatus[] = [
  PartnerProductStatus.active,
  PartnerProductStatus.trialing,
];

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Product setup hooks by key. Empty today: booking's provisioning still lives
   * in the signup path because that is the only way a partner gets it. When a
   * product needs first-time setup, register it here so signup and a later
   * upgrade both go through the same code.
   */
  private readonly setupHooks: Partial<Record<ProductKey, ProductSetupHook>> = {};

  /** The catalog — every product on offer, in display order. */
  async catalog() {
    return this.prisma.product.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /**
   * Products this partner can currently use, in display order.
   *
   * Deliberately NOT cached: entitlements gate access, so a suspension or
   * downgrade has to take effect immediately rather than after a TTL. It is a
   * single indexed lookup on `(partnerId, productKey)`.
   */
  async listFor(partnerId: string): Promise<PartnerProductView[]> {
    const rows = await this.prisma.partnerProduct.findMany({
      where: {
        partnerId,
        disabledAt: null,
        status: { in: [...USABLE_STATUSES] },
        product: { active: true },
      },
      include: { product: { select: { name: true, sortOrder: true } } },
      orderBy: { product: { sortOrder: 'asc' } },
    });

    const now = Date.now();
    return rows
      // An expired trial is not access, whatever the status column says.
      .filter((r) => !this.isExpiredTrial(r.status, r.trialEndsAt, now))
      .map((r) => ({
        key: r.productKey,
        name: r.product.name,
        status: r.status,
        plan: r.plan,
        trialEndsAt: r.trialEndsAt,
        settings: r.settings,
      }));
  }

  /** Whether the partner may use a product right now. */
  async has(partnerId: string, key: ProductKey): Promise<boolean> {
    const row = await this.prisma.partnerProduct.findUnique({
      where: { partnerId_productKey: { partnerId, productKey: key } },
      select: { status: true, disabledAt: true, trialEndsAt: true },
    });
    if (!row || row.disabledAt !== null) return false;
    if (!USABLE_STATUSES.includes(row.status)) return false;
    return !this.isExpiredTrial(row.status, row.trialEndsAt, Date.now());
  }

  /** Throwing form, for guards and service-level checks. */
  async assert(partnerId: string, key: ProductKey): Promise<void> {
    if (!(await this.has(partnerId, key))) {
      throw AppException.badRequest(
        ErrorCode.PRODUCT_NOT_ENABLED,
        'This product is not enabled for your account',
      );
    }
  }

  /**
   * Assert a product exists, is active, and may be taken self-serve.
   *
   * Checked against the catalog rather than a hardcoded list, so offering a new
   * product self-serve is a data change (`UPDATE products SET "selfServe"`), not
   * a deploy. Used on the signup path, where the caller is anonymous and must
   * never be able to grant itself a curated product.
   */
  async assertSelfServe(key: string): Promise<void> {
    const product = await this.prisma.product.findUnique({ where: { key } });
    if (!product || !product.active || !product.selfServe) {
      throw AppException.badRequest(
        ErrorCode.UNKNOWN_PRODUCT,
        `'${key}' is not available for self-serve signup`,
      );
    }
  }

  /**
   * Create or revive a grant on an EXISTING transaction.
   *
   * Exposed so callers that must be atomic with other writes — signup creates
   * partner + admin + grant together — reuse this one definition of a grant row
   * instead of hand-rolling their own insert. Does not run setup hooks; the
   * caller owns the transaction and its own provisioning.
   */
  async grantWithin(
    tx: Prisma.TransactionClient,
    partnerId: string,
    key: string,
    opts: { enabledById?: string | null; plan?: string | null; trialEndsAt?: Date | null } = {},
  ): Promise<void> {
    const existing = await tx.partnerProduct.findUnique({
      where: { partnerId_productKey: { partnerId, productKey: key } },
      select: { id: true },
    });

    if (existing) {
      await tx.partnerProduct.update({
        where: { id: existing.id },
        data: {
          status: PartnerProductStatus.active,
          disabledAt: null,
          ...(opts.plan !== undefined && { plan: opts.plan }),
          ...(opts.trialEndsAt !== undefined && { trialEndsAt: opts.trialEndsAt }),
        },
      });
      return;
    }

    await tx.partnerProduct.create({
      data: {
        id: newId(),
        partnerId,
        productKey: key,
        status: opts.trialEndsAt ? PartnerProductStatus.trialing : PartnerProductStatus.active,
        plan: opts.plan ?? null,
        trialEndsAt: opts.trialEndsAt ?? null,
        enabledById: opts.enabledById ?? null,
      },
    });
  }

  /**
   * Grant a product, running its setup hook the first time.
   *
   * Idempotent: re-enabling a previously disabled grant revives the existing row
   * so its settings and history survive, and does NOT re-run setup.
   */
  async enable(
    partnerId: string,
    key: string,
    opts: { enabledById?: string | null; plan?: string | null; trialEndsAt?: Date | null } = {},
  ): Promise<void> {
    const product = await this.prisma.product.findUnique({ where: { key } });
    if (!product || !product.active) {
      throw AppException.badRequest(ErrorCode.UNKNOWN_PRODUCT, `Unknown product '${key}'`);
    }

    await this.prisma.$transaction(async (tx) => {
      const alreadyGranted =
        (await tx.partnerProduct.count({
          where: { partnerId, productKey: key },
        })) > 0;

      await this.grantWithin(tx, partnerId, key, opts);

      // First-time setup only — a revived grant keeps whatever it had.
      if (!alreadyGranted) {
        const hook = this.setupHooks[key as ProductKey];
        if (hook) await hook(partnerId, tx);
      }
    });
  }

  /**
   * Withdraw access. The row is kept (not deleted) so settings and audit history
   * survive a later re-enable.
   */
  async disable(partnerId: string, key: string): Promise<void> {
    const existing = await this.prisma.partnerProduct.findUnique({
      where: { partnerId_productKey: { partnerId, productKey: key } },
      select: { id: true },
    });
    if (!existing) return;

    await this.prisma.partnerProduct.update({
      where: { id: existing.id },
      data: { status: PartnerProductStatus.suspended, disabledAt: new Date() },
    });
  }

  private isExpiredTrial(
    status: PartnerProductStatus,
    trialEndsAt: Date | null,
    now: number,
  ): boolean {
    return (
      status === PartnerProductStatus.trialing &&
      trialEndsAt !== null &&
      trialEndsAt.getTime() <= now
    );
  }
}
