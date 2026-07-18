import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import {
  initializedDeposit,
  initializeDepositInput,
  initiatedWithdrawal,
  initiateWithdrawalInput,
  paymentProvider,
  providerWebhookEvent,
  verifiedDeposit,
} from '../payment-provider';
import {
  assertSignature,
  hasConfig,
  headerValue,
  parseResponse,
  requiredConfig,
  responseMessage,
  toMajorAmount,
  toMinorAmount,
  webhookEventId,
} from './provider-utils';

interface monnifyResponse<T> {
  requestSuccessful?: boolean;
  responseMessage?: string;
  responseCode?: string;
  responseBody?: T;
}

interface monnifyWebhook {
  eventType?: string;
  eventData?: Record<string, unknown>;
}

interface monnifyToken {
  value: string;
  expiresAt: number;
}

@Injectable()
export class monnifyProvider implements paymentProvider {
  readonly name = 'monnify';
  private readonly baseUrl: string;
  private token?: monnifyToken;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = config.get('MONNIFY_BASE_URL', 'https://sandbox.monnify.com');
  }

  isConfigured(): boolean {
    return hasConfig(this.config, [
      'MONNIFY_API_KEY',
      'MONNIFY_SECRET_KEY',
      'MONNIFY_CONTRACT_CODE',
      'MONNIFY_SOURCE_ACCOUNT_NUMBER',
    ]);
  }

  async initializeDeposit(input: initializeDepositInput): Promise<initializedDeposit> {
    const result = await this.request<{
      checkoutUrl: string;
      paymentReference?: string;
      transactionReference?: string;
    }>('/api/v1/merchant/transactions/init-transaction', {
      amount: toMajorAmount(input.amount),
      customerName: input.email,
      customerEmail: input.email,
      paymentReference: input.reference,
      paymentDescription: 'Wallet funding',
      currencyCode: input.currency,
      contractCode: requiredConfig(this.config, 'MONNIFY_CONTRACT_CODE'),
      redirectUrl: input.callbackUrl,
      paymentMethods: ['CARD', 'ACCOUNT_TRANSFER'],
    });
    return {
      reference: result.paymentReference ?? input.reference,
      checkoutUrl: result.checkoutUrl,
      accessCode: result.transactionReference,
    };
  }

  async initiateWithdrawal(input: initiateWithdrawalInput): Promise<initiatedWithdrawal> {
    const result = await this.request<{
      reference?: string;
      transactionReference?: string;
      status?: string;
    }>('/api/v2/disbursements/single', {
      amount: toMajorAmount(input.amount),
      reference: input.reference,
      narration: input.reason ?? 'Wallet withdrawal',
      destinationBankCode: input.destination.bankCode,
      destinationAccountNumber: input.destination.accountNumber,
      destinationAccountName: input.destination.accountName,
      currency: input.currency,
      sourceAccountNumber: requiredConfig(this.config, 'MONNIFY_SOURCE_ACCOUNT_NUMBER'),
      async: true,
    });
    return {
      reference: result.reference ?? input.reference,
      transferCode: result.transactionReference,
      status: result.status ?? 'pending',
    };
  }

  async verifyDeposit(reference: string): Promise<verifiedDeposit> {
    const result = await this.get<
      | {
          paymentStatus?: string;
          paymentReference?: string;
          amountPaid?: number;
          amount?: number;
          currencyCode?: string;
          currency?: string;
        }
      | Array<{
          paymentStatus?: string;
          paymentReference?: string;
          amountPaid?: number;
          amount?: number;
          currencyCode?: string;
          currency?: string;
        }>
    >(`/api/v2/merchant/transactions/query?paymentReference=${encodeURIComponent(reference)}`);
    const transaction = Array.isArray(result) ? result[0] : result;
    if (!transaction) {
      return { reference, status: 'pending' };
    }
    const status = transaction.paymentStatus?.toUpperCase();
    return {
      reference: transaction.paymentReference ?? reference,
      status:
        status === 'PAID' || status === 'SUCCESS' || status === 'COMPLETED'
          ? 'succeeded'
          : status === 'FAILED' || status === 'CANCELLED' || status === 'EXPIRED'
            ? 'failed'
            : 'pending',
      amount: toMinorAmount(transaction.amountPaid ?? transaction.amount),
      currency:
        typeof transaction.currencyCode === 'string'
          ? transaction.currencyCode
          : typeof transaction.currency === 'string'
            ? transaction.currency
            : undefined,
      providerStatus: transaction.paymentStatus,
    };
  }

  verifyAndParseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): providerWebhookEvent {
    this.verifySignature(rawBody, headers);

    const body = JSON.parse(rawBody.toString('utf8')) as monnifyWebhook;
    const eventType = body.eventType ?? 'unknown';
    const data = body.eventData ?? {};
    return {
      eventId: webhookEventId(
        eventType,
        data.transactionReference ?? data.reference ?? data.paymentReference,
        rawBody,
      ),
      type: this.mapEventType(eventType),
      providerEventType: eventType,
      reference: this.reference(eventType, data),
      amount: toMinorAmount(data.amountPaid ?? data.amount),
      currency: typeof data.currency === 'string' ? data.currency : undefined,
    };
  }

  private mapEventType(eventType: string): providerWebhookEvent['type'] {
    if (eventType === 'SUCCESSFUL_TRANSACTION') {
      return 'depositSucceeded';
    }
    if (eventType === 'SUCCESSFUL_DISBURSEMENT') {
      return 'withdrawalSucceeded';
    }
    if (eventType === 'FAILED_DISBURSEMENT' || eventType === 'REVERSED_DISBURSEMENT') {
      return 'withdrawalFailed';
    }
    return 'ignored';
  }

  private reference(eventType: string, data: Record<string, unknown>): string | undefined {
    const value = eventType.endsWith('DISBURSEMENT') ? data.reference : data.paymentReference;
    return typeof value === 'string' ? value : undefined;
  }

  private verifySignature(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): void {
    const signature = headerValue(headers, 'monnify-signature');
    const allowUnsigned = this.config.get('MONNIFY_ALLOW_UNSIGNED_SANDBOX_WEBHOOKS') === 'true';
    const isProduction = this.config.get('NODE_ENV') === 'production';
    if (!signature && allowUnsigned && !isProduction) {
      return;
    }
    const secret = requiredConfig(this.config, 'MONNIFY_SECRET_KEY');
    const expected = createHmac('sha512', secret).update(rawBody).digest('hex');
    assertSignature(signature, expected);
  }

  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    return this.parseResponseBody<T>(response);
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${await this.accessToken()}` },
      signal: AbortSignal.timeout(15000),
    });
    return this.parseResponseBody<T>(response);
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) {
      return this.token.value;
    }
    const credentials = Buffer.from(
      `${requiredConfig(this.config, 'MONNIFY_API_KEY')}:${requiredConfig(
        this.config,
        'MONNIFY_SECRET_KEY',
      )}`,
    ).toString('base64');
    const response = await fetch(`${this.baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { Authorization: `Basic ${credentials}` },
      signal: AbortSignal.timeout(15000),
    });
    const result = await this.parseResponseBody<{ accessToken: string; expiresIn?: number }>(
      response,
    );
    const expiresIn = Number(result.expiresIn ?? 3600);
    this.token = {
      value: result.accessToken,
      expiresAt: Date.now() + Math.max(expiresIn - 60, 1) * 1000,
    };
    return this.token.value;
  }

  private async parseResponseBody<T>(response: Response): Promise<T> {
    const result = await parseResponse<monnifyResponse<T>>(response);
    if (!result.requestSuccessful || !result.responseBody) {
      throw new BadGatewayException(responseMessage(result));
    }
    return result.responseBody;
  }
}
