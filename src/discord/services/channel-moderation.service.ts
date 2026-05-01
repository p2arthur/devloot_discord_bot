import { Injectable, Logger } from '@nestjs/common';
import { Message, TextChannel } from 'discord.js';
import { QUEST_POOL } from '../commands/quest';

@Injectable()
export class ChannelModerationService {
  private readonly logger = new Logger(ChannelModerationService.name);

  async handleMessage(message: Message): Promise<void> {
    if (message.author.bot) return;

    const bountyFeedChannelId = process.env.DISCORD_BOUNTY_FEED_CHANNEL;
    if (bountyFeedChannelId && message.channelId === bountyFeedChannelId) {
      this.logger.log(
        `[msg] Deleting message from ${message.author.tag} in bounty feed channel (bot-only)`,
      );
      try {
        await message.delete();
        const warning = await (message.channel as TextChannel).send(
          `${message.author}, this channel is bot-only. Use \`/propose\` in the suggestions channel instead.`,
        );
        setTimeout(() => void warning.delete().catch(() => {}), 5000);
      } catch (err) {
        this.logger.warn(
          `[msg] Failed to delete message in bounty feed channel — missing Manage Messages permission? ${err}`,
        );
      }
      return;
    }

    const suggestionsChannelId =
      process.env.DISCORD_BOUNTY_SUGGESTIONS_CHANNEL_ID;
    if (suggestionsChannelId && message.channelId === suggestionsChannelId) {
      this.logger.log(
        `[msg] Deleting message from ${message.author.tag} in suggestions channel (only /propose allowed)`,
      );
      try {
        await message.delete();
        const warning = await (message.channel as TextChannel).send(
          `${message.author}, use \`/propose\` to post in this channel.`,
        );
        setTimeout(() => void warning.delete().catch(() => {}), 5000);
      } catch (err) {
        this.logger.warn(
          `[msg] Failed to delete message in suggestions channel — missing Manage Messages permission? ${err}`,
        );
      }
      return;
    }

    // Check quest channels
    for (const quest of QUEST_POOL) {
      if (quest.channelId && message.channelId === quest.channelId) {
        this.logger.log(
          `[msg] ${message.author.tag} posted in quest channel ${quest.id}`,
        );
        // Note: Quest auto-completion is handled by the quest service
      }
    }
  }
}
