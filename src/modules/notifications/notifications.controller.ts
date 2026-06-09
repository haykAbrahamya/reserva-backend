import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { CurrentUser } from '@/auth/decorators';
import type { AuthUser } from '@/auth/auth.types';
import { ListNotificationsQueryDto } from './dto/notification.dto';
import { RAW_RESPONSE } from '@/common/interceptors/transform.interceptor';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: "List my notifications (paginated; includes unread count)" })
  async list(@CurrentUser() user: AuthUser, @Query() q: ListNotificationsQueryDto) {
    const result = await this.notifications.list(user.id, q);
    return { ...result, [RAW_RESPONSE]: true as const };
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'My unread notification count (for the bell badge)' })
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.notifications.unreadCount(user.id);
  }

  @Patch(':id/read')
  @HttpCode(204)
  @ApiOperation({ summary: 'Mark one notification read' })
  async markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.notifications.markRead(user.id, id);
  }

  @Post('read-all')
  @HttpCode(204)
  @ApiOperation({ summary: 'Mark all my notifications read' })
  async markAllRead(@CurrentUser() user: AuthUser) {
    await this.notifications.markAllRead(user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete one of my notifications' })
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.notifications.remove(user.id, id);
  }
}
