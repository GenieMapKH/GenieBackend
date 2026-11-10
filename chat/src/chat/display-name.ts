/** The user fields a name is shown from. */
export const DISPLAY_FIELDS = {
  name: true,
  username: true,
  email: true,
  phone: true,
  avatarUrl: true,
} as const;

export type DisplayFields = {
  name: string | null;
  username: string | null;
  email: string | null;
  phone: string | null;
};

/** The name a user chose, else their handle. */
export function displayName(user: DisplayFields | null): string {
  return (
    user?.name ||
    user?.username ||
    user?.email ||
    user?.phone ||
    'Property Owner'
  );
}
