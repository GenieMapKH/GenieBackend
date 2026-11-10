/** What the app is given of a message that another one replies to. Still encrypted. */
const QUOTED_FIELDS = {
  id: true,
  senderId: true,
  recipientId: true,
  ciphertext: true,
  nonce: true,
  createdAt: true,
  editedAt: true,
} as const;

/** Reads a message with the one it replies to, and whether [viewerId] deleted that one for themselves. */
export function withReplyTo(viewerId: string) {
  return {
    replyTo: {
      select: {
        ...QUOTED_FIELDS,
        hiddenBy: { where: { userId: viewerId }, select: { userId: true } },
      },
    },
  } as const;
}

interface QuotedRow {
  id: string;
  senderId: string;
  recipientId: string;
  ciphertext: string;
  nonce: string;
  createdAt: Date;
  editedAt: Date | null;
  hiddenBy: { userId: string }[];
}

interface MessageRow {
  replyToId?: string | null;
  replyTo: QuotedRow | null;
}

/**
 * A message as the app receives it. The message it replies to is left out
 * when the viewer deleted it for themselves, or deleted the conversation's
 * history up to [clearedAt]: a reply never brings back what they removed.
 */
export function toMessageView<T extends MessageRow>(
  row: T,
  clearedAt: Date | null = null,
) {
  const { replyToId: _replyToId, replyTo, ...message } = row;
  const hidden =
    !replyTo ||
    replyTo.hiddenBy.length > 0 ||
    (clearedAt !== null && replyTo.createdAt <= clearedAt);
  if (hidden) return { ...message, replyTo: null };
  const { hiddenBy: _hiddenBy, ...quoted } = replyTo;
  return { ...message, replyTo: quoted };
}

/** Messages between the two people, either direction. */
export function betweenPair(userId: string, partnerId: string) {
  return [
    { senderId: userId, recipientId: partnerId },
    { senderId: partnerId, recipientId: userId },
  ];
}
