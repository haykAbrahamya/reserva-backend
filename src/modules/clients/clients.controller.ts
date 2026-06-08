import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ClientsService } from './clients.service';
import { CurrentUser } from '@/auth/decorators';
import type { AuthUser } from '@/auth/auth.types';
import { ListClientsQueryDto, UpdateClientDto } from './dto/client.dto';
import { RAW_RESPONSE } from '@/common/interceptors/transform.interceptor';

@ApiTags('Clients')
@ApiBearerAuth()
@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  @ApiOperation({ summary: 'List clients (paginated, searchable)' })
  async list(@CurrentUser() user: AuthUser, @Query() q: ListClientsQueryDto) {
    const result = await this.clients.list(user.partnerId, q);
    return { ...result, [RAW_RESPONSE]: true as const };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a client with booking history + stats' })
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.clients.get(user.partnerId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update client name / email / notes' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateClientDto) {
    return this.clients.update(user.partnerId, id, dto);
  }
}
