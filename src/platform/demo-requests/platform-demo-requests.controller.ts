import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Public } from '@/auth/decorators';
import { DemoRequestsService } from '@/modules/demo-requests/demo-requests.service';
import {
  ListDemoRequestsQueryDto,
  SetDemoRequestStatusDto,
} from '@/modules/demo-requests/dto/demo-request.dto';
import { PlatformAuthGuard } from '../guards/platform-auth.guard';
import { PlatformRolesGuard } from '../guards/platform-roles.guard';
import { CurrentPlatformUser } from '../platform.decorators';
import type { PlatformAuthUser } from '../platform.types';

/** Internal-console triage of public demo-request leads. */
@ApiTags('Platform · Demo requests')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformAuthGuard, PlatformRolesGuard)
@Controller('platform/demo-requests')
export class PlatformDemoRequestsController {
  constructor(private readonly service: DemoRequestsService) {}

  @Get()
  @ApiOperation({ summary: 'List demo requests (paginated, filter by status)' })
  list(@Query() q: ListDemoRequestsQueryDto) {
    return this.service.list(q);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Mark a demo request new/done' })
  setStatus(
    @Param('id') id: string,
    @Body() dto: SetDemoRequestStatusDto,
    @CurrentPlatformUser() user: PlatformAuthUser,
  ) {
    return this.service.setStatus(id, dto.status, user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a demo request' })
  async remove(@Param('id') id: string) {
    await this.service.remove(id);
  }
}
