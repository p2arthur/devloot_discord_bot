import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { Message, ThreadAutoArchiveDuration } from 'discord.js';

interface DiscordThreadResponse {
  id?: string;
}

@Injectable()
export class DiscordThreadService {
  private readonly logger = new Logger(DiscordThreadService.name);
  private readonly botToken = process.env.DISCORD_BOT_TOKEN;

  async createProposalThread(
    message: Message,
    issueTitle: string,
  ): Promise<boolean> {
    try {
      if (message.hasThread) {
        return true;
      }

      const thread = await message.startThread({
        name: this.buildThreadName('[Proposal]', issueTitle),
        autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
        reason: 'DevLoot proposal discussion thread',
      });

      this.logger.log(
        `[thread] Created proposal thread ${thread.id} for message ${message.id}`,
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `[thread] Failed to create proposal thread for message ${message.id}: ${this.formatError(error)}`,
      );
      return false;
    }
  }

  async createBountyThread(
    channelId: string,
    messageId: string,
    issueTitle: string,
  ): Promise<boolean> {
    if (!this.botToken) {
      this.logger.warn('[thread] Discord bot token missing; skipping thread');
      return false;
    }

    try {
      const response = await axios.post<DiscordThreadResponse>(
        `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/threads`,
        {
          name: this.buildThreadName('Bounty —', issueTitle),
          auto_archive_duration: 1440,
        },
        {
          headers: {
            Authorization: `Bot ${this.botToken}`,
            'Content-Type': 'application/json',
          },
        },
      );

      this.logger.log(
        `[thread] Created bounty thread ${response.data.id ?? 'unknown'} for message ${messageId}`,
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `[thread] Failed to create bounty thread for message ${messageId}: ${this.formatError(error)}`,
      );
      return false;
    }
  }

  private buildThreadName(prefix: string, title: string): string {
    const normalized = title.replace(/\s+/g, ' ').trim();
    return `${prefix} ${normalized}`.slice(0, 100);
  }

  private formatError(error: unknown): string {
    if (axios.isAxiosError(error)) {
      return `${error.response?.status ?? 'unknown'} ${JSON.stringify(error.response?.data ?? error.message)}`;
    }
    return error instanceof Error ? error.message : String(error);
  }
}
