import { currentServiceMessage } from '@tilomnov/shared';
import { PushDeliveryService } from './push-delivery.service';

jest.mock('@tilomnov/shared', () => ({
  ...jest.requireActual('@tilomnov/shared'),
  currentServiceMessage: jest.fn(),
}));

describe('queued push delivery progress', () => {
  const context = currentServiceMessage as jest.Mock;
  const devices = { forget: jest.fn().mockResolvedValue(0) };
  const sender = { send: jest.fn() };
  const targets = [0, 1].map((id) => ({
    id: `device-${id}`,
    token: `token-${id}`,
    platform: 'android' as const,
    locale: 'en' as const,
  }));
  const content = {
    data: { type: 'test' },
    channel: 'security' as const,
    urgent: true,
  };
  let steps: { step: string }[];
  const prisma = {
    $queryRaw: jest.fn(() => Promise.resolve(steps)),
    $executeRaw: jest.fn((_sql, _id, completed: string[]) => {
      steps.push(...completed.map((step) => ({ step })));
      return Promise.resolve(completed.length);
    }),
  };
  beforeEach(() => {
    jest.clearAllMocks();
    steps = [];
    context.mockReturnValue({ id: '11111111-1111-4111-8111-111111111111' });
  });
  it('retries failed devices without resending to devices already reached', async () => {
    sender.send
      .mockResolvedValueOnce(['sent', 'failed'])
      .mockResolvedValueOnce(['sent']);
    const delivery = new PushDeliveryService(
      sender,
      devices as never,
      prisma as never,
    );
    expect(await delivery.deliver(targets, () => content)).toEqual({
      sent: 1,
      failed: 1,
      removed: 0,
    });
    expect(steps).toEqual([{ step: 'push:device-0' }]);
    expect(await delivery.deliver(targets, () => content)).toEqual({
      sent: 1,
      failed: 0,
      removed: 0,
    });
    expect(sender.send.mock.calls[1][0]).toEqual([
      expect.objectContaining({ token: 'token-1' }),
    ]);
    expect(steps).toEqual([
      { step: 'push:device-0' },
      { step: 'push:device-1' },
    ]);
  });
  it('treats an incomplete provider response as failed delivery', async () => {
    sender.send.mockResolvedValueOnce(['sent']);
    const delivery = new PushDeliveryService(
      sender,
      devices as never,
      prisma as never,
    );
    expect(await delivery.deliver(targets, () => content)).toEqual({
      sent: 0,
      failed: 2,
      removed: 0,
    });
    expect(steps).toEqual([]);
  });
});
