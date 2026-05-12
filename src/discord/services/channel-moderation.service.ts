import { Injectable, Logger } from '@nestjs/common';
import { Message } from 'discord.js';
import { DiscordGuildService } from './discord-guild.service';
import { QuestCommand, QUEST_POOL } from '../commands/quest';

@Injectable()
export class ChannelModerationService {
  private readonly logger = new Logger(ChannelModerationService.name);

  constructor(
    private readonly guildService: DiscordGuildService,
    private readonly quest: QuestCommand,
  ) {}

  async handleMessage(message: Message): Promise<void> {
    if (message.author.bot) return;

    const bountyFeedChannelId = process.env.DISCORD_BOUNTY_FEED_CHANNEL;
    if (bountyFeedChannelId && message.channelId === bountyFeedChannelId) {
      await this.deleteAndWarn(
        message,
        'this channel is bot-only. Use `/propose` in the suggestions channel instead.',
      );
      return;
    }

    const suggestionsChannelId =
      process.env.DISCORD_BOUNTY_SUGGESTIONS_CHANNEL_ID;
    if (suggestionsChannelId && message.channelId === suggestionsChannelId) {
      await this.deleteAndWarn(
        message,
        'use `/propose` to post in this channel.',
      );
      return;
    }

    const proposalsChannelId =
      await this.guildService.fetchChannelIdByName('??-proposals');
    if (proposalsChannelId && message.channelId === proposalsChannelId) {
      await this.deleteAndWarn(
        message,
        'use `/propose` to post in this channel.',
      );
      return;
    }

    for (const quest of QUEST_POOL) {
      if (quest.channelId && message.channelId === quest.channelId) {
        await this.quest.autoCompleteQuest(message.author.id, quest.id);
      }
    }
  }

  private async deleteAndWarn(
    message: Message,
    warningText: string,
  ): Promise<void> {
    try {
      await message.delete();
      if (!message.channel.isTextBased() || !('send' in message.channel)) return;
      const warning = await message.channel.send(
        `${message.author}, ${warningText}`,
      );
      setTimeout(() => void warning.delete().catch(() => {}), 5000);
    } catch (err) {
      this.logger.warn(
        `[moderation] Failed to moderate message: ${String(err)}`,
      );
    }
  }
}
