/** Where the ids an account follows are cached. Dropped by whatever changes them: following, and blocking. */
export function followingIdsKey(userId: string): string {
  return `follows:following-ids:${userId}`;
}
