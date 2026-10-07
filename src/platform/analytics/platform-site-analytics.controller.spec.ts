import { HttpException, type ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { PlatformRole } from '@prisma/client';
import { PlatformAuthGuard } from '../guards/platform-auth.guard';
import { PlatformRolesGuard } from '../guards/platform-roles.guard';
import { PlatformSiteAnalyticsController } from './platform-site-analytics.controller';

/**
 * Deleting analytics data is irreversible, so it is the owner's alone; every
 * report stays readable by any platform user. Checked against the
 * controller's real decorators, so dropping one fails here, not in production.
 */
describe('PlatformSiteAnalyticsController — who may do what', () => {
  const guard = new PlatformRolesGuard(new Reflector());
  const as = (role: PlatformRole, handler: (...args: never[]) => unknown) =>
    ({
      getHandler: () => handler,
      getClass: () => PlatformSiteAnalyticsController,
      switchToHttp: () => ({ getRequest: () => ({ platformUser: { id: 'u1', role } }) }),
    }) as unknown as ExecutionContext;
  const routes = PlatformSiteAnalyticsController.prototype;

  it('runs the auth guard and then the roles guard on every route', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, PlatformSiteAnalyticsController)).toEqual([
      PlatformAuthGuard,
      PlatformRolesGuard,
    ]);
  });

  it('refuses an operator deleting data with 403', () => {
    let error: unknown;
    try {
      guard.canActivate(as('operator', routes.clear));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(403);
  });

  it('lets the owner delete data', () => {
    expect(guard.canActivate(as('owner', routes.clear))).toBe(true);
  });

  it('lets any platform user read every report and the storage stats', () => {
    for (const handler of [
      routes.bounds,
      routes.overview,
      routes.partners,
      routes.sources,
      routes.events,
      routes.storage,
      routes.listSessions,
      routes.getSession,
    ]) {
      expect(guard.canActivate(as('operator', handler))).toBe(true);
      expect(guard.canActivate(as('owner', handler))).toBe(true);
    }
  });
});
