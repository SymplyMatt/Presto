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
});
