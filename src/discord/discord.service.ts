import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';

const TIER_ROLES = [
  { envVar: 'ROLE_LEGEND', threshold: 5000 },
  { envVar: 'ROLE_HUNTER', threshold: 2000 },
  { envVar: 'ROLE_BUILDER', threshold: 500 },
];

@Injectable()
export class DiscordService implements OnModuleInit {
  private readonly logger = new Logger(DiscordService.name);
  private readonly botToken = process.env.DISCORD_BOT_TOKEN;
  private readonly channelId = process.env.DISCORD_BOUNTY_FEED_CHANNEL;

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) {}

  private get isConfigured(): boolean {
    return !!(this.botToken && this.channelId);
  }

  onModuleInit() {
    this.logger.log(`Discord config — token present: ${!!this.botToken}, channelId: ${this.channelId ?? 'NOT SET'}`);
    if (!this.isConfigured) {
      this.logger.warn('Discord notifications are DISABLED — set DISCORD_BOT_TOKEN and DISCORD_BOUNTY_FEED_CHANNEL');
    } else {
      this.logger.log('Discord notifications are ENABLED');
    }
  }

  private async sendMessage(content: string): Promise<void> {
    if (!this.isConfigured) {
      this.logger.warn('Discord not configured — skipping notification');
      return;
    }

    this.logger.debug(`Sending Discord message to channel ${this.channelId}: ${content.slice(0, 80)}`);

    try {
      const response = await axios.post(
        `https://discord.com/api/v10/channels/${this.channelId}/messages`,
        { content },
        {
          headers: {
            Authorization: `Bot ${this.botToken}`,
            'Content-Type': 'application/json',
          },
        },
      );
      this.logger.log(`Discord message sent — status: ${response.status}, messageId: ${response.data?.id}`);
    } catch (err) {
      this.logger.error(
        `Discord notification failed — status: ${err?.response?.status}, body: ${JSON.stringify(err?.response?.data)}, message: ${err.message}`,
      );
    }
  }

  notifyProjectCreated(projectName: string, category: string): void {
    void this.sendMessage(`🚀 **New project created:** **${projectName}** [${category}]`);
  }

  private async sendEmbed(
    title: string,
    description: string,
    fields: { name: string; value: string; inline?: boolean }[],
    color: number,
  ): Promise<void> {
    if (!this.isConfigured) {
      this.logger.warn('Discord not configured — skipping notification');
      return;
    }

    try {
      const response = await axios.post(
        `https://discord.com/api/v10/channels/${this.channelId}/messages`,
        {
          embeds: [{ title, description, fields, color, timestamp: new Date().toISOString() }],
        },
        {
          headers: {
            Authorization: `Bot ${this.botToken}`,
            'Content-Type': 'application/json',
          },
        },
      );
      this.logger.log(`Discord embed sent — status: ${response.status}, messageId: ${response.data?.id}`);
    } catch (err) {
      this.logger.error(
        `Discord embed failed — status: ${err?.response?.status}, body: ${JSON.stringify(err?.response?.data)}, message: ${err.message}`,
      );
    }
  }

  async notifyBountyCreated(issueUrl: string, currencyAmount: number, creatorWallet: string): Promise<void> {
    const amount = (currencyAmount / 1_000_000).toFixed(2);

    // Parse issue URL
    const match = issueUrl.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
    if (!match) {
      // Fallback to plain message if URL doesn't match
      await this.sendMessage(`🎯 **New bounty:** ${issueUrl}\n💰 **${amount} USDC** — created by \`${creatorWallet}\``);
      return;
    }

    const [, owner, repo, issueNumberStr] = match;
    const issueNumber = parseInt(issueNumberStr);

    // Fetch issue details and generate AI summary
    let issueTitle = '';
    let aiSummary: { repoDescription: string; issueDescription: string } | null = null;

    try {
      const issueRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
        headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` },
      });
      issueTitle = issueRes.data.title || '';
      const issueBody = issueRes.data.body || '';
      const issueLabels = (issueRes.data.labels || []).map((l: any) => (typeof l === 'string' ? l : l.name));

      aiSummary = await this.aiService.generateSuggestionSummary({
        owner,
        repo,
        issueTitle,
        labels: issueLabels,
        issueBody,
      });
    } catch (err) {
      this.logger.warn(`[bounty-feed] Failed to fetch issue or generate AI summary: ${err}`);
    }

    // Build embed
    const fields: { name: string; value: string; inline?: boolean }[] = [
      {
        name: 'Issue',
        value: issueTitle ? `[#${issueNumber}: ${issueTitle}](${issueUrl})` : `[#${issueNumber}](${issueUrl})`,
        inline: false,
      },
      { name: 'Bounty', value: `**${amount} USDC**`, inline: true },
      { name: 'Creator', value: `\`${creatorWallet}\``, inline: true },
    ];

    if (aiSummary?.repoDescription) {
      fields.push({ name: '📦 About the Project', value: `> ${aiSummary.repoDescription}`, inline: false });
    }
    if (aiSummary?.issueDescription) {
      fields.push({ name: '🎯 Why This Issue', value: `> ${aiSummary.issueDescription}`, inline: false });
    }

    await this.sendEmbed('🎯 New Bounty Created', `[${owner}/${repo}](https://github.com/${owner}/${repo})`, fields, 0x2ecc71);
  }

  notifyBountyClaimed(bountyId: number, issueUrl: string, winnerWallet: string): void {
    void this.sendMessage(`✅ **Bounty claimed:** [#${bountyId}](${issueUrl})\n🏆 Winner: \`${winnerWallet}\``);
  }

  notifyBountyDisputed(bountyId: number, issueUrl: string, reason: string): void {
    void this.sendMessage(`⚠️ **Bounty disputed:** [#${bountyId}](${issueUrl})\n📝 Reason: ${reason}`);
  }

  notifyBountyApproved(bountyId: number, issueUrl: string, winnerWallet: string): void {
    void this.sendMessage(`👍 **Bounty approved:** [#${bountyId}](${issueUrl})\n🏆 Winner \`${winnerWallet}\` is ready to claim`);
  }

  notifyBountyToppedUp(bountyId: number, issueUrl: string, addedCurrencyAmount: number, totalCurrencyAmount: number): void {
    const added = (addedCurrencyAmount / 1_000_000).toFixed(2);
    const total = (totalCurrencyAmount / 1_000_000).toFixed(2);
    void this.sendMessage(`💸 **Bounty topped up:** [#${bountyId}](${issueUrl})\n+${added} USDC → total **${total} USDC**`);
  }

  async addXp(userId: string, amount: number): Promise<number> {
    let user = await this.prisma.user.findUnique({ where: { discordId: userId } });

    if (user) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { xp: { increment: amount } },
      });
      this.logger.log(`[xp] +${amount} for ${userId} → total ${user.xp} XP`);
    } else {
      // Create stub with unique negative githubId as placeholder
      // (real githubId is positive; this gets replaced when user links via /connect)
      const stubGithubId = -(Date.now() % 1_000_000_000) - Math.floor(Math.random() * 1000);
      try {
        user = await this.prisma.user.create({
          data: { discordId: userId, githubId: stubGithubId, xp: amount },
        });
      } catch {
        // Retry with different ID if collision
        user = await this.prisma.user.create({
          data: { discordId: userId, githubId: stubGithubId - 1, xp: amount },
        });
      }
      this.logger.log(`[xp] Created stub user for ${userId} (githubId: ${user.githubId}), +${amount} XP`);
    }

    await this.syncTierRole(userId, user.xp);
    return user.xp;
  }

  async addXpByUserId(userId: number, amount: number): Promise<number> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { xp: { increment: amount } },
    });
    this.logger.log(`[xp] +${amount} for user#${userId} → total ${user.xp} XP`);

    if (user.discordId) {
      await this.syncTierRole(user.discordId, user.xp);
    }

    return user.xp;
  }

  async syncTierRole(discordId: string, xp: number): Promise<void> {
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!guildId || !this.botToken) {
      this.logger.debug(`[role] Skipping sync for ${discordId} — guildId or botToken missing`);
      return;
    }

    const allTierRoleIds = TIER_ROLES.map((t) => process.env[t.envVar]).filter(Boolean) as string[];
    const newcomerRoleId = process.env.ROLE_NEWCOMER;
    if (newcomerRoleId) allTierRoleIds.push(newcomerRoleId);

    this.logger.debug(`[role] Syncing ${discordId} (XP: ${xp}), tier roles configured: ${allTierRoleIds.length}`);

    // Check if user created 2+ bounties (Legend override)
    const user = await this.prisma.user.findUnique({ where: { discordId } });
    let bountyCount = 0;
    if (user?.wallet) {
      bountyCount = await this.prisma.bounty.count({ where: { creatorWallet: user.wallet } });
    }

    try {
      // Fetch current member roles
      const memberRes = await axios.get(`https://discord.com/api/v10/guilds/${guildId}/members/${discordId}`, {
        headers: { Authorization: `Bot ${this.botToken}` },
      });
      const currentRoles: string[] = memberRes.data.roles;

      // Remove ALL tier roles (including newcomer) — keep only non-tier roles
      const nonTierRoles = currentRoles.filter((r) => !allTierRoleIds.includes(r));

      // Determine tier: bounty count overrides XP
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

      // Build new role set: preserve non-tier roles + correct tier role
      const newRoles = [...nonTierRoles];
      if (targetRoleId) {
        newRoles.push(targetRoleId);
      }

      // Only patch if the role set actually changed
      const currentSet = new Set(currentRoles);
      const newSet = new Set(newRoles);
      const changed = currentRoles.length !== newRoles.length || [...currentSet].some((r) => !newSet.has(r));

      if (!changed) {
        this.logger.debug(`[role] No change needed for ${discordId} (already has correct tier)`);
        return;
      }

      this.logger.log(
        `[role] Updating ${discordId}: removing old tiers, adding ${tierName} (${targetRoleId})` +
          (bountyCount >= 2 ? ` [bounty override: ${bountyCount} bounties]` : ''),
      );
      await axios.patch(
        `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}`,
        { roles: newRoles },
        { headers: { Authorization: `Bot ${this.botToken}`, 'Content-Type': 'application/json' } },
      );
      this.logger.log(`[role] Synced tier role for ${discordId} (XP: ${xp}, role: ${tierName})`);
    } catch (err) {
      this.logger.warn(`[role] Failed to sync tier role for ${discordId}: ${err?.response?.status ?? err.message}`);
    }
  }

  async addProposalXp(proposerId: string): Promise<number> {
    return this.addXp(proposerId, 25);
  }

  async addVoteXp(userId: string): Promise<number> {
    return this.addXp(userId, 2);
  }

  async assignScoutRole(discordId: string): Promise<void> {
    const guildId = process.env.DISCORD_GUILD_ID;
    const scoutRoleId = process.env.DISCORD_SCOUT_ROLE_ID;
    if (!guildId || !this.botToken || !scoutRoleId) return;

    try {
      const memberRes = await axios.get(`https://discord.com/api/v10/guilds/${guildId}/members/${discordId}`, {
        headers: { Authorization: `Bot ${this.botToken}` },
      });
      const currentRoles: string[] = memberRes.data.roles;
      if (currentRoles.includes(scoutRoleId)) return;

      currentRoles.push(scoutRoleId);
      await axios.patch(
        `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}`,
        { roles: currentRoles },
        { headers: { Authorization: `Bot ${this.botToken}`, 'Content-Type': 'application/json' } },
      );
      this.logger.log(`[role] Assigned Scout role to ${discordId}`);
    } catch (err) {
      this.logger.warn(`[role] Failed to assign Scout role to ${discordId}: ${err?.response?.status ?? err.message}`);
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

    // Find users who created bounties this week
    const createdBounties = await this.prisma.bounty.findMany({
      where: { createdAt: { gte: oneWeekAgo } },
      select: { creatorWallet: true },
      distinct: ['creatorWallet'],
    });

    // Find users who claimed bounties this week
    const claimedBounties = await this.prisma.bounty.findMany({
      where: { claimedAt: { gte: oneWeekAgo }, winnerId: { not: null } },
      select: { winnerId: true },
    });

    // Resolve creator wallets to discord IDs
    const qualifyingDiscordIds = new Set<string>();

    for (const b of createdBounties) {
      const user = await this.prisma.user.findFirst({ where: { wallet: b.creatorWallet } });
      if (user?.discordId) qualifyingDiscordIds.add(user.discordId);
    }

    for (const b of claimedBounties) {
      if (!b.winnerId) continue;
      const user = await this.prisma.user.findUnique({ where: { id: b.winnerId } });
      if (user?.discordId) qualifyingDiscordIds.add(user.discordId);
    }

    // Fetch chef role
    const chefRoleId = await this.fetchRoleIdByName('Open Source Chef');
    if (!chefRoleId) {
      this.logger.warn('[chef] Open Source Chef role not found — run /setup-server');
      return { awarded: 0, removed: 0 };
    }

    try {
      // Fetch all guild members
      const memberRes = await axios.get(`https://discord.com/api/v10/guilds/${guildId}/members?limit=1000`, {
        headers: { Authorization: `Bot ${this.botToken}` },
      });
      const members: any[] = memberRes.data;

      const membersWithChef = members.filter((m) => m.roles.includes(chefRoleId));
      const membersWithoutChef = members.filter((m) => !m.roles.includes(chefRoleId));

      let awarded = 0;
      let removed = 0;

      // Award to qualifying users who don't have it
      for (const discordId of qualifyingDiscordIds) {
        const member = membersWithoutChef.find((m) => m.user.id === discordId);
        if (member) {
          const currentRoles = [...member.roles, chefRoleId];
          await axios.patch(
            `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}`,
            { roles: currentRoles },
            { headers: { Authorization: `Bot ${this.botToken}`, 'Content-Type': 'application/json' } },
          );
          this.logger.log(`[chef] Awarded Open Source Chef to ${discordId}`);
          awarded++;
        }
      }

      // Remove from non-qualifying users who have it
      for (const member of membersWithChef) {
        if (!qualifyingDiscordIds.has(member.user.id)) {
          const currentRoles = member.roles.filter((r: string) => r !== chefRoleId);
          await axios.patch(
            `https://discord.com/api/v10/guilds/${guildId}/members/${member.user.id}`,
            { roles: currentRoles },
            { headers: { Authorization: `Bot ${this.botToken}`, 'Content-Type': 'application/json' } },
          );
          this.logger.log(`[chef] Removed Open Source Chef from ${member.user.id}`);
          removed++;
        }
      }

      this.logger.log(`[chef] Weekly check complete: ${awarded} awarded, ${removed} removed, ${qualifyingDiscordIds.size} qualifying`);
      return { awarded, removed };
    } catch (err) {
      this.logger.warn(`[chef] Failed weekly check: ${err?.response?.status ?? err.message}`);
      return { awarded: 0, removed: 0 };
    }
  }

  private async fetchRoleIdByName(roleName: string): Promise<string | null> {
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!guildId || !this.botToken) return null;

    try {
      const res = await axios.get(`https://discord.com/api/v10/guilds/${guildId}/roles`, {
        headers: { Authorization: `Bot ${this.botToken}` },
      });
      const role = res.data.find((r: any) => r.name === roleName);
      return role?.id ?? null;
    } catch (err) {
      this.logger.warn(`[roles] Failed to fetch roles: ${err}`);
      return null;
    }
  }
}
