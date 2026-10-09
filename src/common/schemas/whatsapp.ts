import { z } from 'zod';

// WhatsApp number: accept user input with spaces/+/dashes, store digits only
// (E.164 without the +). Empty = not set. 7–15 digits per the E.164 spec.
export const whatsappNumberSchema = z
  .string()
  .max(30)
  .transform((v) => v.replace(/\D/g, ''))
  .refine((v) => v === '' || (v.length >= 7 && v.length <= 15), 'Enter a valid WhatsApp number')
  .default('');
