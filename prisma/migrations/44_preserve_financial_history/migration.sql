-- Keep the financial ledger when an account or its listings are erased.
ALTER TABLE payment.payment_transactions
  ALTER COLUMN user_id DROP NOT NULL,
  DROP CONSTRAINT payment_transactions_user_id_fkey,
  DROP CONSTRAINT payment_transactions_property_id_fkey,
  ADD CONSTRAINT payment_transactions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES account.users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT payment_transactions_property_id_fkey
    FOREIGN KEY (property_id) REFERENCES listing.properties(id) ON DELETE SET NULL ON UPDATE CASCADE;
