import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { jwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { authenticatedUser, currentUser } from '../common/current-user.decorator';
import { idempotencyKey } from '../common/idempotency-key.decorator';
import { createWithdrawalDto } from './dto/create-withdrawal.dto';
import { withdrawalsService } from './withdrawals.service';

@ApiTags('withdrawals')
@ApiBearerAuth()
@ApiCookieAuth()
@UseGuards(jwtAuthGuard)
@Controller('withdrawals')
export class withdrawalsController {
  constructor(private readonly service: withdrawalsService) {}

  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiOperation({ summary: 'Withdraw from the wallet to a Nigerian bank account' })
  create(
    @currentUser() user: authenticatedUser,
    @idempotencyKey() key: string,
    @Body() input: createWithdrawalDto,
  ) {
    return this.service.create(user.userId, user.email, key, input);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get withdrawal status' })
  get(@currentUser() user: authenticatedUser, @Param('id') id: string) {
    return this.service.get(user.userId, id);
  }
}
