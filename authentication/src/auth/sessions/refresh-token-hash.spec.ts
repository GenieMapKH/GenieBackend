import * as bcrypt from 'bcrypt';
import { hashRefreshToken, refreshTokenMatches } from './refresh-token-hash';

/** Two tokens of one user: their first 72 bytes (all bcrypt reads) are the same. */
const HEADER_AND_SUBJECT =
  'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMTExMTExMS0xMTExLTQxMTEtODExMS0xMTExMTExMTExMTEi';
const TOKEN = `${HEADER_AND_SUBJECT}LCJqdGkiOiJhYWFh.signature-a`;
const OTHER_TOKEN = `${HEADER_AND_SUBJECT}LCJqdGkiOiJiYmJi.signature-b`;

describe('refresh token hash', () => {
  it('matches the token it was made from', async () => {
    expect(await refreshTokenMatches(TOKEN, hashRefreshToken(TOKEN))).toBe(
      true,
    );
  });

  it('tells apart tokens that only differ after their first 72 bytes', async () => {
    expect(
      await refreshTokenMatches(OTHER_TOKEN, hashRefreshToken(TOKEN)),
    ).toBe(false);
  });

  it('is the same every time, and never the token itself', () => {
    expect(hashRefreshToken(TOKEN)).toBe(hashRefreshToken(TOKEN));
    expect(hashRefreshToken(TOKEN)).not.toContain(TOKEN);
  });

  it('still accepts a token stored with bcrypt before the switch', async () => {
    const legacy = bcrypt.hashSync(TOKEN, 4);

    expect(await refreshTokenMatches(TOKEN, legacy)).toBe(true);
    expect(await refreshTokenMatches('another-token', legacy)).toBe(false);
  });

  it('refuses a damaged stored hash instead of throwing', async () => {
    expect(await refreshTokenMatches(TOKEN, 'sha256:abc')).toBe(false);
  });
});
