import { NotFoundException } from '@nestjs/common';
import { ConversationStateService } from './conversation-state.service';

describe('ConversationStateService', () => {
  const stateTable = {
    upsert: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
    findUnique: jest.fn(),
  };
  const messageTable = { deleteMany: jest.fn() };
  const callLogTable = { deleteMany: jest.fn() };
  const userTable = { findUnique: jest.fn() };
  const prisma = {
    chatConversationState: stateTable,
    message: messageTable,
    callLog: callLogTable,
    user: userTable,
    $transaction: jest.fn(async (operations: unknown[]) =>
      Promise.all(operations),
    ),
  };
  const attachments = { removeConversation: jest.fn() };
  let states: ConversationStateService;

  beforeEach(() => {
    jest.clearAllMocks();
    userTable.findUnique.mockResolvedValue({ id: 'bob' });
    states = new ConversationStateService(
      prisma as never,
      attachments as never,
    );
  });

  it('archives a conversation for the caller only', async () => {
    await states.archive('alice', 'bob');

    const call = stateTable.upsert.mock.calls[0][0];
    expect(call.where).toEqual({
      userId_partnerId: { userId: 'alice', partnerId: 'bob' },
    });
    expect(call.update.archivedAt).toBeInstanceOf(Date);
  });

  it('refuses a conversation with someone who does not exist', async () => {
    userTable.findUnique.mockResolvedValue(null);

    await expect(states.archive('alice', 'nobody')).rejects.toThrow(
      NotFoundException,
    );
    expect(stateTable.upsert).not.toHaveBeenCalled();
  });

  it('deleting for me hides the history and takes it out of the archive', async () => {
    await states.deleteForMe('alice', 'bob');

    const call = stateTable.upsert.mock.calls[0][0];
    expect(call.update.clearedAt).toBeInstanceOf(Date);
    expect(call.update.archivedAt).toBeNull();
    expect(messageTable.deleteMany).not.toHaveBeenCalled();
  });

  it('deleting for everyone removes both directions, the calls, both views and the files', async () => {
    await states.deleteForEveryone('alice', 'bob');

    expect(messageTable.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { senderId: 'alice', recipientId: 'bob' },
          { senderId: 'bob', recipientId: 'alice' },
        ],
      },
    });
    expect(callLogTable.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { callerId: 'alice', calleeId: 'bob' },
          { callerId: 'bob', calleeId: 'alice' },
        ],
      },
    });
    expect(stateTable.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { userId: 'alice', partnerId: 'bob' },
          { userId: 'bob', partnerId: 'alice' },
        ],
      },
    });
    expect(attachments.removeConversation).toHaveBeenCalledWith('alice', 'bob');
  });

  it('still deletes the messages when the files cannot be deleted', async () => {
    attachments.removeConversation.mockRejectedValueOnce(
      new Error('storage down'),
    );
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      states.deleteForEveryone('alice', 'bob'),
    ).resolves.toBeUndefined();
    expect(messageTable.deleteMany).toHaveBeenCalled();
  });
});
