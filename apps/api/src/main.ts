import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.use(compression());
  app.enableCors();
  app.useBodyParser('json', { limit: '20mb' });
  app.useBodyParser('urlencoded', { limit: '20mb', extended: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const config = app.get(ConfigService);
  await app.listen(config.get<number>('PORT') ?? 3001);
}

bootstrap();
