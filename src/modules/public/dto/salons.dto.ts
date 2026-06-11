import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/** Query params for the public marketplace listing (/public/salons). */
export const salonSearchSchema = z.object({
  q: z.string().max(120).optional(),
  service: z.string().max(120).optional(),
  location: z.string().max(120).optional(),
});
export class SalonSearchDto extends createZodDto(salonSearchSchema) {}
