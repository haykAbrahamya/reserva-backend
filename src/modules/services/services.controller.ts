import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ServicesService } from './services.service';
import { CurrentUser } from '@/auth/decorators';
import type { AuthUser } from '@/auth/auth.types';
import {
  CreateServiceDto,
  UpdateServiceDto,
  ListServiceQueryDto,
} from './dto/service.dto';

@ApiTags('Services')
@ApiBearerAuth()
@Controller('services')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get()
  @ApiOperation({ summary: "List the partner's services" })
  list(@CurrentUser() user: AuthUser, @Query() q: ListServiceQueryDto) {
    return this.services.list(user.partnerId, q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a service' })
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.services.get(user.partnerId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a service' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateServiceDto) {
    return this.services.create(user.partnerId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a service' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateServiceDto) {
    return this.services.update(user.partnerId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-delete a service' })
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.services.remove(user.partnerId, id);
  }
}
