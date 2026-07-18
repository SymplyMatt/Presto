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

interface flutterwaveResponse<T> {
  status: string;
  message: string;
  data: T;
}

interface flutterwaveWebhook {
  event?: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class flutterwaveProvider implements paymentProvider {
  readonly name = 'flutterwave';
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = config.get('FLUTTERWAVE_BASE_URL', 'https://api.flutterwave.com/v3');
  }

  isConfigured(): boolean {
    return hasConfig(this.config, ['FLUTTERWAVE_SECRET_KEY', 'FLUTTERWAVE_WEBHOOK_SECRET']);
  }

  async initializeDeposit(input: initializeDepositInput): Promise<initializedDeposit> {
    const result = await this.request<{ link: string }>('/payments', {
      tx_ref: input.reference,
      amount: toMajorAmount(input.amount),
      currency: input.currency,
      redirect_url: input.callbackUrl,
      customer: { email: input.email },
      customizations: { title: 'Wallet funding' },
    });
    return { reference: input.reference, checkoutUrl: result.link };
  }

  async initiateWithdrawal(input: initiateWithdrawalInput): Promise<initiatedWithdrawal> {
    const result = await this.request<{
      id?: number | string;
      reference?: string;
      status?: string;
    }>('/transfers', {
      account_bank: input.destination.bankCode,
      account_number: input.destination.accountNumber,
      beneficiary_name: input.destination.accountName,
      amount: toMajorAmount(input.amount),
      currency: input.currency,
      reference: input.reference,
      narration: input.reason ?? 'Wallet withdrawal',
    });
    return {
      reference: result.reference ?? input.reference,
      transferCode: result.id === null || result.id === undefined ? undefined : String(result.id),
      status: result.status ?? 'pending',
    };
  }

  verifyAndParseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): providerWebhookEvent {
    this.verifySignature(rawBody, headers);
    const body = JSON.parse(rawBody.toString('utf8')) as flutterwaveWebhook;
    const eventType = body.event ?? 'unknown';
    const data = body.data ?? {};
    const status = typeof data.status === 'string' ? data.status.toLowerCase() : '';
    const isCharge = eventType === 'charge.completed';
    const isTransfer = eventType === 'transfer.completed';

    return {
      eventId: webhookEventId(eventType, data.id ?? data.flw_ref ?? data.reference, rawBody),
      type:
        isCharge && status === 'successful'
          ? 'depositSucceeded'
          : isTransfer && status === 'successful'
            ? 'withdrawalSucceeded'
            : isTransfer && status === 'failed'
              ? 'withdrawalFailed'
              : 'ignored',
      providerEventType: eventType,
      reference: this.reference(isCharge, data),
      amount: toMinorAmount(data.amount),
      currency: typeof data.currency === 'string' ? data.currency : undefined,
    };
  }

  private reference(isCharge: boolean, data: Record<string, unknown>): string | undefined {
    const value = isCharge ? data.tx_ref : data.reference;
    return typeof value === 'string' ? value : undefined;
  }

  private verifySignature(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): void {
    const secret = requiredConfig(this.config, 'FLUTTERWAVE_WEBHOOK_SECRET');
    const signature = headerValue(headers, 'flutterwave-signature');
    if (signature) {
      const expected = createHmac('sha256', secret).update(rawBody).digest('base64');
      assertSignature(signature, expected);
      return;
    }
    assertSignature(headerValue(headers, 'verif-hash'), secret);
  }

  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${requiredConfig(this.config, 'FLUTTERWAVE_SECRET_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const result = await parseResponse<flutterwaveResponse<T>>(response);
    if (result.status !== 'success' || !result.data) {
      throw new BadGatewayException(responseMessage(result));
    }
    return result.data;
  }
}
