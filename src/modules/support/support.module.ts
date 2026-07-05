import { Module } from '@nestjs/common';
import { SupportService } from './support.service';
import { SupportGateway } from './support.gateway';
import { SupportController } from './support.controller';
import { PlatformSupportController } from './platform-support.controller';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { PlatformAuthGuard } from '@/platform/guards/platform-auth.guard';

/**
 * Support chat: partner ⇄ platform 1:1 threads. REST for send/history/read
 * (validation + push fan-out in one place) and a WebSocket gateway for live
 * delivery. NotificationsModule provides PushService (offline fallback). The
 * service ↔ gateway pair use forwardRef (each references the other).
 */
@Module({
  imports: [NotificationsModule],
  controllers: [SupportController, PlatformSupportController],
  providers: [SupportService, SupportGateway, PlatformAuthGuard],
  exports: [SupportService],
})
export class SupportModule {}
