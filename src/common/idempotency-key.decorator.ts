import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { randomUUID } from 'node:crypto';

export const idempotencyKey = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<Request>();
    const value = request.header('idempotency-key');
    return value?.trim() || randomUUID();
  },
);
