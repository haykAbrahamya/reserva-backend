import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PlatformPartnersService } from './platform-partners.service';
import { Public } from '@/auth/decorators';
import { PlatformAuthGuard } from '../guards/platform-auth.guard';
import { PlatformRolesGuard } from '../guards/platform-roles.guard';
import { CreatePartnerDto, UpdatePartnerDto } from '@/modules/partners/dto/partner.dto';
import {
  ListPlatformPartnersQueryDto,
  SetPartnerActiveDto,
  SetPartnerMarketplaceDto,
} from './dto/platform-partner.dto';

@ApiTags('Platform · Partners')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformAuthGuard, PlatformRolesGuard)
@Controller('platform/partners')
export class PlatformPartnersController {
  constructor(private readonly partners: PlatformPartnersService) {}

  @Get()
  @ApiOperation({ summary: 'List partners (paginated, searchable)' })
  list(@Query() q: ListPlatformPartnersQueryDto) {
    return this.partners.list(q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a partner with counts + admins' })
  get(@Param('id') id: string) {
    return this.partners.get(id);
  }

  @Post()
  @ApiOperation({ summary: 'Provision a partner + first admin user' })
  create(@Body() dto: CreatePartnerDto) {
    return this.partners.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update partner profile + branding/presentation' })
  update(@Param('id') id: string, @Body() dto: UpdatePartnerDto) {
    return this.partners.update(id, dto);
  }

  @Patch(':id/active')
  @ApiOperation({ summary: 'Enable or disable a partner' })
  setActive(@Param('id') id: string, @Body() dto: SetPartnerActiveDto) {
    return this.partners.setActive(id, dto.active);
  }

  @Patch(':id/marketplace')
  @ApiOperation({ summary: 'Feature/unfeature a salon in the public marketplace' })
  setMarketplace(@Param('id') id: string, @Body() dto: SetPartnerMarketplaceDto) {
    return this.partners.setMarketplace(id, dto.listed);
  }
}
