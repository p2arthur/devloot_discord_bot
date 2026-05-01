import { Injectable } from '@nestjs/common';
import { Colors, EmbedBuilder, ChatInputCommandInteraction } from 'discord.js';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class LeaderboardCommand {
  constructor(private readonly prisma: PrismaService) {}

  async handle(interaction: ChatInputCommandInteraction): Promise<void> {
    const topUsers = await this.prisma.user.findMany({
      where: { xp: { gt: 0 } },
      orderBy: { xp: 'desc' },
      take: 10,
      select: { discordId: true, xp: true, username: true },
    });

    if (topUsers.length === 0) {
      await interaction.reply({
        content: 'No one has earned XP yet!',
        ephemeral: true,
      });
      return;
    }

    const tierEmoji = (xp: number): string => {
      if (xp >= 5000) return '⭐';
      if (xp >= 2000) return '🎯';
      if (xp >= 500) return '🔨';
      return '📦';
    };

    const lines = topUsers.map((user, index) => {
      const medal =
        index === 0
          ? '🥇'
          : index === 1
            ? '🥈'
            : index === 2
              ? '🥉'
              : `**${index + 1}.**`;
      const name = user.username || `<@${user.discordId}>`;
      return `${medal} ${tierEmoji(user.xp)} ${name} — **${user.xp} XP**`;
    });

    const allUsers = await this.prisma.user.findMany({
      where: { xp: { gt: 0 } },
      orderBy: { xp: 'desc' },
      select: { discordId: true },
    });
    const userRank =
      allUsers.findIndex((user) => user.discordId === interaction.user.id) + 1;

    const embed = new EmbedBuilder()
      .setColor(Colors.Gold)
      .setTitle('Leaderboard')
      .setDescription(lines.join('\n'));

    if (userRank > 0) {
      embed.setFooter({ text: `Your rank: #${userRank}` });
    } else {
      embed.setFooter({ text: 'Claim /daily to get on the board!' });
    }

    await interaction.reply({ embeds: [embed] });
  }
}
