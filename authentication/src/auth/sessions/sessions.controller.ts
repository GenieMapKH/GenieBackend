import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { SessionService } from './session.service';

/** "Logged-in devices": the caller's sessions, and signing them out. */
@ApiTags('auth')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('auth')
export class SessionsController {
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  @Get('sessions')
  @ApiOperation({
    summary:
      'The devices signed in to this account, and whether this one may sign the others out',
  })
  getSessions(@CurrentUser() user: AuthenticatedUser) {
    return this.sessions.listSessions(user);
  }

  @Delete('sessions/:id')
  @ApiOperation({ summary: 'Sign one device out, at once' })
  @ApiResponse({
    status: 403,
    description: 'This device signed in less than a day ago',
  })
  @ApiResponse({
    status: 404,
    description: 'No such active session on this account',
  })
  revokeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) sessionId: string,
  ) {
    return this.sessions.revokeSession(user, sessionId);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign every device out, this one included' })
  @ApiResponse({
    status: 403,
    description: 'This device signed in less than a day ago',
  })
  logoutAll(@CurrentUser() user: AuthenticatedUser) {
    return this.sessions.logoutAll(user);
  }
}
