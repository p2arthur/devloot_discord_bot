import { Injectable, Logger } from '@nestjs/common';
import { MessageReaction, User } from 'discord.js';
import { PrismaService } from '../../prisma/prisma.service';
import { DiscordXpService } from './discord-xp.service';

@Injectable()
export class ProposalVoteService {
  private readonly logger = new Logger(ProposalVoteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly xpService: DiscordXpService,
  ) {}

  async handleReactionAdd(
    reaction: MessageReaction,
    user: User,
  ): Promise<void> {
    if (user.bot) return;

    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch {
        return;
      }
    }

    const emoji = reaction.emoji.name;
    const messageId = reaction.message.id;
    const discordId = user.id;

    if (!['👍', '👎', '💵'].includes(emoji ?? '')) return;

    const proposal = await this.prisma.proposal.findFirst({
      where: { messageId },
    });
    if (!proposal) return;

    this.logger.log(
      `[reaction] ${discordId} reacted ${emoji} on proposal ${proposal.id} (msg ${messageId})`,
    );

    if (emoji === '💵') {
      this.logger.log(
        `[reaction] ${discordId} signaled topup interest on proposal ${proposal.id}`,
      );
      return;
    }

    const isUpvote = emoji === '👍';

    if (proposal.proposerId === discordId) {
      this.logger.log(
        `[reaction] ${discordId} tried to vote on own proposal ${proposal.id} — skipped`,
      );
      return;
    }

    const existingVote = await this.prisma.proposalVote.findUnique({
      where: {
        proposalId_userId: { proposalId: proposal.id, userId: discordId },
      },
    });

    if (existingVote) {
      if (
        (isUpvote && existingVote.value === 1) ||
        (!isUpvote && existingVote.value === -1)
      ) {
        await this.prisma.proposalVote.delete({
          where: { id: existingVote.id },
        });
        await this.prisma.proposal.update({
          where: { id: proposal.id },
          data: { upvotes: { decrement: isUpvote ? 1 : 0 } },
        });
        this.logger.log(
          `[vote] ${discordId} removed vote on proposal ${proposal.id}`,
        );
        return;
      }

      await this.prisma.proposalVote.update({
        where: { id: existingVote.id },
        data: { value: isUpvote ? 1 : -1 },
      });
      this.logger.log(
        `[vote] ${discordId} switched vote on proposal ${proposal.id}`,
      );
    } else {
      await this.prisma.proposalVote.create({
        data: {
          proposalId: proposal.id,
          userId: discordId,
          value: isUpvote ? 1 : -1,
        },
      });
      this.logger.log(
        `[vote] ${discordId} new vote on proposal ${proposal.id}`,
      );
    }

    if (isUpvote) {
      await this.prisma.proposal.update({
        where: { id: proposal.id },
        data: { upvotes: { increment: existingVote?.value === -1 ? 2 : 1 } },
      });
    } else {
      await this.prisma.proposal.update({
        where: { id: proposal.id },
        data: { upvotes: { decrement: existingVote?.value === 1 ? 2 : 1 } },
      });
    }

    await this.xpService.addVoteXp(discordId);
  }
}
