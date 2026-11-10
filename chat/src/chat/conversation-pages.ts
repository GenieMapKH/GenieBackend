import { BadRequestException } from '@nestjs/common';
import { Conversation } from './chat.service';

/** One page of a conversation list, and what the list as a whole adds up to. */
export interface ConversationPage {
  items: Conversation[];
  /** Asks for the next page; null after the last. */
  nextCursor: string | null;
  /** Unread messages in the whole list, not only this page: the badge on the chat tab. */
  unreadTotal: number;
}

/**
 * The page of `conversations` (most recent first, as `getConversations`
 * returns them) after `cursor`. A cursor names the last conversation of the
 * previous page by its last message's time and the other person, so a
 * conversation that moves to the top meanwhile is neither repeated nor
 * skipped by the pages that follow.
 */
export function pageOfConversations(
  conversations: Conversation[],
  page: { limit: number; cursor?: string },
): ConversationPage {
  const after = page.cursor === undefined ? null : readCursor(page.cursor);
  const rest = after
    ? conversations.filter((conversation) => isAfter(conversation, after))
    : conversations;
  const items = rest.slice(0, page.limit);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: rest.length > page.limit && last ? writeCursor(last) : null,
    unreadTotal: conversations.reduce(
      (sum, conversation) => sum + conversation.unreadCount,
      0,
    ),
  };
}

interface Position {
  time: number;
  participantId: string;
}

/** Most recent first; between two equally recent, by the other person's id. */
function isAfter(conversation: Conversation, position: Position): boolean {
  const time = new Date(conversation.lastMessage.createdAt).getTime();
  return (
    time < position.time ||
    (time === position.time &&
      conversation.participantId > position.participantId)
  );
}

function writeCursor(conversation: Conversation): string {
  const time = new Date(conversation.lastMessage.createdAt).toISOString();
  return Buffer.from(`${time}|${conversation.participantId}`).toString(
    'base64url',
  );
}

function readCursor(cursor: string): Position {
  const [time, participantId, ...rest] = Buffer.from(cursor, 'base64url')
    .toString()
    .split('|');
  const parsed = Date.parse(time);
  if (rest.length > 0 || !participantId || Number.isNaN(parsed)) {
    throw new BadRequestException('Invalid cursor');
  }
  return { time: parsed, participantId };
}
