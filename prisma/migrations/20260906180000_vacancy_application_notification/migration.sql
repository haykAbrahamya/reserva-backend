-- A notification type for "somebody applied to your vacancy".
--
-- Additive and non-destructive: adding a value to a Postgres enum cannot
-- invalidate an existing row, and nothing reads this value until the notifier
-- that writes it ships alongside.
--
-- `IF NOT EXISTS` so re-running against a database that already has it is a
-- no-op rather than an error.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'vacancy_application';
