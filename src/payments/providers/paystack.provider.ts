import { BadGatewayException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  initializedDeposit,
  initializeDepositInput,
  initiatedWithdrawal,
  initiateWithdrawalInput,
  paymentProvider,
  providerWebhookEvent,
  withdrawalRecipientInput,
} from '../payment-provider';

interface paystackResponse<T> {
  status: boolean;
  message: string;
  data: T;
}

interface paystackWebhookBody {
  event?: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class paystackProvider implements paymentProvider {
  readonly name = 'paystack';
  private readonly secretKey: string;
  private readonly baseUrl: string;

  constructor(configService: ConfigService) {
    this.secretKey = configService.getOrThrow<string>('PAYSTACK_SECRET_KEY');
    this.baseUrl = configService.get('PAYSTACK_BASE_URL', 'https://api.paystack.co');
  }

  async initializeDeposit(input: initializeDepositInput): Promise<initializedDeposit> {
    const data = await this.request<{
      authorization_url: string;
      access_code: string;
      reference: string;
    }>('/transaction/initialize', {
      email: input.email,
      amount: String(input.amount),
      currency: input.currency,
      reference: input.reference,
      callback_url: input.callbackUrl,
    });
    return {
      reference: data.reference,
      checkoutUrl: data.authorization_url,
      accessCode: data.access_code,
    };
  }

  async createWithdrawalRecipient(input: withdrawalRecipientInput): Promise<string> {
    const data = await this.request<{ recipient_code: string }>('/transferrecipient', {
      type: 'nuban',
      name: input.accountName,
      account_number: input.accountNumber,
      bank_code: input.bankCode,
      currency: input.currency,
    });
    return data.recipient_code;
  }

  async initiateWithdrawal(input: initiateWithdrawalInput): Promise<initiatedWithdrawal> {
    const data = await this.request<{
      reference: string;
      transfer_code?: string;
      status: string;
    }>('/transfer', {
      source: 'balance',
      amount: input.amount,
      currency: input.currency,
      recipient: input.recipientCode,
      reference: input.reference,
      reason: input.reason,
    });
    return {
      reference: data.reference,
      transferCode: data.transfer_code,
      status: data.status,
    };
  }

  verifyAndParseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): providerWebhookEvent {
    this.verifySignature(rawBody, headers['x-paystack-signature']);
    const body = JSON.parse(rawBody.toString('utf8')) as paystackWebhookBody;
    const eventType = body.event ?? 'unknown';
    const data = body.data ?? {};
    const reference = typeof data.reference === 'string' ? data.reference : undefined;
    const dataId = typeof data.id === 'string' || typeof data.id === 'number' ? data.id : undefined;
    const fallbackId = createHash('sha256').update(rawBody).digest('hex');

    return {
      eventId: `${eventType}:${String(dataId ?? reference ?? fallbackId)}`,
      type: this.mapEventType(eventType),
      providerEventType: eventType,
      reference,
      amount: typeof data.amount === 'number' ? data.amount : undefined,
      currency: typeof data.currency === 'string' ? data.currency : undefined,
    };
  }

  private mapEventType(eventType: string): providerWebhookEvent['type'] {
    if (eventType === 'charge.success') {
      return 'depositSucceeded';
    }
    if (eventType === 'transfer.success') {
      return 'withdrawalSucceeded';
    }
    if (eventType === 'transfer.failed' || eventType === 'transfer.reversed') {
      return 'withdrawalFailed';
    }
    return 'ignored';
  }

  private verifySignature(rawBody: Buffer, header: string | string[] | undefined): void {
    const signature = Array.isArray(header) ? header[0] : header;
    if (!signature) {
      throw new UnauthorizedException('missing payment webhook signature');
    }
    const expected = createHmac('sha512', this.secretKey).update(rawBody).digest('hex');
    const suppliedBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    if (
      suppliedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(suppliedBuffer, expectedBuffer)
    ) {
      throw new UnauthorizedException('invalid payment webhook signature');
    }
  }

  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const result = (await response.json()) as paystackResponse<T>;
    if (!response.ok || !result.status) {
      throw new BadGatewayException(result.message || 'payment provider request failed');
    }
    return result.data;
  }
}
