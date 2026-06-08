import type { Prisma } from '@prisma/client';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import {
  intervalsOverlap,
  openWindowForDate,
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

/**
 * Soft-validate a prospective booking against business rules (service offered,
 * within working hours, not during time-off). Throws AppException on failure.
 * The hard double-booking guarantee is enforced by the DB EXCLUDE constraint;
 * this only adds friendlier pre-checks and the time-off rule the DB can't see.
 */
export function assertBookingAllowed(
  ctx: BookingValidationContext,
  timeOff: { startAt: Date; endAt: Date }[],
) {
  // 1. Specialist must offer the service.
  if (!ctx.specialist.services.some((s) => s.serviceId === ctx.serviceId)) {
    throw AppException.badRequest(
      ErrorCode.SERVICE_NOT_OFFERED,
      'This specialist does not offer the selected service',
    );
  }

  // 2. Within the specialist ∩ location working window for that weekday.
  const sched = ctx.specialist.schedule as WeekScheduleInput | null;
  const hours = ctx.location.hours as WeekScheduleInput | null;
  const startMin = ctx.startAt.getHours() * 60 + ctx.startAt.getMinutes();
  const endMin = startMin + (ctx.endAt.getTime() - ctx.startAt.getTime()) / 60000;

  const spWin = openWindowForDate(sched, ctx.startAt);
  const locWin = openWindowForDate(hours, ctx.startAt);
  const windows = [spWin, locWin].filter(Boolean) as { startMin: number; endMin: number }[];
  if (windows.length > 0) {
    const open = Math.max(...windows.map((w) => w.startMin));
    const close = Math.min(...windows.map((w) => w.endMin));
    if (startMin < open || endMin > close) {
      throw AppException.badRequest(
        ErrorCode.OUTSIDE_WORKING_HOURS,
        'The selected time is outside working hours',
      );
    }
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
