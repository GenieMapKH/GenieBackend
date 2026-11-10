import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@tilomnov/shared';
import { CurrentDeviceOwner } from './current-device-owner.decorator';
import {
  RegisterPushDeviceDto,
  RemovePushDeviceDto,
} from './dto/push-device.dto';
import { DeviceOwner, PushDevicesService } from './push-devices.service';

@ApiTags('notifications')
@UseGuards(JwtAuthGuard)
@Controller('notifications/devices')
export class PushDevicesController {
  constructor(private readonly devices: PushDevicesService) {}

  /** Called at sign-in and whenever Firebase gives the app a new token. */
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async register(
    @CurrentDeviceOwner() owner: DeviceOwner,
    @Body() dto: RegisterPushDeviceDto,
  ): Promise<void> {
    await this.devices.register(owner, {
      token: dto.token,
      platform: dto.platform,
      locale: dto.locale ?? 'en',
    });
  }

  /** Called before signing out, so this device stops receiving the account's notifications. */
  @Post('remove')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentDeviceOwner() owner: DeviceOwner,
    @Body() dto: RemovePushDeviceDto,
  ): Promise<void> {
    await this.devices.unregister(owner.userId, dto.token);
  }
}
