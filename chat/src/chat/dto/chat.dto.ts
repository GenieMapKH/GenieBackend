import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Transport length limits, including the managed-format marker. */
const MAX_CIPHERTEXT_LENGTH = 16384;
const MAX_NONCE_LENGTH = 64;
const MAX_PAGE_SIZE = 100;
/** Three UUIDs and two slashes. */
const MAX_ATTACHMENT_PATH_LENGTH = 120;

/** `sendMessage`: a validated transport envelope, encrypted by the server for storage. */
export class SendMessageDto {
  /** Chosen by the sender's device, so a retried send is not stored twice. */
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsUUID()
  recipientId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CIPHERTEXT_LENGTH)
  ciphertext: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NONCE_LENGTH)
  nonce: string;

  /** The message this one replies to, in the same conversation. */
  @IsOptional()
  @IsUUID()
  replyToId?: string;
}

/** `POST /chat/messages/:messageId/edit`: the replacement managed envelope. */
export class EditMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CIPHERTEXT_LENGTH)
  ciphertext: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NONCE_LENGTH)
  nonce: string;
}

/** `POST /chat/messages/:messageId/delete`. */
export class DeleteMessageDto {
  /** Delete the sender's own message for both people, instead of hiding it from the caller. */
  @IsOptional()
  @IsBoolean()
  forEveryone?: boolean;

  /** With `forEveryone`: the file the message carried, `senderId/recipientId/fileId`. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_ATTACHMENT_PATH_LENGTH)
  attachmentPath?: string;
}

/** Asks for a place to upload one encrypted file for this recipient. */
export class CreateAttachmentDto {
  @IsUUID()
  recipientId: string;
}

/** `watchPresence` / `unwatchPresence` socket events: whose status to follow. */
export class PresenceTargetDto {
  @IsUUID()
  userId: string;
}

/** Paging for a conversation's history, newest page first. */
export class MessagePageQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;

  /** Only messages created before this ISO timestamp. */
  @IsOptional()
  @IsISO8601()
  before?: string;
}

/**
 * `GET /chat/conversations`: the main list, or the archive. With `limit`, one
 * page after `cursor` (the `nextCursor` of the page before); without, the
 * whole list as an array, as before pages existed.
 */
export class ConversationListQuery {
  @IsOptional()
  @IsIn(['main', 'archived'])
  list?: 'main' | 'archived';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
}

/** `POST /chat/conversations/:participantId/delete`. */
export class DeleteConversationDto {
  /** Also delete it for the other person, with every message and file. */
  @IsOptional()
  @IsBoolean()
  forEveryone?: boolean;
}
