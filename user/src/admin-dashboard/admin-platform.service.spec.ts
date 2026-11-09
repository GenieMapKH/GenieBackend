import { AdminPlatformService } from './admin-platform.service';
describe('administrator moderation audit', () => {
  const audit = { create: jest.fn(), update: jest.fn() };
  const service = new AdminPlatformService({
    moderationAction: audit,
  } as never);
  beforeEach(() => {
    jest.resetAllMocks();
    audit.create.mockResolvedValue({ id: 'audit' });
    audit.update.mockResolvedValue({});
  });
  it('records the administrator before a mutation and its completed outcome', async () => {
    const work = jest.fn().mockResolvedValue({ status: 'Deleted' });
    await service.mutate(
      'admin',
      'property',
      'property.remove',
      'Scam post',
      work,
    );
    expect(audit.create).toHaveBeenCalledWith({
      data: {
        actorId: 'admin',
        targetId: 'property',
        action: 'property.remove',
        reason: 'Scam post',
      },
    });
    expect(audit.create.mock.invocationCallOrder[0]).toBeLessThan(
      work.mock.invocationCallOrder[0],
    );
    expect(audit.update).toHaveBeenCalledWith({
      where: { id: 'audit' },
      data: { status: 'completed' },
    });
  });
  it('marks failures and never mutates when audit storage is unavailable', async () => {
    const work = jest.fn().mockRejectedValue(new Error('Offline'));
    await expect(
      service.mutate('admin', 'user', 'account.ban', 'Abuse', work),
    ).rejects.toThrow('Offline');
    expect(audit.update).toHaveBeenCalledWith({
      where: { id: 'audit' },
      data: { status: 'failed' },
    });
    work.mockClear();
    audit.create.mockRejectedValue(new Error('Audit unavailable'));
    await expect(
      service.mutate('admin', 'user', 'account.ban', 'Abuse', work),
    ).rejects.toThrow();
    expect(work).not.toHaveBeenCalled();
  });
  it('never allows self-moderation', async () => {
    await expect(
      service.account('admin', 'admin', 'delete', 'Reason'),
    ).rejects.toThrow();
    expect(audit.create).not.toHaveBeenCalled();
  });
});
