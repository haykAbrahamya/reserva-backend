import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { Roles, CurrentUser } from '@/auth/decorators';
import type { AuthUser } from '@/auth/auth.types';
import { CreateManagerDto, UpdateManagerDto } from './dto/user.dto';

/** Team management — admin-only. */
@ApiTags('Users')
@ApiBearerAuth()
@Roles('admin')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List branch managers (admin)' })
  list(@CurrentUser() user: AuthUser) {
    return this.users.listManagers(user.partnerId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a manager; returns a one-time password (admin)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateManagerDto) {
    return this.users.createManager(user.partnerId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a manager (admin)' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateManagerDto) {
    return this.users.updateManager(user.partnerId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a manager (admin)' })
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.users.removeManager(user.partnerId, id);
  }
}
