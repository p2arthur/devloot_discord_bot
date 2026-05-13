import { Injectable, Logger } from '@nestjs/common';
import {
  MessageReaction,
  PartialMessageReaction,
  PartialUser,
  User,
} from 'discord.js';
import { PrismaService } from '../../prisma/prisma.service';
import { DiscordXpService } from './discord-xp.service';

const VOTE_EMOJIS = ['👍', '👎', '💵'];

@Injectable()
export class ProposalVoteService {
  private readonly logger = new Logger(ProposalVoteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly xpService: DiscordXpService,
  ) {}

  async handleReactionAdd(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
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
    if (!emoji || !VOTE_EMOJIS.includes(emoji)) return;

    const proposal = await this.prisma.proposal.findFirst({
      where: { messageId: reaction.message.id },
    });
    if (!proposal) return;

    this.logger.log(
      `[reaction] ${user.id} reacted ${emoji} on proposal ${proposal.id}`,
    );

    if (emoji === '💵') {
      this.logger.log(
        `[reaction] ${user.id} signaled topup interest on proposal ${proposal.id}`,
      );
      return;
    }

    if (proposal.proposerId === user.id) {
      this.logger.log(
        `[reaction] ${user.id} tried to vote on own proposal ${proposal.id} - skipped`,
      );
      return;
    }

    const isUpvote = emoji === '👍';
    const existingVote = await this.prisma.proposalVote.findUnique({
      where: {
        proposalId_userId: { proposalId: proposal.id, userId: user.id },
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
          `[vote] ${user.id} removed vote on proposal ${proposal.id}`,
        );
        return;
      }

      await this.prisma.proposalVote.update({
        where: { id: existingVote.id },
        data: { value: isUpvote ? 1 : -1 },
      });
      this.logger.log(
        `[vote] ${user.id} switched vote on proposal ${proposal.id}`,
      );
    } else {
      await this.prisma.proposalVote.create({
        data: {
          proposalId: proposal.id,
          userId: user.id,
          value: isUpvote ? 1 : -1,
        },
      });
      this.logger.log(`[vote] ${user.id} new vote on proposal ${proposal.id}`);
    }

    await this.prisma.proposal.update({
      where: { id: proposal.id },
      data: {
        upvotes: {
          [isUpvote ? 'increment' : 'decrement']:
            existingVote?.value === (isUpvote ? -1 : 1) ? 2 : 1,
        },
      },
    });

    await this.xpService.addVoteXp(user.id);
  }
}
