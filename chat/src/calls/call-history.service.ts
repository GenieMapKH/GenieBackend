import { Injectable } from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';
import { ConversationStateService } from '../chat/conversation-state.service';

/** The most calls one request returns. */
export const MAX_HISTORY_CALLS = 100;
export const DEFAULT_HISTORY_CALLS = 50;

/** One finished call between two people, as the chat shows it. */
export interface CallHistoryEntry {
  id: string;
  callerId: string;
  /** When it started ringing. */
  createdAt: Date;
  /** Null when nobody answered. */
  answeredAt: Date | null;
  endedAt: Date | null;
  /** 'ended', 'declined', 'missed', 'cancelled' or 'disconnected'. */
  endReason: string | null;
}

/**
 * The calls between two people, to be shown among their messages. Only
 * finished calls are listed, and "delete for me" hides the calls from before
 * it, as it does for messages.
 */
@Injectable()
export class CallHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly states: ConversationStateService,
  ) {}

  /** The newest [limit] finished calls with [peerId], oldest first. */
  async between(
    userId: string,
    peerId: string,
    limit = DEFAULT_HISTORY_CALLS,
  ): Promise<CallHistoryEntry[]> {
    const clearedAt = await this.states.clearedAt(userId, peerId);
    const newestFirst = await this.prisma.callLog.findMany({
      where: {
        status: 'ended',
        OR: [
          { callerId: userId, calleeId: peerId },
          { callerId: peerId, calleeId: userId },
        ],
        ...(clearedAt && { createdAt: { gt: clearedAt } }),
      },
      select: {
        id: true,
        callerId: true,
        createdAt: true,
        answeredAt: true,
        endedAt: true,
        endReason: true,
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, MAX_HISTORY_CALLS),
    });
    return newestFirst.reverse();
  }
}
