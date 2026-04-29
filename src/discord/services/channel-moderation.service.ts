import { Injectable, Logger } from '@nestjs/common';
import { Message, PermissionFlagsBits } from 'discord.js';

@Injectable()
export class ChannelModerationService {
  private readonly logger = new Logger(ChannelModerationService.name);

  /**
   * Handle auto-moderation for the proposals/suggestions channel.
   * Non-slash-command messages are deleted and the user is warned.
   */
  async handleMessage(message: Message): Promise<void> {
    if (message.author.bot) return;

    const suggestionsChannelId =
      process.env.DISCORD_BOUNTY_SUGGESTIONS_CHANNEL_ID;
    if (!suggestionsChannelId) return;
    if (message.channelId !== suggestionsChannelId) return;

    // Check if the bot has permission to manage messages
    const botMember = message.guild?.members.me;
    if (
      !botMember?.permissions.has(PermissionFlagsBits.ManageMessages)
    ) {
      this.logger.debug(
        '[moderation] Missing ManageMessages permission — cannot auto-delete',
      );
      return;
    }

    try {
      await message.delete();
      this.logger.log(
        `[moderation] Deleted raw message from ${message.author.tag} in suggestions channel`,
      );

      const warning = await message.channel.send({
        content: `<@${message.author.id}> Please use **/propose** to submit a bounty proposal. Raw messages in this channel are not allowed.`,
      });

      // Auto-delete the warning after 8 seconds
      setTimeout(() => {
        warning.delete().catch((err) => {
          this.logger.debug(`[moderation] Failed to delete warning: ${err}`);
        });
      }, 8_000);
    } catch (err) {
      this.logger.warn(
        `[moderation] Failed to delete message or send warning: ${err}`,
      );
    }
  }
}