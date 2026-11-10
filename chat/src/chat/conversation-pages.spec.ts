import { BadRequestException } from '@nestjs/common';
import { Conversation } from './chat.service';
import { pageOfConversations } from './conversation-pages';

function conversation(
  participantId: string,
  minute: number,
  unreadCount = 0,
): Conversation {
  return {
    participantId,
    participantName: participantId,
    participantAvatar: null,
    lastMessage: {
      id: `m-${participantId}`,
      ciphertext: 'c',
      nonce: 'n',
      senderId: participantId,
      createdAt: new Date(Date.UTC(2026, 9, 20, 10, minute)),
      readAt: null,
    },
    unreadCount,
  };
}

/** Most recent first, ties by id: as ChatService.getConversations sorts. */
const LIST = [
  conversation('a', 50, 2),
  conversation('b', 40),
  conversation('c', 40, 1),
  conversation('d', 30),
  conversation('e', 20, 4),
];

describe('pageOfConversations', () => {
  it('walks the whole list page by page, each conversation once', () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = pageOfConversations(LIST, { limit: 2, cursor });
      seen.push(...page.items.map((c) => c.participantId));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    expect(seen).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('ends without a cursor when the rest fits', () => {
    expect(pageOfConversations(LIST, { limit: 5 }).nextCursor).toBeNull();
    expect(pageOfConversations(LIST, { limit: 10 }).nextCursor).toBeNull();
  });

  it('keeps the next pages right when a conversation jumps to the top meanwhile', () => {
    const first = pageOfConversations(LIST, { limit: 2 });

    // "d" gets a new message: it is now the most recent.
    const moved = [
      conversation('d', 59),
      ...LIST.filter((c) => c.participantId !== 'd'),
    ];
    const second = pageOfConversations(moved, {
      limit: 2,
      cursor: first.nextCursor!,
    });

    expect(second.items.map((c) => c.participantId)).toEqual(['c', 'e']);
  });

  it('counts the unread messages of the whole list on every page', () => {
    expect(pageOfConversations(LIST, { limit: 1 }).unreadTotal).toBe(7);
    const last = pageOfConversations(LIST, { limit: 4 });
    expect(
      pageOfConversations(LIST, { limit: 4, cursor: last.nextCursor! })
        .unreadTotal,
    ).toBe(7);
  });

  it('refuses a cursor it did not write', () => {
    expect(() =>
      pageOfConversations(LIST, { limit: 2, cursor: 'not-a-cursor' }),
    ).toThrow(BadRequestException);
    expect(() =>
      pageOfConversations(LIST, {
        limit: 2,
        cursor: Buffer.from('a|b|c').toString('base64url'),
      }),
    ).toThrow(BadRequestException);
  });
});
