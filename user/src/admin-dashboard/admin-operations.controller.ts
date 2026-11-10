import {
  Body,
  ConflictException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard, CurrentUserId } from '@tilomnov/shared';
import { AdminRotationJobService } from './admin-rotation-job.service';
import { AdminPlatformService } from './admin-platform.service';
import { ModerationReasonDto } from './admin-moderation.dto';
import { AdminLogsQuery, AdminSentryService } from './admin-sentry.service';
import {
  AdminDeploymentsService,
  AdminRollbackDto,
} from './admin-deployments.service';

@UseGuards(AdminGuard)
@Controller('admin/operations')
export class AdminOperationsController {
  constructor(
    private readonly rotation: AdminRotationJobService,
    private readonly platform: AdminPlatformService,
    private readonly sentry: AdminSentryService,
    private readonly deployments: AdminDeploymentsService,
  ) {}

  @Get('rotation-job')
  rotationStatus() {
    return this.rotation.status();
  }

  @Post('rotation-job')
  rotate(@CurrentUserId() actor: string, @Body() dto: ModerationReasonDto) {
    return this.platform.mutate(
      actor,
      actor,
      'credentials.rotate-all.request',
      dto.reason,
      () => this.rotation.force(),
    );
  }

  @Get('logs')
  logs(@Query() query: AdminLogsQuery) {
    return this.sentry.logs(query);
  }

  @Get('deployments')
  deploymentStatus() {
    return this.deployments.status();
  }

  @Post('deployments/:service/rollback')
  async rollback(
    @CurrentUserId() actor: string,
    @Param('service') service: string,
    @Body() dto: AdminRollbackDto,
  ) {
    if ((await this.rotation.status()).busy)
      throw new ConflictException(
        'Wait for credential rotation to finish before rolling back',
      );
    return this.platform.mutate(
      actor,
      dto.deploymentId,
      'deployment.rollback.request',
      `${service}: ${dto.reason}`,
      () => this.deployments.rollback(service, dto),
    );
  }
}
