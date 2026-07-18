import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
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
import {
  assertSignature,
  hasConfig,
  headerValue,
  parseResponse,
  requiredConfig,
  responseMessage,
  splitAccountName,
  toMajorAmount,
  toMinorAmount,
  webhookEventId,
} from './provider-utils';

interface fincraResponse<T> {
  status?: boolean;
  success?: boolean;
  message?: string;
  error?: string;
  data?: T;
}

interface fincraWebhook {
  event?: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class fincraProvider implements paymentProvider {
  readonly name = 'fincra';
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = config.get('FINCRA_BASE_URL', 'https://sandboxapi.fincra.com');
  }

  isConfigured(): boolean {
    return hasConfig(this.config, [
      'FINCRA_SECRET_KEY',
      'FINCRA_PUBLIC_KEY',
      'FINCRA_BUSINESS_ID',
      'FINCRA_WEBHOOK_SECRET',
    ]);
  }

  async initializeDeposit(input: initializeDepositInput): Promise<initializedDeposit> {
    const result = await this.request<{ link: string; reference?: string; payCode?: string }>(
      '/checkout/payments',
      {
        currency: input.currency,
        amount: toMajorAmount(input.amount),
        customer: { name: input.email, email: input.email },
        paymentMethods: ['card', 'bank_transfer'],
        reference: input.reference,
        feeBearer: 'business',
        settlementDestination: 'wallet',
        redirectUrl: input.callbackUrl,
      },
      this.checkoutHeaders(),
    );
    return {
      reference: result.reference ?? input.reference,
      checkoutUrl: result.link,
      accessCode: result.payCode,
    };
  }

  async resolveAccount(input: resolveAccountInput): Promise<resolvedAccount> {
    const result = await this.get<{
      accountNumber?: string;
      accountName?: string;
      bankCode?: string;
    }>(
      `/core/accounts/resolve?accountNumber=${encodeURIComponent(input.accountNumber)}&bankCode=${encodeURIComponent(input.bankCode)}`,
      this.apiHeaders(),
    );
    if (!result.accountName) {
      throw new BadGatewayException('unable to resolve bank account name');
    }
    return {
      accountName: result.accountName,
      accountNumber: result.accountNumber ?? input.accountNumber,
      bankCode: result.bankCode ?? input.bankCode,
    };
  }

  async initiateWithdrawal(input: initiateWithdrawalInput): Promise<initiatedWithdrawal> {
    const accountName = splitAccountName(input.destination.accountName);
    const result = await this.request<{
      id?: string;
      reference?: string;
      status?: string;
    }>(
      '/disbursements/payouts',
      {
        business: requiredConfig(this.config, 'FINCRA_BUSINESS_ID'),
        sourceCurrency: input.currency,
        destinationCurrency: input.currency,
        amount: toMajorAmount(input.amount).toFixed(2),
        description: input.reason ?? 'Wallet withdrawal',
        paymentDestination: 'bank_account',
        customerReference: input.reference,
        beneficiary: {
          firstName: accountName.firstName,
          lastName: accountName.lastName,
          accountHolderName: input.destination.accountName,
          accountNumber: input.destination.accountNumber,
          bankCode: input.destination.bankCode,
          type: 'individual',
        },
      },
      this.apiHeaders(),
    );
    return {
      reference: input.reference,
      transferCode: result.reference ?? result.id,
      status: result.status ?? 'pending',
    };
  }

  async verifyDeposit(reference: string): Promise<verifiedDeposit> {
    const result = await this.get<{
      status?: string;
      merchantReference?: string;
      reference?: string;
      amountExpected?: number;
      amountReceived?: number;
      amount?: number;
      currency?: string;
    }>(`/checkout/payments/merchant-reference/${encodeURIComponent(reference)}`, this.apiHeaders());
    const status = result.status?.toLowerCase();
    return {
      reference: result.merchantReference ?? result.reference ?? reference,
      status:
        status === 'success' || status === 'successful'
          ? 'succeeded'
          : status === 'failed' || status === 'cancelled'
            ? 'failed'
            : 'pending',
      amount: toMinorAmount(result.amountReceived ?? result.amountExpected ?? result.amount),
      currency: typeof result.currency === 'string' ? result.currency : undefined,
      providerStatus: result.status,
    };
  }

  async listBanks(): Promise<bankInfo[]> {
    const banks = await this.get<Array<{ name?: string; code?: string }>>(
      '/core/banks?currency=NGN',
      this.apiHeaders(),
    );
    return banks
      .filter((bank) => typeof bank.name === 'string' && typeof bank.code === 'string')
      .map((bank) => ({ name: bank.name as string, code: bank.code as string }));
  }

  verifyAndParseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): providerWebhookEvent {
    const secret = requiredConfig(this.config, 'FINCRA_WEBHOOK_SECRET');
    const expected = createHmac('sha512', secret).update(rawBody).digest('hex');
    assertSignature(headerValue(headers, 'signature'), expected);

    const body = JSON.parse(rawBody.toString('utf8')) as fincraWebhook;
    const eventType = body.event ?? 'unknown';
    const data = body.data ?? {};
    return {
      eventId: webhookEventId(
        eventType,
        data.id ?? data.chargeReference ?? data.reference,
        rawBody,
      ),
      type: this.mapEventType(eventType),
      providerEventType: eventType,
      reference: this.reference(eventType, data),
      amount: toMinorAmount(data.amountExpected ?? data.amount),
      currency: this.currency(data),
    };
  }

  private mapEventType(eventType: string): providerWebhookEvent['type'] {
    if (eventType === 'charge.successful') {
      return 'depositSucceeded';
    }
    if (eventType === 'payout.successful') {
      return 'withdrawalSucceeded';
    }
    if (eventType === 'payout.failed') {
      return 'withdrawalFailed';
    }
    return 'ignored';
  }

  private reference(eventType: string, data: Record<string, unknown>): string | undefined {
    const value = eventType.startsWith('payout.')
      ? (data.customerReference ?? data.reference)
      : (data.merchantReference ?? data.reference);
    return typeof value === 'string' ? value : undefined;
  }

  private currency(data: Record<string, unknown>): string | undefined {
    const value = data.currency ?? data.destinationCurrency;
    return typeof value === 'string' ? value : undefined;
  }

  private checkoutHeaders(): Record<string, string> {
    return {
      ...this.apiHeaders(),
      'x-pub-key': requiredConfig(this.config, 'FINCRA_PUBLIC_KEY'),
    };
  }

  private apiHeaders(): Record<string, string> {
    return {
      'api-key': requiredConfig(this.config, 'FINCRA_SECRET_KEY'),
      'x-business-id': requiredConfig(this.config, 'FINCRA_BUSINESS_ID'),
      'Content-Type': 'application/json',
    };
  }

  private async request<T>(
    path: string,
    body: Record<string, unknown>,
    headers: Record<string, string>,
  ): Promise<T> {
    return this.send<T>(
      path,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      },
      true,
    );
  }

  private async get<T>(path: string, headers: Record<string, string>): Promise<T> {
    return this.send<T>(path, { method: 'GET', headers }, true);
  }

  private async send<T>(path: string, init: RequestInit, requireData: boolean): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(15000),
    });
    const result = await parseResponse<fincraResponse<T>>(response);
    if ((!result.status && !result.success) || (requireData && !result.data)) {
      throw new BadGatewayException(responseMessage(result));
    }
    return result.data as T;
  }
}
