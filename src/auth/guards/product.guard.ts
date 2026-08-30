import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PRODUCT_KEY } from '../decorators';
import { AppException } from '@/common/errors/app.exception';
import { ProductsService } from '@/modules/products/products.service';
import type { ProductKey } from '@/modules/products/product-keys';
import type { AuthUser } from '../auth.types';

/**
 * Enforces `@RequiresProduct(...)` on routes. Runs after JwtAuthGuard, so the
 * principal (and therefore the organization) is already resolved.
 *
 * Routes without the decorator are unaffected, which is why this can be enabled
 * globally without touching any existing endpoint.
 */
@Injectable()
export class ProductGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly products: ProductsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<ProductKey | undefined>(PRODUCT_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required) return true;

    const user = ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user) throw AppException.unauthenticated();

    await this.products.assert(user.partnerId, required);
    return true;
  }
}
