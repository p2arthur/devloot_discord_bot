import { Injectable } from '@nestjs/common';
import { EmbedBuilder, Colors } from 'discord.js';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ProposalsCommand {
  constructor(private prisma: PrismaService) {}

  async handle(interaction: any) {
    const weekAgo = new Date(Date.now() - 7 * 86400000);
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
        proposals.map((p, i) => ({
          name: `${i + 1}. ${p.title}`,
          value: `+${p.upvotes} interested | [${p.owner}/${p.repo}#${p.issueNumber}](${p.issueUrl})`,
          inline: false,
        })),
      );

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}
