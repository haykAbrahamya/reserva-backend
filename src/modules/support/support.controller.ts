import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CurrentUser } from '@/auth/decorators';
import type { AuthUser } from '@/auth/auth.types';
import { SupportService } from './support.service';
import { SendSupportMessageDto, SupportHistoryQueryDto } from './dto/support.dto';

/**
 * Partner-side support API (tenant JWT — the global JwtAuthGuard protects these).
 * The partnerId always comes from the token, never the client, so a partner can
 * only ever touch their own thread.
 */
@ApiTags('Support')
@ApiBearerAuth()
@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @ApiOperation({ summary: 'Get my support thread + latest messages' })
  @Get('thread')
  thread(@CurrentUser() user: AuthUser) {
    return this.support.partnerThreadView(user.partnerId);
  }

  @ApiOperation({ summary: 'Load older messages (cursor)' })
  @Get('messages')
  async history(@CurrentUser() user: AuthUser, @Query() q: SupportHistoryQueryDto) {
    const threadId = await this.support.findThreadId(user.partnerId);
    if (!threadId) return []; // no thread yet → no history, don't create one
    return this.support.history(threadId, q.before, q.take);
  }

  @ApiOperation({ summary: 'Unread count for the widget badge' })
  @Get('unread')
  async unread(@CurrentUser() user: AuthUser) {
    return { count: await this.support.partnerUnread(user.partnerId) };
  }

  @ApiOperation({ summary: 'Mark platform replies as read' })
  @Post('read')
  async read(@CurrentUser() user: AuthUser) {
    await this.support.partnerMarkRead(user.partnerId);
    return { ok: true };
  }

  @ApiOperation({ summary: 'Send a support message' })
  @Post('messages')
  send(@CurrentUser() user: AuthUser, @Body() dto: SendSupportMessageDto) {
    return this.support.sendMessage({
      partnerId: user.partnerId,
      senderType: 'partner',
      senderUserId: user.id,
      body: dto.body,
    });
  }
}
