import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { PushService } from './push.service';
import { CurrentUser } from '@/auth/decorators';
import type { AuthUser } from '@/auth/auth.types';
import { SubscribeDto, UnsubscribeDto } from './dto/push.dto';

@ApiTags('Push')
@ApiBearerAuth()
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('vapid-public-key')
  @ApiOperation({ summary: 'The VAPID public key the browser needs to subscribe' })
  vapidKey() {
    return { publicKey: this.push.publicKey };
  }

  @Post('subscribe')
  @HttpCode(204)
  @ApiOperation({ summary: 'Register this device for push notifications' })
  async subscribe(
    @CurrentUser() user: AuthUser,
    @Body() dto: SubscribeDto,
    @Req() req: Request,
  ) {
    await this.push.subscribe(user.id, dto, req.headers['user-agent'] ?? '');
  }

  @Post('unsubscribe')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove this device subscription' })
  async unsubscribe(@Body() dto: UnsubscribeDto) {
    await this.push.unsubscribe(dto.endpoint);
  }
}
