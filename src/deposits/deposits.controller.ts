import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { jwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { authenticatedUser, currentUser } from '../common/current-user.decorator';
import { idempotencyKey } from '../common/idempotency-key.decorator';
import { depositsService } from './deposits.service';
import { createDepositDto } from './dto/create-deposit.dto';

@ApiTags('deposits')
@ApiBearerAuth()
@ApiCookieAuth()
@UseGuards(jwtAuthGuard)
@Controller('deposits')
export class depositsController {
  constructor(private readonly service: depositsService) {}

  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiOperation({ summary: 'Initialize a Paystack deposit' })
  create(
    @currentUser() user: authenticatedUser,
    @idempotencyKey() key: string,
    @Body() input: createDepositDto,
  ) {
    return this.service.create(user.userId, user.email, key, input);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get deposit status; unconfirmed deposits stay pending until TTL expiry',
  })
  get(@currentUser() user: authenticatedUser, @Param('id') id: string) {
    return this.service.get(user.userId, id);
  }
}
