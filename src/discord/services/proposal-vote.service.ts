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

    if (!emoji || !['👍', '👎', '💵'].includes(emoji)) return;

    const proposal = await this.prisma.proposal.findFirst({
      where: { messageId },
    });
    if (!proposal) return;

    if (emoji === '💵') return;
    const isUpvote = emoji === '👍';
    if (proposal.proposerId === discordId) return;

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
        return;
      }

      await this.prisma.proposalVote.update({
        where: { id: existingVote.id },
        data: { value: isUpvote ? 1 : -1 },
      });
    } else {
      await this.prisma.proposalVote.create({
        data: {
          proposalId: proposal.id,
          userId: discordId,
          value: isUpvote ? 1 : -1,
        },
      });
    }

    await this.prisma.proposal.update({
      where: { id: proposal.id },
      data: {
        upvotes: {
          [isUpvote ? 'increment' : 'decrement']: existingVote
            ? existingVote.value === (isUpvote ? -1 : 1)
              ? 2
              : 0
            : 1,
        },
      },
    });

    await this.xpService.addVoteXp(discordId);
    this.logger.log(
      `[vote] Processed vote reaction for proposal ${proposal.id}`,
    );
  }
}
