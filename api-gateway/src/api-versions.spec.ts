import type { IncomingMessage } from 'http';
import type { Request, Response } from 'express';
import type { ApiVersions } from '@tilomnov/shared/api-versions';
import {
  createApiVersionMiddleware,
  isWebSocketUpgrade,
  versionedPaths,
  versionInPath,
  withVersion,
} from './api-versions';

const v1Only: ApiVersions = { served: ['1'], retired: [], unversioned: '1' };
const v1Retired: ApiVersions = {
  served: ['2'],
  retired: ['1'],
  unversioned: '1',
};

describe('reading the version from a path', () => {
  it.each([
    ['/v1/properties', '1'],
    ['/v12/chat/keys', '12'],
    ['/v1', '1'],
    ['/v1?x=1', '1'],
    ['/properties', null],
    ['/videos/1', null],
    ['/v1beta/properties', null],
  ])('%s names version %s', (path, version) => {
    expect(versionInPath(path)).toBe(version);
  });
});

describe('which paths the gateway accepts', () => {
  it('accepts a prefix unversioned and under every served or retired version', () => {
    expect(versionedPaths('/auth', v1Retired)).toEqual([
      '/auth',
      '/v2/auth',
      '/v1/auth',
    ]);
  });
});

describe('the path forwarded to a service', () => {
  it('gives an unversioned path the version it stands for', () => {
    expect(withVersion('/properties/7?x=1', v1Only)).toBe(
      '/v1/properties/7?x=1',
    );
  });

  it('leaves a versioned path as it is', () => {
    expect(withVersion('/v1/properties/7', v1Only)).toBe('/v1/properties/7');
  });

  it('recognises a WebSocket handshake, whose socket.io path is never rewritten', () => {
    const upgrade = { headers: { upgrade: 'WebSocket' } } as IncomingMessage;
    expect(isWebSocketUpgrade(upgrade)).toBe(true);
    expect(isWebSocketUpgrade({ headers: {} } as IncomingMessage)).toBe(false);
  });
});

describe('the API version middleware', () => {
  function run(path: string, versions: ApiVersions) {
    const res = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();
    createApiVersionMiddleware(versions)(
      { originalUrl: path } as Request,
      res as unknown as Response,
      next,
    );
    return { res, next };
  }

  it('passes a served version on and says which version answers', () => {
    const { res, next } = run('/v1/properties', v1Only);

    expect(next).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('API-Version', '1');
  });

  it('answers an unversioned request as the version it stands for', () => {
    const { res, next } = run('/properties', v1Only);

    expect(next).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('API-Version', '1');
  });

  it('answers a retired version 410 with the code the app turns into "Update required"', () => {
    const { res, next } = run('/v1/properties', v1Retired);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'api_version_retired' }),
    );
  });

  it('retires unversioned paths together with the version they stand for', () => {
    const { res, next } = run('/properties', v1Retired);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(410);
  });
});
