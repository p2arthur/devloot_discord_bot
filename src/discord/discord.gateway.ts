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
  GuildMember,
  ChatInputCommandInteraction,
  ButtonInteraction,
  MessageReaction,
  User,
  TextChannel,
} from 'discord.js';
import { PrismaService } from '../prisma/prisma.service';
import { DiscordXpService } from './services/discord-xp.service';
import { DiscordRoleService } from './services/discord-role.service';
import { DiscordGuildService } from './services/discord-guild.service';
import { DiscordSetupService } from './handlers/discord-setup.service';
import { DiscordVerifyService } from './handlers/discord-verify.service';
import { ProposalVoteService } from './services/proposal-vote.service';
import { ChannelModerationService } from './services/channel-moderation.service';
import { XpSyncService } from './services/xp-sync.service';
import { ChefSchedulerService } from './services/chef-scheduler.service';
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
    private proposalVoteService: ProposalVoteService,
    private channelModerationService: ChannelModerationService,
    private xpSyncService: XpSyncService,
    private chefSchedulerService: ChefSchedulerService,
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
            .setDescription('Short pitch for why this issue matters')
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
            .setDescription('Suggested bounty in USDC')
            .setRequired(true),
        ),
      new SlashCommandBuilder()
        .setName('daily')
        .setDescription('Claim your daily XP reward'),
      new SlashCommandBuilder()
        .setName('rank')
        .setDescription('Check your current XP and tier'),
      new SlashCommandBuilder()
        .setName('quests')
        .setDescription('View available quests'),
      new SlashCommandBuilder()
        .setName('proposals')
        .setDescription('View recent bounty proposals'),
      new SlashCommandBuilder()
        .setName('onboarding')
        .setDescription('Start the onboarding flow'),
      new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View top users by XP'),
      new SlashCommandBuilder()
        .setName('sync-points')
        .setDescription('Sync XP from bounty activity (admin only)'),
      new SlashCommandBuilder()
        .setName('setup-server')
        .setDescription('Setup server channels and roles (admin only)'),
      new SlashCommandBuilder()
        .setName('check-chef')
        .setDescription('Manually trigger Open Source Chef check (admin only)'),
    ];

    const rest = new REST().setToken(token);

    try {
      if (guildId) {
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
          body: commands.map((c) => c.toJSON()),
        });
        this.logger.log(`Registered ${commands.length} commands to guild ${guildId}`);
      } else {
        await rest.put(Routes.applicationCommands(clientId), {
          body: commands.map((c) => c.toJSON()),
        });
        this.logger.log(`Registered ${commands.length} commands globally`);
      }
    } catch (err) {
      this.logger.error(`Failed to register commands: ${err}`);
    }

    this.client.once(Events.ClientReady, async (readyClient) => {
      this.logger.log(`✅ Logged in as ${readyClient.user.tag}`);

      this.chefSchedulerService.startWeeklyChefCheck();
      await this.setupVerifyChannel();
    });

    this.client.on(Events.InteractionCreate, async (interaction: Interaction) => {
      await this.handleInteraction(interaction);
    });

    this.client.on(Events.MessageCreate, async (message: Message) => {
      await this.channelModerationService.handleMessage(message);
      await this.handleQuestChannelMessage(message);
    });

    this.client.on(Events.MessageReactionAdd, async (reaction: MessageReaction, user: User) => {
      await this.proposalVoteService.handleReactionAdd(reaction, user);
    });

    this.client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
      await this.handleNewMember(member);
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
      this.logger.log(
        `[/] /${interaction.commandName} by ${interaction.user.tag} (${interaction.user.id}) in ${interaction.guild?.name ?? 'DM'}`,
      );
      await this.handleCommand(interaction);
    } else if (interaction.isButton()) {
      this.logger.log(
        `[btn] ${interaction.customId} by ${interaction.user.tag} (${interaction.user.id})`,
      );
      await this.handleButton(interaction);
    } else if (interaction.isModalSubmit()) {
      this.logger.log(
        `[modal] ${interaction.customId} by ${interaction.user.tag}`,
      );
    } else {
      this.logger.debug(`[interaction] Unhandled type: ${interaction.type}`);
    }
  }

  private async handleCommand(interaction: ChatInputCommandInteraction) {
    const name = interaction.commandName;
    const discordId = interaction.user.id;

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

  private async handleButton(interaction: ButtonInteraction) {
    if (interaction.customId === 'onboarding-verify') {
      this.logger.log(`[btn] onboarding-verify from ${interaction.user.tag}`);
      await this.verifyService.handleVerify(interaction);
    } else {
      this.logger.warn(`[btn] Unhandled button: ${interaction.customId}`);
    }
  }

  private async handleSyncPoints(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });
    const result = await this.xpSyncService.syncPoints();

    await interaction.editReply(
      `XP sync complete:\n` +
        `• **${result.usersUpdated}** users updated\n` +
        `• **${result.totalXpAwarded}** XP awarded`,
    );
  }

  private async handleQuestChannelMessage(message: Message): Promise<void> {
    for (const quest of QUEST_POOL) {
      if (quest.channelId && message.channelId === quest.channelId) {
        await this.quest.autoCompleteQuest(message.author.id, quest.id);
      }
    }
  }

  private async handleNewMember(member: GuildMember) {
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

      const verifyChannel = channels.find((c) => c?.name === '🔓-verify');
      if (!verifyChannel || !('send' in verifyChannel)) {
        this.logger.log(
          '[welcome] #🔓-verify channel not found — skipping (run /setup-server first)',
        );
        return;
      }

      const textChannel = verifyChannel as TextChannel;
      const messages = await textChannel.messages.fetch({ limit: 20 });
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
      await textChannel.send(message);
      this.logger.log('[welcome] Posted onboarding message to #🔓-verify');
    } catch (err) {
      this.logger.warn(`[welcome] Could not setup verify channel: ${err}`);
    }
  }

  private async handleCheckChef(interaction: ChatInputCommandInteraction) {
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
