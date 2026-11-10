CREATE TABLE IF NOT EXISTS listing.property_takeovers (
  property_id uuid PRIMARY KEY REFERENCES listing.properties(id) ON DELETE CASCADE,
  provider_type text,
  provider_name text,
  project_name text,
  seller_amount decimal(12,2) CHECK (seller_amount >= 0),
  remaining_balance decimal(12,2) CHECK (remaining_balance >= 0),
  balance_as_of date,
  payment_amount decimal(12,2) CHECK (payment_amount >= 0),
  payment_frequency text,
  remaining_months integer CHECK (remaining_months BETWEEN 1 AND 1200),
  next_payment_date date,
  interest_type text,
  annual_interest_rate decimal(5,2) CHECK (annual_interest_rate BETWEEN 0 AND 100),
  transfer_status text,
  transfer_fee decimal(12,2) CHECK (transfer_fee >= 0),
  transfer_fee_payer text,
  arrears_amount decimal(12,2) CHECK (arrears_amount >= 0),
  arrears_payer text,
  has_additional_payments boolean,
  notes text
);

CREATE TABLE IF NOT EXISTS listing.property_takeover_payments (
  property_id uuid NOT NULL REFERENCES listing.property_takeovers(property_id) ON DELETE CASCADE,
  "order" integer NOT NULL,
  amount decimal(12,2) CHECK (amount > 0),
  due_date date,
  PRIMARY KEY (property_id, "order")
);

ALTER TABLE listing.property_takeovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing.property_takeover_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON listing.property_takeovers, listing.property_takeover_payments FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON listing.property_takeovers, listing.property_takeover_payments TO property_service;
