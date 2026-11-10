import { PushDeliveryService } from './push-delivery.service';
import {
  PushContent,
  PushOutcome,
  PushSender,
  PushTarget,
} from './push-sender';

const content: PushContent = {
  data: { type: 'x' },
  channel: 'security',
  urgent: true,
};

const targets = (count: number): PushTarget[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `d${i}`,
    token: `t${i}`,
    platform: 'android',
    locale: 'en',
  }));

class FakeSender extends PushSender {
  batches: number[] = [];
  outcomeOf: (token: string) => PushOutcome = () => 'sent';
  error?: Error;

  async send(pushes: { token: string }[]): Promise<PushOutcome[]> {
    if (this.error) throw this.error;
    this.batches.push(pushes.length);
    return pushes.map((push) => this.outcomeOf(push.token));
  }
}

describe('PushDeliveryService', () => {
  let sender: FakeSender;
  const devices = {
    forget: jest.fn((ids: string[]) => Promise.resolve(ids.length)),
  };
  let delivery: PushDeliveryService;

  beforeEach(() => {
    jest.clearAllMocks();
    sender = new FakeSender();
    delivery = new PushDeliveryService(sender, devices as never);
  });

  it('sends in batches the provider accepts', async () => {
    const report = await delivery.deliver(targets(1200), () => content);

    expect(sender.batches).toEqual([500, 500, 200]);
    expect(report).toEqual({ sent: 1200, failed: 0, removed: 0 });
  });

  it('forgets the devices whose token is gone, and only those', async () => {
    sender.outcomeOf = (token) =>
      token === 't1' ? 'unregistered' : token === 't2' ? 'failed' : 'sent';

    const report = await delivery.deliver(targets(3), () => content);

    expect(devices.forget).toHaveBeenCalledWith(['d1']);
    expect(report).toEqual({ sent: 1, failed: 2, removed: 1 });
  });

  it('skips devices with nothing to say to them', async () => {
    const report = await delivery.deliver(targets(3), (target) =>
      target.id === 'd0' ? content : null,
    );

    expect(sender.batches).toEqual([1]);
    expect(report.sent).toBe(1);
  });

  it('a provider outage fails the batch but forgets nobody', async () => {
    sender.error = new Error('FCM down');

    const report = await delivery.deliver(targets(2), () => content);

    expect(report).toEqual({ sent: 0, failed: 2, removed: 0 });
    expect(devices.forget).not.toHaveBeenCalled();
  });
});
