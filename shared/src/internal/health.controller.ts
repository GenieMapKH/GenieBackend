import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';

/**
 * What the platform's health check asks. It only shows the process is up and
 * answering: it must not depend on the database or other services, or one
 * outage would make the platform restart every service. Unversioned: it is
 * the platform's, not part of the app's API.
 */
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
