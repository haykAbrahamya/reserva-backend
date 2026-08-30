import { PartnerProductStatus } from '@prisma/client';
import { ProductsService } from './products.service';
import { PRODUCT_KEYS, isProductKey } from './product-keys';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';

/** Minimal shape of a `partner_products` row as the service reads it. */
interface GrantRow {
  status: PartnerProductStatus;
  disabledAt: Date | null;
  trialEndsAt: Date | null;
}

/**
 * A stand-in for PrismaService holding a single grant. Only the calls the
 * service actually makes are implemented, so an unexpected query fails loudly
 * rather than silently returning undefined.
 */
function serviceWithGrant(grant: GrantRow | null): ProductsService {
  const prisma = {
    partnerProduct: {
      findUnique: jest.fn().mockResolvedValue(grant),
    },
  };
  return new ProductsService(prisma as never);
}

const HOUR = 3_600_000;
const future = () => new Date(Date.now() + HOUR);
const past = () => new Date(Date.now() - HOUR);

describe('product keys', () => {
  it('narrows known keys and rejects unknown ones', () => {
    expect(isProductKey('bookings')).toBe(true);
    expect(isProductKey('courses')).toBe(true);
    expect(isProductKey('vacancies')).toBe(true);
    expect(isProductKey('seminars')).toBe(false); // seedable, but no code knows it yet
    expect(isProductKey('')).toBe(false);
  });

  it('uses lowercase plural keys, matching the columns and route names', () => {
    for (const key of PRODUCT_KEYS) {
      expect(key).toMatch(/^[a-z][a-z0-9-]*$/);
    }
    expect(PRODUCT_KEYS).toContain('bookings');
  });
});

describe('ProductsService.has — what actually grants access', () => {
  it('grants access for an active grant', async () => {
    const svc = serviceWithGrant({
      status: PartnerProductStatus.active,
      disabledAt: null,
      trialEndsAt: null,
    });
    await expect(svc.has('p1', 'bookings')).resolves.toBe(true);
  });

  it('refuses when there is no grant at all', async () => {
    const svc = serviceWithGrant(null);
    await expect(svc.has('p1', 'bookings')).resolves.toBe(false);
  });

  it('refuses a suspended grant', async () => {
    const svc = serviceWithGrant({
      status: PartnerProductStatus.suspended,
      disabledAt: null,
      trialEndsAt: null,
    });
    await expect(svc.has('p1', 'bookings')).resolves.toBe(false);
  });

  // disabledAt is set on withdrawal; the row is kept so settings survive a
  // later re-enable, so its presence — not its absence — must be the signal.
  it('refuses a withdrawn grant even if the status still reads active', async () => {
    const svc = serviceWithGrant({
      status: PartnerProductStatus.active,
      disabledAt: past(),
      trialEndsAt: null,
    });
    await expect(svc.has('p1', 'bookings')).resolves.toBe(false);
  });

  it('grants access during a live trial', async () => {
    const svc = serviceWithGrant({
      status: PartnerProductStatus.trialing,
      disabledAt: null,
      trialEndsAt: future(),
    });
    await expect(svc.has('p1', 'bookings')).resolves.toBe(true);
  });

  it('refuses once the trial has expired, without waiting for a status change', async () => {
    const svc = serviceWithGrant({
      status: PartnerProductStatus.trialing,
      disabledAt: null,
      trialEndsAt: past(),
    });
    await expect(svc.has('p1', 'bookings')).resolves.toBe(false);
  });

  it('treats an open-ended trial as access', async () => {
    const svc = serviceWithGrant({
      status: PartnerProductStatus.trialing,
      disabledAt: null,
      trialEndsAt: null,
    });
    await expect(svc.has('p1', 'bookings')).resolves.toBe(true);
  });
});

describe('ProductsService.assert', () => {
  it('passes silently when the product is enabled', async () => {
    const svc = serviceWithGrant({
      status: PartnerProductStatus.active,
      disabledAt: null,
      trialEndsAt: null,
    });
    await expect(svc.assert('p1', 'bookings')).resolves.toBeUndefined();
  });

  it('throws PRODUCT_NOT_ENABLED so clients can switch on the code', async () => {
    const svc = serviceWithGrant(null);
    await expect(svc.assert('p1', 'bookings')).rejects.toBeInstanceOf(AppException);
    await expect(svc.assert('p1', 'bookings')).rejects.toMatchObject({
      code: ErrorCode.PRODUCT_NOT_ENABLED,
    });
  });
});

describe('ProductsService.assertSelfServe — the signup boundary', () => {
  const withProduct = (product: unknown) =>
    new ProductsService({ product: { findUnique: jest.fn().mockResolvedValue(product) } } as never);

  it('allows a product the catalog marks self-serve', async () => {
    const svc = withProduct({ key: 'bookings', active: true, selfServe: true });
    await expect(svc.assertSelfServe('bookings')).resolves.toBeUndefined();
  });

  // The signup endpoint is unauthenticated, so this is what stops an anonymous
  // caller granting itself a curated product by posting its key.
  it('refuses a curated product', async () => {
    const svc = withProduct({ key: 'courses', active: true, selfServe: false });
    await expect(svc.assertSelfServe('courses')).rejects.toMatchObject({
      code: ErrorCode.UNKNOWN_PRODUCT,
    });
  });

  it('refuses an inactive product', async () => {
    const svc = withProduct({ key: 'seminars', active: false, selfServe: true });
    await expect(svc.assertSelfServe('seminars')).rejects.toMatchObject({
      code: ErrorCode.UNKNOWN_PRODUCT,
    });
  });

  it('refuses a product that is not in the catalog', async () => {
    const svc = withProduct(null);
    await expect(svc.assertSelfServe('nonsense')).rejects.toMatchObject({
      code: ErrorCode.UNKNOWN_PRODUCT,
    });
  });
});
