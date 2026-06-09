import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SignupService } from './signup.service';
import { Public } from '@/auth/decorators';
import { SignupDto, ActivateDto } from './dto/signup.dto';

@ApiTags('Signup')
@Public()
@Controller('public/signup')
export class SignupController {
  constructor(private readonly signup: SignupService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Start a self-serve signup — emails an activation link' })
  start(@Body() dto: SignupDto) {
    return this.signup.start(dto);
  }

  @Post('activate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Activate via magic-link token — creates partner + auto-login' })
  activate(@Body() dto: ActivateDto) {
    return this.signup.activate(dto.token);
  }

  @Get('slug-available')
  @ApiOperation({ summary: 'Is a slug available for signup?' })
  async slugAvailable(@Query('slug') slug: string) {
    return { available: await this.signup.slugAvailable(slug ?? '') };
  }
}
