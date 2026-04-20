import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../../prisma/prisma.service';

const TIER_ROLES = [
  { envVar: 'ROLE_LEGEND', threshold: 5000 },
  { envVar: 'ROLE_HUNTER', threshold: 2000 },
  { envVar: 'ROLE_BUILDER', threshold: 500 },
];

@Injectable()
export class DiscordRoleService {
  private readonly logger = new Logger(DiscordRoleService.name);
  private readonly botToken = process.env.DISCORD_BOT_TOKEN;

  constructor(private readonly prisma: PrismaService) {}

  async syncTierRole(discordId: string, xp: number): Promise<void> {
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!guildId || !this.botToken) {
      this.logger.debug(
        `[role] Skipping sync for ${discordId} — guildId or botToken missing`,
      );
      return;
    }

    const allTierRoleIds = TIER_ROLES.map((t) => process.env[t.envVar]).filter(
      Boolean,
    ) as string[];
    const newcomerRoleId = process.env.ROLE_NEWCOMER;
    if (newcomerRoleId) allTierRoleIds.push(newcomerRoleId);

    this.logger.debug(
      `[role] Syncing ${discordId} (XP: ${xp}), tier roles configured: ${allTierRoleIds.length}`,
    );

    const user = await this.prisma.user.findUnique({ where: { discordId } });
    let bountyCount = 0;
    if (user?.wallet) {
      bountyCount = await this.prisma.bounty.count({
        where: { creatorWallet: user.wallet },
      });
    }

    try {
      const memberRes = await axios.get(
        `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}`,
        {
          headers: { Authorization: `Bot ${this.botToken}` },
        },
      );
      const currentRoles: string[] = memberRes.data.roles;

      const nonTierRoles = currentRoles.filter(
        (r) => !allTierRoleIds.includes(r),
      );

      let targetRoleId: string | undefined;
      let tierName = 'none';

      if (bountyCount >= 2) {
        targetRoleId = process.env.ROLE_LEGEND;
        tierName = 'legend';
      } else {
        for (const { envVar, threshold } of TIER_ROLES) {
          const id = process.env[envVar];
          if (id && xp >= threshold) {
            targetRoleId = id;
            tierName = envVar.replace('ROLE_', '').toLowerCase();
            break;
          }
        }
        if (!targetRoleId && newcomerRoleId) {
          targetRoleId = newcomerRoleId;
          tierName = 'newcomer';
        }
      }

      const newRoles = [...nonTierRoles];
      if (targetRoleId) {
        newRoles.push(targetRoleId);
      }

      const currentSet = new Set(currentRoles);
      const newSet = new Set(newRoles);
      const changed =
        currentRoles.length !== newRoles.length ||
        [...currentSet].some((r) => !newSet.has(r));

      if (!changed) {
        this.logger.debug(
          `[role] No change needed for ${discordId} (already has correct tier)`,
        );
        return;
      }

      this.logger.log(
        `[role] Updating ${discordId}: removing old tiers, adding ${tierName} (${targetRoleId})` +
          (bountyCount >= 2
            ? ` [bounty override: ${bountyCount} bounties]`
            : ''),
      );
      await axios.patch(
        `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}`,
        { roles: newRoles },
        {
          headers: {
            Authorization: `Bot ${this.botToken}`,
            'Content-Type': 'application/json',
          },
        },
      );
      this.logger.log(
        `[role] Synced tier role for ${discordId} (XP: ${xp}, role: ${tierName})`,
      );
    } catch (err) {
      this.logger.warn(
        `[role] Failed to sync tier role for ${discordId}: ${err?.response?.status ?? err.message}`,
      );
    }
  }

  async assignScoutRole(discordId: string): Promise<void> {
    const guildId = process.env.DISCORD_GUILD_ID;
    const scoutRoleId = process.env.DISCORD_SCOUT_ROLE_ID;
    if (!guildId || !this.botToken || !scoutRoleId) return;

    try {
      const memberRes = await axios.get(
        `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}`,
        {
          headers: { Authorization: `Bot ${this.botToken}` },
        },
      );
      const currentRoles: string[] = memberRes.data.roles;
      if (currentRoles.includes(scoutRoleId)) return;

      currentRoles.push(scoutRoleId);
      await axios.patch(
        `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}`,
        { roles: currentRoles },
        {
          headers: {
            Authorization: `Bot ${this.botToken}`,
            'Content-Type': 'application/json',
          },
        },
      );
      this.logger.log(`[role] Assigned Scout role to ${discordId}`);
    } catch (err) {
      this.logger.warn(
        `[role] Failed to assign Scout role to ${discordId}: ${err?.response?.status ?? err.message}`,
      );
    }
  }

  async checkWeeklyChef(): Promise<{ awarded: number; removed: number }> {
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!guildId || !this.botToken) {
      this.logger.warn('[chef] Guild ID or bot token not set');
      return { awarded: 0, removed: 0 };
    }

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const createdBounties = await this.prisma.bounty.findMany({
      where: { createdAt: { gte: oneWeekAgo } },
      select: { creatorWallet: true },
      distinct: ['creatorWallet'],
    });

    const claimedBounties = await this.prisma.bounty.findMany({
      where: { claimedAt: { gte: oneWeekAgo }, winnerId: { not: null } },
      select: { winnerId: true },
    });

    const qualifyingDiscordIds = new Set<string>();

    for (const b of createdBounties) {
      const user = await this.prisma.user.findFirst({
        where: { wallet: b.creatorWallet },
      });
      if (user?.discordId) qualifyingDiscordIds.add(user.discordId);
    }

    for (const b of claimedBounties) {
      if (!b.winnerId) continue;
      const user = await this.prisma.user.findUnique({
        where: { id: b.winnerId },
      });
      if (user?.discordId) qualifyingDiscordIds.add(user.discordId);
    }

    const chefRoleId = await this.fetchRoleIdByName('Open Source Chef');
    if (!chefRoleId) {
      this.logger.warn(
        '[chef] Open Source Chef role not found — run /setup-server',
      );
      return { awarded: 0, removed: 0 };
    }

    try {
      const memberRes = await axios.get(
        `https://discord.com/api/v10/guilds/${guildId}/members?limit=1000`,
        {
          headers: { Authorization: `Bot ${this.botToken}` },
        },
      );
      const members: any[] = memberRes.data;

      const membersWithChef = members.filter((m) =>
        m.roles.includes(chefRoleId),
      );
      const membersWithoutChef = members.filter(
        (m) => !m.roles.includes(chefRoleId),
      );

      let awarded = 0;
      let removed = 0;

      for (const discordId of qualifyingDiscordIds) {
        const member = membersWithoutChef.find((m) => m.user.id === discordId);
        if (member) {
          const currentRoles = [...member.roles, chefRoleId];
          await axios.patch(
            `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}`,
            { roles: currentRoles },
            {
              headers: {
                Authorization: `Bot ${this.botToken}`,
                'Content-Type': 'application/json',
              },
            },
          );
          this.logger.log(`[chef] Awarded Open Source Chef to ${discordId}`);
          awarded++;
        }
      }

      for (const member of membersWithChef) {
        if (!qualifyingDiscordIds.has(member.user.id)) {
          const currentRoles = member.roles.filter(
            (r: string) => r !== chefRoleId,
          );
          await axios.patch(
            `https://discord.com/api/v10/guilds/${guildId}/members/${member.user.id}`,
            { roles: currentRoles },
            {
              headers: {
                Authorization: `Bot ${this.botToken}`,
                'Content-Type': 'application/json',
              },
            },
          );
          this.logger.log(
            `[chef] Removed Open Source Chef from ${member.user.id}`,
          );
          removed++;
        }
      }

      this.logger.log(
        `[chef] Weekly check complete: ${awarded} awarded, ${removed} removed, ${qualifyingDiscordIds.size} qualifying`,
      );
      return { awarded, removed };
    } catch (err) {
      this.logger.warn(
        `[chef] Failed weekly check: ${err?.response?.status ?? err.message}`,
      );
      return { awarded: 0, removed: 0 };
    }
  }

  async fetchRoleIdByName(roleName: string): Promise<string | null> {
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!guildId || !this.botToken) return null;

    try {
      const res = await axios.get(
        `https://discord.com/api/v10/guilds/${guildId}/roles`,
        {
          headers: { Authorization: `Bot ${this.botToken}` },
        },
      );
      const role = res.data.find((r: any) => r.name === roleName);
      return role?.id ?? null;
    } catch (err) {
      this.logger.warn(`[roles] Failed to fetch roles: ${err}`);
      return null;
    }
  }
}
