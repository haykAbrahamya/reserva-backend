import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import { newId } from '@/common/ids';
import type { CreateTimeOffDto, UpdateTimeOffDto } from './dto/time-off.dto';

/** Statuses that count as a real booking conflict (cancelled/noshow don't). */
const ACTIVE_BOOKING_STATUSES = ['pending', 'confirmed', 'completed'] as const;

@Injectable()
export class TimeOffService {
  constructor(private readonly prisma: PrismaService) {}

  list(partnerId: string, specialistId: string) {
    return this.prisma.specialistTimeOff.findMany({
      where: { partnerId, specialistId },
      orderBy: { startAt: 'asc' },
    });
  }

  /**
   * Bookings that overlap [startAt, endAt) for a specialist — the conflict set
   * shown in the backoffice "resolve first" gate.
   */
  async findConflicts(partnerId: string, specialistId: string, startAt: Date, endAt: Date) {
    return this.prisma.booking.findMany({
      where: {
        partnerId,
        specialistId,
        status: { in: [...ACTIVE_BOOKING_STATUSES] },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      orderBy: { startAt: 'asc' },
      select: {
        id: true,
        clientName: true,
        clientPhone: true,
        startAt: true,
        endAt: true,
        status: true,
        serviceId: true,
      },
    });
  }

  async create(partnerId: string, specialistId: string, dto: CreateTimeOffDto, createdById?: string) {
    await this.assertSpecialist(partnerId, specialistId);

    if (!dto.force) {
      const conflicts = await this.findConflicts(partnerId, specialistId, dto.startAt, dto.endAt);
      if (conflicts.length > 0) {
        throw AppException.conflict(
          ErrorCode.TIME_OFF_HAS_CONFLICTS,
          'This time off overlaps existing bookings. Resolve them first.',
          { conflicts },
        );
      }
    }

    return this.prisma.specialistTimeOff.create({
      data: {
        id: newId(),
        partnerId,
        specialistId,
        startAt: dto.startAt,
        endAt: dto.endAt,
        allDay: dto.allDay ?? false,
        reason: dto.reason,
        createdById,
      },
    });
  }

  async update(partnerId: string, specialistId: string, id: string, dto: UpdateTimeOffDto) {
    const existing = await this.getOwned(partnerId, specialistId, id);
    const startAt = dto.startAt ?? existing.startAt;
    const endAt = dto.endAt ?? existing.endAt;
    if (endAt <= startAt) {
      throw AppException.badRequest(ErrorCode.INVALID_TIME_RANGE, 'End must be after start');
    }

    if (!dto.force) {
      const conflicts = await this.findConflicts(partnerId, specialistId, startAt, endAt);
      if (conflicts.length > 0) {
        throw AppException.conflict(
          ErrorCode.TIME_OFF_HAS_CONFLICTS,
          'This time off overlaps existing bookings. Resolve them first.',
          { conflicts },
        );
      }
    }

    return this.prisma.specialistTimeOff.update({
      where: { id },
      data: {
        startAt,
        endAt,
        ...(dto.allDay !== undefined && { allDay: dto.allDay }),
        ...(dto.reason !== undefined && { reason: dto.reason }),
      },
    });
  }

  async remove(partnerId: string, specialistId: string, id: string) {
    await this.getOwned(partnerId, specialistId, id);
    await this.prisma.specialistTimeOff.delete({ where: { id } });
  }

  // ── helpers ───────────────────────────────────────────────

  private async assertSpecialist(partnerId: string, specialistId: string) {
    const sp = await this.prisma.specialist.findFirst({
      where: { id: specialistId, partnerId, deletedAt: null },
      select: { id: true },
    });
    if (!sp) throw AppException.notFound('Specialist not found');
  }

  private async getOwned(partnerId: string, specialistId: string, id: string) {
    const row = await this.prisma.specialistTimeOff.findFirst({
      where: { id, partnerId, specialistId },
    });
    if (!row) throw AppException.notFound('Time-off entry not found');
    return row;
  }
}
