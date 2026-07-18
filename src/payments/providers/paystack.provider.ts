import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  bankInfo,
  initializedDeposit,
  initializeDepositInput,
  initiatedWithdrawal,
  initiateWithdrawalInput,
  paymentProvider,
  providerWebhookEvent,
  resolveAccountInput,
  resolvedAccount,
  verifiedDeposit,
} from '../payment-provider';
import { hasConfig } from './provider-utils';

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
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = configService.get('PAYSTACK_BASE_URL', 'https://api.paystack.co');
  }

  isConfigured(): boolean {
    return hasConfig(this.configService, ['PAYSTACK_SECRET_KEY']);
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

  private async createWithdrawalRecipient(input: initiateWithdrawalInput): Promise<string> {
    const data = await this.request<{ recipient_code: string }>('/transferrecipient', {
      type: 'nuban',
      name: input.destination.accountName,
      account_number: input.destination.accountNumber,
      bank_code: input.destination.bankCode,
      currency: input.currency,
    });
    return data.recipient_code;
  }

  async resolveAccount(input: resolveAccountInput): Promise<resolvedAccount> {
    const data = await this.get<{ account_number: string; account_name: string; bank_id?: number }>(
      `/bank/resolve?account_number=${encodeURIComponent(input.accountNumber)}&bank_code=${encodeURIComponent(input.bankCode)}`,
    );
    if (!data.account_name) {
      throw new BadGatewayException('unable to resolve bank account name');
    }
    return {
      accountName: data.account_name,
      accountNumber: data.account_number ?? input.accountNumber,
      bankCode: input.bankCode,
    };
  }

  async initiateWithdrawal(input: initiateWithdrawalInput): Promise<initiatedWithdrawal> {
    const recipientCode = await this.createWithdrawalRecipient(input);
    const data = await this.request<{
      reference: string;
      transfer_code?: string;
      status: string;
    }>('/transfer', {
      source: 'balance',
      amount: input.amount,
      currency: input.currency,
      recipient: recipientCode,
      reference: input.reference,
      reason: input.reason,
    });
    return {
      reference: data.reference,
      transferCode: data.transfer_code,
      status: data.status,
    };
  }

  async verifyDeposit(reference: string): Promise<verifiedDeposit> {
    const data = await this.get<{
      status: string;
      reference: string;
      amount: number;
      currency: string;
    }>(`/transaction/verify/${encodeURIComponent(reference)}`);
    const status = data.status?.toLowerCase();
    return {
      reference: data.reference ?? reference,
      status:
        status === 'success' ? 'succeeded' : status === 'failed' || status === 'abandoned' ? 'failed' : 'pending',
      amount: typeof data.amount === 'number' ? data.amount : undefined,
      currency: typeof data.currency === 'string' ? data.currency : undefined,
      providerStatus: data.status,
    };
  }

  async listBanks(): Promise<bankInfo[]> {
    const banks = await this.get<
      Array<{ name?: string; code?: string; active?: boolean; currency?: string }>
    >('/bank?country=nigeria&perPage=100');
    return banks
      .filter(
        (bank) =>
          typeof bank.name === 'string' &&
          typeof bank.code === 'string' &&
          bank.active !== false &&
          (!bank.currency || bank.currency === 'NGN'),
      )
      .map((bank) => ({ name: bank.name as string, code: bank.code as string }));
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
    const expected = createHmac('sha512', this.secretKey()).update(rawBody).digest('hex');
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
    return this.send<T>(path, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  private async get<T>(path: string): Promise<T> {
    return this.send<T>(path, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.secretKey()}` },
    });
  }

  private async send<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(15000),
    });
    const result = (await response.json()) as paystackResponse<T>;
    if (!response.ok || !result.status) {
      throw new BadGatewayException(result.message || 'payment provider request failed');
    }
    return result.data;
  }

  private secretKey(): string {
    const secretKey = this.configService.get<string>('PAYSTACK_SECRET_KEY');
    if (!secretKey) {
      throw new ServiceUnavailableException('the active payment processor is not configured');
    }
    return secretKey;
  }
}
