import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { buildOriginChecker } from '@/common/utils/cors-origin';
import type { Env } from '@/config/env.config';
import type { JwtPayload } from '@/auth/auth.types';
import type { PlatformJwtPayload } from '@/platform/platform.types';
import type { SupportMessageDto } from './support.service';

/** Room helpers — one room per partner, one shared room for platform staff. */
const partnerRoom = (partnerId: string) => `support:partner:${partnerId}`;
const PLATFORM_ROOM = 'support:platform';

/** What we stash on the socket after a successful handshake. */
interface SupportSocket extends Socket {
  data: {
    side: 'partner' | 'platform';
    userId: string;
    partnerId?: string; // partner side only
  };
}

/**
 * WebSocket gateway for support chat. Namespaced at `/support`. Authenticates the
 * handshake with the SAME JWTs the REST API uses (partner access token OR
 * platform access token — distinguished by the `type` claim), then joins the
 * socket to the appropriate room. Sending is done over REST (so validation +
 * push fan-out live in one place); the gateway is the live delivery channel and
 * emits domain events the clients subscribe to.
 */
@WebSocketGateway({
  namespace: '/support',
  // Origin gating is enforced in afterInit() via the shared checker (same rule
  // as the HTTP server). Kept permissive here; the real check runs at handshake.
  cors: { credentials: true, origin: true },
})
export class SupportGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer() server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private isAllowedOrigin = (_origin: string | undefined): boolean => true;

  afterInit(_server: Server) {
    // Build the config-driven origin checker once, applied per-handshake below.
    const allowed = this.config.get<Env['CORS_ORIGINS']>('CORS_ORIGINS') ?? [];
    const baseDomain = this.config.get<string>('CORS_BASE_DOMAIN') ?? '';
    this.isAllowedOrigin = buildOriginChecker(allowed, baseDomain);
  }

  async handleConnection(client: SupportSocket) {
    try {
      // Origin gate — same rule as the HTTP CORS check.
      if (!this.isAllowedOrigin(client.handshake.headers.origin)) {
        return this.reject(client, 'origin_not_allowed');
      }

      const token = this.extractToken(client);
      if (!token) return this.reject(client, 'no_token');

      // Same secret for both token families; the `type` claim tells them apart.
      const payload = await this.jwt.verifyAsync<JwtPayload | PlatformJwtPayload>(token, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      });

      if (payload.type === 'access') {
        const p = payload as JwtPayload;
        client.data = { side: 'partner', userId: p.sub, partnerId: p.partnerId };
        await client.join(partnerRoom(p.partnerId));
      } else if (payload.type === 'platform-access') {
        const p = payload as PlatformJwtPayload;
        client.data = { side: 'platform', userId: p.sub };
        await client.join(PLATFORM_ROOM);
      } else {
        return this.reject(client, 'bad_token_type');
      }
    } catch {
      return this.reject(client, 'auth_failed');
    }
  }

  private reject(client: Socket, reason: string) {
    client.emit('support:error', { reason });
    client.disconnect(true);
  }

  private extractToken(client: Socket): string | null {
    // Prefer the socket.io auth payload; fall back to a query param.
    const fromAuth = (client.handshake.auth as { token?: string } | undefined)?.token;
    if (fromAuth) return fromAuth;
    const q = client.handshake.query?.token;
    return typeof q === 'string' ? q : null;
  }

  // ── Client → server: typing indicator ──

  /**
   * Relay a typing signal to the OTHER side of the conversation. Partner typing
   * → the platform room (tagged with their partnerId so the console shows it on
   * the right thread); platform typing → that partner's room. Ephemeral: nothing
   * is persisted, and the client auto-clears after a short idle timeout.
   */
  @SubscribeMessage('support:typing')
  handleTyping(
    @ConnectedSocket() client: SupportSocket,
    @MessageBody() data: { threadPartnerId?: string; typing: boolean },
  ) {
    if (client.data?.side === 'partner') {
      const partnerId = client.data.partnerId!;
      this.server.to(PLATFORM_ROOM).emit('support:typing', {
        from: 'partner',
        partnerId,
        typing: !!data?.typing,
      });
    } else if (client.data?.side === 'platform') {
      // Platform must say which partner thread they're typing in.
      const partnerId = data?.threadPartnerId;
      if (!partnerId) return;
      this.server.to(partnerRoom(partnerId)).emit('support:typing', {
        from: 'platform',
        partnerId,
        typing: !!data?.typing,
      });
    }
  }

  // ── Emit helpers (called by SupportService after a message is persisted) ──

  /** Deliver a new message to the partner's room AND the platform room, so both
   *  ends (and the sender's other tabs) update live. */
  emitMessage(partnerId: string, message: SupportMessageDto) {
    this.server.to(partnerRoom(partnerId)).emit('support:message', message);
    this.server.to(PLATFORM_ROOM).emit('support:message', message);
  }

  /** Nudge the platform console to refresh its unread badge/thread list. */
  emitPlatformBadge() {
    this.server.to(PLATFORM_ROOM).emit('support:badge');
  }

  /** Read-receipt: tell the OTHER side their messages were seen. `reader` is who
   *  did the reading, so the counterpart marks their own sent messages "seen". */
  emitRead(partnerId: string, reader: 'partner' | 'platform') {
    this.server.to(partnerRoom(partnerId)).emit('support:read', { partnerId, reader });
    this.server.to(PLATFORM_ROOM).emit('support:read', { partnerId, reader });
  }

  /** A ticket was closed (hard-deleted). Both ends clear the conversation; the
   *  partner's widget resets to a fresh, empty "first message" state. */
  emitClosed(partnerId: string) {
    this.server.to(partnerRoom(partnerId)).emit('support:closed', { partnerId });
    this.server.to(PLATFORM_ROOM).emit('support:closed', { partnerId });
  }
}
