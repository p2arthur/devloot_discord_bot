import { Injectable, Logger } from '@nestjs/common';
import {
  MessageReaction,
  User,
  PartialMessageReaction,
  PartialUser,
  EmbedBuilder,
  Colors,
} from 'discord.js';
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
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
  ): Promise<void> {
    if (user.bot) return;

    const suggestionsChannelId =
      process.env.DISCORD_BOUNTY_SUGGESTIONS_CHANNEL_ID;
    if (!suggestionsChannelId) return;
    if (reaction.message.channelId !== suggestionsChannelId) return;

    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch (err) {
        this.logger.warn(`[vote] Failed to fetch partial reaction: ${err}`);
        return;
      }
    }

    const emoji = reaction.emoji.name;
    if (emoji !== '👍' && emoji !== '👎') return;

    const message = reaction.message;
    if (message.partial) {
      try {
        await message.fetch();
      } catch (err) {
        this.logger.warn(`[vote] Failed to fetch partial message: ${err}`);
        return;
      }
    }

    const embed = message.embeds?.[0];
    if (!embed) return;

    const proposalField = embed.fields?.find((f) => f.name === 'Proposal ID');
    if (!proposalField) return;

    const proposalId = parseInt(proposalField.value, 10);
    if (isNaN(proposalId)) return;

    try {
      const proposal = await this.prisma.proposal.findUnique({
        where: { id: proposalId },
        include: { proposer: true },
      });
      if (!proposal) return;

      const voterId = user.id;

      const existingVote = await this.prisma.proposalVote.findFirst({
        where: { proposalId, voter: { discordId: voterId } },
      });

      if (existingVote) {
        this.logger.debug(
          `[vote] User ${voterId} already voted on proposal ${proposalId}`,
        );
        return;
      }

      let voterUser = await this.prisma.user.findUnique({
        where: { discordId: voterId },
      });

      if (!voterUser) {
        this.logger.debug(
          `[vote] Voter ${voterId} not found in DB — skipping vote record`,
        );
        return;
      }

      const voteValue = emoji === '👍' ? 1 : -1;

      await this.prisma.proposalVote.create({
        data: {
          proposalId,
          voterId: voterUser.id,
          vote: voteValue,
        },
      });

      this.logger.log(
        `[vote] User ${voterId} voted ${emoji} on proposal ${proposalId}`,
      );

      // Award XP to voter
      await this.xpService.addVoteXp(voterId);

      // Check if proposal has enough upvotes to notify
      const upvotes = await this.prisma.proposalVote.count({
        where: { proposalId, vote: 1 },
      });

      const UPVOTE_THRESHOLD = 5;
      if (upvotes === UPVOTE_THRESHOLD && proposal.proposer?.discordId) {
        this.logger.log(
          `[vote] Proposal ${proposalId} reached ${UPVOTE_THRESHOLD} upvotes`,
        );
        // Award bonus XP to proposer on threshold
        await this.xpService.addProposalXp(proposal.proposer.discordId);
      }
    } catch (err) {
      this.logger.error(`[vote] Error handling reaction: ${err}`);
    }
  }
}