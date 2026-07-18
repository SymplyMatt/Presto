import { Controller, HttpCode, HttpStatus, Post, RawBodyRequest, Req } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { webhooksService } from './webhooks.service';

@ApiTags('webhooks')
@Controller('webhooks')
export class webhooksController {
  constructor(private readonly service: webhooksService) {}

  @Post('payments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive a signed event from the active payment processor' })
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  handle(@Req() request: RawBodyRequest<Request>) {
    const rawBody = request.rawBody ?? Buffer.from(JSON.stringify(request.body));
    return this.service.handle(rawBody, request.headers);
  }
}
