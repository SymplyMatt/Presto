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
  withdrawalRecipientInput,
} from '../src/payments/payment-provider';
import { paymentProviderRegistry } from '../src/payments/payment-provider.registry';

class testPaymentProvider implements paymentProvider {
  readonly name = 'paystack';

  async initializeDeposit(input: initializeDepositInput) {
    return {
      reference: input.reference,
      checkoutUrl: `https://checkout.test/${input.reference}`,
      accessCode: 'access-code',
    };
  }

  async createWithdrawalRecipient(_input: withdrawalRecipientInput) {
    return 'RCP_test';
  }

  async initiateWithdrawal(input: initiateWithdrawalInput) {
    return { reference: input.reference, transferCode: 'TRF_test', status: 'pending' };
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
  let eventId = 1000;

  beforeAll(async () => {
    const provider = new testPaymentProvider();
    const cache = new Map<string, unknown>();
    const module = await Test.createTestingModule({ imports: [appModule] })
      .overrideProvider(paymentProviderRegistry)
      .useValue({ getActive: () => provider })
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
      .set('Idempotency-Key', `deposit-${Date.now()}-${Math.random()}`)
      .send({ amount })
      .expect(201);
    return response.body as { id: string; reference: string; status: string };
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
    await request(app.getHttpServer())
      .get('/api/v1/wallet')
      .set('Cookie', user.cookie)
      .expect(200);
  });

  it('credits a duplicate webhook exactly once', async () => {
    const user = await register('duplicate');
    const deposit = await initializeDeposit(user.token, 1000);
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
        .set('Idempotency-Key', 'concurrent-transfer-a')
        .send({ recipientUsername: firstRecipient.username, amount: 700 }),
      request(app.getHttpServer())
        .post('/api/v1/transfers')
        .auth(sender.token, { type: 'bearer' })
        .set('Idempotency-Key', 'concurrent-transfer-b')
        .send({ recipientUsername: secondRecipient.username, amount: 700 }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
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
        .set('Idempotency-Key', 'concurrent-withdrawal-a')
        .send(input),
      request(app.getHttpServer())
        .post('/api/v1/withdrawals')
        .auth(user.token, { type: 'bearer' })
        .set('Idempotency-Key', 'concurrent-withdrawal-b')
        .send(input),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect((await wallet(user.token).expect(200)).body.balance).toBe(300);
  });
});
