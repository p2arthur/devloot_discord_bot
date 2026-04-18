import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const port = process.env.BOT_PORT ?? 3001;
  await app.listen(port);

  logger.log(`DevLoot Discord Bot running on port ${port}`);
}
bootstrap();
