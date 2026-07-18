import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { jwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { banksService } from './banks.service';
import { bankInfo } from './payment-provider';

@ApiTags('banks')
@ApiBearerAuth()
@ApiCookieAuth()
@UseGuards(jwtAuthGuard)
@Controller('banks')
export class banksController {
  constructor(private readonly service: banksService) {}

  @Get()
  @ApiOperation({
    summary: 'List banks supported by the active payment processor',
    description:
      'Returns bank name/code pairs for withdrawals. Results are cached in Redis for 24 hours per processor.',
  })
  list(): Promise<bankInfo[]> {
    return this.service.list();
  }
}
