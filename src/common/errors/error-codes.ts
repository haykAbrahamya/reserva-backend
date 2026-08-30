/**
 * Stable, machine-readable error codes returned in every error response as
 * `{ error: { code, message, details } }`. Clients should switch on `code`,
 * never on the human-readable `message`. Keep these stable across versions.
 */
export enum ErrorCode {
  // Generic
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  NOT_FOUND = 'NOT_FOUND',
  INTERNAL = 'INTERNAL',
  RATE_LIMITED = 'RATE_LIMITED',
  UPLOAD_FAILED = 'UPLOAD_FAILED',

  // Auth / access
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_INVALID = 'TOKEN_INVALID',
  FORBIDDEN = 'FORBIDDEN',
  WRONG_CURRENT_PASSWORD = 'WRONG_CURRENT_PASSWORD',

  // Domain — uniqueness / conflicts
  SLUG_TAKEN = 'SLUG_TAKEN',
  EMAIL_TAKEN = 'EMAIL_TAKEN',
  PHONE_TAKEN = 'PHONE_TAKEN',
  LOCATION_HAS_SPECIALISTS = 'LOCATION_HAS_SPECIALISTS',

  // Domain — products / entitlements
  /// The organization does not have access to the requested product.
  PRODUCT_NOT_ENABLED = 'PRODUCT_NOT_ENABLED',
  /// The product key is not in the catalog (or is not offered self-serve).
  UNKNOWN_PRODUCT = 'UNKNOWN_PRODUCT',

  // Domain — courses
  COURSE_FULL = 'COURSE_FULL',
  ENROLLMENT_CLOSED = 'ENROLLMENT_CLOSED',
  ALREADY_ENROLLED = 'ALREADY_ENROLLED',
  INVALID_COHORT_TRANSITION = 'INVALID_COHORT_TRANSITION',

  // Domain — bookings
  BOOKING_OVERLAP = 'BOOKING_OVERLAP',
  SPECIALIST_TIME_OFF = 'SPECIALIST_TIME_OFF',
  OUTSIDE_WORKING_HOURS = 'OUTSIDE_WORKING_HOURS',
  SERVICE_NOT_OFFERED = 'SERVICE_NOT_OFFERED',
  TIME_OFF_HAS_CONFLICTS = 'TIME_OFF_HAS_CONFLICTS',
  INVALID_TIME_RANGE = 'INVALID_TIME_RANGE',
  PAST_DATE = 'PAST_DATE',
}
