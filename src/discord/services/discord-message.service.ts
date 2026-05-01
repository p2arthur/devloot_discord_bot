import { Injectable, Logger } from '@nestjs/common';
import { Client, Message } from 'discord.js';
import { DiscordGuildService } from './discord-guild.service';
import { QuestCommand, QUEST_POOL } from '../commands/quest';
import { OnboardingCommand } from '../commands/onboarding';

@Injectable()
export class DiscordMessageService {
  private readonly logger = new Logger(DiscordMessageService.name);

  constructor(
    private readonly guildService: DiscordGuildService,
    private readonly quest: QuestCommand,
    private readonly onboarding: OnboardingCommand,
  ) {}

  async handleMessage(message: Message): Promise<void> {
    if (message.author.bot) return;

    const bountyFeedChannelId = process.env.DISCORD_BOUNTY_FEED_CHANNEL;
    if (bountyFeedChannelId && message.channelId === bountyFeedChannelId) {
      this.logger.log(
        `[msg] Deleting message from ${message.author.tag} in bounty feed channel (bot-only)`,
      );
      await this.deleteAndWarn(
        message,
        'this channel is bot-only. Use `/propose` in the suggestions channel instead.',
      );
      return;
    }

    const suggestionsChannelId = process.env.DISCORD_BOUNTY_SUGGESTIONS_CHANNEL_ID;
    if (suggestionsChannelId && message.channelId === suggestionsChannelId) {
      this.logger.log(
        `[msg] Deleting message from ${message.author.tag} in suggestions channel (only /propose allowed)`,
      );
      await this.deleteAndWarn(message, 'use `/propose` to post in this channel.');
      return;
    }

    const proposalsChannelId = await this.guildService.fetchChannelIdByName('💡-proposals');
    if (proposalsChannelId && message.channelId === proposalsChannelId) {
      this.logger.log(
        `[msg] Deleting message from ${message.author.tag} in proposals channel`,
      );
      await this.deleteAndWarn(message, 'use `/propose` to post in this channel.');
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

  async setupVerifyChannel(client: Client): Promise<void> {
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!guildId) {
      this.logger.warn(
        '[welcome] DISCORD_GUILD_ID not set — skipping verify channel setup',
      );
      return;
    }

    try {
      const guild = await client.guilds.fetch(guildId);
      const channels = await guild.channels.fetch();

      const verifyChannel = channels.find(
        (channel) => channel?.name === '🔓-verify',
      );
      if (!verifyChannel || !('send' in verifyChannel)) {
        this.logger.log(
          '[welcome] #🔓-verify channel not found — skipping (run /setup-server first)',
        );
        return;
      }

      const messages = await verifyChannel.messages.fetch({ limit: 20 });
      const existingBot = messages.find(
        (m) =>
          m.author.id === client.user?.id &&
          m.embeds[0]?.title === 'Welcome to DevLoot',
      );

      if (existingBot) {
        this.logger.log('[welcome] Onboarding message already exists in #🔓-verify');
        return;
      }

      await verifyChannel.send(this.onboarding.buildOnboardingMessage());
      this.logger.log('[welcome] Posted onboarding message to #🔓-verify');
    } catch (err) {
      this.logger.warn(
        `[welcome] Could not setup verify channel: ${this.describeError(err)}`,
      );
    }
  }

  private async deleteAndWarn(
    message: Message,
    warningText: string,
  ): Promise<void> {
    try {
      await message.delete();
      const warning = await this.sendChannelWarning(
        message,
        `${message.author}, ${warningText}`,
      );
      if (warning) {
        setTimeout(() => void warning.delete().catch(() => {}), 5000);
      }
    } catch (err) {
      this.logger.warn(
        `[msg] Failed to delete message in ${message.channelId} — missing Manage Messages permission? ${this.describeError(err)}`,
      );
    }
  }

  private async sendChannelWarning(
    message: Message,
    content: string,
  ): Promise<Message | null> {
    if (!('send' in message.channel)) return null;

    try {
      return await message.channel.send(content);
    } catch {
      return null;
    }
  }

  private describeError(err: unknown): string {
    if (typeof err === 'object' && err && 'message' in err) {
      return String((err as { message?: unknown }).message ?? err);
    }
    return String(err);
  }
}
