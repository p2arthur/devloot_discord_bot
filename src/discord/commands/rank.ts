import { Injectable } from '@nestjs/common';
import { EmbedBuilder, Colors } from 'discord.js';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class RankCommand {
  constructor(private prisma: PrismaService) {}

  async handle(interaction: any) {
    const discordId = interaction.user.id;
    const user = await this.prisma.user.findUnique({ where: { discordId } });

    const xp = user?.xp ?? 0;
    const thresholds = { builder: 500, hunter: 2000, legend: 5000 };
    let tier = 'Newcomer';
    let nextThreshold = thresholds.builder;
    let emoji = '\u{1F4E6}';

    if (xp >= thresholds.legend) {
      tier = 'Legend';
      nextThreshold = Infinity;
      emoji = '\u{2B50}';
    } else if (xp >= thresholds.hunter) {
      tier = 'Hunter';
      nextThreshold = thresholds.legend;
      emoji = '\u{1F3AF}';
    } else if (xp >= thresholds.builder) {
      tier = 'Builder';
      nextThreshold = thresholds.hunter;
      emoji = '\u{1F528}';
    }

    const progress = nextThreshold === Infinity ? 'MAX' : `${xp}/${nextThreshold}`;
    const xpToNext = nextThreshold === Infinity ? 0 : nextThreshold - xp;

    // Get streak info
    const streak = await this.prisma.dailyStreak.findUnique({ where: { userId: discordId } });

    // Get total proposals
    const proposalCount = await this.prisma.proposal.count({
      where: { proposerId: discordId },
    });

    const embed = new EmbedBuilder()
      .setColor(Colors.Blue)
      .setTitle(`${emoji} ${interaction.user.displayName}'s Rank`)
      .addFields(
        { name: 'Tier', value: tier, inline: true },
        { name: 'XP', value: `${xp}`, inline: true },
        { name: 'Progress', value: progress, inline: true },
        { name: 'Daily Streak', value: `${streak?.currentStreak ?? 0} days`, inline: true },
        { name: 'Best Streak', value: `${streak?.longestStreak ?? 0} days`, inline: true },
        { name: 'Proposals', value: `${proposalCount}`, inline: true },
      );

    const nextTierName = tier === 'Newcomer' ? 'Builder' : tier === 'Builder' ? 'Hunter' : tier === 'Hunter' ? 'Legend' : null;
    const nextTierUnlock = tier === 'Newcomer' ? '/propose unlocked' : tier === 'Builder' ? 'Hunter perks' : tier === 'Hunter' ? 'Legend perks' : '';

    if (xpToNext > 0 && nextTierName) {
      embed.setFooter({ text: `${xpToNext} XP to ${nextTierName} — ${nextTierUnlock}` });
    } else if (tier === 'Legend') {
      embed.setFooter({ text: 'Max tier reached. Create or claim a bounty for Open Source Chef.' });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}
