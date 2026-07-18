import { Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { jwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { paymentProcessorView, paymentProviderRegistry } from './payment-provider.registry';

@ApiTags('payment processors')
@ApiBearerAuth()
@ApiCookieAuth()
@UseGuards(jwtAuthGuard)
@Controller('payment-processors')
export class paymentProcessorsController {
  constructor(private readonly processors: paymentProviderRegistry) {}

  @Get()
  @ApiOperation({ summary: 'List supported payment processors and the active processor' })
  list(): Promise<paymentProcessorView[]> {
    return this.processors.list();
  }

  @Patch(':name/activate')
  @ApiOperation({ summary: 'Set the active payment processor' })
  activate(@Param('name') name: string): Promise<paymentProcessorView> {
    return this.processors.activate(name);
  }
}
