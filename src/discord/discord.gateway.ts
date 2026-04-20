/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-misused-promises */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
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
import { DiscordXpService } from './services/discord-xp.service';
import { DiscordRoleService } from './services/discord-role.service';
import { DiscordGuildService } from './services/discord-guild.service';
import { DiscordSetupService } from './handlers/discord-setup.service';
import { DiscordVerifyService } from './handlers/discord-verify.service';
import { ProposeCommand } from './commands/propose';
import { DailyCommand } from './commands/daily';
import { RankCommand } from './commands/rank';
import { QuestCommand, QUEST_POOL } from './commands/quest';
import { ProposalsCommand } from './commands/proposals';
import { OnboardingCommand } from './commands/onboarding';
import { LeaderboardCommand } from './commands/leaderboard';

const COMMANDS_REQUIRING_ONBOARDING = [
  'propose',
  'daily',
  'rank',
  'quests',
  'proposals',
  'leaderboard',
  'sync-points',
];

@Injectable()
export class DiscordGateway implements OnModuleInit {
  private readonly logger = new Logger(DiscordGateway.name);
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
    private xpService: DiscordXpService,
    private roleService: DiscordRoleService,
    private guildService: DiscordGuildService,
    private setupService: DiscordSetupService,
    private verifyService: DiscordVerifyService,
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
      this.logger.warn(
        'DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID not set — bot is DISABLED',
      );
      return;
    }

    const commands = [
      new SlashCommandBuilder()
        .setName('propose')
        .setDescription('Suggest a GitHub issue for a bounty')
        .addStringOption((o) =>
          o
            .setName('message')
            .setDescription('Why this issue should have a bounty')
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('issue_url')
            .setDescription('GitHub issue URL')
            .setRequired(true),
        )
        .addNumberOption((o) =>
          o
            .setName('bounty_amount')
            .setDescription('Suggested bounty amount in USDC')
            .setRequired(true)
            .setMinValue(1),
        ),
      new SlashCommandBuilder()
        .setName('daily')
        .setDescription('Claim your daily XP'),
      new SlashCommandBuilder()
        .setName('rank')
        .setDescription('View your XP rank and progress'),
      new SlashCommandBuilder()
        .setName('quests')
        .setDescription('View your daily quests'),
      new SlashCommandBuilder()
        .setName('proposals')
        .setDescription('View recent proposals this week'),
      new SlashCommandBuilder()
        .setName('onboarding')
        .setDescription('Get started with DevLoot'),
      new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View the XP leaderboard'),
      new SlashCommandBuilder()
        .setName('sync-points')
        .setDescription('Sync XP from bounty activity'),
      new SlashCommandBuilder()
        .setName('setup-server')
        .setDescription('Set up DevLoot server structure (admin only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
      new SlashCommandBuilder()
        .setName('check-chef')
        .setDescription('Manually trigger weekly Open Source Chef check')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    ].map((c) => c.toJSON());

    this.logger.log(`Registering ${commands.length} slash commands`);

    const rest = new REST().setToken(token);

    try {
      if (guildId) {
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
          body: commands,
        });
        this.logger.log(`Slash commands registered for guild ${guildId}`);
      } else {
        await rest.put(Routes.applicationCommands(clientId), {
          body: commands,
        });
        this.logger.log(
          'Slash commands registered globally (may take up to 1 hour)',
        );
      }
    } catch (err) {
      this.logger.error(`Failed to register slash commands: ${err}`);
      return;
    }

    this.client.on(
      Events.InteractionCreate,
      (interaction) => void this.handleInteraction(interaction),
    );
    this.client.on(
      Events.MessageCreate,
      (message) => void this.handleMessage(message),
    );
    this.client.on(
      Events.MessageReactionAdd,
      (reaction, user) => void this.handleReactionAdd(reaction, user),
    );
    this.client.on(
      Events.GuildMemberAdd,
      (member) => void this.handleNewMember(member),
    );

    this.client.on('clientReady', async () => {
      this.guildService.setClient(this.client);

      this.logger.log(
        `Discord bot CONNECTED as ${this.client.user?.tag} (ID: ${this.client.user?.id})`,
      );
      this.logger.log(`Bot is in ${this.client.guilds.cache.size} guild(s)`);
      for (const [id, guild] of this.client.guilds.cache) {
        this.logger.log(
          `  Guild: ${guild.name} (ID: ${id}, members: ${guild.memberCount})`,
        );
      }
      await this.setupVerifyChannel();

      setInterval(() => {
        const now = new Date();
        if (
          now.getUTCDay() === 1 &&
          now.getUTCHours() === 0 &&
          now.getUTCMinutes() === 0
        ) {
          this.logger.log('[cron] Running weekly Open Source Chef check');
          void this.roleService.checkWeeklyChef();
        }
      }, 60_000);
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
      this.logger.log(
        `Shard ${shardId} resumed, replayed ${replayedEvents} events`,
      );
    });

    this.logger.log('Calling client.login()...');
    try {
      await this.client.login(token);
      this.logger.log(
        'client.login() resolved — waiting for clientReady event...',
      );
    } catch (err) {
      this.logger.error(`client.login() FAILED: ${err}`);
    }
  }

  private async handleInteraction(interaction: Interaction) {
    if (interaction.isChatInputCommand()) {
      const cmd = interaction as any;
      this.logger.log(
        `[/] /${cmd.commandName} by ${cmd.user.tag} (${cmd.user.id}) in ${cmd.guild?.name ?? 'DM'}`,
      );
      await this.handleCommand(interaction);
    } else if (interaction.isButton()) {
      const btn = interaction as any;
      this.logger.log(
        `[btn] ${btn.customId} by ${btn.user.tag} (${btn.user.id})`,
      );
      await this.handleButton(interaction);
    } else if (interaction.isModalSubmit()) {
      this.logger.log(
        `[modal] ${(interaction as any).customId} by ${(interaction as any).user.tag}`,
      );
    } else {
      this.logger.debug(`[interaction] Unhandled type: ${interaction.type}`);
    }
  }

  private async handleCommand(interaction: any) {
    const name = interaction.commandName as string;
    const discordId = interaction.user.id as string;

    if (name !== 'onboarding' && COMMANDS_REQUIRING_ONBOARDING.includes(name)) {
      const isOnboarded = await this.verifyService.checkOnboarded(discordId);
      if (!isOnboarded) {
        this.logger.log(
          `[/] /${name} blocked — user ${discordId} not onboarded`,
        );
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
          const bountyAmount = interaction.options.getNumber(
            'bounty_amount',
            true,
          );
          this.logger.log(
            `[/propose] ${discordId} proposing ${issueUrl} for ${bountyAmount} USDC`,
          );
          await this.propose.handle(
            interaction,
            message,
            issueUrl,
            bountyAmount,
            this.client,
          );
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
          this.logger.log(
            `[/setup-server] ${interaction.user.tag} (${discordId}) triggering setup`,
          );
          await this.setupService.handleSetupServer(interaction, this.client);
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
        await interaction.reply({
          content: 'Something went wrong.',
          flags: MessageFlags.Ephemeral,
        });
      } else if (interaction.deferred) {
        await interaction.editReply({ content: 'Something went wrong.' });
      }
    }
  }

  private async handleButton(interaction: any) {
    if (interaction.customId === 'onboarding-verify') {
      this.logger.log(`[btn] onboarding-verify from ${interaction.user.tag}`);
      await this.verifyService.handleVerify(interaction);
    } else {
      this.logger.warn(`[btn] Unhandled button: ${interaction.customId}`);
    }
  }

  private async handleSyncPoints(interaction: any) {
    await interaction.deferReply({ ephemeral: true });

    const createdBounties = await this.prisma.bounty.groupBy({
      by: ['creatorWallet'],
      _count: { id: true },
    });

    const claimedBounties = await this.prisma.bounty.groupBy({
      by: ['winnerId'],
      where: { status: 'CLAIMED', winnerId: { not: null } },
      _count: { id: true },
    });

    let usersUpdated = 0;
    let totalXpAwarded = 0;

    for (const group of createdBounties) {
      const user = await this.prisma.user.findFirst({
        where: { wallet: group.creatorWallet },
      });
      if (!user) continue;

      const xpFromCreations = group._count.id * 100;
      await this.xpService
        .addXpByUserId(user.id, xpFromCreations)
        .catch((err) =>
          this.logger.warn(
            `[sync-points] Failed to award creation XP to user#${user.id}: ${err}`,
          ),
        );
      usersUpdated++;
      totalXpAwarded += xpFromCreations;
    }

    for (const group of claimedBounties) {
      if (!group.winnerId) continue;
      const xpFromClaims = group._count.id * 200;
      await this.xpService
        .addXpByUserId(group.winnerId, xpFromClaims)
        .catch((err) =>
          this.logger.warn(
            `[sync-points] Failed to award claim XP to user#${group.winnerId}: ${err}`,
          ),
        );
      usersUpdated++;
      totalXpAwarded += xpFromClaims;
    }

    await interaction.editReply(
      `Sync complete!\n` +
        `• **${usersUpdated}** users updated\n` +
        `• **${totalXpAwarded}** total XP awarded\n` +
        `• ${createdBounties.length} creators, ${claimedBounties.length} claimers processed`,
    );

    this.logger.log(
      `[sync-points] Synced ${usersUpdated} users, ${totalXpAwarded} XP awarded`,
    );
  }

  private async handleReactionAdd(reaction: any, user: any) {
    if (user.bot) return;

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

    if (!['👍', '👎', '💵'].includes(emoji)) return;

    const proposal = await this.prisma.proposal.findFirst({
      where: { messageId },
    });
    if (!proposal) return;

    this.logger.log(
      `[reaction] ${discordId} reacted ${emoji} on proposal ${proposal.id} (msg ${messageId})`,
    );

    if (emoji === '💵') {
      this.logger.log(
        `[reaction] ${discordId} signaled topup interest on proposal ${proposal.id}`,
      );
      return;
    }

    const isUpvote = emoji === '👍';

    if (proposal.proposerId === discordId) {
      this.logger.log(
        `[reaction] ${discordId} tried to vote on own proposal ${proposal.id} — skipped`,
      );
      return;
    }

    const existingVote = await this.prisma.proposalVote.findUnique({
      where: {
        proposalId_userId: { proposalId: proposal.id, userId: discordId },
      },
    });

    if (existingVote) {
      if (
        (isUpvote && existingVote.value === 1) ||
        (!isUpvote && existingVote.value === -1)
      ) {
        await this.prisma.proposalVote.delete({
          where: { id: existingVote.id },
        });
        await this.prisma.proposal.update({
          where: { id: proposal.id },
          data: { upvotes: { decrement: isUpvote ? 1 : 0 } },
        });
        this.logger.log(
          `[vote] ${discordId} removed vote on proposal ${proposal.id}`,
        );
        return;
      }

      await this.prisma.proposalVote.update({
        where: { id: existingVote.id },
        data: { value: isUpvote ? 1 : -1 },
      });
      this.logger.log(
        `[vote] ${discordId} switched vote on proposal ${proposal.id}`,
      );
    } else {
      await this.prisma.proposalVote.create({
        data: {
          proposalId: proposal.id,
          userId: discordId,
          value: isUpvote ? 1 : -1,
        },
      });
      this.logger.log(
        `[vote] ${discordId} new vote on proposal ${proposal.id}`,
      );
    }

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

    await this.xpService.addVoteXp(discordId);
  }

  private async handleMessage(message: Message) {
    if (message.author.bot) return;

    const bountyFeedChannelId = process.env.DISCORD_BOUNTY_FEED_CHANNEL;
    if (bountyFeedChannelId && message.channelId === bountyFeedChannelId) {
      this.logger.log(
        `[msg] Deleting message from ${message.author.tag} in bounty feed channel (bot-only)`,
      );
      try {
        await message.delete();
        const warning = await (message.channel as any).send(
          `${message.author}, this channel is bot-only. Use \`/propose\` in the suggestions channel instead.`,
        );
        setTimeout(() => void warning.delete().catch(() => {}), 5000);
      } catch (err) {
        this.logger.warn(
          `[msg] Failed to delete message in bounty feed channel — missing Manage Messages permission? ${err}`,
        );
      }
      return;
    }

    const suggestionsChannelId =
      process.env.DISCORD_BOUNTY_SUGGESTIONS_CHANNEL_ID;
    if (suggestionsChannelId && message.channelId === suggestionsChannelId) {
      this.logger.log(
        `[msg] Deleting message from ${message.author.tag} in suggestions channel (only /propose allowed)`,
      );
      try {
        await message.delete();
        const warning = await (message.channel as any).send(
          `${message.author}, use \`/propose\` to post in this channel.`,
        );
        setTimeout(() => void warning.delete().catch(() => {}), 5000);
      } catch (err) {
        this.logger.warn(
          `[msg] Failed to delete message in suggestions channel — missing Manage Messages permission? ${err}`,
        );
      }
      return;
    }

    const proposalsChannelId =
      await this.guildService.fetchChannelIdByName('💡-proposals');
    if (proposalsChannelId && message.channelId === proposalsChannelId) {
      this.logger.log(
        `[msg] Deleting message from ${message.author.tag} in proposals channel`,
      );
      try {
        await message.delete();
        const warning = await (message.channel as any).send(
          `${message.author}, use \`/propose\` to post in this channel.`,
        );
        setTimeout(() => void warning.delete().catch(() => {}), 5000);
      } catch (err) {
        this.logger.warn(
          `[msg] Failed to delete message in proposals channel: ${err}`,
        );
      }
      return;
    }

    for (const quest of QUEST_POOL) {
      if (quest.channelId && message.channelId === quest.channelId) {
        this.logger.log(
          `[msg] ${message.author.tag} posted in quest channel ${quest.id}`,
        );
        await this.quest.autoCompleteQuest(message.author.id, quest.id);
      }
    }
  }

  private async handleNewMember(member: any) {
    this.logger.log(
      `[member] New member joined: ${member.user.tag} (${member.user.id})`,
    );

    try {
      const verifiedRoleId =
        await this.roleService.fetchRoleIdByName('Verified');
      this.logger.log(
        `[member] ${member.user.tag} joined — Verified role ID: ${verifiedRoleId ?? 'not found (run /setup-server)'}`,
      );
    } catch (err) {
      this.logger.debug(`[member] Could not log role info: ${err}`);
    }
  }

  private async setupVerifyChannel() {
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!guildId) {
      this.logger.warn(
        '[welcome] DISCORD_GUILD_ID not set — skipping verify channel setup',
      );
      return;
    }

    try {
      const guild = await this.client.guilds.fetch(guildId);
      const channels = await guild.channels.fetch();

      const verifyChannel = channels.find((c: any) => c?.name === '🔓-verify');
      if (!verifyChannel || !('send' in verifyChannel)) {
        this.logger.log(
          '[welcome] #🔓-verify channel not found — skipping (run /setup-server first)',
        );
        return;
      }

      const messages = await verifyChannel.messages.fetch({ limit: 20 });
      const existingBot = messages.find(
        (m) =>
          m.author.id === this.client.user?.id &&
          m.embeds[0]?.title === 'Welcome to DevLoot',
      );

      if (existingBot) {
        this.logger.log(
          '[welcome] Onboarding message already exists in #🔓-verify',
        );
        return;
      }

      const message = this.onboarding.buildOnboardingMessage();
      await verifyChannel.send(message);
      this.logger.log('[welcome] Posted onboarding message to #🔓-verify');
    } catch (err) {
      this.logger.warn(`[welcome] Could not setup verify channel: ${err}`);
    }
  }

  private async handleCheckChef(interaction: any) {
    if (!interaction.memberPermissions?.has('Administrator')) {
      await interaction.reply({
        content: 'Only server admins can run this command.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const result = await this.roleService.checkWeeklyChef();

    await interaction.editReply(
      `Open Source Chef check complete:\n` +
        `• **${result.awarded}** users awarded\n` +
        `• **${result.removed}** users removed\n` +
        `Based on bounty activity in the last 7 days.`,
    );
  }
}
