import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminGuard, CurrentUserId, JwtAuthGuard } from '@tilomnov/shared';
import { CreatePromotionDto } from './dto/create-promotion.dto';
import { PromotionStatus, PromotionsService } from './promotions.service';

/** For a future admin panel; until then, called with an admin account's token. */
@ApiTags('notifications')
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('notifications/promotions')
export class PromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  /** `202`: accepted and being sent; poll `GET /:id` for the counts. */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  create(
    @CurrentUserId() adminId: string,
    @Body() dto: CreatePromotionDto,
  ): Promise<PromotionStatus> {
    return this.promotions.create(adminId, dto);
  }

  @Get(':id')
  status(@Param('id', ParseUUIDPipe) id: string): Promise<PromotionStatus> {
    return this.promotions.status(id);
  }
}
