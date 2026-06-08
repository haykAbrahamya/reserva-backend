import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/** Marker so handlers can return a fully-formed body (e.g. paginated lists,
 *  the OpenAPI doc) without being wrapped again in `{ data }`. */
export const RAW_RESPONSE = Symbol('raw_response');
export type Raw<T> = T & { [RAW_RESPONSE]?: true };

/**
 * Wraps successful handler results in `{ data: <result> }` for a consistent
 * envelope across the API. Already-shaped responses (those carrying the
 * RAW_RESPONSE marker, e.g. `{ items, page, ... }`) pass through untouched.
 */
@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((result) => {
        if (result && typeof result === 'object' && RAW_RESPONSE in result) {
          const { [RAW_RESPONSE]: _omit, ...rest } = result as Record<PropertyKey, unknown>;
          return rest;
        }
        return { data: result };
      }),
    );
  }
}
