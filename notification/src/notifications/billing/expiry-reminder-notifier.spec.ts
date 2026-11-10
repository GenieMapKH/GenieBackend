import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ExpiryReminderNotifier } from './expiry-reminder-notifier';
import { ExpiryReminderDto } from '../internal/dto/expiry-reminder.dto';
import { PushContent, PushTarget } from '../delivery/push-sender';

describe('publishing reminder pushes', () => {
  const event = {
    userId: '11111111-1111-4111-8111-111111111111',
    kind: 'listing' as const,
    propertyId: '22222222-2222-4222-8222-222222222222',
    expiresAt: '2026-11-12T00:00:00Z',
  };
  const devices = { targetsOf: jest.fn() };
  const pushes: PushContent[] = [];
  const delivery = {
    deliver: jest.fn(
      async (
        targets: PushTarget[],
        content: (target: PushTarget) => PushContent,
      ) => {
        pushes.push(...targets.map(content));
        return { sent: targets.length, failed: 0, removed: 0 };
      },
    ),
  };
  const notifier = new ExpiryReminderNotifier(
    devices as never,
    delivery as never,
  );
  beforeEach(() => {
    jest.clearAllMocks();
    pushes.length = 0;
    devices.targetsOf.mockResolvedValue([{ locale: 'en' }, { locale: 'km' }]);
  });

  it('sends localized listing reminders with stable replacement tags and navigation data', async () => {
    await notifier.notify(event);
    expect(devices.targetsOf).toHaveBeenCalledWith(event.userId);
    expect(pushes[0]).toMatchObject({
      channel: 'listing_alerts',
      urgent: false,
      data: {
        type: 'publishing_expiry',
        kind: 'listing',
        propertyId: event.propertyId,
      },
      alert: { title: 'Your property post expires soon' },
    });
    expect(pushes[1].alert!.title).not.toBe(pushes[0].alert!.title);
    expect(pushes[0].tag).toBe(pushes[1].tag);
  });

  it('sends a subscription reminder without property navigation data', async () => {
    await notifier.notify({
      ...event,
      kind: 'subscription',
      propertyId: undefined,
      tier: 'gold',
    });
    expect(pushes[0].alert!.title).toBe('Your subscription expires soon');
    expect(pushes[0].data).not.toHaveProperty('propertyId');
  });

  it.each([
    { propertyId: undefined },
    { expiresAt: 'invalid' },
    { userId: 'invalid' },
    { kind: 'unknown' },
  ])('rejects malformed internal requests: %j', (change) => {
    expect(
      validateSync(plainToInstance(ExpiryReminderDto, { ...event, ...change })),
    ).not.toHaveLength(0);
  });
});
