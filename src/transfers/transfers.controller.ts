import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { jwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { authenticatedUser, currentUser } from '../common/current-user.decorator';
import { idempotencyKey } from '../common/idempotency-key.decorator';
import { createTransferDto } from './dto/create-transfer.dto';
import { transfersService } from './transfers.service';

@ApiTags('transfers')
@ApiBearerAuth()
@ApiCookieAuth()
@UseGuards(jwtAuthGuard)
@Controller('transfers')
export class transfersController {
  constructor(private readonly service: transfersService) {}

  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiOperation({ summary: 'Transfer from the authenticated wallet to another user' })
  create(
    @currentUser() user: authenticatedUser,
    @idempotencyKey() key: string,
    @Body() input: createTransferDto,
  ) {
    return this.service.create(user.userId, user.email, key, input);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a transfer involving the authenticated wallet' })
  get(@currentUser() user: authenticatedUser, @Param('id') id: string) {
    return this.service.get(user.userId, id);
  }
}
