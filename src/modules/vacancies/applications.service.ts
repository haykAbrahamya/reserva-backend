import { Injectable } from '@nestjs/common';
import { Prisma, type VacancyApplicationStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { VacancyApplicationNotifier } from './application-notifier.service';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import { newId } from '@/common/ids';
import { normalizePhone } from '@/common/utils/phone';
import { liveVacancyWhere } from './vacancy-visibility';

/**
 * What an application needs, declared here rather than imported from the board.
 *
 * The domain must not depend on the surface that happens to collect the data:
 * the public board satisfies this shape today, and a logged-in professional
 * profile will satisfy the same one without this file changing.
 */
export interface ApplicationInput {
  name: string;
  phone: string;
  email: string;
  note: string;
  locale: string;
}

/** What an applicant may see of their own submission, and the salon of theirs. */
const APPLICATION_SELECT = {
  id: true,
  name: true,
  phone: true,
  email: true,
  note: true,
  locale: true,
  source: true,
  status: true,
  seenAt: true,
  createdAt: true,
  /*
   * The account behind the application, when there was one.
   *
   * Read so the salon can open the applicant's PROFILE — the portfolio, the
   * years, the districts they will travel to — instead of judging a name and a
   * phone number. It is the difference between an inbox and a shortlist.
   *
   * `publicProfile` is selected rather than assumed: it is the gate below.
   */
  professional: {
    select: { id: true, publicProfile: true, avatarUrl: true },
  },
} satisfies Prisma.VacancyApplicationSelect;

/** One application row, as selected above. Exported for the view's spec. */
export type ApplicationRow = Prisma.VacancyApplicationGetPayload<{
  select: typeof APPLICATION_SELECT;
}>;

/**
 * Decide what an application says about the account behind it.
 *
 * The privacy line, in one function: an application carries what the applicant
 * TYPED into it — their name, their number, their note — because they typed it
 * into this salon's form. Their profile is a separate thing they may not have
 * published, so nothing from it survives unless they did.
 *
 * That is why `profileId` is null rather than the row being hidden: the salon
 * still learns this is a registered specialist rather than an anonymous
 * walk-up, which is genuinely useful triage, without being handed a page its
 * owner has kept closed. And the avatar rides the same gate as the link — if
 * the profile is public, so is the picture on it.
 */
export function toApplicationView(row: ApplicationRow) {
  const pro = row.professional;
  const published = Boolean(pro?.publicProfile);
  const { professional: _professional, ...application } = row;

  return {
    ...application,
    account: {
      /** They applied while signed in, so there is a person to look up. */
      hasAccount: pro !== null,
      /** Non-null only when they published their profile. */
      profileId: published ? (pro?.id ?? null) : null,
      avatarUrl: published ? (pro?.avatarUrl ?? '') : '',
    },
  };
}

/**
 * Applications to a listing — the single owner of the `vacancy_applications`
 * table.
 *
 * Both ends live here on purpose. The public board writes, the salon's
 * backoffice reads and triages, and putting them in one service is what keeps
 * the two views of one row from drifting: the phone the salon dials is
 * normalized by the same function that de-duplicates the applicant.
 */
@Injectable()
export class VacancyApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: VacancyApplicationNotifier,
  ) {}

  // -- public side -------------------------------------------

  /**
   * Apply from the public board.
   *
   * Accepted on exactly the terms the board LISTS on (`liveVacancyWhere`), so
   * it is impossible to apply to a listing that is expired, paused, or belongs
   * to a salon whose product was suspended — the failure mode that would
   * otherwise waste a real person's time.
   *
   * Re-applying is an update, not a second row. Someone who applies, remembers
   * something and applies again should refine their message, not appear twice
   * in the salon's inbox; the unique key on (vacancy, phone) is what makes that
   * true even against a double-tapped submit button.
   */
  async applyFromBoard(vacancyId: string, dto: ApplicationInput, professionalId?: string | null) {
    const vacancy = await this.prisma.vacancy.findFirst({
      where: { AND: [{ id: vacancyId }, liveVacancyWhere()] },
      /* Also what the notification needs to address itself: which partner,
         which branch (that decides which managers hear about it), and what the
         listing is called. */
      select: {
        id: true,
        applyMode: true,
        partnerId: true,
        locationId: true,
        title: true,
        specialty: { select: { roleName: true } },
      },
    });
    if (!vacancy) throw AppException.notFound('This listing is no longer available');

    // A salon that chose phone-only is telling applicants to call. Storing an
    // application it will never look at would be worse than refusing one.
    if (vacancy.applyMode === 'phone') {
      throw AppException.badRequest(
        ErrorCode.VALIDATION_FAILED,
        'This salon asks candidates to call instead of applying online',
      );
    }

    const phone = normalizePhone(dto.phone);

    // Asked before writing rather than inferred from timestamps afterwards. The
    // obvious trick — comparing createdAt to updatedAt — cannot tell a fresh
    // row from a re-application that happened within the same second, and this
    // flag decides which message a real person reads.
    const existing = await this.prisma.vacancyApplication.findUnique({
      where: { vacancyId_phone: { vacancyId, phone } },
      select: { id: true },
    });

    const row = await this.prisma.vacancyApplication.upsert({
      where: { vacancyId_phone: { vacancyId, phone } },
      create: {
        id: newId(),
        vacancyId,
        phone,
        name: dto.name,
        email: dto.email,
        note: dto.note,
        locale: dto.locale,
        source: 'board',
        /*
         * The account behind the application, when there is one.
         *
         * Optional and staying that way: applying has never required an
         * account. This exists so a signed-in professional can see their own
         * history, and for nothing else — the salon reads the same fields
         * either way, so an anonymous application is not a lesser one.
         */
        professionalId: professionalId ?? null,
      },
      // Only what the applicant can restate. Their triage status is the salon's
      // to set, so a second submission must not quietly reset a "contacted"
      // application back to new and lose the salon's work.
      //
      // The account link is claimed on re-application too, but only FORWARD:
      // a signed-in person re-applying claims the row they made anonymously,
      // while an anonymous re-application never clears a link that exists.
      // Clearing it would silently delete someone's own history.
      update: {
        name: dto.name,
        email: dto.email,
        note: dto.note,
        locale: dto.locale,
        ...(professionalId ? { professionalId } : {}),
      },
      select: { id: true },
    });

    /*
     * Tell the salon. Deliberately NOT awaited into the applicant's response
     * path in a way that can fail it — the notifier swallows its own errors, so
     * a dead push endpoint or a missing recipient can never turn a successful
     * application into an error for the person who made it.
     */
    await this.notifier.applicationReceived({
      applicationId: row.id,
      vacancyId,
      partnerId: vacancy.partnerId,
      locationId: vacancy.locationId,
      applicantName: dto.name,
      role: vacancy.title.trim() || vacancy.specialty.roleName,
      updated: existing !== null,
    });

    return {
      id: row.id,
      /** True when this replaced an earlier submission, so the page can say so
       *  rather than implying a second application was created. */
      updated: existing !== null,
    };
  }

  // -- salon side --------------------------------------------

  /**
   * The applicants for one listing.
   *
   * Tenant- AND branch-scoped through the listing itself rather than by a
   * denormalized partner column: a manager who may only see their own branch
   * must not read applicants for another branch's chair, and deriving that from
   * the listing means there is one place the rule can be wrong.
   */
  async listForVacancy(partnerId: string, vacancyId: string, scopeLocationId: string | null) {
    await this.assertVacancy(partnerId, vacancyId, scopeLocationId);

    const rows = await this.prisma.vacancyApplication.findMany({
      where: { vacancyId },
      select: APPLICATION_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toApplicationView);
  }

  /**
   * How many applicants each of a partner's listings has, and how many of those
   * nobody has opened yet.
   *
   * One grouped query for the whole list page. The alternative — a count per
   * card — is the classic N+1 that makes a list of twelve listings issue
   * twenty-five queries.
   */
  async countsForPartner(partnerId: string, scopeLocationId: string | null) {
    const rows = await this.prisma.vacancyApplication.groupBy({
      by: ['vacancyId', 'status'],
      where: {
        vacancy: {
          partnerId,
          deletedAt: null,
          ...(scopeLocationId ? { locationId: scopeLocationId } : {}),
        },
      },
      _count: { _all: true },
    });

    const out: Record<string, { total: number; unseen: number }> = {};
    for (const r of rows) {
      const bucket = (out[r.vacancyId] ??= { total: 0, unseen: 0 });
      bucket.total += r._count._all;
      if (r.status === 'new') bucket.unseen += r._count._all;
    }
    return out;
  }

  /**
   * Move an applicant through triage.
   *
   * `seenAt` is stamped on the first status change away from `new` rather than
   * on read, because "seen" here means a person made a decision — a list that
   * marks everything read the moment the page loads makes the unseen count
   * useless within a day.
   */
  async setStatus(
    partnerId: string,
    vacancyId: string,
    applicationId: string,
    status: VacancyApplicationStatus,
    scopeLocationId: string | null,
  ) {
    await this.assertVacancy(partnerId, vacancyId, scopeLocationId);

    const existing = await this.prisma.vacancyApplication.findFirst({
      where: { id: applicationId, vacancyId },
      select: { id: true, seenAt: true },
    });
    if (!existing) throw AppException.notFound('Application not found');

    const row = await this.prisma.vacancyApplication.update({
      where: { id: applicationId },
      data: {
        status,
        seenAt: existing.seenAt ?? (status === 'new' ? null : new Date()),
      },
      select: APPLICATION_SELECT,
    });
    return toApplicationView(row);
  }

  /** The listing must belong to this partner and to a branch the caller owns. */
  private async assertVacancy(
    partnerId: string,
    vacancyId: string,
    scopeLocationId: string | null,
  ) {
    const found = await this.prisma.vacancy.findFirst({
      where: {
        id: vacancyId,
        partnerId,
        deletedAt: null,
        ...(scopeLocationId ? { locationId: scopeLocationId } : {}),
      },
      select: { id: true },
    });
    if (!found) throw AppException.notFound('Vacancy not found');
  }
}
