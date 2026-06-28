import { Controller, Delete, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Public } from '@/auth/decorators';
import { PlatformPendingRegistrationsService } from './platform-pending-registrations.service';
import { ListPendingRegistrationsQueryDto } from './dto/pending-registration.dto';
import { PlatformAuthGuard } from '../guards/platform-auth.guard';
import { PlatformRolesGuard } from '../guards/platform-roles.guard';

/** Internal-console: self-serve signups awaiting activation (link not clicked). */
@ApiTags('Platform · Pending registrations')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformAuthGuard, PlatformRolesGuard)
@Controller('platform/pending-registrations')
export class PlatformPendingRegistrationsController {
  constructor(private readonly service: PlatformPendingRegistrationsService) {}

  @Get()
  @ApiOperation({ summary: 'List pending self-serve signups (not yet activated)' })
  list(@Query() q: ListPendingRegistrationsQueryDto) {
    return this.service.list(q);
  }

  @Get('count')
  @ApiOperation({ summary: 'Count of actionable pending signups' })
  count() {
    return this.service.pendingCount();
  }

  @Post(':id/resend')
  @ApiOperation({ summary: 'Resend the activation email (new link + extended expiry)' })
  resend(@Param('id') id: string) {
    return this.service.resend(id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a pending registration' })
  async remove(@Param('id') id: string) {
    await this.service.remove(id);
  }
}
