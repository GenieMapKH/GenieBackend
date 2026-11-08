ALTER TABLE payment.payment_transactions
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS subscription_period_start timestamptz,
  ADD COLUMN IF NOT EXISTS subscription_period_end timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS one_pending_subscription_per_account
  ON payment.payment_transactions(user_id)
  WHERE purpose = 'SUBSCRIPTION' AND status = 'Pending';
