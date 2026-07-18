import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { paystackProvider } from './paystack.provider';

describe('paystackProvider webhooks', () => {
  const secretKey = 'test-secret-key';
  const provider = new paystackProvider(
    new ConfigService({ PAYSTACK_SECRET_KEY: secretKey, PAYSTACK_BASE_URL: 'https://example.com' }),
  );

  it('verifies a valid signature and maps a successful charge', () => {
    const rawBody = Buffer.from(
      JSON.stringify({
        event: 'charge.success',
        data: { id: 42, reference: 'dep-reference', amount: 5000, currency: 'NGN' },
      }),
    );
    const signature = createHmac('sha512', secretKey).update(rawBody).digest('hex');

    expect(provider.verifyAndParseWebhook(rawBody, { 'x-paystack-signature': signature })).toEqual({
      eventId: 'charge.success:42',
      type: 'depositSucceeded',
      providerEventType: 'charge.success',
      reference: 'dep-reference',
      amount: 5000,
      currency: 'NGN',
    });
  });

  it('rejects an invalid signature before parsing the event', () => {
    const rawBody = Buffer.from('{}');
    expect(() =>
      provider.verifyAndParseWebhook(rawBody, { 'x-paystack-signature': 'invalid' }),
    ).toThrow(UnauthorizedException);
  });

  it('maps transaction verification statuses by reference', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        status: true,
        message: 'Verification successful',
        data: {
          status: 'success',
          reference: 'dep-reference',
          amount: 5000,
          currency: 'NGN',
        },
      }),
    } as Response);

    await expect(provider.verifyDeposit('dep-reference')).resolves.toEqual({
      reference: 'dep-reference',
      status: 'succeeded',
      amount: 5000,
      currency: 'NGN',
      providerStatus: 'success',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/transaction/verify/dep-reference',
      expect.objectContaining({ method: 'GET' }),
    );
    fetchMock.mockRestore();
  });

  it('lists Nigerian banks from Paystack', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        status: true,
        message: 'Banks retrieved',
        data: [
          { name: 'Guaranty Trust Bank', code: '058', active: true, currency: 'NGN' },
          { name: 'Inactive Bank', code: '000', active: false, currency: 'NGN' },
          { name: 'Paycom', code: '999992', active: true, currency: 'NGN' },
        ],
      }),
    } as Response);

    await expect(provider.listBanks()).resolves.toEqual([
      { name: 'Guaranty Trust Bank', code: '058' },
      { name: 'Paycom', code: '999992' },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/bank?country=nigeria&perPage=100',
      expect.objectContaining({ method: 'GET' }),
    );
    fetchMock.mockRestore();
  });
});
