import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUserId, RateLimit, RateLimits } from '@tilomnov/shared';
import { AvatarService } from './avatar.service';
import { UseAvatarUploadDto, UseGooglePhotoDto } from './dto/avatar.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsernameCheckQuery } from './dto/username-check.query';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  /** An upload URL costs nothing to ask for but lets a file be stored: 10 per user every minute. */
  private readonly avatarUploadLimiter: RateLimit;

  /** One check per keystroke pause: 60 per user every minute, so names cannot be harvested. */
  private readonly usernameCheckLimiter: RateLimit;

  constructor(
    private readonly usersService: UsersService,
    private readonly avatars: AvatarService,
    rateLimits: RateLimits,
  ) {
    this.avatarUploadLimiter = rateLimits.create('avatar-upload', 10, 60);
    this.usernameCheckLimiter = rateLimits.create('username-check', 60, 60);
  }

  @Get('me')
  getProfile(@CurrentUserId() userId: string) {
    return this.usersService.getProfile(userId);
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Update the profile: username, name, first/last name, sex, phone',
  })
  @ApiResponse({ status: 200, description: 'Profile successfully updated' })
  @ApiResponse({ status: 409, description: 'Username or phone already taken' })
  updateProfile(
    @CurrentUserId() userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(userId, dto);
  }

  /** Declared before `:id`, which would otherwise take "username-available" for an id. */
  @Get('username-available')
  @ApiOperation({
    summary:
      "Whether a username can be chosen: well formed and not another account's",
  })
  async checkUsername(
    @CurrentUserId() userId: string,
    @Query() query: UsernameCheckQuery,
  ) {
    try {
      await this.usernameCheckLimiter.consume(userId);
    } catch {
      throw new HttpException(
        'Too Many Requests',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.usersService.checkUsername(userId, query.username);
  }

  @Post('me/avatar/upload')
  @ApiOperation({
    summary: 'Where to upload a new profile picture: `{ path, uploadUrl }`',
  })
  async createAvatarUpload(@CurrentUserId() userId: string) {
    try {
      await this.avatarUploadLimiter.consume(userId);
    } catch {
      throw new HttpException(
        'Too Many Requests',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.avatars.createUpload(userId);
  }

  @Put('me/avatar')
  @ApiOperation({
    summary: 'Use the picture uploaded to `path` as the profile picture',
  })
  useAvatarUpload(
    @CurrentUserId() userId: string,
    @Body() dto: UseAvatarUploadDto,
  ) {
    return this.avatars.useUpload(userId, dto.path);
  }

  @Put('me/avatar/google')
  @ApiOperation({
    summary: "Use the Google account's photo, and keep following it",
  })
  useGooglePhoto(
    @CurrentUserId() userId: string,
    @Body() dto: UseGooglePhotoDto,
  ) {
    return this.avatars.useGooglePhoto(userId, dto.photoUrl);
  }

  @Delete('me/avatar')
  @ApiOperation({ summary: 'Remove the profile picture' })
  removeAvatar(@CurrentUserId() userId: string) {
    return this.avatars.remove(userId);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      "Another user's public profile (username, name, avatar, member since)",
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  getPublicProfile(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.getPublicProfile(id);
  }
}
