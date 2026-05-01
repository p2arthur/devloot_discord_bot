import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class DiscordThreadService {
  private readonly logger = new Logger(DiscordThreadService.name);
  private readonly botToken = process.env.DISCORD_BOT_TOKEN;

  async createThreadFromMessage(params: {
    channelId: string;
    messageId: string;
    name: string;
    reason?: string;
  }): Promise<boolean> {
    if (!this.botToken) {
      this.logger.warn('Discord bot token missing — skipping thread creation');
      return false;
    }

    const threadName = this.sanitizeThreadName(params.name);
    if (!threadName) {
      this.logger.warn('Thread name resolved to empty string — skipping');
      return false;
    }

    try {
      await axios.post(
        `https://discord.com/api/v10/channels/${params.channelId}/messages/${params.messageId}/threads`,
        {
          name: threadName,
          auto_archive_duration: 1440,
        },
        {
          headers: {
            Authorization: `Bot ${this.botToken}`,
            'Content-Type': 'application/json',
            ...(params.reason
              ? { 'X-Audit-Log-Reason': encodeURIComponent(params.reason) }
              : {}),
          },
        },
      );
      this.logger.log(
        `[thread] Created thread "${threadName}" for message ${params.messageId}`,
      );
      return true;
    } catch (err) {
      this.logger.warn(
        `[thread] Failed to create thread for message ${params.messageId}: ${this.describeError(err)}`,
      );
      return false;
    }
  }

  private sanitizeThreadName(name: string): string {
    const cleaned = name
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();

    return cleaned.slice(0, 90) || 'discussion';
  }

  private describeError(err: unknown): string {
    if (typeof err === 'object' && err && 'message' in err) {
      return String((err as { message?: unknown }).message ?? err);
    }
    return String(err);
  }
}
