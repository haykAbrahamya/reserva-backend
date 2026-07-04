import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { paginationSchema } from '@/common/dto/pagination';

const optStr = (max: number) => z.string().trim().max(max).optional().or(z.literal(''));

/**
 * Public page-view payload from the client. Only browser-available page context;
 * IP and User-Agent parsing happen server-side from the request, never trusted
 * from the body.
 */
export const createVisitorEventSchema = z.object({
  path: optStr(512),
  host: optStr(255),
  /** Slug of the partner page being viewed, when on a tenant page. */
  partnerSlug: optStr(80),
  referrer: optStr(1024),
  language: optStr(35),
  screenW: z.coerce.number().int().min(0).max(100_000).optional(),
  screenH: z.coerce.number().int().min(0).max(100_000).optional(),
});
export class CreateVisitorEventDto extends createZodDto(createVisitorEventSchema) {}

/** Platform-side listing (paginated, optional device/country/partner filters). */
export const listVisitorEventsQuerySchema = paginationSchema.extend({
  deviceType: z.string().trim().max(40).optional(),
  country: z.string().trim().max(8).optional(),
  partnerSlug: z.string().trim().max(80).optional(),
  /** High-level page filter: which kind of page the visit landed on. */
  pageType: z.enum(['signup', 'home', 'marketplace', 'partner']).optional(),
});
export class ListVisitorEventsQueryDto extends createZodDto(listVisitorEventsQuerySchema) {}
