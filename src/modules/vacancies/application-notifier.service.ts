import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '@/prisma/prisma.service';
import { newId } from '@/common/ids';
import { PushService } from '@/modules/notifications/push.service';

/** What the salon needs to know about an application, to be told about it. */
export interface NotifiableApplication {
  applicationId: string;
  vacancyId: string;
  partnerId: string;
  /** The branch the listing belongs to — decides which managers hear about it. */
  locationId: string;
  applicantName: string;
  /** The listing's own title, or the specialty's role name when it has none. */
  role: string;
  /** True when this replaced an earlier application from the same number. */
  updated: boolean;
}

/**
 * Tell the salon somebody applied.
 *
 * The board could take applications from the day it launched and the salon had
 * no signal that any had arrived — they landed in a table and waited to be
 * discovered by someone who happened to open the right listing. This closes
 * that: the same bell that already carries bookings and course registrations
 * now carries applications too.
 *
 * Modelled on BookingNotifierService deliberately, down to the order of the two
 * deliveries: the Notification row is the source of truth for the bell, and the
 * web push is a transient nudge on top of it. A push that fails must never cost
 * the partner the record.
 *
 * NEVER throws into the caller. Applying is the applicant's action, and it must
 * succeed whether or not the salon's notification did — a person who has just
 * applied for a job cannot be shown an error because a push endpoint was down.
 */
@Injectable()
export class VacancyApplicationNotifier {
  private readonly logger = new Logger(VacancyApplicationNotifier.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  async applicationReceived(app: NotifiableApplication): Promise<void> {
    try {
      await this.run(app);
    } catch (err) {
      // Logged, not raised — see the note on the class.
      this.logger.warn(`Failed to notify partner ${app.partnerId} of an application: ${String(err)}`);
    }
  }

  private async run(app: NotifiableApplication): Promise<void> {
    /*
     * Who hears about it: every admin, plus the managers of the branch the
     * listing belongs to.
     *
     * The same rule the applicant list itself enforces, and for the same
     * reason — a manager who may only READ their own branch's applicants must
     * not be told about another branch's. Deriving both from `locationId`
     * means there is one place the rule can be wrong.
     */
    const recipients = await this.prisma.user.findMany({
      where: {
        partnerId: app.partnerId,
        active: true,
        deletedAt: null,
        OR: [{ role: 'admin' }, { role: 'manager', locationId: app.locationId }],
      },
      select: { id: true },
    });
    if (recipients.length === 0) return;

    const userIds = recipients.map((r) => r.id);
    /*
     * A re-application says so.
     *
     * The board de-duplicates by phone, so someone applying twice UPDATES their
     * row rather than creating a second one. Announcing that as a new applicant
     * would inflate a count the partner is using to decide whether a listing is
     * working.
     */
    const title = app.updated ? 'Application updated' : 'New application';
    const body = `${app.applicantName} · ${app.role}`;

    const data: Prisma.InputJsonValue = {
      vacancyId: app.vacancyId,
      applicationId: app.applicationId,
      applicantName: app.applicantName,
      role: app.role,
    };

    // 1) The record. This is what the bell reads.
    await this.prisma.notification.createMany({
      data: userIds.map((userId) => ({
        id: newId(),
        userId,
        partnerId: app.partnerId,
        type: 'vacancy_application' as const,
        title,
        body,
        data,
      })),
    });

    // 2) The nudge. Best-effort; the service prunes dead subscriptions itself.
    await this.push.notifyUsers(userIds, {
      title,
      body,
      // Opens the listing's applicant drawer, not just the page — the partner
      // is one tap from the person who applied.
      url: `/vacancies?applicants=${app.vacancyId}`,
    });
  }
}
