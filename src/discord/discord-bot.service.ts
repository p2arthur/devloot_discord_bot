/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-misused-promises */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  Events,
  Interaction,
  EmbedBuilder,
  Colors,
  MessageFlags,
  Message,
  PermissionFlagsBits,
} from 'discord.js';
import { PrismaService } from '../prisma/prisma.service';
import { DiscordService } from './discord.service';
import { ProposeCommand } from './commands/propose';
import { DailyCommand } from './commands/daily';
import { RankCommand } from './commands/rank';
import { QuestCommand, QUEST_POOL } from './commands/quest';
import { ProposalsCommand } from './commands/proposals';
import { OnboardingCommand } from './commands/onboarding';
import { LeaderboardCommand } from './commands/leaderboard';

const COMMANDS_REQUIRING_ONBOARDING = ['propose', 'daily', 'rank', 'quests', 'proposals', 'leaderboard', 'sync-points'];

@Injectable()
export class DiscordBotService implements OnModuleInit {
  private readonly logger = new Logger(DiscordBotService.name);
  private readonly client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions,
    ],
  });

  constructor(
    private prisma: PrismaService,
    private discordService: DiscordService,
    private propose: ProposeCommand,
    private daily: DailyCommand,
    private rank: RankCommand,
    private quest: QuestCommand,
    private proposals: ProposalsCommand,
    private onboarding: OnboardingCommand,
    private leaderboard: LeaderboardCommand,
  ) {}

  async onModuleInit() {
    const token = process.env.DISCORD_BOT_TOKEN;
    const clientId = process.env.DISCORD_CLIENT_ID;
    const guildId = process.env.DISCORD_GUILD_ID;

    this.logger.log(
      `Config check — token: ${token ? 'set' : 'MISSING'}, clientId: ${clientId ?? 'MISSING'}, guildId: ${guildId ?? 'MISSING (will use global)'}`,
    );
    this.logger.log(
      `Env — ROLE_NEWCOMER: ${process.env.ROLE_NEWCOMER ? 'set' : 'MISSING'}, ROLE_BUILDER: ${process.env.ROLE_BUILDER ? 'set' : 'MISSING'}, ROLE_HUNTER: ${process.env.ROLE_HUNTER ? 'set' : 'MISSING'}, ROLE_LEGEND: ${process.env.ROLE_LEGEND ? 'set' : 'MISSING'}`,
    );
    this.logger.log(
      `Env — CHANNEL_ID: ${process.env.DISCORD_BOUNTY_FEED_CHANNEL ?? 'MISSING'}, WELCOME_CHANNEL: ${process.env.DISCORD_WELCOME_CHANNEL ?? 'MISSING'}, ONBOARDED_ROLE_ID: ${process.env.DISCORD_ONBOARDED_ROLE_ID ?? 'MISSING'}, SCOUT_ROLE_ID: ${process.env.DISCORD_SCOUT_ROLE_ID ?? 'MISSING'}, SUGGESTIONS_CHANNEL_ID: ${process.env.DISCORD_BOUNTY_SUGGESTIONS_CHANNEL_ID ?? 'MISSING'}`,
    );

    if (!token || !clientId) {
      this.logger.warn('DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID not set — bot is DISABLED');
      return;
    }

    const commandDefs = [
      { name: 'propose', desc: 'Suggest a GitHub issue for a bounty' },
      { name: 'daily', desc: 'Claim your daily XP' },
      { name: 'rank', desc: 'View your XP rank and progress' },
      { name: 'quests', desc: 'View your daily quests' },
      { name: 'proposals', desc: 'View recent proposals this week' },
      { name: 'onboarding', desc: 'Get started with DevLoot' },
      { name: 'leaderboard', desc: 'View the XP leaderboard' },
      { name: 'sync-points', desc: 'Sync XP from bounty activity' },
      { name: 'setup-server', desc: 'Set up DevLoot server structure (admin only)' },
      { name: 'check-chef', desc: 'Manually trigger weekly Open Source Chef check (admin)' },
    ];

    const commands = [
      new SlashCommandBuilder()
        .setName('propose')
        .setDescription('Suggest a GitHub issue for a bounty')
        .addStringOption((o) => o.setName('message').setDescription('Why this issue should have a bounty').setRequired(true))
        .addStringOption((o) => o.setName('issue_url').setDescription('GitHub issue URL').setRequired(true))
        .addNumberOption((o) =>
          o.setName('bounty_amount').setDescription('Suggested bounty amount in USDC').setRequired(true).setMinValue(1),
        ),
      new SlashCommandBuilder().setName('daily').setDescription('Claim your daily XP'),
      new SlashCommandBuilder().setName('rank').setDescription('View your XP rank and progress'),
      new SlashCommandBuilder().setName('quests').setDescription('View your daily quests'),
      new SlashCommandBuilder().setName('proposals').setDescription('View recent proposals this week'),
      new SlashCommandBuilder().setName('onboarding').setDescription('Get started with DevLoot'),
      new SlashCommandBuilder().setName('leaderboard').setDescription('View the XP leaderboard'),
      new SlashCommandBuilder().setName('sync-points').setDescription('Sync XP from bounty activity'),
      new SlashCommandBuilder()
        .setName('setup-server')
        .setDescription('Set up DevLoot server structure (admin only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
      new SlashCommandBuilder()
        .setName('check-chef')
        .setDescription('Manually trigger weekly Open Source Chef check')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    ].map((c) => c.toJSON());

    this.logger.log(`Registering ${commands.length} slash commands: ${commandDefs.map((c) => `/${c.name}`).join(', ')}`);

    const rest = new REST().setToken(token);

    try {
      if (guildId) {
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
        this.logger.log(`Slash commands registered for guild ${guildId}`);
      } else {
        await rest.put(Routes.applicationCommands(clientId), { body: commands });
        this.logger.log('Slash commands registered globally (may take up to 1 hour)');
      }
    } catch (err) {
      this.logger.error(`Failed to register slash commands: ${err}`);
      return;
    }

    // Handle all interactions (commands + buttons)
    this.client.on(Events.InteractionCreate, (interaction) => void this.handleInteraction(interaction));
    this.logger.log('InteractionCreate handler registered');

    // Auto-complete bounty proposal quest when user posts in #bounty-proposal
    this.client.on(Events.MessageCreate, (message) => void this.handleMessage(message));
    this.logger.log('MessageCreate handler registered');

    // Handle reactions on proposal messages
    this.client.on(Events.MessageReactionAdd, (reaction, user) => void this.handleReactionAdd(reaction, user));
    this.logger.log('MessageReactionAdd handler registered');

    // Welcome new members and prompt onboarding
    this.client.on(Events.GuildMemberAdd, (member) => void this.handleNewMember(member));
    this.logger.log('GuildMemberAdd handler registered');

    // Post onboarding message in system channel on ready
    this.client.on('clientReady', async () => {
      this.logger.log(`Discord bot CONNECTED as ${this.client.user?.tag} (ID: ${this.client.user?.id})`);
      this.logger.log(`Bot is in ${this.client.guilds.cache.size} guild(s)`);
      for (const [id, guild] of this.client.guilds.cache) {
        this.logger.log(`  Guild: ${guild.name} (ID: ${id}, members: ${guild.memberCount})`);
      }
      await this.setupVerifyChannel();

      // Weekly Open Source Chef check — every Monday at 00:00 UTC
      setInterval(() => {
        const now = new Date();
        if (now.getUTCDay() === 1 && now.getUTCHours() === 0 && now.getUTCMinutes() === 0) {
          this.logger.log('[cron] Running weekly Open Source Chef check');
          void this.discordService.checkWeeklyChef();
        }
      }, 60_000); // Check every minute
    });

    this.client.on('error', (err) => {
      this.logger.error(`Discord client error: ${err.message}`);
    });

    this.client.on('warn', (warning) => {
      this.logger.warn(`Discord client warning: ${warning}`);
    });

    this.client.on('shardDisconnect', (event, shardId) => {
      this.logger.warn(`Shard ${shardId} disconnected (code: ${event.code})`);
    });

    this.client.on('shardReconnecting', (shardId) => {
      this.logger.log(`Shard ${shardId} reconnecting...`);
    });

    this.client.on('shardResume', (shardId, replayedEvents) => {
      this.logger.log(`Shard ${shardId} resumed, replayed ${replayedEvents} events`);
    });

    this.logger.log('Calling client.login()...');
    try {
      await this.client.login(token);
      this.logger.log('client.login() resolved — waiting for clientReady event...');
    } catch (err) {
      this.logger.error(`client.login() FAILED: ${err}`);
    }
  }

  private async handleInteraction(interaction: Interaction) {
    if (interaction.isChatInputCommand()) {
      const cmd = interaction as any;
      this.logger.log(`[/] /${cmd.commandName} by ${cmd.user.tag} (${cmd.user.id}) in ${cmd.guild?.name ?? 'DM'}`);
      await this.handleCommand(interaction);
    } else if (interaction.isButton()) {
      const btn = interaction as any;
      this.logger.log(`[btn] ${btn.customId} by ${btn.user.tag} (${btn.user.id})`);
      await this.handleButton(interaction);
    } else if (interaction.isModalSubmit()) {
      this.logger.log(`[modal] ${(interaction as any).customId} by ${(interaction as any).user.tag}`);
    } else {
      this.logger.debug(`[interaction] Unhandled type: ${interaction.type}`);
    }
  }

  private async handleCommand(interaction: any) {
    const name = interaction.commandName as string;
    const discordId = interaction.user.id as string;

    // Onboarding check — only /onboarding is allowed without being onboarded
    if (name !== 'onboarding' && COMMANDS_REQUIRING_ONBOARDING.includes(name)) {
      const isOnboarded = await this.checkOnboarded(discordId);
      if (!isOnboarded) {
        this.logger.log(`[/] /${name} blocked — user ${discordId} not onboarded`);
        const message = this.onboarding.buildOnboardingMessage(discordId);
        await interaction.reply({
          content: 'You need to complete onboarding first!',
          ...message,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    try {
      switch (name) {
        case 'propose': {
          const message = interaction.options.getString('message', true);
          const issueUrl = interaction.options.getString('issue_url', true);
          const bountyAmount = interaction.options.getNumber('bounty_amount', true);
          this.logger.log(`[/propose] ${discordId} proposing ${issueUrl} for ${bountyAmount} USDC`);
          await this.propose.handle(interaction, message, issueUrl, bountyAmount, this.client);
          await this.quest.autoCompleteQuest(discordId, 'bounty_proposal');
          break;
        }
        case 'daily':
          this.logger.log(`[/daily] ${discordId} claiming daily`);
          await this.daily.handle(interaction);
          break;
        case 'rank':
          this.logger.log(`[/rank] ${discordId} checking rank`);
          await this.rank.handle(interaction);
          break;
        case 'quests':
          this.logger.log(`[/quests] ${discordId} viewing quests`);
          await this.quest.handle(interaction);
          break;
        case 'proposals':
          this.logger.log(`[/proposals] ${discordId} viewing proposals`);
          await this.proposals.handle(interaction);
          break;
        case 'onboarding':
          this.logger.log(`[/onboarding] ${discordId} starting onboarding`);
          await this.onboarding.handle(interaction);
          break;
        case 'leaderboard':
          this.logger.log(`[/leaderboard] ${discordId} viewing leaderboard`);
          await this.leaderboard.handle(interaction);
          break;
        case 'sync-points': {
          this.logger.log(`[/sync-points] ${discordId} triggering XP sync`);
          await this.handleSyncPoints(interaction);
          break;
        }
        case 'setup-server':
          this.logger.log(`[/setup-server] ${interaction.user.tag} (${discordId}) triggering setup`);
          await this.handleSetupServer(interaction);
          break;
        case 'check-chef':
          this.logger.log(`[/check-chef] ${discordId} triggering chef check`);
          await this.handleCheckChef(interaction);
          break;
        default:
          this.logger.warn(`Unknown command: ${name}`);
      }
      this.logger.log(`[/] /${name} completed for ${discordId}`);
    } catch (err) {
      this.logger.error(`[/] /${name} FAILED for ${discordId}: ${err}`);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'Something went wrong.', flags: MessageFlags.Ephemeral });
      } else if (interaction.deferred) {
        await interaction.editReply({ content: 'Something went wrong.' });
      }
    }
  }

  private async handleButton(interaction: any) {
    if (interaction.customId === 'onboarding-verify') {
      this.logger.log(`[btn] onboarding-verify from ${interaction.user.tag}`);
      await this.handleVerify(interaction);
    } else {
      this.logger.warn(`[btn] Unhandled button: ${interaction.customId}`);
    }
  }

  private async handleVerify(interaction: any) {
    const discordId = interaction.user.id;
    const userTag = interaction.user.tag;

    this.logger.log(`[verify] ===== VERIFY FLOW START for ${userTag} (${discordId}) =====`);

    // Check if user already onboarded
    const existing = await this.prisma.user.findUnique({ where: { discordId } });

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
      this.logger.log(`[verify] ${discordId} already onboarded — syncing roles anyway`);

      // Re-sync tier role and ensure Verified role is assigned
      await this.discordService.syncTierRole(discordId, existing.xp);

      const verifiedRoleId = await this.fetchRoleIdByName('Verified');
      if (verifiedRoleId && interaction.guild) {
        try {
          const member = await interaction.guild.members.fetch(discordId);
          if (!member.roles.cache.has(verifiedRoleId)) {
            await member.roles.add(verifiedRoleId);
            this.logger.log(`[verify] Re-assigned missing Verified role ${verifiedRoleId} to ${discordId}`);
          }
        } catch (err) {
          this.logger.warn(`[verify] Failed to sync Verified role: ${err}`);
        }
      }

      await interaction.reply({ content: 'You are already verified! Roles synced.', flags: MessageFlags.Ephemeral });
      return;
    }

    // Check if user has a linked GitHub account
    if (!existing || !existing.githubId) {
      this.logger.warn(
        `[verify] BLOCKED: ${discordId} (${userTag}) has no linked GitHub — ` +
          `user record exists: ${!!existing}, ` +
          `githubId present: ${!!existing?.githubId}, ` +
          `githubAccessToken present: ${!!existing?.githubAccessToken}. ` +
          `User must complete GitHub OAuth at /connect?discord_id=${discordId}`,
      );

      // Also check if ANY user has this discordId (debug duplicate records)
      const allWithDiscordId = await this.prisma.user.findMany({ where: { discordId } });
      if (allWithDiscordId.length > 1) {
        this.logger.warn(
          `[verify] DATA ISSUE: Found ${allWithDiscordId.length} user records with discordId=${discordId}: ` +
            allWithDiscordId.map((u) => `id=${u.id},githubId=${u.githubId ?? 'null'}`).join(' | '),
        );
      }

      await interaction.reply({
        content: 'No GitHub account linked yet. Click **Link GitHub** first, sign in with GitHub, then come back and click **Verify**.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Mark as onboarded and award 100 XP welcome bonus
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
      this.logger.log(`[verify] Awarded 100 XP bonus to ${discordId} — total ${updatedUser.xp} XP`);
    }

    // Assign Verified role
    const verifiedRoleId = await this.fetchRoleIdByName('Verified');
    if (verifiedRoleId && interaction.guild) {
      try {
        const member = await interaction.guild.members.fetch(discordId);
        await member.roles.add(verifiedRoleId);
        this.logger.log(`[verify] Assigned Verified role ${verifiedRoleId} to ${discordId}`);
      } catch (err) {
        this.logger.warn(`[verify] Failed to assign Verified role: ${err}`);
      }
    }

    // Sync tier role
    this.logger.log(`[verify] Syncing tier role for ${discordId} (XP: ${updatedUser.xp})`);
    await this.discordService.syncTierRole(discordId, updatedUser.xp);

    // Post welcome in general channel
    try {
      const generalChannelId = await this.fetchChannelIdByName('⚡-general');
      if (generalChannelId) {
        const channel = await interaction.guild?.channels.fetch(generalChannelId);
        if (channel && 'send' in channel) {
          await channel.send(`Welcome <@${discordId}> to DevLoot! 🎉`);
          this.logger.log(`[verify] Posted welcome in general for ${discordId}`);
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
          '- `/quests` — View today\'s quests\n' +
          '- `/leaderboard` — See who\'s on top\n' +
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

  private async fetchRoleIdByName(roleName: string): Promise<string | null> {
    const guildId = process.env.DISCORD_GUILD_ID;
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!guildId || !token) return null;

    try {
      const res = await axios.get(`https://discord.com/api/v10/guilds/${guildId}/roles`, { headers: { Authorization: `Bot ${token}` } });
      const role = res.data.find((r: any) => r.name === roleName);
      return role?.id ?? null;
    } catch (err) {
      this.logger.warn(`[roles] Failed to fetch roles: ${err}`);
      return null;
    }
  }

  private async fetchChannelIdByName(channelName: string): Promise<string | null> {
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!guildId) return null;

    try {
      const guild = await this.client.guilds.fetch(guildId);
      const channels = await guild.channels.fetch();
      const channel = channels.find((c: any) => c?.name === channelName);
      return channel?.id ?? null;
    } catch (err) {
      this.logger.warn(`[channels] Failed to find channel ${channelName}: ${err}`);
      return null;
    }
  }

  private async checkOnboarded(discordId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { discordId } });
    return !!(user?.onboarded && user?.githubId);
  }

  private async handleSyncPoints(interaction: any) {
    await interaction.deferReply({ ephemeral: true });

    // Count bounties created per wallet
    const createdBounties = await this.prisma.bounty.groupBy({
      by: ['creatorWallet'],
      _count: { id: true },
    });

    // Count bounties claimed per winner
    const claimedBounties = await this.prisma.bounty.groupBy({
      by: ['winnerId'],
      where: { status: 'CLAIMED', winnerId: { not: null } },
      _count: { id: true },
    });

    let usersUpdated = 0;
    let totalXpAwarded = 0;

    // Award XP for created bounties
    for (const group of createdBounties) {
      const user = await this.prisma.user.findFirst({ where: { wallet: group.creatorWallet } });
      if (!user) continue;

      const xpFromCreations = group._count.id * 100;
      await this.discordService
        .addXpByUserId(user.id, xpFromCreations)
        .catch((err) => this.logger.warn(`[sync-points] Failed to award creation XP to user#${user.id}: ${err}`));
      usersUpdated++;
      totalXpAwarded += xpFromCreations;
    }

    // Award XP for claimed bounties
    for (const group of claimedBounties) {
      if (!group.winnerId) continue;
      const xpFromClaims = group._count.id * 200;
      await this.discordService
        .addXpByUserId(group.winnerId, xpFromClaims)
        .catch((err) => this.logger.warn(`[sync-points] Failed to award claim XP to user#${group.winnerId}: ${err}`));
      usersUpdated++;
      totalXpAwarded += xpFromClaims;
    }

    await interaction.editReply(
      `Sync complete!\n` +
        `• **${usersUpdated}** users updated\n` +
        `• **${totalXpAwarded}** total XP awarded\n` +
        `• ${createdBounties.length} creators, ${claimedBounties.length} claimers processed`,
    );

    this.logger.log(`[sync-points] Synced ${usersUpdated} users, ${totalXpAwarded} XP awarded`);
  }

  private async handleReactionAdd(reaction: any, user: any) {
    if (user.bot) return;

    // Fetch partials if needed
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch {
        return;
      }
    }

    const emoji = reaction.emoji.name;
    const messageId = reaction.message.id;
    const discordId = user.id;

    // Only handle 👍, 👎, 💵
    if (!['👍', '👎', '💵'].includes(emoji)) return;

    // Look up proposal by message ID
    const proposal = await this.prisma.proposal.findFirst({ where: { messageId } });
    if (!proposal) return;

    this.logger.log(`[reaction] ${discordId} reacted ${emoji} on proposal ${proposal.id} (msg ${messageId})`);

    // 💵 is just a signal — don't process as a vote
    if (emoji === '💵') {
      this.logger.log(`[reaction] ${discordId} signaled topup interest on proposal ${proposal.id}`);
      return;
    }

    const isUpvote = emoji === '👍';

    // Don't allow voting on own proposals
    if (proposal.proposerId === discordId) {
      this.logger.log(`[reaction] ${discordId} tried to vote on own proposal ${proposal.id} — skipped`);
      return;
    }

    // Check existing vote
    const existingVote = await this.prisma.proposalVote.findUnique({
      where: { proposalId_userId: { proposalId: proposal.id, userId: discordId } },
    });

    if (existingVote) {
      // Toggle off if same vote
      if ((isUpvote && existingVote.value === 1) || (!isUpvote && existingVote.value === -1)) {
        await this.prisma.proposalVote.delete({ where: { id: existingVote.id } });
        await this.prisma.proposal.update({
          where: { id: proposal.id },
          data: { upvotes: { decrement: isUpvote ? 1 : 0 } },
        });
        this.logger.log(`[vote] ${discordId} removed vote on proposal ${proposal.id}`);
        return;
      }

      // Switch vote
      await this.prisma.proposalVote.update({
        where: { id: existingVote.id },
        data: { value: isUpvote ? 1 : -1 },
      });
      this.logger.log(`[vote] ${discordId} switched vote on proposal ${proposal.id}`);
    } else {
      // New vote
      await this.prisma.proposalVote.create({
        data: { proposalId: proposal.id, userId: discordId, value: isUpvote ? 1 : -1 },
      });
      this.logger.log(`[vote] ${discordId} new vote on proposal ${proposal.id}`);
    }

    // Update upvote count
    if (isUpvote) {
      await this.prisma.proposal.update({
        where: { id: proposal.id },
        data: { upvotes: { increment: existingVote?.value === -1 ? 2 : 1 } },
      });
    } else {
      await this.prisma.proposal.update({
        where: { id: proposal.id },
        data: { upvotes: { decrement: existingVote?.value === 1 ? 2 : 1 } },
      });
    }

    await this.discordService.addVoteXp(discordId);
  }

  private async handleMessage(message: Message) {
    if (message.author.bot) return;

    // Enforce bot-only in the bounty feed channel
    const bountyFeedChannelId = process.env.DISCORD_BOUNTY_FEED_CHANNEL;
    if (bountyFeedChannelId && message.channelId === bountyFeedChannelId) {
      this.logger.log(`[msg] Deleting message from ${message.author.tag} in bounty feed channel (bot-only)`);
      try {
        await message.delete();
        const warning = await (message.channel as any).send(
          `${message.author}, this channel is bot-only. Use \`/propose\` in the suggestions channel instead.`,
        );
        setTimeout(() => void warning.delete().catch(() => {}), 5000);
      } catch (err) {
        this.logger.warn(`[msg] Failed to delete message in bounty feed channel — missing Manage Messages permission? ${err}`);
      }
      return;
    }

    // Enforce /propose-only in the bounty suggestions channel
    const suggestionsChannelId = process.env.DISCORD_BOUNTY_SUGGESTIONS_CHANNEL_ID;
    if (suggestionsChannelId && message.channelId === suggestionsChannelId) {
      this.logger.log(`[msg] Deleting message from ${message.author.tag} in suggestions channel (only /propose allowed)`);
      try {
        await message.delete();
        const warning = await (message.channel as any).send(`${message.author}, use \`/propose\` to post in this channel.`);
        setTimeout(() => void warning.delete().catch(() => {}), 5000);
      } catch (err) {
        this.logger.warn(`[msg] Failed to delete message in suggestions channel — missing Manage Messages permission? ${err}`);
      }
      return;
    }

    // Enforce /propose-only in #💡-proposals channel (delete raw messages, keep bot embeds)
    const proposalsChannelId = await this.fetchChannelIdByName('💡-proposals');
    if (proposalsChannelId && message.channelId === proposalsChannelId) {
      this.logger.log(`[msg] Deleting message from ${message.author.tag} in proposals channel`);
      try {
        await message.delete();
        const warning = await (message.channel as any).send(`${message.author}, use \`/propose\` to post in this channel.`);
        setTimeout(() => void warning.delete().catch(() => {}), 5000);
      } catch (err) {
        this.logger.warn(`[msg] Failed to delete message in proposals channel: ${err}`);
      }
      return;
    }

    // Check if message is in a quest-relevant channel
    for (const quest of QUEST_POOL) {
      if (quest.channelId && message.channelId === quest.channelId) {
        this.logger.log(`[msg] ${message.author.tag} posted in quest channel ${quest.id}`);
        await this.quest.autoCompleteQuest(message.author.id, quest.id);
      }
    }
  }

  private async handleNewMember(member: any) {
    this.logger.log(`[member] New member joined: ${member.user.tag} (${member.user.id})`);

    // Onboarding is handled by Discord channel permissions (@everyone has no ViewChannel
    // on Community/Bounty categories). The onboarding embed in #🔓-verify handles the rest.

    try {
      const verifiedRoleId = await this.fetchRoleIdByName('Verified');
      this.logger.log(`[member] ${member.user.tag} joined — Verified role ID: ${verifiedRoleId ?? 'not found (run /setup-server)'}`);
    } catch (err) {
      this.logger.debug(`[member] Could not log role info: ${err}`);
    }
  }

  private async setupVerifyChannel() {
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!guildId) {
      this.logger.warn('[welcome] DISCORD_GUILD_ID not set — skipping verify channel setup');
      return;
    }

    try {
      const guild = await this.client.guilds.fetch(guildId);
      const channels = await guild.channels.fetch();

      // Find the #🔓-verify channel by name
      const verifyChannel = channels.find((c: any) => c?.name === '🔓-verify');
      if (!verifyChannel || !('send' in verifyChannel)) {
        this.logger.log('[welcome] #🔓-verify channel not found — skipping (run /setup-server first)');
        return;
      }

      // Check if we already posted the onboarding message
      const messages = await verifyChannel.messages.fetch({ limit: 20 });
      const existingBot = messages.find((m) => m.author.id === this.client.user?.id && m.embeds[0]?.title === 'Welcome to DevLoot');

      if (existingBot) {
        this.logger.log('[welcome] Onboarding message already exists in #🔓-verify');
        return;
      }

      const message = this.onboarding.buildOnboardingMessage();
      await verifyChannel.send(message);
      this.logger.log('[welcome] Posted onboarding message to #🔓-verify');
    } catch (err) {
      this.logger.warn(`[welcome] Could not setup verify channel: ${err}`);
    }
  }

  private async handleSetupServer(interaction: any) {
    if (!interaction.memberPermissions?.has('Administrator')) {
      await interaction.reply({ content: 'Only server admins can run this command.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;
    if (!guild) {
      await interaction.editReply('This command must be run in a server.');
      return;
    }

    const results: string[] = [];

    // Step 1: Create roles
    const roles = [
      { name: 'Verified', color: 0x2ecc71, hoist: true },
      { name: 'Open Source Chef', color: 0xf39c12, hoist: true },
    ];

    const createdRoles: Record<string, string> = {};
    for (const roleDef of roles) {
      try {
        const existing = guild.roles.cache.find((r) => r.name === roleDef.name);
        if (existing) {
          createdRoles[roleDef.name] = existing.id;
          results.push(`Role **${roleDef.name}** already exists (${existing.id})`);
        } else {
          const role = await guild.roles.create({
            name: roleDef.name,
            color: roleDef.color,
            hoist: roleDef.hoist,
            reason: 'DevLoot server setup',
          });
          createdRoles[roleDef.name] = role.id;
          results.push(`Created role **${roleDef.name}** (${role.id})`);
        }
      } catch (err) {
        results.push(`Failed to create role ${roleDef.name}: ${err}`);
      }
    }

    // Step 2: Create categories with permission overwrites
    const everyoneId = guild.id;
    const verifiedId = createdRoles['Verified'];

    const categories = [
      {
        name: '🚪 ONBOARDING',
        permissionOverwrites: [
          { id: everyoneId, allow: ['ViewChannel'], deny: ['SendMessages'] },
          { id: verifiedId, allow: ['ViewChannel', 'SendMessages'] },
        ],
      },
      {
        name: '🌍 COMMUNITY',
        permissionOverwrites: [
          { id: everyoneId, deny: ['ViewChannel'] },
          { id: verifiedId, allow: ['ViewChannel'] },
        ],
      },
      {
        name: '🎯 BOUNTIES',
        permissionOverwrites: [
          { id: everyoneId, deny: ['ViewChannel'] },
          { id: verifiedId, allow: ['ViewChannel'] },
        ],
      },
    ];

    const createdCategories: Record<string, string> = {};
    for (const catDef of categories) {
      try {
        const existing = guild.channels.cache.find(
          (c) => c?.name === catDef.name && c.type === 4, // CategoryChannel
        );
        if (existing) {
          createdCategories[catDef.name] = existing.id;
          results.push(`Category **${catDef.name}** already exists`);
        } else {
          const cat = await guild.channels.create({
            name: catDef.name,
            type: 4, // CategoryChannel
            permissionOverwrites: catDef.permissionOverwrites.map((p) => ({
              id: p.id,
              allow: p.allow,
              deny: p.deny,
            })),
          });
          createdCategories[catDef.name] = cat.id;
          results.push(`Created category **${catDef.name}**`);
        }
      } catch (err) {
        results.push(`Failed to create category ${catDef.name}: ${err}`);
      }
    }

    // Step 3: Create channels
    const channels = [
      {
        name: '🔓-verify',
        topic: 'Link your GitHub and verify to unlock the full server. devloot.xyz/connect',
        parent: createdCategories['🚪 ONBOARDING'],
        permissions: [{ id: everyoneId, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] }],
      },
      {
        name: '⚖️-rules',
        topic: 'Read before engaging. Respect the community, respect the code.',
        parent: createdCategories['🚪 ONBOARDING'],
        permissions: [{ id: everyoneId, allow: ['ViewChannel', 'ReadMessageHistory'], deny: ['SendMessages'] }],
      },
      {
        name: '📢-announcement',
        topic: 'Platform updates, bounty highlights, and community news. devloot.xyz',
        parent: createdCategories['🚪 ONBOARDING'],
        permissions: [{ id: everyoneId, allow: ['ViewChannel', 'ReadMessageHistory'], deny: ['SendMessages'] }],
      },
      {
        name: '⚡-general',
        topic: 'Talk open source, bounties, dev tools, or whatever. Builders+ can chat.',
        parent: createdCategories['🌍 COMMUNITY'],
        permissions: [
          { id: everyoneId, deny: ['ViewChannel'] },
          { id: verifiedId, allow: ['ViewChannel'] },
        ],
      },
      {
        name: '💡-proposals',
        topic: 'Suggest open source issues worth funding. Use /propose — raw messages get cleaned up.',
        parent: createdCategories['🌍 COMMUNITY'],
        permissions: [
          { id: everyoneId, deny: ['ViewChannel'] },
          { id: verifiedId, allow: ['ViewChannel', 'SendMessages'] },
        ],
      },
      {
        name: '💰-feed',
        topic: 'Live bounty feed — new bounties, claims, and payouts as they happen. devloot.xyz',
        parent: createdCategories['🎯 BOUNTIES'],
        permissions: [
          { id: everyoneId, deny: ['ViewChannel'] },
          { id: verifiedId, allow: ['ViewChannel', 'ReadMessageHistory'] },
        ],
      },
    ];

    for (const chDef of channels) {
      try {
        const existing = guild.channels.cache.find((c) => c?.name === chDef.name);
        if (existing) {
          // Update topic on existing channels
          if ('topic' in existing && existing.topic !== chDef.topic) {
            await existing.edit({ topic: chDef.topic });
            results.push(`Updated topic on **#${chDef.name}**`);
          } else {
            results.push(`Channel **#${chDef.name}** already exists`);
          }
        } else {
          const ch = await guild.channels.create({
            name: chDef.name,
            type: 0, // TextChannel
            topic: chDef.topic,
            parent: chDef.parent,
            permissionOverwrites: chDef.permissions.map((p) => ({
              id: p.id,
              allow: p.allow || [],
              deny: p.deny || [],
            })),
          });
          results.push(`Created channel **#${chDef.name}**`);
        }
      } catch (err) {
        results.push(`Failed to create channel #${chDef.name}: ${err}`);
      }
    }

    // Step 4: Post onboarding embed in #🔓-verify
    try {
      const verifyChannel = guild.channels.cache.find((c) => c?.name === '🔓-verify');
      if (verifyChannel && 'send' in verifyChannel) {
        const messages = await verifyChannel.messages.fetch({ limit: 20 });
        const existingEmbed = messages.find((m) => m.author.id === this.client.user?.id && m.embeds[0]?.title === 'Welcome to DevLoot');
        if (!existingEmbed) {
          const message = this.onboarding.buildOnboardingMessage();
          await verifyChannel.send(message);
          results.push('Posted onboarding embed in #🔓-verify');
        } else {
          results.push('Onboarding embed already exists in #🔓-verify');
        }
      }
    } catch (err) {
      results.push(`Failed to post onboarding embed: ${err}`);
    }

    const embed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle('Server Setup Complete')
      .setDescription(
        results.map((r) => `• ${r}`).join('\n') +
          '\n\n**Important:** Make sure the bot role is at the TOP of the role hierarchy in Server Settings > Roles.',
      );

    await interaction.editReply({ embeds: [embed] });
    this.logger.log(`[setup-server] Completed by ${interaction.user.tag}: ${results.length} items`);
  }

  private async handleCheckChef(interaction: any) {
    if (!interaction.memberPermissions?.has('Administrator')) {
      await interaction.reply({ content: 'Only server admins can run this command.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const result = await this.discordService.checkWeeklyChef();

    await interaction.editReply(
      `Open Source Chef check complete:\n` +
        `• **${result.awarded}** users awarded\n` +
        `• **${result.removed}** users removed\n` +
        `Based on bounty activity in the last 7 days.`,
    );
  }
}
