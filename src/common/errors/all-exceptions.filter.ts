import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import type { Request, Response } from 'express';
import { AppException } from './app.exception';
import { ErrorCode } from './error-codes';
import { reportException } from '../monitoring/sentry';

interface ErrorBody {
  code: ErrorCode | string;
  message: string;
  details?: unknown;
}

/**
 * Translates every thrown error into the canonical envelope:
 *   { error: { code, message, details? } }
 * Known Prisma errors (unique violation, our overlap EXCLUDE constraint) are
 * mapped to friendly domain codes so the client never sees a raw DB error.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const { status, body } = this.resolve(exception);

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.url} → ${status} ${body.code}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      // Report only unexpected 5xx to Sentry (expected 4xx are normal, ignored).
      const user = (req as Request & { user?: { id?: string; partnerId?: string } }).user;
      reportException(exception, {
        method: req.method,
        url: req.url,
        partnerId: user?.partnerId,
        userId: user?.id,
      });
    }

    res.status(status).json({ error: body });
  }

  private resolve(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        body: { code: exception.code, message: messageOf(exception), details: exception.details },
      };
    }

    if (exception instanceof ZodError) {
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        body: {
          code: ErrorCode.VALIDATION_FAILED,
          message: 'Validation failed',
          details: exception.flatten(),
        },
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrisma(exception);
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const resp = exception.getResponse();
      const message =
        typeof resp === 'string' ? resp : ((resp as { message?: string }).message ?? exception.message);
      return { status, body: { code: codeForStatus(status), message } };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { code: ErrorCode.INTERNAL, message: 'Internal server error' },
    };
  }

  private fromPrisma(e: Prisma.PrismaClientKnownRequestError): { status: number; body: ErrorBody } {
    switch (e.code) {
      case 'P2002': {
        // Unique constraint — map common targets to specific codes.
        const target = String((e.meta?.target as string[] | string) ?? '');
        if (target.includes('slug'))
          return conflict(ErrorCode.SLUG_TAKEN, 'That slug is already taken');
        if (target.includes('email'))
          return conflict(ErrorCode.EMAIL_TAKEN, 'That email is already in use');
        if (target.includes('phone'))
          return conflict(ErrorCode.PHONE_TAKEN, 'That phone number is already in use');
        return conflict(ErrorCode.VALIDATION_FAILED, 'A record with these values already exists');
      }
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          body: { code: ErrorCode.NOT_FOUND, message: 'Resource not found' },
        };
      default:
        // The booking overlap EXCLUDE constraint surfaces as a raw DB error
        // (P2010/raw); the bookings service catches it explicitly, so anything
        // reaching here is unexpected.
        this.logger.error(`Unhandled Prisma error ${e.code}: ${e.message}`);
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          body: { code: ErrorCode.INTERNAL, message: 'Database error' },
        };
    }
  }
}

function conflict(code: ErrorCode, message: string) {
  return { status: HttpStatus.CONFLICT, body: { code, message } };
}

function messageOf(e: AppException): string {
  const r = e.getResponse();
  return typeof r === 'object' && r && 'message' in r ? String((r as { message: unknown }).message) : e.message;
}

function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 401:
      return ErrorCode.UNAUTHENTICATED;
    case 403:
      return ErrorCode.FORBIDDEN;
    case 404:
      return ErrorCode.NOT_FOUND;
    case 429:
      return ErrorCode.RATE_LIMITED;
    case 422:
      return ErrorCode.VALIDATION_FAILED;
    default:
      return status >= 500 ? ErrorCode.INTERNAL : ErrorCode.VALIDATION_FAILED;
  }
}
