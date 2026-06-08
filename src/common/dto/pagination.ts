import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/** Shared query params for paginated list endpoints. */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(5),
  /** Bypass pagination and return the whole list in one page (dropdowns/catalogs). */
  all: z.coerce.boolean().default(false),
});

export class PaginationQueryDto extends createZodDto(paginationSchema) {}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
}

export function paginate<T>(items: T[], total: number, page: number, pageSize: number): Paginated<T> {
  return {
    items,
    page,
    pageSize,
    total,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** {skip, take} for a Prisma findMany from page params. */
export function pageArgs(page: number, pageSize: number) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}
