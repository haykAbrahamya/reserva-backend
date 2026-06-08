import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes';

/**
 * The single domain exception type. Carries a stable {@link ErrorCode}, an HTTP
 * status, a human message and optional structured details. The global filter
 * serializes it to the standard error envelope.
 */
export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }

  // ── Common factory helpers (read at call sites like AppException.notFound()) ──

  static notFound(message = 'Resource not found', details?: unknown) {
    return new AppException(ErrorCode.NOT_FOUND, message, HttpStatus.NOT_FOUND, details);
  }

  static forbidden(message = 'You do not have access to this resource') {
    return new AppException(ErrorCode.FORBIDDEN, message, HttpStatus.FORBIDDEN);
  }

  static unauthenticated(message = 'Authentication required') {
    return new AppException(ErrorCode.UNAUTHENTICATED, message, HttpStatus.UNAUTHORIZED);
  }

  static conflict(code: ErrorCode, message: string, details?: unknown) {
    return new AppException(code, message, HttpStatus.CONFLICT, details);
  }

  static badRequest(code: ErrorCode, message: string, details?: unknown) {
    return new AppException(code, message, HttpStatus.BAD_REQUEST, details);
  }
}
