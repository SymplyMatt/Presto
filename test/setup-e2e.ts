process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://wallet@127.0.0.1:55432/wallet';
process.env.DB_SYNCHRONIZE = 'true';
process.env.DB_DROP_SCHEMA = 'true';
process.env.JWT_SECRET = 'test-secret-that-is-longer-than-thirty-two-characters';
process.env.PAYSTACK_SECRET_KEY = 'test-secret';
process.env.DISABLE_QUEUE_WORKER = 'true';
