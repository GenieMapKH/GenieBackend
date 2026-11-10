import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PropertyThumbnailService } from '../properties/services/property-thumbnail.service';

/**
 * Makes thumbnails for listing photos uploaded before thumbnails existed.
 * Needs migration 29 first. Safe to stop and run again.
 *
 *   npm run build -w property
 *   node property/dist/scripts/backfill-photo-thumbnails.js
 */
async function backfill() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'error', 'warn'],
  });
  try {
    const { made, failed } = await app.get(PropertyThumbnailService).backfill();
    Logger.log(`Done: ${made} thumbnails made, ${failed} skipped`, 'Backfill');
  } finally {
    await app.close();
  }
}
void backfill();
