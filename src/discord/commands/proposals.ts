import { Injectable } from '@nestjs/common';
import { Colors, EmbedBuilder, ChatInputCommandInteraction } from 'discord.js';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ProposalsCommand {
  constructor(private readonly prisma: PrismaService) {}

  async handle(interaction: ChatInputCommandInteraction): Promise<void> {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const proposals = await this.prisma.proposal.findMany({
      where: { createdAt: { gte: weekAgo } },
      orderBy: { upvotes: 'desc' },
      take: 10,
      include: { _count: { select: { votes: true } } },
    });

    if (proposals.length === 0) {
      await interaction.reply({
        content: 'No proposals this week yet!',
        ephemeral: true,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('Top Proposals This Week')
      .setColor(Colors.Purple)
      .addFields(
        proposals.map((proposal, index) => ({
          name: `${index + 1}. ${proposal.title}`,
          value: `+${proposal.upvotes} interested | [${proposal.owner}/${proposal.repo}#${proposal.issueNumber}](${proposal.issueUrl})`,
          inline: false,
        })),
      );

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}
