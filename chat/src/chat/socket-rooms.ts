/** Every device a user is signed in on joins this room. */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}
