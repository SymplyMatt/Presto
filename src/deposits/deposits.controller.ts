import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { jwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { authenticatedUser, currentUser } from '../common/current-user.decorator';
import { depositsService } from './deposits.service';
import { createDepositDto } from './dto/create-deposit.dto';
import { verifyDepositDto } from './dto/verify-deposit.dto';

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

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify a deposit with the payment processor and credit the wallet if paid',
    description:
      'Looks up the deposit by its processor reference, asks the processor for the current status, and updates the local deposit (and wallet balance) when payment succeeded.',
  })
  verify(@currentUser() user: authenticatedUser, @Body() input: verifyDepositDto) {
    return this.service.verifyByReference(user.userId, user.email, input.reference);
  }

  @Get()
  @ApiOperation({ summary: 'List all deposit requests for the authenticated user' })
  list(@currentUser() user: authenticatedUser) {
    return this.service.list(user.userId);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get deposit status; unconfirmed deposits stay pending until TTL expiry',
  })
  get(@currentUser() user: authenticatedUser, @Param('id') id: string) {
    return this.service.get(user.userId, id);
  }
}
