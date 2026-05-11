import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from 'discord.js';
import { DiscordGuildService } from './services/discord-guild.service';
import { DiscordSetupService } from './handlers/discord-setup.service';
import { DiscordCommandRouterService } from './services/discord-command-router.service';
import { ProposalVoteService } from './services/proposal-vote.service';
import { ChannelModerationService } from './services/channel-moderation.service';
import { ChefSchedulerService } from './services/chef-scheduler.service';

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
    private readonly guildService: DiscordGuildService,
    private readonly setupService: DiscordSetupService,
    private readonly commandRouter: DiscordCommandRouterService,
    private readonly proposalVoteService: ProposalVoteService,
    private readonly channelModerationService: ChannelModerationService,
    private readonly chefScheduler: ChefSchedulerService,
  ) {}

  async onModuleInit(): Promise<void> {
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

    const commands = this.buildSlashCommands();
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
    } catch (error) {
      this.logger.error(
        `Failed to register slash commands: ${this.formatError(error)}`,
      );
      return;
    }

    this.registerEventHandlers();
    this.logger.log('Calling client.login()...');

    try {
      await this.client.login(token);
      this.logger.log(
        'client.login() resolved — waiting for clientReady event...',
      );
    } catch (error) {
      this.logger.error(`client.login() FAILED: ${this.formatError(error)}`);
    }
  }

  private buildSlashCommands(): unknown[] {
    const commands = [
      new SlashCommandBuilder()
        .setName('propose')
        .setDescription('Suggest a GitHub issue for a bounty')
        .addStringOption((option) =>
          option
            .setName('message')
            .setDescription('Why this issue should have a bounty')
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('issue_url')
            .setDescription('GitHub issue URL')
            .setRequired(true),
        )
        .addNumberOption((option) =>
          option
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
    ].map((command) => command.toJSON());

    this.logger.log(`Registering ${commands.length} slash commands`);
    return commands;
  }

  private registerEventHandlers(): void {
    this.client.on(
      Events.InteractionCreate,
      (interaction) =>
        void this.commandRouter.handleInteraction(interaction, this.client),
    );
    this.client.on(
      Events.MessageCreate,
      (message) => void this.channelModerationService.handleMessage(message),
    );
    this.client.on(
      Events.MessageReactionAdd,
      (reaction, user) =>
        void this.proposalVoteService.handleReactionAdd(reaction, user),
    );
    this.client.on(Events.GuildMemberAdd, (member) => {
      this.logger.log(
        `[member] New member joined: ${member.user.tag} (${member.user.id})`,
      );
    });
    this.client.on('clientReady', () => {
      void this.handleClientReady();
    });
    this.client.on('error', (error) => {
      this.logger.error(`Discord client error: ${error.message}`);
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
  }

  private async handleClientReady(): Promise<void> {
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

    await this.setupService.ensureVerifyChannel(this.client);
    this.chefScheduler.start();
  }

  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
