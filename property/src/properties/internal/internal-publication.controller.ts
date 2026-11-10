import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { serviceCallGuard } from '@tilomnov/shared';
import { PropertyPublicationService } from '../services/property-publication.service';
import {
  BeginPublishDto,
  RevertPublishDto,
  SettlePublishDto,
} from './dto/publication.dto';

/**
 * Called by the payment service only, never by the app: the gateway does not
 * forward `/internal`, and the guard checks who is asking.
 */
@ApiExcludeController()
@UseGuards(serviceCallGuard('payment'))
@Controller({
  path: 'internal/properties/:propertyId',
  version: VERSION_NEUTRAL,
})
export class InternalPublicationController {
  constructor(private readonly publication: PropertyPublicationService) {}

  @Post('begin-publish')
  @HttpCode(HttpStatus.OK)
  beginPublish(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: BeginPublishDto,
  ) {
    return this.publication.beginPublish(dto.userId, propertyId);
  }

  @Post('settle-publish')
  @HttpCode(HttpStatus.NO_CONTENT)
  settlePublish(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: SettlePublishDto,
  ) {
    return this.publication.settlePublish(propertyId, dto.outcome);
  }

  @Post('revert-publish')
  @HttpCode(HttpStatus.NO_CONTENT)
  revertPublish(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: RevertPublishDto,
  ) {
    return this.publication.revertPublish(propertyId, dto.status);
  }
}
