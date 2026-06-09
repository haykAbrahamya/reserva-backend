import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});
export class SubscribeDto extends createZodDto(subscribeSchema) {}

export const unsubscribeSchema = z.object({
  endpoint: z.string().url(),
});
export class UnsubscribeDto extends createZodDto(unsubscribeSchema) {}
