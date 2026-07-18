import {
  BadGatewayException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';

export const requiredConfig = (config: ConfigService, name: string): string => {
  const value = config.get<string>(name);
  if (!value) {
    throw new ServiceUnavailableException('the active payment processor is not configured');
  }
  return value;
};

export const hasConfig = (config: ConfigService, names: string[]): boolean =>
  names.every((name) => Boolean(config.get<string>(name)));

export const toMajorAmount = (amount: number): number => amount / 100;

export const toMinorAmount = (amount: unknown): number | undefined => {
  const value = typeof amount === 'number' || typeof amount === 'string' ? Number(amount) : NaN;
  return Number.isFinite(value) ? Math.round(value * 100) : undefined;
};

export const splitAccountName = (accountName: string): { firstName: string; lastName: string } => {
  const names = accountName.trim().split(/\s+/);
  const firstName = names.shift() ?? accountName.trim();
  return { firstName, lastName: names.join(' ') || firstName };
};

export const webhookEventId = (eventType: string, identifier: unknown, rawBody: Buffer): string => {
  const fallback = createHash('sha256').update(rawBody).digest('hex');
  const value =
    typeof identifier === 'string' || typeof identifier === 'number'
      ? String(identifier)
      : fallback;
  return `${eventType}:${value}`;
};

export const headerValue = (
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined => {
  const key = Object.keys(headers).find((header) => header.toLowerCase() === name.toLowerCase());
  const value = key ? headers[key] : undefined;
  return Array.isArray(value) ? value[0] : value;
};

export const assertSignature = (supplied: string | undefined, expected: string): void => {
  if (!supplied) {
    throw new UnauthorizedException('missing payment webhook signature');
  }
  const suppliedBuffer = Buffer.from(supplied, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    throw new UnauthorizedException('invalid payment webhook signature');
  }
};

export const parseResponse = async <T>(response: Response): Promise<T> => {
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new BadGatewayException('payment processor returned an invalid response');
  }
  if (!response.ok) {
    throw new BadGatewayException(responseMessage(result));
  }
  return result as T;
};

export const responseMessage = (result: unknown): string => {
  if (result && typeof result === 'object') {
    const record = result as Record<string, unknown>;
    for (const key of ['message', 'error', 'responseMessage']) {
      if (typeof record[key] === 'string' && record[key]) {
        return record[key];
      }
    }
  }
  return 'payment processor request failed';
};
