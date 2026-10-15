import { Module } from '@nestjs/common';
import { LeadsModule } from '@/modules/leads/leads.module';
import { DemoRequestsService } from './demo-requests.service';
import { DemoRequestsPublicController } from './demo-requests.public.controller';

/**
 * Demo-request leads from the public landing "Book a demo" form. The public
 * submit endpoint lives here; the internal-console triage endpoints live in
 * PlatformModule (which imports this module to reuse the service).
 */
@Module({
  // Every request also becomes a lead.
  imports: [LeadsModule],
  controllers: [DemoRequestsPublicController],
  providers: [DemoRequestsService],
  exports: [DemoRequestsService],
})
export class DemoRequestsModule {}
