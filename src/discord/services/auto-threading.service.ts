import { Injectable, Logger } from '@nestjs/common';
import { Client, TextChannel, PublicThreadChannel } from 'discord.js';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AutoThreadingService {
  private readonly logger = new Logger(AutoThreadingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createProposalThread(
    channel: TextChannel,
    messageId: string,
    issueTitle: string,
    proposalId: number,
  ): Promise<PublicThreadChannel | null> {
    // Check if thread already exists
    const proposal = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
    });
    
    if (!proposal || proposal.threadCreated) {
      this.logger.log(
        `[thread] Thread already exists for proposal ${proposalId}, skipping`,
      );
      return null;
    }

    try {
      const message = await channel.messages.fetch(messageId);
      const threadTitle = `[Proposal] ${issueTitle.slice(0, 80)}`;
      
      const thread = await message.startThread({
        name: threadTitle,
        autoArchiveDuration: 60,
      });

      await this.prisma.proposal.update({
        where: { id: proposalId },
        data: { threadCreated: true },
      });

      this.logger.log(
        `[thread] Created thread "${threadTitle}" for proposal ${proposalId}`,
      );

      return thread;
    } catch (err) {
      this.logger.error(
        `[thread] Failed to create thread for proposal ${proposalId}: ${err}`,
      );
      return null;
    }
  }

  async createBountyThread(
    client: Client,
    channelId: string,
    messageId: string,
    issueTitle: string,
  ): Promise<PublicThreadChannel | null> {
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel || !('messages' in channel)) {
        this.logger.warn(`[thread] Channel ${channelId} not found or not a text channel`);
        return null;
      }

      const textChannel = channel as TextChannel;
      const message = await textChannel.messages.fetch(messageId);
      const threadTitle = `Bounty — ${issueTitle.slice(0, 80)}`;

      const thread = await message.startThread({
        name: threadTitle,
        autoArchiveDuration: 60,
      });

      this.logger.log(
        `[thread] Created thread "${threadTitle}" for bounty notification`,
      );

      return thread;
    } catch (err) {
      this.logger.error(
        `[thread] Failed to create thread for bounty: ${err}`,
      );
      return null;
    }
  }
}
