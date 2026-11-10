-- Migrate "unsubscribed" subscribers to "active" (per-list status is source of truth now)
UPDATE subscribers SET status = 'active' WHERE status = 'unsubscribed';

-- Drop confirmedAt column
ALTER TABLE `subscribers` DROP COLUMN `confirmed_at`;