import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { authenticatedUser } from '../../common/current-user.decorator';
import { userModel } from '../../database/models';
import { extractJwtFromCookie } from '../auth-cookie';

interface jwtPayload {
  sub: string;
}

@Injectable()
export class jwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    @InjectModel(userModel) private readonly users: typeof userModel,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        extractJwtFromCookie,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: jwtPayload): Promise<authenticatedUser> {
    const user = await this.users.findByPk(payload.sub);
    if (!user) {
      throw new UnauthorizedException();
    }
    return { userId: user.id, email: user.email, username: user.username };
  }
}
