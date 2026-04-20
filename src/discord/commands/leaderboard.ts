import { Injectable } from '@nestjs/common';
import { EmbedBuilder, Colors } from 'discord.js';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class LeaderboardCommand {
  constructor(private prisma: PrismaService) {}

  async handle(interaction: any) {
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

    const tierEmoji = (xp: number) => {
      if (xp >= 5000) return '\u{2B50}';
      if (xp >= 2000) return '\u{1F3AF}';
      if (xp >= 500) return '\u{1F528}';
      return '\u{1F4E6}';
    };

    const lines = topUsers.map((u, i) => {
      const medal =
        i === 0
          ? '\u{1F947}'
          : i === 1
            ? '\u{1F948}'
            : i === 2
              ? '\u{1F949}'
              : `**${i + 1}.**`;
      const name = u.username || `<@${u.discordId}>`;
      return `${medal} ${tierEmoji(u.xp)} ${name} — **${u.xp} XP**`;
    });

    // Check requesting user's rank
    const allUsers = await this.prisma.user.findMany({
      where: { xp: { gt: 0 } },
      orderBy: { xp: 'desc' },
      select: { discordId: true },
    });
    const userRank =
      allUsers.findIndex((u) => u.discordId === interaction.user.id) + 1;

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
