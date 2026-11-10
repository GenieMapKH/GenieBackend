/** Lifetime of the short-lived JWT used to call the API, in seconds. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * `typ` claim of each token. All kinds are signed with the same key, so this
 * is what stops a 30-day refresh token from being used as an access token.
 */
export const ACCESS_TOKEN_TYPE = 'access';
export const REFRESH_TOKEN_TYPE = 'refresh';

/**
 * Says "this user typed their password a moment ago". Given to the app, which
 * hands it to the user service for chat key recovery (see `PasswordProofService`).
 */
export const PASSWORD_PROOF_TOKEN_TYPE = 'password-proof';
export const PASSWORD_PROOF_TTL_SECONDS = 5 * 60;

/** Carried by a call this service makes to the user service (see `UserContentClient`). */
export const INTERNAL_TOKEN_TYPE = 'internal';
export const INTERNAL_TOKEN_TTL_SECONDS = 60;

/** Lifetime of the refresh token, in days (also used for the DB expiry). */
export const REFRESH_TOKEN_TTL_DAYS = 30;

/** Work factor for every bcrypt hash (passwords, OTPs). */
export const BCRYPT_ROUNDS = 10;

/** How long a password-reset OTP stays valid, in minutes. */
export const OTP_TTL_MINUTES = 10;

/** Role given to every self-registered account. */
export const DEFAULT_USER_ROLE = 'user';
