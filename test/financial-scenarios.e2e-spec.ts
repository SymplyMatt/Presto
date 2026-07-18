import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { appModule } from '../src/app.module';
import { redisCacheService } from '../src/cache/redis-cache.service';
import { depositsService } from '../src/deposits/deposits.service';
import { notificationService } from '../src/notifications/notification.service';
import {
  initializeDepositInput,
  initiateWithdrawalInput,
  paymentProvider,
  providerWebhookEvent,
  verifiedDeposit,
} from '../src/payments/payment-provider';
import { paymentProvidersToken } from '../src/payments/payment-provider.registry';

class testPaymentProvider implements paymentProvider {
  readonly name = 'paystack';
  readonly verifiedDeposits = new Map<string, verifiedDeposit>();

  isConfigured(): boolean {
    return true;
  }

  async initializeDeposit(input: initializeDepositInput) {
    return {
      reference: input.reference,
      checkoutUrl: `https://checkout.test/${input.reference}`,
      accessCode: 'access-code',
    };
  }

  async initiateWithdrawal(input: initiateWithdrawalInput) {
    return { reference: input.reference, transferCode: 'TRF_test', status: 'pending' };
  }

  async verifyDeposit(reference: string): Promise<verifiedDeposit> {
    return (
      this.verifiedDeposits.get(reference) ?? {
        reference,
        status: 'pending',
      }
    );
  }

  verifyAndParseWebhook(rawBody: Buffer): providerWebhookEvent {
    const body = JSON.parse(rawBody.toString()) as {
      event: string;
      data: { id: number; reference: string; amount: number; currency: string };
    };
    return {
      eventId: `${body.event}:${body.data.id}`,
      type: body.event === 'charge.success' ? 'depositSucceeded' : 'ignored',
      providerEventType: body.event,
      reference: body.data.reference,
      amount: body.data.amount,
      currency: body.data.currency,
    };
  }
}

describe('financial evaluation scenarios', () => {
  jest.setTimeout(30000);
  let app: INestApplication;
  let provider: testPaymentProvider;
  let eventId = 1000;

  beforeAll(async () => {
    provider = new testPaymentProvider();
    const cache = new Map<string, unknown>();
    const module = await Test.createTestingModule({ imports: [appModule] })
      .overrideProvider(paymentProvidersToken)
      .useValue([provider])
      .overrideProvider(notificationService)
      .useValue({ notify: async () => undefined })
      .overrideProvider(redisCacheService)
      .useValue({
        getJson: async (key: string) => cache.get(key) ?? null,
        setJson: async (key: string, value: unknown) => cache.set(key, value),
        delete: async (key: string) => cache.delete(key),
      })
      .compile();
    app = module.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  const register = async (prefix: string) => {
    const unique = `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: `${unique}@example.com`, username: unique, password: 'password123' })
      .expect(201);
    const cookieHeaders = response.get('Set-Cookie');
    return {
      token: response.body.accessToken as string,
      username: unique,
      cookie: cookieHeaders?.[0].split(';')[0] ?? '',
    };
  };

  const wallet = (token: string) =>
    request(app.getHttpServer()).get('/api/v1/wallet').auth(token, { type: 'bearer' });

  const initializeDeposit = async (token: string, amount: number) => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/deposits')
      .auth(token, { type: 'bearer' })
      .send({ amount })
      .expect(201);
    return response.body as {
      id: string;
      reference: string;
      status: string;
      paymentProcessor: string;
    };
  };

  const confirmDeposit = async (reference: string, amount: number) => {
    const body = {
      event: 'charge.success',
      data: { id: eventId++, reference, amount, currency: 'NGN' },
    };
    return request(app.getHttpServer()).post('/api/v1/webhooks/payments').send(body).expect(200);
  };

  it('authenticates with the HTTP-only JWT cookie', async () => {
    const user = await register('cookie');
    expect(user.cookie).toContain('accessToken=');
    await request(app.getHttpServer()).get('/api/v1/wallet').set('Cookie', user.cookie).expect(200);
  });

  it('credits a duplicate webhook exactly once', async () => {
    const user = await register('duplicate');
    const deposit = await initializeDeposit(user.token, 1000);
    expect(deposit.paymentProcessor).toBe('paystack');
    const body = {
      event: 'charge.success',
      data: { id: eventId++, reference: deposit.reference, amount: 1000, currency: 'NGN' },
    };

    const responses = await Promise.all([
      request(app.getHttpServer()).post('/api/v1/webhooks/payments').send(body).expect(200),
      request(app.getHttpServer()).post('/api/v1/webhooks/payments').send(body).expect(200),
    ]);

    expect(responses.filter((response) => response.body.processed).length).toBe(1);
    expect(responses.filter((response) => response.body.duplicate).length).toBe(1);
    expect((await wallet(user.token).expect(200)).body.balance).toBe(1000);
    const ledger = await request(app.getHttpServer())
      .get('/api/v1/wallet/ledger')
      .auth(user.token, { type: 'bearer' })
      .expect(200);
    expect(ledger.body.items[0].paymentProcessor).toBe('paystack');
  });

  it('credits a deposit when verified by reference with the payment processor', async () => {
    const user = await register('verify_ref');
    const deposit = await initializeDeposit(user.token, 1500);
    provider.verifiedDeposits.set(deposit.reference, {
      reference: deposit.reference,
      status: 'succeeded',
      amount: 1500,
      currency: 'NGN',
    });

    const verified = await request(app.getHttpServer())
      .post('/api/v1/deposits/verify')
      .auth(user.token, { type: 'bearer' })
      .send({ reference: deposit.reference })
      .expect(200);

    expect(verified.body.status).toBe('confirmed');
    expect((await wallet(user.token)).body.balance).toBe(1500);

    const again = await request(app.getHttpServer())
      .post('/api/v1/deposits/verify')
      .auth(user.token, { type: 'bearer' })
      .send({ reference: deposit.reference })
      .expect(200);
    expect(again.body.status).toBe('confirmed');
    expect((await wallet(user.token)).body.balance).toBe(1500);
  });

  it('leaves an unconfirmed deposit pending without changing the balance', async () => {
    const user = await register('pending');
    const deposit = await initializeDeposit(user.token, 900);

    expect(deposit.status).toBe('pending');
    expect((await wallet(user.token).expect(200)).body.balance).toBe(0);
    const status = await request(app.getHttpServer())
      .get(`/api/v1/deposits/${deposit.id}`)
      .auth(user.token, { type: 'bearer' })
      .expect(200);
    expect(status.body.status).toBe('pending');
  });

  it('rejects a similar deposit attempted within two minutes', async () => {
    const user = await register('recent_deposit');
    await initializeDeposit(user.token, 850);
    await request(app.getHttpServer())
      .post('/api/v1/deposits')
      .auth(user.token, { type: 'bearer' })
      .send({ amount: 850 })
      .expect(409);
  });

  it('lists the supported processors and identifies the active processor', async () => {
    const user = await register('processors');
    const response = await request(app.getHttpServer())
      .get('/api/v1/payment-processors')
      .auth(user.token, { type: 'bearer' })
      .expect(200);

    const processors = response.body as { name: string; displayName: string; isActive: boolean }[];
    expect(processors).toHaveLength(4);
    expect(processors.find((processor) => processor.name === 'paystack')).toMatchObject({
      displayName: 'Paystack',
      isActive: true,
    });

    await request(app.getHttpServer())
      .patch('/api/v1/payment-processors/paystack/activate')
      .auth(user.token, { type: 'bearer' })
      .expect(200);
  });

  it('marks an unconfirmed deposit failed on expiry without changing the balance', async () => {
    const user = await register('expired');
    const deposit = await initializeDeposit(user.token, 900);
    const deposits = app.get(depositsService);

    expect(await deposits.expireIfPending(deposit.id)).toBe(true);
    expect((await wallet(user.token).expect(200)).body.balance).toBe(0);
    const status = await request(app.getHttpServer())
      .get(`/api/v1/deposits/${deposit.id}`)
      .auth(user.token, { type: 'bearer' })
      .expect(200);
    expect(status.body.status).toBe('failed');
    expect(await deposits.expireIfPending(deposit.id)).toBe(false);
  });

  it('allows only one of two concurrent transfers when one balance can cover only one', async () => {
    const sender = await register('sender');
    const firstRecipient = await register('recipient_a');
    const secondRecipient = await register('recipient_b');
    const deposit = await initializeDeposit(sender.token, 1000);
    await confirmDeposit(deposit.reference, 1000);

    const responses = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/transfers')
        .auth(sender.token, { type: 'bearer' })
        .send({ recipientUsername: firstRecipient.username, amount: 700 }),
      request(app.getHttpServer())
        .post('/api/v1/transfers')
        .auth(sender.token, { type: 'bearer' })
        .send({ recipientUsername: secondRecipient.username, amount: 700 }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const successfulIndex = responses.findIndex((response) => response.status === 201);
    const successfulRecipient = [firstRecipient.username, secondRecipient.username][
      successfulIndex
    ];
    const repeated = await request(app.getHttpServer())
      .post('/api/v1/transfers')
      .auth(sender.token, { type: 'bearer' })
      .send({ recipientUsername: successfulRecipient, amount: 700 })
      .expect(409);
    expect(repeated.body.message).toBe(
      'a similar transaction was attempted within the last two minutes',
    );
    expect((await wallet(sender.token).expect(200)).body.balance).toBe(300);
  });

  it('allows only one of two concurrent withdrawals when one balance can cover only one', async () => {
    const user = await register('withdrawer');
    const deposit = await initializeDeposit(user.token, 1000);
    await confirmDeposit(deposit.reference, 1000);
    const input = {
      amount: 700,
      bankCode: '058',
      accountNumber: '0123456789',
      accountName: 'Test User',
    };

    const responses = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/withdrawals')
        .auth(user.token, { type: 'bearer' })
        .send(input),
      request(app.getHttpServer())
        .post('/api/v1/withdrawals')
        .auth(user.token, { type: 'bearer' })
        .send(input),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const blocked = responses.find((response) => response.status === 409);
    expect(blocked?.body.message).toBe(
      'a similar transaction was attempted within the last two minutes',
    );
    expect((await wallet(user.token).expect(200)).body.balance).toBe(300);
  });
});
