-- Add a notification type for public course self-registrations. Additive: a new
-- enum value only, no data change. (Postgres ADD VALUE is non-destructive.)
ALTER TYPE "NotificationType" ADD VALUE 'course_registration';
