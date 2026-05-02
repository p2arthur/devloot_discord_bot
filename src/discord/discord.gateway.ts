import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  Events,
  Interaction,
  Message,
  GuildMember,
  ChatInputCommandInteraction,
  ButtonInteraction,
  MessageReaction,
  User,
} from 'discord.js';
import { PrismaService } from '../prisma/prisma.service';
import { DiscordGuildService } from './services/discord-guild.service';
import { DiscordVerifyService } from './handlers/discord-verify.service';
import { ProposalVoteService } from './services/proposal-vote.service';
import { ChannelModerationService } from './services/channel-moderation.service';
import { ChefSchedulerService } from './services/chef-scheduler.service';
import { CommandDispatcherService } from './services/command-dispatcher.service';
import { WelcomeService } from './services/welcome.service';
import { QuestCommand, QUEST_POOL } from './commands/quest';

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
    private guildService: DiscordGuildService,
    private verifyService: DiscordVerifyService,
    private proposalVoteService: ProposalVoteService,
    private channelModerationService: ChannelModerationService,
    private chefSchedulerService: ChefSchedulerService,
    private commandDispatcher: CommandDispatcherService,
    private welcomeService: WelcomeService,
    private quest: QuestCommand,
  ) {}

  async onModuleInit() {
    const token = process.env.DISCORD_BOT_TOKEN;
    const clientId = process.env.DISCORD_CLIENT_ID;
    const guildId = process.env.DISCORD_GUILD_ID;

    if (!token || !clientId) {
      this.logger.warn('DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID not set — bot DISABLED');
      return;
    }

    await this.registerCommands(token, clientId, guildId);
    this.setupEventHandlers();
    await this.login(token);
  }

  private async registerCommands(token: string, clientId: string, guildId: string | undefined) {
    const commands = [
      new SlashCommandBuilder().setName('propose').setDescription('Suggest a GitHub issue for a bounty')
        .addStringOption((o) => o.setName('message').setDescription('Short pitch for why this issue matters').setRequired(true))
        .addStringOption((o) => o.setName('issue_url').setDescription('GitHub issue URL').setRequired(true))
        .addNumberOption((o) => o.setName('bounty_amount').setDescription('Suggested bounty in USDC').setRequired(true)),
      new SlashCommandBuilder().setName('daily').setDescription('Claim your daily XP reward'),
      new SlashCommandBuilder().setName('rank').setDescription('Check your current XP and tier'),
      new SlashCommandBuilder().setName('quests').setDescription('View available quests'),
      new SlashCommandBuilder().setName('proposals').setDescription('View recent bounty proposals'),
      new SlashCommandBuilder().setName('onboarding').setDescription('Start the onboarding flow'),
      new SlashCommandBuilder().setName('leaderboard').setDescription('View top users by XP'),
      new SlashCommandBuilder().setName('sync-points').setDescription('Sync XP from bounty activity (admin only)'),
      new SlashCommandBuilder().setName('setup-server')
        .setDescription('Setup server channels and roles (admin only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
      new SlashCommandBuilder().setName('check-chef')
        .setDescription('Manually trigger Open Source Chef check (admin only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    ];

    const rest = new REST().setToken(token);
    const route = guildId
      ? Routes.applicationGuildCommands(clientId, guildId)
      : Routes.applicationCommands(clientId);
    const body = commands.map((c) => c.toJSON());

    try {
      await rest.put(route, { body });
      this.logger.log(`Registered ${commands.length} commands ${guildId ? `to guild ${guildId}` : 'globally'}`);
    } catch (err) {
      this.logger.error(`Failed to register commands: ${err}`);
    }
  }

  private setupEventHandlers() {
    this.client.once(Events.ClientReady, async (readyClient) => {
      this.logger.log(`✅ Logged in as ${readyClient.user.tag}`);
      this.guildService.setClient(this.client);
      this.chefSchedulerService.startWeeklyChefCheck();
      await this.welcomeService.setupVerifyChannel(this.client);
    });

    this.client.on(Events.InteractionCreate, async (interaction: Interaction) => {
      if (interaction.isChatInputCommand()) {
        await this.commandDispatcher.dispatch(interaction as ChatInputCommandInteraction, this.client);
      } else if (interaction.isButton()) {
        await this.handleButton(interaction as ButtonInteraction);
      } else if (interaction.isModalSubmit()) {
        this.logger.log(`[modal] ${interaction.customId} by ${interaction.user.tag}`);
      }
    });

    this.client.on(Events.MessageCreate, async (message: Message) => {
      await this.channelModerationService.handleMessage(message);
      await this.handleQuestChannelMessage(message);
    });

    this.client.on(Events.MessageReactionAdd, async (reaction: MessageReaction, user: User) => {
      await this.proposalVoteService.handleReactionAdd(reaction, user);
    });

    this.client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
      await this.welcomeService.handleNewMember(member);
    });

    this.client.on('error', (err) => this.logger.error(`Discord client error: ${err.message}`));
    this.client.on('warn', (w) => this.logger.warn(`Discord client warning: ${w}`));
  }

  private async login(token: string) {
    this.logger.log('Calling client.login()...');
    try {
      await this.client.login(token);
      this.logger.log('client.login() resolved — waiting for clientReady event...');
    } catch (err) {
      this.logger.error(`client.login() FAILED: ${err}`);
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

  private async handleQuestChannelMessage(message: Message): Promise<void> {
    if (message.author.bot) return;
    for (const quest of QUEST_POOL) {
      if (quest.channelId && message.channelId === quest.channelId) {
        await this.quest.autoCompleteQuest(message.author.id, quest.id);
      }
    }
  }
}
