ALTER TABLE payment.subscriptions
  ADD COLUMN billing_period text NOT NULL DEFAULT 'monthly'
  CHECK (billing_period IN ('monthly', 'annual'));

ALTER TABLE payment.payment_transactions
  ADD COLUMN billing_period text NOT NULL DEFAULT 'monthly'
  CHECK (billing_period IN ('monthly', 'annual'));
