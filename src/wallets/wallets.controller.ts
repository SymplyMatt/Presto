import { Controller, Get, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { jwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { authenticatedUser, currentUser } from '../common/current-user.decorator';
import { walletsService } from './wallets.service';

@ApiTags('wallet')
@ApiBearerAuth()
@ApiCookieAuth()
@UseGuards(jwtAuthGuard)
@Controller('wallet')
export class walletsController {
  constructor(private readonly service: walletsService) {}

  @Get()
  @ApiOperation({ summary: 'Get the authenticated user wallet balance' })
  getWallet(@currentUser() user: authenticatedUser) {
    return this.service.getView(user.userId);
  }

  @Get('ledger')
  @ApiOperation({ summary: 'Get the wallet ledger' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  getLedger(
    @currentUser() user: authenticatedUser,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.service.listLedger(user.userId, page, limit);
  }
}
