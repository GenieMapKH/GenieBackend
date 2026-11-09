import { Module } from '@nestjs/common';
import { SupabaseModule } from '@tilomnov/shared';
import { AdvertisementsService } from './advertisements.service';
import {
  PublicAdvertisementsController,
  InternalAdvertisementsController,
} from './advertisements.controller';
@Module({
  imports: [SupabaseModule],
  providers: [AdvertisementsService],
  controllers: [
    PublicAdvertisementsController,
    InternalAdvertisementsController,
  ],
})
export class AdvertisementsModule {}
