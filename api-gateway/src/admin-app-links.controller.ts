import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Query,
} from '@nestjs/common';

const APP_PACKAGE = 'com.sparkbytekh.tilomnov';
const ANDROID_CERTIFICATE =
  'D5:26:8F:E6:7A:13:3E:0A:2C:0C:2A:FC:D7:81:A2:40:9B:AC:60:82:3C:A8:39:01:B5:A5:DD:DF:80:2F:E2:82';

/** Public link metadata never grants a session; only the app's POST consumes a challenge. */
@Controller()
export class AdminAppLinksController {
  @Get('.well-known/assetlinks.json')
  @Header('Cache-Control', 'public, max-age=300')
  androidAssociation() {
    return [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: APP_PACKAGE,
          sha256_cert_fingerprints: [ANDROID_CERTIFICATE],
        },
      },
    ];
  }

  @Get('.well-known/apple-app-site-association')
  @Header('Cache-Control', 'public, max-age=300')
  appleAssociation() {
    const team = process.env.APPLE_TEAM_ID;
    return {
      applinks: {
        apps: [],
        details: /^[A-Z0-9]{10}$/.test(team ?? '')
          ? [{ appID: `${team}.${APP_PACKAGE}`, paths: ['/admin-login'] }]
          : [],
      },
    };
  }

  @Get('admin-login')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('Content-Type', 'text/html; charset=utf-8')
  openApp(@Query('token') token?: string) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new BadRequestException('Open the sign-in link from your email.');
    }
    const intent = `intent://tilomnovgateway.sparkbytekh.com/admin-login?token=${encodeURIComponent(token)}#Intent;scheme=https;package=${APP_PACKAGE};end`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Open Tilomnov</title></head><body><main><h1>Finish signing in to Tilomnov</h1><p>Open this link on the phone where Tilomnov is installed.</p><p><a href="${intent}">Open Tilomnov on Android</a></p><p>If the app does not open, install the latest app build and open the link from your email again.</p></main></body></html>`;
  }
}
