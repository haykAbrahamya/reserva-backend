import { Module } from '@nestjs/common';
import { LeadsService } from './leads.service';

/**
 * Leads: potential partners for the internal console. The sign-up, demo-request
 * and site-analytics modules import this to capture them as they arrive; the
 * console endpoints live in PlatformModule.
 */
@Module({
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
