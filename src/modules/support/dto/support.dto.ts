import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/** Send a support message (both partner and platform sides). */
export const sendSupportMessageSchema = z.object({
  body: z.string().trim().min(1, 'Message cannot be empty').max(4000),
});
export class SendSupportMessageDto extends createZodDto(sendSupportMessageSchema) {}

/** Cursor-paginated history load: fetch messages older than `before` (a message
 *  id), newest-first, capped page size. Omit `before` for the latest page. */
export const supportHistoryQuerySchema = z.object({
  before: z.string().uuid().optional(),
  take: z.coerce.number().int().min(1).max(50).default(30),
});
export class SupportHistoryQueryDto extends createZodDto(supportHistoryQuerySchema) {}
