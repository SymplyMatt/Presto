import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { monnifyProvider } from './monnify.provider';

const jsonResponse = (responseBody: unknown): Response =>
  new Response(
    JSON.stringify({ requestSuccessful: true, responseMessage: 'success', responseBody }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

describe('monnifyProvider', () => {
  const secretKey = 'monnify-secret-key';
  let provider: monnifyProvider;
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    provider = new monnifyProvider(
      new ConfigService({
        MONNIFY_API_KEY: 'monnify-api-key',
        MONNIFY_SECRET_KEY: secretKey,
        MONNIFY_CONTRACT_CODE: 'contract-code',
        MONNIFY_SOURCE_ACCOUNT_NUMBER: 'source-account',
        MONNIFY_BASE_URL: 'https://monnify.test',
      }),
    );
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => jest.restoreAllMocks());

  it('authenticates once and submits checkout and payout requests', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ accessToken: 'access-token', expiresIn: 3600 }))
      .mockResolvedValueOnce(
        jsonResponse({
          checkoutUrl: 'https://checkout.test',
          paymentReference: 'dep-1',
          transactionReference: 'transaction-1',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ reference: 'wd-1', transactionReference: 'transfer-1', status: 'PENDING' }),
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
      accessCode: 'transaction-1',
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
      transferCode: 'transfer-1',
      status: 'PENDING',
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe('https://monnify.test/api/v1/auth/login');
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toMatchObject({
      paymentReference: 'dep-1',
      amount: 125.5,
    });
    expect(JSON.parse(fetchMock.mock.calls[2][1]?.body as string)).toMatchObject({
      reference: 'wd-1',
      amount: 75,
      sourceAccountNumber: 'source-account',
    });
  });

  it('verifies and normalizes successful transaction webhooks', () => {
    const rawBody = Buffer.from(
      JSON.stringify({
        eventType: 'SUCCESSFUL_TRANSACTION',
        eventData: {
          transactionReference: 'transaction-1',
          paymentReference: 'dep-1',
          amountPaid: 25.5,
          currency: 'NGN',
        },
      }),
    );
    const signature = createHmac('sha512', secretKey).update(rawBody).digest('hex');

    expect(provider.verifyAndParseWebhook(rawBody, { 'monnify-signature': signature })).toEqual({
      eventId: 'SUCCESSFUL_TRANSACTION:transaction-1',
      type: 'depositSucceeded',
      providerEventType: 'SUCCESSFUL_TRANSACTION',
      reference: 'dep-1',
      amount: 2550,
      currency: 'NGN',
    });
  });

  it('maps reversed disbursement webhooks to the merchant reference', () => {
    const rawBody = Buffer.from(
      JSON.stringify({
        eventType: 'REVERSED_DISBURSEMENT',
        eventData: {
          transactionReference: 'transfer-1',
          reference: 'wd-1',
          amount: 75,
          currency: 'NGN',
        },
      }),
    );
    const signature = createHmac('sha512', secretKey).update(rawBody).digest('hex');

    expect(
      provider.verifyAndParseWebhook(rawBody, { 'monnify-signature': signature }),
    ).toMatchObject({
      type: 'withdrawalFailed',
      reference: 'wd-1',
      amount: 7500,
      currency: 'NGN',
    });
  });
});
