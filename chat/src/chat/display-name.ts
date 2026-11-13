/** The user fields a name is shown from. */
export const DISPLAY_FIELDS = {
  name: true,
  username: true,
  avatarUrl: true,
} as const;

export type DisplayFields = {
  name: string | null;
  username: string | null;
};

/** The name a user chose, else their handle. */
export function displayName(user: DisplayFields | null): string {
  return user?.name || user?.username || 'Property Owner';
}
