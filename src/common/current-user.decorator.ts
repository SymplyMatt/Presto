import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

export interface authenticatedUser {
  userId: string;
  email: string;
  username: string;
}

export const currentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): authenticatedUser => {
    const request = context.switchToHttp().getRequest<Request & { user: authenticatedUser }>();
    return request.user;
  },
);
