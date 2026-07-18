import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { fincraProvider } from './fincra.provider';

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('fincraProvider', () => {
  const webhookSecret = 'fincra-webhook-secret';
  let provider: fincraProvider;
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    provider = new fincraProvider(
      new ConfigService({
        FINCRA_SECRET_KEY: 'fincra-secret-key',
        FINCRA_PUBLIC_KEY: 'fincra-public-key',
        FINCRA_BUSINESS_ID: 'business-id',
        FINCRA_WEBHOOK_SECRET: webhookSecret,
        FINCRA_BASE_URL: 'https://fincra.test',
      }),
    );
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => jest.restoreAllMocks());

  it('initializes checkout and payouts using the merchant reference', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          status: true,
          data: { link: 'https://checkout.test', reference: 'dep-1', payCode: 'pay-code' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: { id: 'payout-id', reference: 'processor-ref', status: 'processing' },
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
    ).resolves.toEqual({
      reference: 'dep-1',
      checkoutUrl: 'https://checkout.test',
      accessCode: 'pay-code',
    });
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
    ).resolves.toEqual({
      reference: 'wd-1',
      transferCode: 'processor-ref',
      status: 'processing',
    });

    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      'api-key': 'fincra-secret-key',
      'x-pub-key': 'fincra-public-key',
      'x-business-id': 'business-id',
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toMatchObject({
      reference: 'dep-1',
      amount: 125.5,
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toMatchObject({
      customerReference: 'wd-1',
      amount: '75.00',
      beneficiary: { firstName: 'Ada', lastName: 'Lovelace' },
    });
  });

  it('verifies and normalizes successful charge webhooks', () => {
    const rawBody = Buffer.from(
      JSON.stringify({
        event: 'charge.successful',
        data: {
          id: 'charge-id',
          reference: 'dep-1',
          amountExpected: 25.5,
          currency: 'NGN',
        },
      }),
    );
    const signature = createHmac('sha512', webhookSecret).update(rawBody).digest('hex');

    expect(provider.verifyAndParseWebhook(rawBody, { signature })).toEqual({
      eventId: 'charge.successful:charge-id',
      type: 'depositSucceeded',
      providerEventType: 'charge.successful',
      reference: 'dep-1',
      amount: 2550,
      currency: 'NGN',
    });
  });

  it('maps successful payout webhooks to the customer reference', () => {
    const rawBody = Buffer.from(
      JSON.stringify({
        event: 'payout.successful',
        data: {
          id: 'payout-id',
          reference: 'processor-ref',
          customerReference: 'wd-1',
          amount: 75,
          destinationCurrency: 'NGN',
        },
      }),
    );
    const signature = createHmac('sha512', webhookSecret).update(rawBody).digest('hex');

    expect(provider.verifyAndParseWebhook(rawBody, { signature })).toMatchObject({
      type: 'withdrawalSucceeded',
      reference: 'wd-1',
      amount: 7500,
      currency: 'NGN',
    });
  });
});
