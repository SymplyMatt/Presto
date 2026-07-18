import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { jwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { authenticatedUser, currentUser } from '../common/current-user.decorator';
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
  @ApiOperation({ summary: 'Initialize a deposit with the active payment processor' })
  create(@currentUser() user: authenticatedUser, @Body() input: createDepositDto) {
    return this.service.create(user.userId, user.email, input);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get deposit status; unconfirmed deposits stay pending until TTL expiry',
  })
  get(@currentUser() user: authenticatedUser, @Param('id') id: string) {
    return this.service.get(user.userId, id);
  }
}
