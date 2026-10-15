import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Public } from '@/auth/decorators';
import { LeadsService } from '@/modules/leads/leads.service';
import { CreateLeadDto, ListLeadsQueryDto, UpdateLeadDto } from '@/modules/leads/dto/lead.dto';
import { PlatformAuthGuard } from '../guards/platform-auth.guard';
import { PlatformRolesGuard } from '../guards/platform-roles.guard';
import { CurrentPlatformUser } from '../platform.decorators';
import type { PlatformAuthUser } from '../platform.types';

/** Internal-console work list of potential partners. */
@ApiTags('Platform · Leads')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformAuthGuard, PlatformRolesGuard)
@Controller('platform/leads')
export class PlatformLeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  @ApiOperation({ summary: 'List leads (paginated; filter by status, source or a search)' })
  list(@Query() q: ListLeadsQueryDto) {
    return this.leads.list(q);
  }

  @Post()
  @ApiOperation({ summary: 'Add a lead by hand' })
  create(@Body() dto: CreateLeadDto, @CurrentPlatformUser() user: PlatformAuthUser) {
    return this.leads.create(dto, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: "Update a lead: its status, notes or contact details" })
  update(@Param('id') id: string, @Body() dto: UpdateLeadDto) {
    return this.leads.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a lead' })
  async remove(@Param('id') id: string) {
    await this.leads.remove(id);
  }
}
