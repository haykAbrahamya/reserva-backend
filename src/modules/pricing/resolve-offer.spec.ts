import { resolveOffer, compareForAssignment, type ServiceDefaults } from './resolve-offer';
import { OfferBook } from './offer-book';

// The real story behind the feature: hair removal, 5 000 ֏ / 30 min by default.
const HAIR_REMOVAL: ServiceDefaults & { id: string } = {
  id: 'svc-hair',
  priceType: 'fixed',
  price: 5000,
  priceMax: null,
  duration: 30,
  capacity: 1,
};

const noBranch = null;
const nothing = { priceType: null, price: null, priceMax: null, duration: null };

describe('resolveOffer', () => {
  it('uses the service defaults when nothing overrides them', () => {
    expect(resolveOffer(HAIR_REMOVAL)).toEqual({
      priceType: 'fixed',
      price: 5000,
      priceMax: null,
      duration: 30,
      capacity: 1,
      priceSource: 'service',
      durationSource: 'service',
    });
  });

  it('prefers the branch price over the default', () => {
    const komitas = { ...nothing, offered: true, capacity: null, priceType: 'fixed' as const, price: 4000 };
    const offer = resolveOffer(HAIR_REMOVAL, komitas);
    expect(offer.price).toBe(4000);
    expect(offer.priceSource).toBe('branch');
    expect(offer.duration).toBe(30);
    expect(offer.durationSource).toBe('service');
  });

  it("prefers the specialist's own price over the branch price", () => {
    const branch = { ...nothing, offered: true, capacity: null, priceType: 'fixed' as const, price: 4000 };
    const anahit = { ...nothing, priceType: 'fixed' as const, price: 7000 };
    const offer = resolveOffer(HAIR_REMOVAL, branch, anahit);
    expect(offer.price).toBe(7000);
    expect(offer.priceSource).toBe('specialist');
  });

  it('falls back for duration independently of price', () => {
    const branch = { ...nothing, offered: true, capacity: null, priceType: 'fixed' as const, price: 4000 };
    const slowerButSamePrice = { ...nothing, duration: 45 };
    const offer = resolveOffer(HAIR_REMOVAL, branch, slowerButSamePrice);
    expect(offer).toMatchObject({ price: 4000, priceSource: 'branch', duration: 45, durationSource: 'specialist' });
  });

  it('moves the price as one unit: a fixed override drops the range ceiling', () => {
    const range: ServiceDefaults = { ...HAIR_REMOVAL, priceType: 'range', price: 5000, priceMax: 9000 };
    const fixed = { ...nothing, priceType: 'fixed' as const, price: 7000, priceMax: 9000 /* stale */ };
    expect(resolveOffer(range, noBranch, fixed)).toMatchObject({ priceType: 'fixed', price: 7000, priceMax: null });
  });

  it('keeps an open-ended range open', () => {
    const own = { ...nothing, priceType: 'range' as const, price: 6000, priceMax: null };
    expect(resolveOffer(HAIR_REMOVAL, noBranch, own)).toMatchObject({ priceType: 'range', price: 6000, priceMax: null });
  });

  it('ignores a half-filled price override (type without amount)', () => {
    const broken = { ...nothing, priceType: 'fixed' as const, price: null };
    expect(resolveOffer(HAIR_REMOVAL, noBranch, broken).priceSource).toBe('service');
  });

  it('takes capacity from the branch only', () => {
    const sauna: ServiceDefaults = { ...HAIR_REMOVAL, capacity: 4 };
    const branch = { ...nothing, offered: true, capacity: 6 };
    expect(resolveOffer(sauna, branch).capacity).toBe(6);
    expect(resolveOffer(sauna, null).capacity).toBe(4);
  });
});

describe('OfferBook', () => {
  // Kentron: no branch row (default 5 000). Komitas: branch price 4 000.
  // Hasmik works at both; Anahit (Kentron) charges 7 000 and takes 45 min.
  const book = new OfferBook(
    [
      { locationId: 'komitas', serviceId: 'svc-hair', offered: true, priceType: 'fixed', price: 4000, priceMax: null, duration: null, capacity: null },
      { locationId: 'komitas', serviceId: 'svc-laser', offered: false, priceType: null, price: null, priceMax: null, duration: null, capacity: null },
    ],
    [{ specialistId: 'anahit', locationId: 'kentron', serviceId: 'svc-hair', priceType: 'fixed', price: 7000, priceMax: null, duration: 45 }],
  );

  it('resolves the whole story', () => {
    expect(book.offer(HAIR_REMOVAL, 'kentron', 'hasmik')).toMatchObject({ price: 5000, priceSource: 'service' });
    expect(book.offer(HAIR_REMOVAL, 'komitas', 'hasmik')).toMatchObject({ price: 4000, priceSource: 'branch' });
    expect(book.offer(HAIR_REMOVAL, 'kentron', 'anahit')).toMatchObject({ price: 7000, duration: 45, priceSource: 'specialist' });
  });

  it('treats a missing branch row as offered, and honours an explicit "not here"', () => {
    expect(book.offered('kentron', 'svc-laser')).toBe(true);
    expect(book.offered('komitas', 'svc-laser')).toBe(false);
  });

  it('resolves without a specialist (facility services, list prices)', () => {
    expect(book.offer(HAIR_REMOVAL, 'komitas')).toMatchObject({ price: 4000 });
    expect(OfferBook.empty().offer(HAIR_REMOVAL, 'komitas')).toMatchObject({ price: 5000 });
  });
});

describe('compareForAssignment', () => {
  const c = (specialistId: string, name: string, price: number, dayLoad: number) => ({ specialistId, name, price, dayLoad });

  it('picks the least busy specialist first', () => {
    const order = [c('a', 'Anahit', 7000, 1), c('h', 'Hasmik', 5000, 3)].sort(compareForAssignment);
    expect(order[0].specialistId).toBe('a');
  });

  it('breaks a tie on load by the lower price, then by name', () => {
    const order = [c('a', 'Anahit', 7000, 2), c('h', 'Hasmik', 5000, 2), c('g', 'Gayane', 5000, 2)].sort(compareForAssignment);
    expect(order.map((x) => x.specialistId)).toEqual(['g', 'h', 'a']);
  });
});
