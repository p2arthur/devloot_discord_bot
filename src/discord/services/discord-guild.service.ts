import { Injectable, Logger } from '@nestjs/common';
import { Client } from 'discord.js';

@Injectable()
export class DiscordGuildService {
  private readonly logger = new Logger(DiscordGuildService.name);
  private client: Client | null = null;

  setClient(client: Client): void {
    this.client = client;
  }

  async fetchChannelIdByName(channelName: string): Promise<string | null> {
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!guildId || !this.client) return null;

    try {
      const guild = await this.client.guilds.fetch(guildId);
      const channels = await guild.channels.fetch();
      const channel = channels.find((c: any) => c?.name === channelName);
      return channel?.id ?? null;
    } catch (err) {
      this.logger.warn(
        `[channels] Failed to find channel ${channelName}: ${err}`,
      );
      return null;
    }
  }
}
