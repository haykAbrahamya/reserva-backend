import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PlatformAreasService } from './platform-areas.service';
import { Public } from '@/auth/decorators';
import { PlatformAuthGuard } from '../guards/platform-auth.guard';
import { PlatformRolesGuard } from '../guards/platform-roles.guard';
import { CreateAreaDto, UpdateAreaDto } from './dto/platform-area.dto';

/** Staff administration of the shared area catalog (cities and districts). */
@ApiTags('Platform · Areas')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformAuthGuard, PlatformRolesGuard)
@Controller('platform/areas')
export class PlatformAreasController {
  constructor(private readonly areas: PlatformAreasService) {}

  @Get()
  @ApiOperation({ summary: 'List areas with usage counts (including inactive)' })
  list(@Query('search') search?: string) {
    return this.areas.list(search);
  }

  @Post()
  @ApiOperation({ summary: 'Create an area' })
  create(@Body() dto: CreateAreaDto) {
    return this.areas.create(dto);
  }

  @Patch(':key')
  @ApiOperation({ summary: 'Update an area' })
  update(@Param('key') key: string, @Body() dto: UpdateAreaDto) {
    return this.areas.update(key, dto);
  }

  @Delete(':key')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete an unused, childless area' })
  async remove(@Param('key') key: string) {
    await this.areas.remove(key);
  }
}
