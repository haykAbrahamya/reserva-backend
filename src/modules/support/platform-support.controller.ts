import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '@/auth/decorators';
import { PlatformAuthGuard } from '@/platform/guards/platform-auth.guard';
import { CurrentPlatformUser } from '@/platform/platform.decorators';
import type { PlatformAuthUser } from '@/platform/platform.types';
import { PushService } from '@/modules/notifications/push.service';
import { SubscribeDto, UnsubscribeDto } from '@/modules/notifications/dto/push.dto';
import { SupportService } from './support.service';
import { SendSupportMessageDto, SupportHistoryQueryDto } from './dto/support.dto';

/**
 * Platform-side support API (internal-backoffice). Guarded by PlatformAuthGuard;
 * `@Public()` opts out of the global tenant JWT guard so the platform token is
 * the only accepted credential — same pattern as the other platform controllers.
 */
@ApiTags('Platform · Support')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformAuthGuard)
@Controller('platform/support')
export class PlatformSupportController {
  constructor(
    private readonly support: SupportService,
    private readonly push: PushService,
  ) {}

  @ApiOperation({ summary: 'List support threads (recent activity first)' })
  @Get('threads')
  threads() {
    return this.support.listThreads();
  }

  @ApiOperation({ summary: 'Total unread across all threads (nav badge)' })
  @Get('unread')
  async unread() {
    return { count: await this.support.platformUnreadTotal() };
  }

  @ApiOperation({ summary: 'One thread + latest messages' })
  @Get('threads/:id/messages')
  messages(@Param('id') id: string) {
    return this.support.platformThreadMessages(id);
  }

  @ApiOperation({ summary: 'Load older messages (cursor)' })
  @Get('threads/:id/history')
  history(@Param('id') id: string, @Query() q: SupportHistoryQueryDto) {
    return this.support.history(id, q.before, q.take);
  }

  @ApiOperation({ summary: 'Mark a thread read (platform side)' })
  @Post('threads/:id/read')
  async read(@Param('id') id: string) {
    await this.support.platformMarkRead(id);
    return { ok: true };
  }

  @ApiOperation({ summary: 'Reply to a partner in a thread' })
  @Post('threads/:id/messages')
  async send(
    @Param('id') id: string,
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Body() dto: SendSupportMessageDto,
  ) {
    // Resolve the partnerId from the thread, then send as the platform side.
    const thread = await this.support.threadPartnerId(id);
    return this.support.sendMessage({
      partnerId: thread,
      senderType: 'platform',
      senderUserId: user.id,
      body: dto.body,
    });
  }

  @ApiOperation({ summary: 'Close a ticket — permanently deletes the conversation' })
  @Post('threads/:id/close')
  async close(@Param('id') id: string) {
    await this.support.closeTicket(id);
    return { ok: true };
  }

  // ── Platform staff web-push (for offline support alerts) ──

  @Get('push/vapid-public-key')
  vapidKey() {
    return { publicKey: this.push.publicKey };
  }

  @Post('push/subscribe')
  @HttpCode(204)
  @ApiOperation({ summary: 'Register this platform device for support push' })
  async subscribe(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Body() dto: SubscribeDto,
    @Req() req: Request,
  ) {
    await this.push.subscribePlatform(user.id, dto, req.headers['user-agent'] ?? '');
  }

  @Post('push/unsubscribe')
  @HttpCode(204)
  async unsubscribe(@Body() dto: UnsubscribeDto) {
    await this.push.unsubscribePlatform(dto.endpoint);
  }
}
