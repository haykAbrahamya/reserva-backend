import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { UserRole } from '@prisma/client';
import type { AuthUser } from './auth.types';
import type { ProductKey } from '@/modules/products/product-keys';

/** Marks a route as not requiring authentication (public booking, login, etc.). */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restricts a route to the given role(s). Used with RolesGuard. */
export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Restricts a route to partners who have the given product enabled. Used with
 * ProductGuard, e.g. `@RequiresProduct('vacancies')`.
 *
 * This is the real product boundary — hiding a menu item in the backoffice is
 * cosmetic, this is what stops a partner without the entitlement calling the
 * endpoint directly.
 */
export const PRODUCT_KEY = 'requiredProduct';
export const RequiresProduct = (product: ProductKey) => SetMetadata(PRODUCT_KEY, product);

/** Injects the authenticated principal: `@CurrentUser() user: AuthUser`. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as AuthUser;
  },
);
