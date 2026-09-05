import type { Prisma } from '@prisma/client';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import {
  intervalsOverlap,
  isWithinWorkingHours,
} from '@/common/utils/availability';
import type { WeekScheduleInput } from '@/common/schemas/week-schedule.schema';

const ACTIVE_STATUSES = ['pending', 'confirmed', 'completed'] as const;

export interface BookingValidationContext {
  specialist: {
    id: string;
    schedule: Prisma.JsonValue;
    services: { serviceId: string }[];
  };
  location: { hours: Prisma.JsonValue };
  serviceId: string;
  startAt: Date;
  endAt: Date;
}

export interface BookingRuleOptions {
  /**
   * The booking is a RECORD of something that already happened, not a slot
   * being reserved — so the scheduling rules do not apply to it.
   *
   * Working hours and time-off answer "can this be booked", which is a question
   * about the future. Asked about the past they answer using TODAY's schedule,
   * which is not the schedule that was in force then: a salon that has since
   * moved its Saturday hours, or a specialist who later took a holiday covering
   * that week, would make a genuine past visit unrecordable — and the error
   * ("outside working hours") would be actively misleading, because the visit
   * demonstrably happened.
   *
   * What still applies: the specialist must actually offer the service (a data
   * error either way), and the DB EXCLUDE constraint still refuses to put two
   * bookings on one specialist at one time, past or not.
   */
  historical?: boolean;
}

/**
 * Soft-validate a prospective booking against business rules (service offered,
 * within working hours, not during time-off). Throws AppException on failure.
 * The hard double-booking guarantee is enforced by the DB EXCLUDE constraint;
 * this only adds friendlier pre-checks and the time-off rule the DB can't see.
 */
export function assertBookingAllowed(
  ctx: BookingValidationContext,
  timeOff: { startAt: Date; endAt: Date }[],
  opts: BookingRuleOptions = {},
) {
  // 1. Specialist must offer the service.
  if (!ctx.specialist.services.some((s) => s.serviceId === ctx.serviceId)) {
    throw AppException.badRequest(
      ErrorCode.SERVICE_NOT_OFFERED,
      'This specialist does not offer the selected service',
    );
  }

  // Recording history stops here: the two remaining rules are about whether a
  // time can be RESERVED, and neither can be evaluated honestly for a date
  // whose schedule is no longer the one on file. See BookingRuleOptions.
  if (opts.historical) return;

  // 2. Within the specialist ∩ location working window for that weekday.
  //    Minutes are measured from the START date's midnight, so `endMin` exceeds
  //    1440 for an appointment running past midnight. `isWithinWorkingHours`
  //    also considers the PREVIOUS day's shift, which is what makes a 01:00
  //    booking belonging to a 18:00→02:30 overnight shift validate correctly.
  const sched = ctx.specialist.schedule as WeekScheduleInput | null;
  const hours = ctx.location.hours as WeekScheduleInput | null;
  const startMin = ctx.startAt.getHours() * 60 + ctx.startAt.getMinutes();
  const endMin = startMin + (ctx.endAt.getTime() - ctx.startAt.getTime()) / 60000;

  if (!isWithinWorkingHours(sched, hours, ctx.startAt, startMin, endMin)) {
    throw AppException.badRequest(
      ErrorCode.OUTSIDE_WORKING_HOURS,
      'The selected time is outside working hours',
    );
  }

  // 3. Not inside a time-off window.
  const hitsOff = timeOff.some((o) =>
    intervalsOverlap(ctx.startAt.getTime(), ctx.endAt.getTime(), o.startAt.getTime(), o.endAt.getTime()),
  );
  if (hitsOff) {
    throw AppException.conflict(
      ErrorCode.SPECIALIST_TIME_OFF,
      'The specialist is unavailable at the selected time',
    );
  }
}

export { ACTIVE_STATUSES };
