import { Body, Controller, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { authCookieName } from './auth-cookie';
import { authService } from './auth.service';
import { loginDto } from './dto/login.dto';
import { registerDto } from './dto/register.dto';

@ApiTags('auth')
@Controller('auth')
export class authController {
  constructor(
    private readonly service: authService,
    private readonly configService: ConfigService,
  ) {}

  @Post('register')
  @ApiOperation({
    summary: 'Register a user and create their NGN wallet',
    description:
      'Returns a JWT in the body and sets the HTTP-only `accessToken` cookie used by Swagger on later requests.',
  })
  async register(
    @Body() input: registerDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.service.register(input);
    this.setSessionCookie(response, session.accessToken);
    return session;
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log in with email or username',
    description:
      'Returns a JWT in the body and sets the HTTP-only `accessToken` cookie used by Swagger on later requests.',
  })
  async login(@Body() input: loginDto, @Res({ passthrough: true }) response: Response) {
    const session = await this.service.login(input);
    this.setSessionCookie(response, session.accessToken);
    return session;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Clear the JWT session cookie' })
  logout(@Res({ passthrough: true }) response: Response): void {
    response.clearCookie(authCookieName, this.cookieOptions());
  }

  private setSessionCookie(response: Response, accessToken: string): void {
    response.cookie(authCookieName, accessToken, {
      ...this.cookieOptions(),
      maxAge: Number(this.configService.get('JWT_EXPIRES_IN_SECONDS', 3600)) * 1000,
    });
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      secure: this.configService.get('NODE_ENV', 'development') === 'production',
      sameSite: 'strict' as const,
      path: '/',
    };
  }
}
