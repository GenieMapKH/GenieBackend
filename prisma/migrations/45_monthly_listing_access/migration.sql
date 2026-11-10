ALTER TABLE payment.payment_transactions
  ADD COLUMN IF NOT EXISTS listing_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS expiry_reminder_sent_at timestamptz;
ALTER TABLE payment.subscriptions
  ADD COLUMN IF NOT EXISTS expiry_reminder_sent_at timestamptz;

UPDATE payment.payment_transactions
SET listing_period_end = ((COALESCE(paid_at, updated_at, created_at) AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC'
WHERE purpose = 'LISTING_PUBLISH' AND status = 'Success' AND listing_period_end IS NULL;

CREATE INDEX IF NOT EXISTS payment_listing_expiry_reminder_idx
  ON payment.payment_transactions(listing_period_end)
  WHERE status = 'Success' AND expiry_reminder_sent_at IS NULL;
CREATE INDEX IF NOT EXISTS subscription_expiry_reminder_idx
  ON payment.subscriptions(current_period_end)
  WHERE expiry_reminder_sent_at IS NULL;
