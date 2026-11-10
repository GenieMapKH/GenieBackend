import { Logger } from '@nestjs/common';
import { createHmac } from 'crypto';
import { IceServersService } from './ice-servers.service';

const CLOUDFLARE = {
  CLOUDFLARE_TURN_KEY_ID: 'key-1',
  CLOUDFLARE_TURN_API_TOKEN: 'token-1',
};

const GOOGLE_STUN = {
  urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
};

function answering(status: number, body: unknown) {
  return jest
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify(body), { status }),
    ) as unknown as jest.MockedFunction<typeof fetch>;
}

describe('IceServersService', () => {
  beforeEach(() =>
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined),
  );
  afterEach(() => jest.restoreAllMocks());

  it('offers public STUN only, until TURN is configured', async () => {
    expect(await new IceServersService({}).forUser('u1')).toEqual({
      iceServers: [GOOGLE_STUN],
    });
  });

  it('gives a TURN password that expires, in the coturn scheme', async () => {
    const service = new IceServersService({
      TURN_URLS: 'turn:turn.example:3478, turns:turn.example:5349',
      TURN_SECRET: 's3cret',
    });

    const turn = (await service.forUser('u1', 1_000_000_000_000)).iceServers[1];

    expect(turn.urls).toEqual([
      'turn:turn.example:3478',
      'turns:turn.example:5349',
    ]);
    expect(turn.username).toBe(`${1_000_000_000 + 6 * 60 * 60}:u1`);
    expect(turn.credential).toBe(
      createHmac('sha1', 's3cret').update(turn.username!).digest('base64'),
    );
  });

  it('asks Cloudflare for 6-hour credentials and passes on its servers', async () => {
    const fetchFn = answering(201, {
      iceServers: [
        { urls: 'stun:stun.cloudflare.com:3478' },
        {
          urls: [
            'turn:turn.cloudflare.com:3478?transport=udp',
            'turns:turn.cloudflare.com:5349?transport=tcp',
          ],
          username: 'cf-user',
          credential: 'cf-pass',
        },
      ],
    });

    const result = await new IceServersService(CLOUDFLARE, fetchFn).forUser(
      'u1',
    );

    expect(result.iceServers).toEqual([
      { urls: ['stun:stun.cloudflare.com:3478'] },
      {
        urls: [
          'turn:turn.cloudflare.com:3478?transport=udp',
          'turns:turn.cloudflare.com:5349?transport=tcp',
        ],
        username: 'cf-user',
        credential: 'cf-pass',
      },
    ]);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(
      'https://rtc.live.cloudflare.com/v1/turn/keys/key-1/credentials/generate-ice-servers',
    );
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer token-1',
    );
    expect(JSON.parse(init?.body as string)).toEqual({ ttl: 6 * 60 * 60 });
  });

  it('falls back to STUN (and coturn) when Cloudflare refuses', async () => {
    const service = new IceServersService(
      {
        ...CLOUDFLARE,
        TURN_URLS: 'turn:turn.example:3478',
        TURN_SECRET: 's3cret',
      },
      answering(401, { error: 'nope' }),
    );

    const { iceServers } = await service.forUser('u1');

    expect(iceServers[0]).toEqual(GOOGLE_STUN);
    expect(iceServers[1].urls).toEqual(['turn:turn.example:3478']);
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('401'),
    );
  });

  it('falls back to STUN when Cloudflare cannot be reached or sends nothing usable', async () => {
    const unreachable = jest
      .fn()
      .mockRejectedValue(new Error('timeout')) as unknown as typeof fetch;

    expect(
      await new IceServersService(CLOUDFLARE, unreachable).forUser('u1'),
    ).toEqual({ iceServers: [GOOGLE_STUN] });
    expect(
      await new IceServersService(
        CLOUDFLARE,
        answering(201, { iceServers: [] }),
      ).forUser('u1'),
    ).toEqual({ iceServers: [GOOGLE_STUN] });
  });

  it('needs both Cloudflare settings', async () => {
    const fetchFn = answering(201, {});

    await new IceServersService(
      { CLOUDFLARE_TURN_KEY_ID: 'key-1' },
      fetchFn,
    ).forUser('u1');

    expect(fetchFn).not.toHaveBeenCalled();
  });
});
