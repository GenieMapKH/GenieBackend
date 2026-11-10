import { Socket } from 'socket.io';
import type { ApiVersions } from '@tilomnov/shared/api-versions';
import { refuseApiVersion, socketApiVersion } from './ws-api-version';

function socket(auth: Record<string, unknown>): Socket {
  return { handshake: { auth } } as unknown as Socket;
}

const v1Only: ApiVersions = { served: ['1'], retired: [], unversioned: '1' };
const v1Retired: ApiVersions = {
  served: ['2'],
  retired: ['1'],
  unversioned: '1',
};

describe('the API version of a chat socket', () => {
  it('is what the app sends in the handshake', () => {
    expect(socketApiVersion(socket({ apiVersion: '2' }), v1Retired)).toBe('2');
  });

  it('is the unversioned one for app builds that send none', () => {
    expect(socketApiVersion(socket({ token: 't' }), v1Only)).toBe('1');
    expect(socketApiVersion(socket({ apiVersion: 1 }), v1Only)).toBe('1');
  });

  it('lets a served version connect', () => {
    expect(refuseApiVersion(socket({ apiVersion: '1' }), v1Only)).toBeNull();
    expect(refuseApiVersion(socket({}), v1Only)).toBeNull();
  });

  it('refuses a retired version with the code the app turns into "Update required"', () => {
    expect(refuseApiVersion(socket({ apiVersion: '1' }), v1Retired)).toBe(
      'api_version_retired',
    );
    expect(refuseApiVersion(socket({}), v1Retired)).toBe('api_version_retired');
  });

  it('refuses a version this server does not know yet', () => {
    expect(refuseApiVersion(socket({ apiVersion: '9' }), v1Only)).toBe(
      'api_version_unknown',
    );
  });
});
