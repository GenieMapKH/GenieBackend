import {
  BadRequestException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthAttemptLimits } from '../attempt-limiter';
import { ACCOUNT_UNDER_ATTACK, LoginThrottle } from './login-throttle.service';

const OWNER_PHONE = '+85512345678';
const OWNER_DEVICE = 'o'.repeat(43);

/** Remembers devices in memory, as Redis would. */
class FakeKnownDevices {
  private readonly known = new Set<string>();

  isKnown(account: string, deviceKey: string | null): Promise<boolean> {
    return Promise.resolve(
      !!deviceKey && this.known.has(`${account}|${deviceKey}`),
    );
  }

  remember(account: string, deviceKey: string | null): Promise<void> {
    if (deviceKey) this.known.add(`${account}|${deviceKey}`);
    return Promise.resolve();
  }
}

describe('LoginThrottle', () => {
  let throttle: LoginThrottle;
  let knownDevices: FakeKnownDevices;
  let checkPassword: jest.Mock;

  const wrongPassword = () =>
    Promise.reject(new UnauthorizedException('Invalid credentials'));
  const rightPassword = () => Promise.resolve('tokens');

  const attempt = (
    source: { account?: string; ipAddress?: string; deviceKey?: string },
    signIn: () => Promise<string> = wrongPassword,
  ) => {
    checkPassword = jest.fn(signIn);
    return throttle.guard(
      {
        account: source.account ?? OWNER_PHONE,
        ipAddress: source.ipAddress ?? '203.0.113.1',
        deviceKey: source.deviceKey ?? null,
      },
      checkPassword,
    );
  };

  const statusOf = async (run: Promise<unknown>) => {
    try {
      await run;
      return HttpStatus.OK;
    } catch (error) {
      return (error as { getStatus(): number }).getStatus();
    }
  };

  beforeEach(() => {
    knownDevices = new FakeKnownDevices();
    throttle = new LoginThrottle(
      new AuthAttemptLimits(),
      knownDevices as never,
    );
  });

  it('pauses the network that keeps guessing, without checking the password', async () => {
    for (let i = 0; i < 10; i++) {
      expect(await statusOf(attempt({ ipAddress: '198.51.100.7' }))).toBe(401);
    }

    expect(await statusOf(attempt({ ipAddress: '198.51.100.7' }))).toBe(429);
    expect(checkPassword).not.toHaveBeenCalled();
  });

  it('lets the owner in from another network while a guesser is paused', async () => {
    for (let i = 0; i < 11; i++) {
      await attempt({ ipAddress: '198.51.100.7' }).catch(() => undefined);
    }

    await expect(
      attempt({ ipAddress: '203.0.113.50' }, rightPassword),
    ).resolves.toBe('tokens');
  });

  it("lets the owner's own device in even from the guesser's network", async () => {
    await attempt({ deviceKey: OWNER_DEVICE }, rightPassword);
    for (let i = 0; i < 11; i++) {
      await attempt({ ipAddress: '198.51.100.7' }).catch(() => undefined);
    }

    await expect(
      attempt(
        { ipAddress: '198.51.100.7', deviceKey: OWNER_DEVICE },
        rightPassword,
      ),
    ).resolves.toBe('tokens');
  });

  it('does not trust a device key the account never signed in with', async () => {
    for (let i = 0; i < 10; i++) {
      await attempt({
        ipAddress: '198.51.100.7',
        deviceKey: `${i}`.repeat(43),
      }).catch(() => undefined);
    }

    expect(
      await statusOf(
        attempt({ ipAddress: '198.51.100.7', deviceKey: 'x'.repeat(43) }),
      ),
    ).toBe(429);
  });

  it('pauses a network trying many accounts', async () => {
    for (let i = 0; i < 100; i++) {
      await attempt({ account: `user${i}@example.com` }).catch(() => undefined);
    }

    expect(await statusOf(attempt({ account: 'new@example.com' }))).toBe(429);
  });

  it('pauses strangers, not the owner, when one account is tried from many networks', async () => {
    await attempt({ deviceKey: OWNER_DEVICE }, rightPassword);
    for (let i = 0; i < 50; i++) {
      await attempt({ ipAddress: `198.51.100.${i}` }).catch(() => undefined);
    }

    await expect(
      attempt({ ipAddress: '198.51.100.200' }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: ACCOUNT_UNDER_ATTACK }),
    });
    await expect(
      attempt(
        { ipAddress: '198.51.100.201', deviceKey: OWNER_DEVICE },
        rightPassword,
      ),
    ).resolves.toBe('tokens');
  });

  it('forgets typos from a source once it signs in', async () => {
    for (let i = 0; i < 9; i++) await attempt({}).catch(() => undefined);
    await attempt({}, rightPassword);

    for (let i = 0; i < 10; i++) {
      expect(await statusOf(attempt({}))).toBe(401);
    }
  });

  it('never counts successful sign-ins against the network', async () => {
    for (let i = 0; i < 150; i++) {
      await attempt({ account: `user${i}@example.com` }, rightPassword);
    }

    expect(await statusOf(attempt({ account: 'other@example.com' }))).toBe(401);
  });

  it('does not count an attempt that failed for another reason than the password', async () => {
    const broken = () => Promise.reject(new BadRequestException('Bad input'));
    for (let i = 0; i < 20; i++) {
      await attempt({}, broken).catch(() => undefined);
    }

    expect(await statusOf(attempt({}))).toBe(401);
  });
});
