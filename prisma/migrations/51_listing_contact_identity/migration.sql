-- Individual listing details show contact identity, never authentication secrets.
GRANT SELECT (email, email_verified, phone_verified) ON account.users TO property_service;
