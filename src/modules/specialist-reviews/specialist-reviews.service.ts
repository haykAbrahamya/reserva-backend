import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { AppException } from '@/common/errors/app.exception';
import { newId } from '@/common/ids';
import type { CreateSpecialistReviewDto } from './dto/specialist-review.dto';

/** Public-facing review shape (no internal ids leaked beyond the review id). */
export interface PublicReview {
  id: string;
  author: string;
  rating: number;
  text: string;
  createdAt: Date;
}

/** Aggregate used to render stars: average + count, computed from real rows. */
export interface ReviewAggregate {
  rating: number; // 0 when no reviews
  reviewCount: number;
}

@Injectable()
export class SpecialistReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Submit a public review for a specialist on a partner's booking page. */
  async createPublic(slug: string, specialistId: string, dto: CreateSpecialistReviewDto) {
    // The specialist must belong to the partner identified by the public slug.
    const specialist = await this.prisma.specialist.findFirst({
      where: { id: specialistId, deletedAt: null, partner: { slug, active: true, deletedAt: null } },
      select: { id: true, partnerId: true },
    });
    if (!specialist) throw AppException.notFound('Specialist not found');

    const review = await this.prisma.specialistReview.create({
      data: {
        id: newId(),
        specialistId: specialist.id,
        partnerId: specialist.partnerId,
        author: (dto.author ?? '').trim(),
        rating: dto.rating,
        text: (dto.text ?? '').trim(),
      },
      select: { id: true, author: true, rating: true, text: true, createdAt: true },
    });
    return review;
  }

  /** Latest reviews for a specialist (public booking page). */
  listPublic(specialistId: string, take = 20): Promise<PublicReview[]> {
    return this.prisma.specialistReview.findMany({
      where: { specialistId },
      orderBy: { createdAt: 'desc' },
      take,
      select: { id: true, author: true, rating: true, text: true, createdAt: true },
    });
  }

  /** Backoffice: list a specialist's reviews (tenant-scoped). */
  async listForPartner(partnerId: string, specialistId: string) {
    const sp = await this.prisma.specialist.findFirst({
      where: { id: specialistId, partnerId, deletedAt: null },
      select: { id: true },
    });
    if (!sp) throw AppException.notFound('Specialist not found');
    return this.prisma.specialistReview.findMany({
      where: { specialistId, partnerId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, author: true, rating: true, text: true, createdAt: true },
    });
  }

  /** Backoffice: delete a review (tenant-scoped — can't touch other partners'). */
  async deleteForPartner(partnerId: string, reviewId: string) {
    const { count } = await this.prisma.specialistReview.deleteMany({
      where: { id: reviewId, partnerId },
    });
    if (count === 0) throw AppException.notFound('Review not found');
  }

  /**
   * Compute rating aggregates for many specialists in one query. Returns a map
   * specialistId → { rating (avg, 0 if none), reviewCount }. Used to enrich the
   * public partner payload so every place that shows a specialist can show stars.
   */
  async aggregatesFor(specialistIds: string[]): Promise<Map<string, ReviewAggregate>> {
    const map = new Map<string, ReviewAggregate>();
    if (specialistIds.length === 0) return map;
    const rows = await this.prisma.specialistReview.groupBy({
      by: ['specialistId'],
      where: { specialistId: { in: specialistIds } },
      _avg: { rating: true },
      _count: { _all: true },
    });
    for (const r of rows) {
      map.set(r.specialistId, {
        rating: r._avg.rating ? Math.round(r._avg.rating * 10) / 10 : 0,
        reviewCount: r._count._all,
      });
    }
    return map;
  }
}
