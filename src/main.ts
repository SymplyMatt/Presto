import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { appModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(appModule, { rawBody: true });
  app.setGlobalPrefix('api/v1');
  const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim());
  app.enableCors({ origin: corsOrigins, credentials: true });
  app.enableShutdownHooks();
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Wallet and Payments API')
    .setDescription(
      [
        'Transaction-safe NGN wallet API with provider-agnostic payments.',
        '',
        '**Swagger auth:** call `POST /auth/register` or `POST /auth/login` with Try it out.',
        'The API sets an HTTP-only `accessToken` cookie; Swagger sends that cookie on every later request.',
        'Use Authorize only if you want to test the Bearer header fallback.',
      ].join('\n'),
    )
    .setVersion('1.0')
    .addBearerAuth()
    .addCookieAuth('accessToken')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs/openapi.json',
    swaggerOptions: {
      persistAuthorization: true,
      withCredentials: true,
      requestInterceptor: (request: { credentials?: RequestCredentials }) => {
        request.credentials = 'include';
        return request;
      },
    },
  });

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
