/**
 * A user's display profile. Auto-created by the `handle_new_user` trigger
 * (migration 001) when a row is inserted into auth.users, so the auth.uid
 * and profile.id are always the same UUID.
 */
export type Profile = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
};
