/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, Logger } from '@nestjs/common';
import { EmbedBuilder, Colors, MessageFlags } from 'discord.js';
import { PrismaService } from '../../prisma/prisma.service';
import { DiscordRoleService } from '../services/discord-role.service';
import { DiscordGuildService } from '../services/discord-guild.service';

@Injectable()
export class DiscordVerifyService {
  private readonly logger = new Logger(DiscordVerifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly roleService: DiscordRoleService,
    private readonly guildService: DiscordGuildService,
  ) {}

  async checkOnboarded(discordId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { discordId } });
    return !!(user?.onboarded && user?.githubId);
  }

  async handleVerify(interaction: any): Promise<void> {
    const discordId = interaction.user.id;
    const userTag = interaction.user.tag;

    this.logger.log(
      `[verify] ===== VERIFY FLOW START for ${userTag} (${discordId}) =====`,
    );

    const existing = await this.prisma.user.findUnique({
      where: { discordId },
    });

    this.logger.log(
      `[verify] DB lookup by discordId=${discordId} — ` +
        `found: ${!!existing}, ` +
        `id: ${existing?.id ?? 'N/A'}, ` +
        `githubId: ${existing?.githubId ?? 'NONE'}, ` +
        `username: ${existing?.username ?? 'NONE'}, ` +
        `wallet: ${existing?.wallet ?? 'NONE'}, ` +
        `githubAccessToken: ${existing?.githubAccessToken ? 'SET(' + existing.githubAccessToken.slice(0, 6) + '...)' : 'NULL'}, ` +
        `onboarded: ${existing?.onboarded ?? false}, ` +
        `xp: ${existing?.xp ?? 0}`,
    );

    if (existing?.onboarded) {
      this.logger.log(
        `[verify] ${discordId} already onboarded — syncing roles anyway`,
      );

      await this.roleService.syncTierRole(discordId, existing.xp);

      const verifiedRoleId =
        await this.roleService.fetchRoleIdByName('Verified');
      if (verifiedRoleId && interaction.guild) {
        try {
          const member = await interaction.guild.members.fetch(discordId);
          if (!member.roles.cache.has(verifiedRoleId)) {
            await member.roles.add(verifiedRoleId);
            this.logger.log(
              `[verify] Re-assigned missing Verified role ${verifiedRoleId} to ${discordId}`,
            );
          }
        } catch (err) {
          this.logger.warn(`[verify] Failed to sync Verified role: ${err}`);
        }
      }

      await interaction.reply({
        content: 'You are already verified! Roles synced.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!existing || !existing.githubId) {
      this.logger.warn(
        `[verify] BLOCKED: ${discordId} (${userTag}) has no linked GitHub — ` +
          `user record exists: ${!!existing}, ` +
          `githubId present: ${!!existing?.githubId}, ` +
          `githubAccessToken present: ${!!existing?.githubAccessToken}. ` +
          `User must complete GitHub OAuth at /connect?discord_id=${discordId}`,
      );

      const allWithDiscordId = await this.prisma.user.findMany({
        where: { discordId },
      });
      if (allWithDiscordId.length > 1) {
        this.logger.warn(
          `[verify] DATA ISSUE: Found ${allWithDiscordId.length} user records with discordId=${discordId}: ` +
            allWithDiscordId
              .map((u) => `id=${u.id},githubId=${u.githubId ?? 'null'}`)
              .join(' | '),
        );
      }

      await interaction.reply({
        content:
          'No GitHub account linked yet. Click **Link GitHub** first, sign in with GitHub, then come back and click **Verify**.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    this.logger.log(`[verify] Marking ${discordId} as onboarded`);
    const isFirstVerify = !existing?.onboarded;

    const updatedUser = await this.prisma.user.update({
      where: { discordId },
      data: {
        onboarded: true,
        ...(isFirstVerify ? { xp: { increment: 100 } } : {}),
      },
    });

    if (isFirstVerify) {
      this.logger.log(
        `[verify] Awarded 100 XP bonus to ${discordId} — total ${updatedUser.xp} XP`,
      );
    }

    const verifiedRoleId = await this.roleService.fetchRoleIdByName('Verified');
    if (verifiedRoleId && interaction.guild) {
      try {
        const member = await interaction.guild.members.fetch(discordId);
        await member.roles.add(verifiedRoleId);
        this.logger.log(
          `[verify] Assigned Verified role ${verifiedRoleId} to ${discordId}`,
        );
      } catch (err) {
        this.logger.warn(`[verify] Failed to assign Verified role: ${err}`);
      }
    }

    this.logger.log(
      `[verify] Syncing tier role for ${discordId} (XP: ${updatedUser.xp})`,
    );
    await this.roleService.syncTierRole(discordId, updatedUser.xp);

    try {
      const generalChannelId =
        await this.guildService.fetchChannelIdByName('⚡-general');
      if (generalChannelId) {
        const channel =
          await interaction.guild?.channels.fetch(generalChannelId);
        if (channel && 'send' in channel) {
          await channel.send(`Welcome <@${discordId}> to DevLoot! 🎉`);
          this.logger.log(
            `[verify] Posted welcome in general for ${discordId}`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(`[verify] Failed to post welcome in general: ${err}`);
    }

    const embed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle("You're in.")
      .setDescription(
        "Here's what you can do:\n\n" +
          '- `/daily` — Claim your daily XP (streak bonus up to +40)\n' +
          '- `/rank` — Check your XP, tier, and streak\n' +
          "- `/quests` — View today's quests\n" +
          "- `/leaderboard` — See who's on top\n" +
          '- `/propose` — Suggest an open source issue for a bounty\n' +
          '- `#💰-feed` — Browse active bounties' +
          (isFirstVerify ? '\n\n**+100 XP** welcome bonus applied!' : ''),
      )
      .addFields({
        name: 'Tier Progression',
        value:
          '🔨 **Builder** (500 XP) — `/propose` unlocked\n' +
          '🎯 **Hunter** (2,000 XP) — Hunter perks\n' +
          '⭐ **Legend** (5,000 XP) — Legend perks\n' +
          '🍳 **Open Source Chef** — Create or claim a bounty this week',
        inline: false,
      });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    this.logger.log(`[verify] ${discordId} verified successfully`);
  }
}
