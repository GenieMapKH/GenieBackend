import { BadRequestException } from '@nestjs/common';
import { AdminAppLinksController } from './admin-app-links.controller';

describe('Admin app links', () => {
  const controller = new AdminAppLinksController();
  const originalTeam = process.env.APPLE_TEAM_ID;
  afterEach(() => {
    if (originalTeam === undefined) delete process.env.APPLE_TEAM_ID;
    else process.env.APPLE_TEAM_ID = originalTeam;
  });

  it('associates the domain with the signed production Android app', () => {
    expect(controller.androidAssociation()[0].target).toEqual({
      namespace: 'android_app',
      package_name: 'com.sparkbytekh.tilomnov',
      sha256_cert_fingerprints: [
        'D5:26:8F:E6:7A:13:3E:0A:2C:0C:2A:FC:D7:81:A2:40:9B:AC:60:82:3C:A8:39:01:B5:A5:DD:DF:80:2F:E2:82',
      ],
    });
  });

  it('enables Apple links only with a valid signing team', () => {
    delete process.env.APPLE_TEAM_ID;
    expect(controller.appleAssociation().applinks.details).toEqual([]);
    process.env.APPLE_TEAM_ID = 'ABCDEFGHIJ';
    expect(controller.appleAssociation().applinks.details[0]).toEqual({
      appID: 'ABCDEFGHIJ.com.sparkbytekh.tilomnov',
      paths: ['/admin-login'],
    });
  });

  it('opens the known Android package and rejects malformed link tokens', () => {
    expect(controller.openApp('a'.repeat(43))).toContain(
      'package=com.sparkbytekh.tilomnov;end',
    );
    expect(() => controller.openApp('<script>alert(1)</script>')).toThrow(
      BadRequestException,
    );
    expect(() => controller.openApp()).toThrow(BadRequestException);
  });
});
