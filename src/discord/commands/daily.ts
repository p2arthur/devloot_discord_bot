/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Injectable } from '@nestjs/common';
import { EmbedBuilder, Colors } from 'discord.js';
import { PrismaService } from '../../prisma/prisma.service';
import { DiscordService } from '../discord.service';

const BASE_XP = 10;
const STREAK_BONUS_PER_DAY = 2;
const MAX_STREAK_BONUS = 30;

@Injectable()
export class DailyCommand {
  constructor(
    private prisma: PrismaService,
    private discordService: DiscordService,
  ) {}

  async handle(interaction: any) {
    const discordId = interaction.user.id;
    const user = await this.prisma.user.findUnique({ where: { discordId } });

    const now = new Date();

    // Check cooldown
    if (user?.lastDailyClaim) {
      const lastClaim = new Date(user.lastDailyClaim);
      const diff = now.getTime() - lastClaim.getTime();
      if (diff < 86400000) {
        const hoursLeft = Math.ceil((86400000 - diff) / 3600000);
        await interaction.reply({
          content: `Daily already claimed! Come back in ${hoursLeft}h.`,
          ephemeral: true,
        });
        return;
      }
    }

    // Calculate streak
    let streak = await this.prisma.dailyStreak.findUnique({ where: { userId: discordId } });

    let currentStreak = 1;
    let longestStreak = 1;

    if (streak && streak.lastClaimDate) {
      const lastClaim = new Date(streak.lastClaimDate);
      const hoursSince = (now.getTime() - lastClaim.getTime()) / 3600000;

      if (hoursSince <= 48) {
        // Streak continues (within 48h window)
        currentStreak = streak.currentStreak + 1;
        longestStreak = Math.max(currentStreak, streak.longestStreak);
      }
      // Otherwise streak resets to 1
    }

    // Upsert streak record
    streak = await this.prisma.dailyStreak.upsert({
      where: { userId: discordId },
      update: { currentStreak, longestStreak, lastClaimDate: now },
      create: { userId: discordId, currentStreak, longestStreak, lastClaimDate: now },
    });

    // Calculate XP with streak bonus
    const streakBonus = Math.min((currentStreak - 1) * STREAK_BONUS_PER_DAY, MAX_STREAK_BONUS);
    const totalXp = BASE_XP + streakBonus;

    // Award XP
    await this.discordService.addXp(discordId, totalXp);

    // Update lastDailyClaim on User
    await this.prisma.user.update({
      where: { discordId },
      data: { lastDailyClaim: now },
    });

    const embed = new EmbedBuilder()
      .setColor(Colors.Gold)
      .setTitle('Daily Claimed!')
      .setDescription(`You earned **${totalXp} XP**`)
      .addFields(
        { name: 'Base', value: `+${BASE_XP} XP`, inline: true },
        { name: 'Streak Bonus', value: streakBonus > 0 ? `+${streakBonus} XP` : 'None', inline: true },
        { name: 'Current Streak', value: `${currentStreak} day${currentStreak > 1 ? 's' : ''}`, inline: true },
        { name: 'Best Streak', value: `${longestStreak} day${longestStreak > 1 ? 's' : ''}`, inline: true },
      );

    if (currentStreak >= 7) {
      embed.setFooter({ text: `🔥 ${currentStreak}-day streak! Keep it going for max bonus (+${MAX_STREAK_BONUS} XP).` });
    } else {
      const daysToMax = Math.ceil((MAX_STREAK_BONUS - streakBonus) / STREAK_BONUS_PER_DAY);
      embed.setFooter({ text: `Streak bonus grows +${STREAK_BONUS_PER_DAY} XP/day (max +${MAX_STREAK_BONUS}). ${daysToMax} days to max.` });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}
