import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { flutterwaveProvider } from './flutterwave.provider';

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('flutterwaveProvider', () => {
  const webhookSecret = 'flutterwave-webhook-secret';
  let provider: flutterwaveProvider;
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    provider = new flutterwaveProvider(
      new ConfigService({
        FLUTTERWAVE_SECRET_KEY: 'flutterwave-secret-key',
        FLUTTERWAVE_WEBHOOK_SECRET: webhookSecret,
        FLUTTERWAVE_BASE_URL: 'https://flutterwave.test/v3',
      }),
    );
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => jest.restoreAllMocks());

  it('initializes checkout and payouts using major currency units', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ status: 'success', message: 'ok', data: { link: 'https://checkout.test' } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'success',
          message: 'ok',
          data: { id: 91, reference: 'wd-1', status: 'NEW' },
        }),
      );

    await expect(
      provider.initializeDeposit({
        amount: 12550,
        currency: 'NGN',
        email: 'user@example.com',
        reference: 'dep-1',
        callbackUrl: 'https://app.test/callback',
      }),
    ).resolves.toMatchObject({ reference: 'dep-1', checkoutUrl: 'https://checkout.test' });
    await expect(
      provider.initiateWithdrawal({
        amount: 7500,
        currency: 'NGN',
        reference: 'wd-1',
        destination: {
          accountName: 'Ada Lovelace',
          accountNumber: '0123456789',
          bankCode: '058',
        },
      }),
    ).resolves.toEqual({ reference: 'wd-1', transferCode: '91', status: 'NEW' });

    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toMatchObject({
      tx_ref: 'dep-1',
      amount: 125.5,
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toMatchObject({
      reference: 'wd-1',
      amount: 75,
      account_bank: '058',
    });
  });

  it('verifies and normalizes successful charge webhooks', () => {
    const rawBody = Buffer.from(
      JSON.stringify({
        event: 'charge.completed',
        data: {
          id: 44,
          tx_ref: 'dep-1',
          amount: 25.5,
          currency: 'NGN',
          status: 'successful',
        },
      }),
    );
    const signature = createHmac('sha256', webhookSecret).update(rawBody).digest('base64');

    expect(provider.verifyAndParseWebhook(rawBody, { 'flutterwave-signature': signature })).toEqual(
      {
        eventId: 'charge.completed:44',
        type: 'depositSucceeded',
        providerEventType: 'charge.completed',
        reference: 'dep-1',
        amount: 2550,
        currency: 'NGN',
      },
    );
  });

  it('maps failed transfer webhooks to the merchant reference', () => {
    const rawBody = Buffer.from(
      JSON.stringify({
        event: 'transfer.completed',
        data: { id: 45, reference: 'wd-1', amount: 75, currency: 'NGN', status: 'FAILED' },
      }),
    );

    expect(provider.verifyAndParseWebhook(rawBody, { 'verif-hash': webhookSecret })).toMatchObject({
      type: 'withdrawalFailed',
      reference: 'wd-1',
      amount: 7500,
      currency: 'NGN',
    });
  });
});
