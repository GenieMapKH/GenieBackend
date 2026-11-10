import { Controller, Post, Get, UseGuards, Request } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('properties')
@Controller('properties')
export class PropertiesController {
  // ==========================================
  // PUBLIC ENDPOINT (Option 1: Guest Browsing)
  // ==========================================
  @Get()
  @ApiOperation({ summary: 'Get a list of properties (Public)' })
  @ApiResponse({
    status: 200,
    description: 'Returns properties for anyone to browse',
  })
  getProperties() {
    return [
      { id: 1, title: 'Beautiful Apartment', price: 1500 },
      { id: 2, title: 'Luxury Villa', price: 5000 },
    ];
  }

  // ==========================================
  // PROTECTED ENDPOINT (Requires Login)
  // ==========================================
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('user', 'admin')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a new property (Restricted to logged-in users and admins)',
  })
  @ApiResponse({ status: 201, description: 'Property created successfully' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden resource (Requires user or admin role)',
  })
  createProperty(@Request() req: { user: AuthenticatedUser }) {
    const userId = req.user.userId;
    const userRole = req.user.role;

    return {
      message: 'Property created successfully',
      user: { userId, userRole },
    };
  }
}
