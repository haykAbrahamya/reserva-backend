import { createBookingSchema } from './booking.dto';
import { publicCreateBookingSchema } from '@/modules/public/dto/public-booking.dto';

const UUID = '019f144b-e4c6-761e-9f4c-756b7d984838';

const backoffice = (clientPhone?: string) =>
  createBookingSchema.safeParse({
    locationId: UUID,
    specialistId: UUID,
    serviceId: UUID,
    clientName: 'Anna Karapetyan',
    startAt: '2026-08-31T19:00:00.000Z',
    ...(clientPhone === undefined ? {} : { clientPhone }),
  });

// The public flow posts a calendar date + slot time, not an absolute instant.
const publicBooking = (clientPhone?: string) =>
  publicCreateBookingSchema.safeParse({
    locationId: UUID,
    specialistId: UUID,
    serviceId: UUID,
    clientName: 'Anna Karapetyan',
    date: '2026-08-31',
    time: '19:00',
    ...(clientPhone === undefined ? {} : { clientPhone }),
  });

/**
 * The phone rule is deliberately ASYMMETRIC: staff booking a walk-in from the
 * backoffice may not have a number, but a client booking themselves online must
 * leave one so the salon can reach them. These tests pin both halves — relaxing
 * the public schema by copy-paste is the obvious way for this to regress.
 */
describe('client phone requirement', () => {
  describe('backoffice (createBookingSchema)', () => {
    it('accepts a booking with a phone', () => {
      expect(backoffice('+37493813298').success).toBe(true);
    });

    it('accepts a booking with the phone omitted entirely', () => {
      const res = backoffice(undefined);
      expect(res.success).toBe(true);
      // Normalised to '' so the service can treat it as "no phone on record".
      if (res.success) expect(res.data.clientPhone).toBe('');
    });

    it('accepts an explicitly empty phone', () => {
      const res = backoffice('');
      expect(res.success).toBe(true);
      if (res.success) expect(res.data.clientPhone).toBe('');
    });

    it('treats a whitespace-only phone as empty', () => {
      const res = backoffice('   ');
      expect(res.success).toBe(true);
      if (res.success) expect(res.data.clientPhone).toBe('');
    });

    it('still rejects a half-typed phone, so a typo cannot be saved silently', () => {
      expect(backoffice('+37').success).toBe(false);
      expect(backoffice('12').success).toBe(false);
    });

    it('still enforces the length cap', () => {
      expect(backoffice('9'.repeat(41)).success).toBe(false);
    });

    it('still requires a client name', () => {
      const res = createBookingSchema.safeParse({
        locationId: UUID,
        serviceId: UUID,
        clientName: '',
        startAt: '2026-08-31T19:00:00.000Z',
      });
      expect(res.success).toBe(false);
    });
  });

  describe('public (publicCreateBookingSchema) — must stay required', () => {
    it('accepts a booking with a phone', () => {
      expect(publicBooking('+37493813298').success).toBe(true);
    });

    it('rejects an omitted phone', () => {
      expect(publicBooking(undefined).success).toBe(false);
    });

    it('rejects an empty phone', () => {
      expect(publicBooking('').success).toBe(false);
      expect(publicBooking('   ').success).toBe(false);
    });

    it('rejects a half-typed phone', () => {
      expect(publicBooking('+37').success).toBe(false);
    });
  });
});
