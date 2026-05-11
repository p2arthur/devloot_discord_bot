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
      await this.deleteWithWarning(
        message,
        `<@${message.author.id}>, this channel is bot-only. Use \`/propose\` in the suggestions channel instead.`,
        '[msg] Failed to delete message in bounty feed channel — missing Manage Messages permission?',
      );
      return;
    }

    const suggestionsChannelId =
      process.env.DISCORD_BOUNTY_SUGGESTIONS_CHANNEL_ID;
    if (suggestionsChannelId && message.channelId === suggestionsChannelId) {
      await this.deleteWithWarning(
        message,
        `<@${message.author.id}>, use \`/propose\` to post in this channel.`,
        '[msg] Failed to delete message in suggestions channel — missing Manage Messages permission?',
      );
      return;
    }

    const proposalsChannelId =
      await this.guildService.fetchChannelIdByName('💡-proposals');
    if (proposalsChannelId && message.channelId === proposalsChannelId) {
      await this.deleteWithWarning(
        message,
        `<@${message.author.id}>, use \`/propose\` to post in this channel.`,
        '[msg] Failed to delete message in proposals channel',
      );
      return;
    }

    for (const quest of QUEST_POOL) {
      if (quest.channelId && message.channelId === quest.channelId) {
        this.logger.log(
          `[msg] ${message.author.tag} posted in quest channel ${quest.id}`,
        );
        await this.quest.autoCompleteQuest(message.author.id, quest.id);
      }
    }
  }

  private async deleteWithWarning(
    message: Message,
    warningText: string,
    failurePrefix: string,
  ): Promise<void> {
    this.logger.log(
      `[msg] Deleting message from ${message.author.tag} in ${message.channelId}`,
    );

    try {
      await message.delete();
      if ('send' in message.channel) {
        const warning = await message.channel.send(warningText);
        setTimeout(() => void warning.delete().catch(() => undefined), 5000);
      }
    } catch (error) {
      this.logger.warn(`${failurePrefix}: ${this.formatError(error)}`);
    }
  }

  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
