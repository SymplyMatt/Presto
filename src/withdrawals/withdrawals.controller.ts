import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { jwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { authenticatedUser, currentUser } from '../common/current-user.decorator';
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
  @ApiOperation({ summary: 'Withdraw through the active payment processor' })
  create(@currentUser() user: authenticatedUser, @Body() input: createWithdrawalDto) {
    return this.service.create(user.userId, user.email, input);
  }

  @Get()
  @ApiOperation({ summary: 'List all withdrawal attempts for the authenticated user' })
  list(@currentUser() user: authenticatedUser) {
    return this.service.list(user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get withdrawal status' })
  get(@currentUser() user: authenticatedUser, @Param('id') id: string) {
    return this.service.get(user.userId, id);
  }
}
