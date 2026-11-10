import { Inject, Injectable } from '@nestjs/common';
import { AvatarService } from './avatar.service';
import {
  CHAT_CONTENT,
  PROPERTY_CONTENT,
  RemoteAccountContent,
} from './remote-account-content';
import { UsersService } from './users.service';

/**
 * What the platform keeps for an account outside its database rows, acted on
 * when the authentication service hides, restores or deletes the account
 * (`InternalAccountsController`). The profile picture is this service's own;
 * listing photos and chat files belong to the property and chat services,
 * which are asked to remove theirs.
 *
 * A feature that starts storing files for users must add them to `eraseFiles`,
 * or deleting an account will leave them behind.
 */
@Injectable()
export class AccountContentService {
  constructor(
    private readonly users: UsersService,
    private readonly avatars: AvatarService,
    @Inject(PROPERTY_CONTENT) private readonly properties: RemoteAccountContent,
    @Inject(CHAT_CONTENT) private readonly chat: RemoteAccountContent,
  ) {}

  /**
   * Deletes every file the account uploaded: listing photos, chat attachments
   * (both directions of its conversations) and profile pictures. The rows
   * themselves go when the authentication service deletes the account.
   * Fails if any of them could not be erased.
   */
  async eraseFiles(userId: string): Promise<void> {
    await Promise.all([
      this.properties.eraseFiles(userId),
      this.chat.eraseFiles(userId),
      this.avatars.removeAllOf(userId),
    ]);
  }

  /**
   * The account was hidden, shown again or is being deleted: drop what is
   * cached about it, so the change shows at once instead of when the caches expire.
   */
  async visibilityChanged(userId: string): Promise<void> {
    await Promise.all([
      this.users.publicViewChanged(userId),
      this.chat.notifyVisibilityChanged(userId),
    ]);
  }
}
