-- No non-authentication process needs password hashes or authentication-state writes.
REVOKE SELECT, UPDATE ON account.users FROM user_service, property_service, chat_service, notification_service, payment_service;

GRANT SELECT (id, username, name, avatar_url, role, created_at, deactivated_at, banned_at, last_seen_at)
  ON account.users TO property_service, chat_service, notification_service;
-- Publishing may copy the owner's chosen account phone into an explicit listing contact.
GRANT SELECT (phone) ON account.users TO property_service;

GRANT SELECT (id, email, phone, email_verified, phone_verified, username, name,
  first_name, last_name, sex, role, created_at, firebase_uid, avatar_url,
  has_password, deactivated_at, banned_at, last_seen_at)
  ON account.users TO user_service;
GRANT UPDATE (username, name, first_name, last_name, sex, phone, phone_verified, avatar_url)
  ON account.users TO user_service;

-- Legacy chat key columns retain their existing chat-only grants, not role/password access.
GRANT SELECT (identity_public_key, backup_blob, backup_salt, backup_nonce) ON account.users TO chat_service;
GRANT UPDATE (identity_public_key, backup_blob, backup_salt, backup_nonce, last_seen_at)
  ON account.users TO chat_service;
