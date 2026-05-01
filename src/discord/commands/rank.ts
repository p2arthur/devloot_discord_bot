import { Injectable } from '@nestjs/common';
import { Colors, EmbedBuilder, ChatInputCommandInteraction } from 'discord.js';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class RankCommand {
  constructor(private readonly prisma: PrismaService) {}

  async handle(interaction: ChatInputCommandInteraction): Promise<void> {
    const discordId = interaction.user.id;
    const user = await this.prisma.user.findUnique({ where: { discordId } });

    const xp = user?.xp ?? 0;
    const thresholds = { builder: 500, hunter: 2000, legend: 5000 };
    let tier = 'Newcomer';
    let nextThreshold = thresholds.builder;
    let emoji = '📦';

    if (xp >= thresholds.legend) {
      tier = 'Legend';
      nextThreshold = Infinity;
      emoji = '⭐';
    } else if (xp >= thresholds.hunter) {
      tier = 'Hunter';
      nextThreshold = thresholds.legend;
      emoji = '🎯';
    } else if (xp >= thresholds.builder) {
      tier = 'Builder';
      nextThreshold = thresholds.hunter;
      emoji = '🔨';
    }

    const progress = nextThreshold === Infinity ? 'MAX' : `${xp}/${nextThreshold}`;
    const xpToNext = nextThreshold === Infinity ? 0 : nextThreshold - xp;

    const streak = await this.prisma.dailyStreak.findUnique({
      where: { userId: discordId },
    });

    const proposalCount = await this.prisma.proposal.count({
      where: { proposerId: discordId },
    });

    const displayName = interaction.member && 'displayName' in interaction.member
      ? interaction.member.displayName
      : interaction.user.username;

    const embed = new EmbedBuilder()
      .setColor(Colors.Blue)
      .setTitle(`${emoji} ${displayName}'s Rank`)
      .addFields(
        { name: 'Tier', value: tier, inline: true },
        { name: 'XP', value: `${xp}`, inline: true },
        { name: 'Progress', value: progress, inline: true },
        {
          name: 'Daily Streak',
          value: `${streak?.currentStreak ?? 0} days`,
          inline: true,
        },
        {
          name: 'Best Streak',
          value: `${streak?.longestStreak ?? 0} days`,
          inline: true,
        },
        { name: 'Proposals', value: `${proposalCount}`, inline: true },
      );

    const nextTierName =
      tier === 'Newcomer'
        ? 'Builder'
        : tier === 'Builder'
          ? 'Hunter'
          : tier === 'Hunter'
            ? 'Legend'
            : null;
    const nextTierUnlock =
      tier === 'Newcomer'
        ? '/propose unlocked'
        : tier === 'Builder'
          ? 'Hunter perks'
          : tier === 'Hunter'
            ? 'Legend perks'
            : '';

    if (xpToNext > 0 && nextTierName) {
      embed.setFooter({
        text: `${xpToNext} XP to ${nextTierName} — ${nextTierUnlock}`,
      });
    } else if (tier === 'Legend') {
      embed.setFooter({
        text: 'Max tier reached. Create or claim a bounty for Open Source Chef.',
      });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}
