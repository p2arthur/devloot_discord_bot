import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { DiscordModule } from './discord/discord.module';

@Module({
  imports: [PrismaModule, DiscordModule],
})
export class AppModule {}
