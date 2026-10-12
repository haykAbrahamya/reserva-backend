import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import { RESERVED_SLUGS, assertSlugNotReserved, isReservedSlug } from './reserved-slugs';

describe('reserved slugs', () => {
  it("reserves every address Reserva's own sites live on", () => {
    for (const host of ['www', 'api', 'backoffice', 'console', 'tools', 'vacancies']) {
      expect(isReservedSlug(host)).toBe(true);
    }
  });

  it('matches regardless of case and surrounding space', () => {
    expect(isReservedSlug('Tools')).toBe(true);
    expect(isReservedSlug('  API ')).toBe(true);
  });

  it('leaves ordinary salon handles — and the real "demo" partner — alone', () => {
    for (const handle of ['anna-beauty', 'barberbro', 'tools-salon', 'demo']) {
      expect(isReservedSlug(handle)).toBe(false);
    }
  });

  it('holds only values that would otherwise pass slug validation', () => {
    // An entry the slug regex rejects anyway would be dead weight in the list.
    for (const slug of RESERVED_SLUGS) {
      expect(slug).toMatch(/^[a-z0-9-]{2,60}$/);
    }
  });

  it('refuses a reserved handle with the conflict a taken one gets', () => {
    let error: unknown;
    try {
      assertSlugNotReserved('tools');
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).code).toBe(ErrorCode.SLUG_TAKEN);
    expect((error as AppException).getStatus()).toBe(409);
  });

  it('lets an ordinary handle through', () => {
    expect(() => assertSlugNotReserved('anna-beauty')).not.toThrow();
  });
});
