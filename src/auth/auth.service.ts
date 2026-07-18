import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/sequelize';
import { compare, hash } from 'bcryptjs';
import { Op, UniqueConstraintError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { userModel, walletModel } from '../database/models';
import { notificationService } from '../notifications/notification.service';
import { loginDto } from './dto/login.dto';
import { registerDto } from './dto/register.dto';

export interface authSession {
  accessToken: string;
  user: { id: string; email: string; username: string };
}

@Injectable()
export class authService {
  constructor(
    private readonly sequelize: Sequelize,
    private readonly jwtService: JwtService,
    private readonly notifications: notificationService,
    @InjectModel(userModel) private readonly users: typeof userModel,
    @InjectModel(walletModel) private readonly wallets: typeof walletModel,
  ) {}

  async register(input: registerDto): Promise<authSession> {
    const email = input.email.trim().toLowerCase();
    const username = input.username.trim().toLowerCase();
    const passwordHash = await hash(input.password, 12);

    try {
      const user = await this.sequelize.transaction(async (transaction) => {
        const savedUser = await this.users.create(
          { email, username, passwordHash },
          { transaction },
        );
        await this.wallets.create({ userId: savedUser.id, balance: 0 }, { transaction });
        return savedUser;
      });
      void this.notifications.notify(user.email, 'account.registered', {
        username: user.username,
      });
      return this.createSession(user);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException('email or username is already registered');
      }
      throw error;
    }
  }

  async login(input: loginDto): Promise<authSession> {
    const identifier = input.identifier.trim().toLowerCase();
    const user = await this.users.findOne({
      where: { [Op.or]: [{ email: identifier }, { username: identifier }] },
    });
    if (!user || !(await compare(input.password, user.passwordHash))) {
      throw new UnauthorizedException('invalid credentials');
    }
    void this.notifications.notify(user.email, 'account.login', {});
    return this.createSession(user);
  }

  private createSession(user: userModel): authSession {
    return {
      accessToken: this.jwtService.sign({ sub: user.id }),
      user: { id: user.id, email: user.email, username: user.username },
    };
  }
}
