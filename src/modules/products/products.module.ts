import { Global, Module } from '@nestjs/common';
import { ProductsService } from './products.service';

/**
 * Product catalog + per-partner entitlements — the spine of the ecosystem.
 *
 * Global because entitlement checks are cross-cutting: the ProductGuard, the
 * signup flow, the platform console and every future product module need
 * `ProductsService`, and threading it through each module's imports would add
 * noise without adding safety.
 */
@Global()
@Module({
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
