import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { paginationSchema } from '@/common/dto/pagination';

export const LEAD_STATUSES = ['new', 'contacted', 'interested', 'partner', 'lost'] as const;
export const LEAD_SOURCES = ['signup', 'demo', 'tools', 'manual'] as const;

const status = z.enum(LEAD_STATUSES);
const trimmed = (max: number) => z.string().trim().max(max);

/** What staff can write on a lead. Empty strings clear a field. */
const leadFields = {
  name: trimmed(120).optional(),
  company: trimmed(160).optional(),
  phone: trimmed(40).optional(),
  email: z.string().trim().email().max(160).optional().or(z.literal('')),
  /** A username, an @username or a profile link — stored as the bare username. */
  instagram: trimmed(120).optional(),
  notes: trimmed(4000).optional(),
  status: status.optional(),
};

/** The work list: newest activity first, filtered by status, source or a search. */
export const listLeadsQuerySchema = paginationSchema.extend({
  status: status.optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  search: z.string().trim().max(100).optional(),
});
export class ListLeadsQueryDto extends createZodDto(listLeadsQuerySchema) {}

/** A lead added by hand: a name or at least one way to reach them. */
export const createLeadSchema = z.object(leadFields).refine(
  (d) => [d.name, d.company, d.phone, d.email, d.instagram].some((v) => !!v?.trim()),
  { message: 'Add a name or a way to reach them', path: ['name'] },
);
export class CreateLeadDto extends createZodDto(createLeadSchema) {}

export const updateLeadSchema = z.object(leadFields);
export class UpdateLeadDto extends createZodDto(updateLeadSchema) {}
