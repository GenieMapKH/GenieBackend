ALTER TABLE payment.subscriptions
  ADD COLUMN IF NOT EXISTS billing_period text NOT NULL DEFAULT 'monthly'
  CHECK (billing_period IN ('monthly', 'annual'));

ALTER TABLE payment.payment_transactions
  ADD COLUMN IF NOT EXISTS billing_period text NOT NULL DEFAULT 'monthly'
  CHECK (billing_period IN ('monthly', 'annual'));

ALTER TABLE payment.subscriptions
  ADD COLUMN IF NOT EXISTS period_amount decimal(10,2),
  ADD COLUMN IF NOT EXISTS listing_limit integer;

ALTER TABLE payment.payment_transactions
  ADD COLUMN IF NOT EXISTS subscription_plan_amount decimal(10,2),
  ADD COLUMN IF NOT EXISTS subscription_listing_limit integer;

-- Preserve already purchased capacity and credit until that period ends.
UPDATE payment.subscriptions SET
  period_amount = CASE tier WHEN 'silver' THEN 5.90 WHEN 'gold' THEN 8.90 WHEN 'diamond' THEN 16.90 END,
  listing_limit = CASE tier WHEN 'silver' THEN 20 WHEN 'gold' THEN 50 WHEN 'diamond' THEN 120 END
WHERE period_amount IS NULL;

UPDATE payment.payment_transactions SET
  subscription_plan_amount = CASE subscription_tier WHEN 'silver' THEN 5.90 WHEN 'gold' THEN 8.90 WHEN 'diamond' THEN 16.90 END,
  subscription_listing_limit = CASE subscription_tier WHEN 'silver' THEN 20 WHEN 'gold' THEN 50 WHEN 'diamond' THEN 120 END
WHERE purpose = 'SUBSCRIPTION' AND subscription_plan_amount IS NULL;
