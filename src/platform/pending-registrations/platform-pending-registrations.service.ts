import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHash } from 'crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { MailService } from '@/mail/mail.service';
import { SignupService } from '@/modules/signup/signup.service';
import { AppException } from '@/common/errors/app.exception';
import { paginate, pageArgs } from '@/common/dto/pagination';
import type { ListPendingRegistrationsQueryDto } from './dto/pending-registration.dto';

const TOKEN_TTL_HOURS = 24;
const hashToken = (raw: string) => createHash('sha256').update(raw).digest('hex');

/**
 * Internal-console view of self-serve signups that haven't been activated yet —
 * i.e. people who started a free trial but never clicked the email link. Staff
 * can see who's stuck, resend the activation email, or clear stale entries.
 */
@Injectable()
export class PlatformPendingRegistrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly signup: SignupService,
  ) {}

  /** Paginated list. Default shows still-actionable pending signups (not yet
   *  consumed and not expired); `status=expired` shows the lapsed ones. */
  async list(q: ListPendingRegistrationsQueryDto) {
    const now = new Date();
    const where = {
      consumedAt: null,
      ...(q.status === 'expired'
        ? { expiresAt: { lt: now } }
        : { expiresAt: { gte: now } }),
      ...(q.search
        ? {
            OR: [
              { companyName: { contains: q.search, mode: 'insensitive' as const } },
              { adminEmail: { contains: q.search, mode: 'insensitive' as const } },
              { adminName: { contains: q.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const { skip, take } = pageArgs(q.page, q.pageSize);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.pendingRegistration.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          companyName: true,
          companyType: true,
          slug: true,
          adminName: true,
          adminEmail: true,
          adminPhone: true,
          expiresAt: true,
          createdAt: true,
        },
      }),
      this.prisma.pendingRegistration.count({ where }),
    ]);

    const items = rows.map((r) => ({ ...r, expired: r.expiresAt < now }));
    return paginate(items, total, q.page, q.pageSize);
  }

  /** Count of still-actionable pending signups (for a nav badge). */
  async pendingCount() {
    const count = await this.prisma.pendingRegistration.count({
      where: { consumedAt: null, expiresAt: { gte: new Date() } },
    });
    return { count };
  }

  /**
   * Resend the activation email: regenerate the token (so the link is always
   * valid) and extend the expiry, then re-send. Returns the recipient.
   */
  async resend(id: string) {
    const pending = await this.prisma.pendingRegistration.findUnique({ where: { id } });
    if (!pending || pending.consumedAt) {
      throw AppException.notFound('Pending registration not found');
    }

    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 3600_000);

    await this.prisma.pendingRegistration.update({
      where: { id },
      data: { tokenHash, expiresAt },
    });

    const base = this.config.get<string>('BACKOFFICE_URL') || 'https://backoffice.reserva.am';
    const link = `${base}/activate?token=${rawToken}`;
    await this.mail.sendActivation(pending.adminEmail, {
      name: pending.adminName,
      company: pending.companyName,
      link,
    });
    return { email: pending.adminEmail };
  }

  /**
   * Manually activate a pending signup: provision the partner + admin now,
   * without waiting for the email link to be clicked. Delegates to the shared
   * signup provisioning so behavior (incl. solo auto-provisioning + uniqueness
   * checks) stays identical to the self-serve path.
   */
  async activate(id: string) {
    return this.signup.activateById(id);
  }

  /** Remove a pending registration (e.g. abandoned/duplicate). */
  async remove(id: string) {
    const { count } = await this.prisma.pendingRegistration.deleteMany({
      where: { id, consumedAt: null },
    });
    if (count === 0) throw AppException.notFound('Pending registration not found');
  }
}
