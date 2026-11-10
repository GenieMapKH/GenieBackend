/** How a push names a listing's owner: their name, else their handle. */
export function ownerName(owner: {
  name: string | null;
  username: string | null;
}): string {
  return owner.name?.trim() || owner.username || 'Someone';
}
