ALTER TABLE payment.payment_transactions
  ALTER COLUMN property_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'LISTING_PUBLISH',
  ADD COLUMN IF NOT EXISTS subscription_tier text,
  ADD COLUMN IF NOT EXISTS request_id uuid,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_user_id_request_id_key
  ON payment.payment_transactions(user_id, request_id);

CREATE TABLE IF NOT EXISTS payment.subscriptions (
  user_id uuid PRIMARY KEY REFERENCES account.users(id) ON DELETE CASCADE,
  tier text NOT NULL CHECK (tier IN ('silver', 'gold', 'diamond')),
  current_period_start timestamptz NOT NULL,
  current_period_end timestamptz NOT NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  cancelled_at timestamptz,
  transaction_id uuid NOT NULL UNIQUE REFERENCES payment.payment_transactions(id),
  CHECK (current_period_end > current_period_start)
);
ALTER TABLE payment.subscriptions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON payment.subscriptions TO payment_service;
