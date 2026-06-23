import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { Public } from '@/auth/decorators';
import { PrismaService } from '@/prisma/prisma.service';
import { AppException } from '@/common/errors/app.exception';
import { PushService } from './push.service';

const subscribeSchema = z.object({
  bookingId: z.string().uuid(),
  subscription: z.object({
    endpoint: z.string().url(),
    keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  }),
});

/**
 * Public Web Push enrolment for a booking's CUSTOMER (anonymous — no auth).
 * The client app registers a service worker, subscribes via the VAPID public
 * key, then posts the subscription here scoped to its booking. We then notify
 * that device when the booking's status changes (see BookingNotifier).
 */
@ApiTags('Public · Push')
@Public()
@Controller('public/push')
export class ClientPushController {
  constructor(
    private readonly push: PushService,
    private readonly prisma: PrismaService,
  ) {}

  /** VAPID public key the browser needs to create a push subscription. */
  @Get('public-key')
  @ApiOperation({ summary: 'VAPID public key for client push subscriptions' })
  publicKey() {
    return { key: this.push.publicKey || null };
  }

  /** Save a device's push subscription for a specific booking. */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('subscribe')
  @ApiOperation({ summary: 'Subscribe a device to a booking’s push notifications' })
  async subscribe(@Body() body: unknown) {
    const { bookingId, subscription } = subscribeSchema.parse(body);

    // Guard: the booking must exist (don't store orphan subscriptions).
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true },
    });
    if (!booking) throw AppException.notFound('Booking not found');

    await this.push.subscribeClient(bookingId, subscription);
    return { ok: true };
  }
}
