import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { paginationSchema } from '@/common/dto/pagination';

export const listNotificationsQuerySchema = paginationSchema.extend({
  unreadOnly: z.coerce.boolean().default(false),
});
export class ListNotificationsQueryDto extends createZodDto(listNotificationsQuerySchema) {}
