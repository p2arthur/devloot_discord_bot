import { Injectable, Logger } from '@nestjs/common';
import { Message, TextBasedChannel } from 'discord.js';
import { DiscordGuildService } from './discord-guild.service';
import { QuestCommand, QUEST_POOL } from '../commands/quest';

function canSend(channel: TextBasedChannel): channel is TextBasedChannel & {
  send: (content: string) => Promise<Message>;
} {
  return 'send' in channel;
}

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
        'bounty feed channel',
      );
      return;
    }

    const suggestionsChannelId =
      process.env.DISCORD_BOUNTY_SUGGESTIONS_CHANNEL_ID;
    if (suggestionsChannelId && message.channelId === suggestionsChannelId) {
      await this.deleteWithWarning(
        message,
        `<@${message.author.id}>, use \`/propose\` to post in this channel.`,
        'suggestions channel',
      );
      return;
    }

    const proposalsChannelId =
      await this.guildService.fetchChannelIdByName('💡-proposals');
    if (proposalsChannelId && message.channelId === proposalsChannelId) {
      await this.deleteWithWarning(
        message,
        `<@${message.author.id}>, use \`/propose\` to post in this channel.`,
        'proposals channel',
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
    context: string,
  ): Promise<void> {
    this.logger.log(
      `[msg] Deleting message from ${message.author.tag} in ${context}`,
    );

    try {
      await message.delete();
      if (canSend(message.channel)) {
        const warning = await message.channel.send(warningText);
        setTimeout(() => void warning.delete().catch(() => undefined), 5000);
      }
    } catch (err) {
      this.logger.warn(
        `[msg] Failed to delete message in ${context} - missing Manage Messages permission? ${err}`,
      );
    }
  }
}
