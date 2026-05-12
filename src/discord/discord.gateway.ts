import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  GuildMember,
  Interaction,
  MessageReaction,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  User,
} from 'discord.js';
import { DiscordSetupService } from './handlers/discord-setup.service';
import { DiscordVerifyService } from './handlers/discord-verify.service';
import { DailyCommand } from './commands/daily';
import { LeaderboardCommand } from './commands/leaderboard';
import { OnboardingCommand } from './commands/onboarding';
import { ProposalsCommand } from './commands/proposals';
import { ProposeCommand } from './commands/propose';
import { QuestCommand } from './commands/quest';
import { RankCommand } from './commands/rank';
import { ChannelModerationService } from './services/channel-moderation.service';
import { ChefSchedulerService } from './services/chef-scheduler.service';
import { DiscordGuildService } from './services/discord-guild.service';
import { DiscordRoleService } from './services/discord-role.service';
import { ProposalVoteService } from './services/proposal-vote.service';
import { XpSyncService } from './services/xp-sync.service';

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
    private readonly roleService: DiscordRoleService,
    private readonly guildService: DiscordGuildService,
    private readonly setupService: DiscordSetupService,
    private readonly verifyService: DiscordVerifyService,
    private readonly propose: ProposeCommand,
    private readonly daily: DailyCommand,
    private readonly rank: RankCommand,
    private readonly quest: QuestCommand,
    private readonly proposals: ProposalsCommand,
    private readonly onboarding: OnboardingCommand,
    private readonly leaderboard: LeaderboardCommand,
    private readonly proposalVoteService: ProposalVoteService,
    private readonly channelModerationService: ChannelModerationService,
    private readonly xpSyncService: XpSyncService,
    private readonly chefSchedulerService: ChefSchedulerService,
  ) {}

  async onModuleInit(): Promise<void> {
    const token = process.env.DISCORD_BOT_TOKEN;
    const clientId = process.env.DISCORD_CLIENT_ID;
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!token || !clientId) return;

    await this.registerCommands(token, clientId, guildId);

    this.client.on(
      Events.InteractionCreate,
      (i) => void this.handleInteraction(i),
    );
    this.client.on(
      Events.MessageCreate,
      (m) => void this.channelModerationService.handleMessage(m),
    );
    this.client.on(
      Events.MessageReactionAdd,
      (r, u) =>
        void this.proposalVoteService.handleReactionAdd(
          r as MessageReaction,
          u as User,
        ),
    );
    this.client.on(Events.GuildMemberAdd, (m) => void this.handleNewMember(m));

    this.client.on(Events.ClientReady, () => {
      this.guildService.setClient(this.client);
      void this.setupService.setupVerifyChannel(this.client);
      this.chefSchedulerService.start();
    });

    await this.client.login(token);
  }

  // prettier-ignore
  private async registerCommands(token: string, clientId: string, guildId?: string): Promise<void> {
    const commands = [
      new SlashCommandBuilder().setName('propose').setDescription('Suggest a GitHub issue for a bounty').addStringOption((o) => o.setName('message').setDescription('Why this issue should have a bounty').setRequired(true)).addStringOption((o) => o.setName('issue_url').setDescription('GitHub issue URL').setRequired(true)).addNumberOption((o) => o.setName('bounty_amount').setDescription('Suggested bounty amount in USDC').setRequired(true).setMinValue(1)),
      new SlashCommandBuilder().setName('daily').setDescription('Claim your daily XP'),
      new SlashCommandBuilder().setName('rank').setDescription('View your XP rank and progress'),
      new SlashCommandBuilder().setName('quests').setDescription('View your daily quests'),
      new SlashCommandBuilder().setName('proposals').setDescription('View recent proposals this week'),
      new SlashCommandBuilder().setName('onboarding').setDescription('Get started with DevLoot'),
      new SlashCommandBuilder().setName('leaderboard').setDescription('View the XP leaderboard'),
      new SlashCommandBuilder().setName('sync-points').setDescription('Sync XP from bounty activity'),
      new SlashCommandBuilder().setName('setup-server').setDescription('Set up DevLoot server structure (admin only)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
      new SlashCommandBuilder().setName('check-chef').setDescription('Manually trigger weekly Open Source Chef check').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    ].map((c) => c.toJSON());
    const rest = new REST().setToken(token);
    if (guildId) await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    else await rest.put(Routes.applicationCommands(clientId), { body: commands });
  }

  private async handleInteraction(interaction: Interaction): Promise<void> {
    if (interaction.isChatInputCommand()) await this.handleCommand(interaction);
    if (interaction.isButton()) await this.handleButton(interaction);
  }

  private async handleCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const name = interaction.commandName;
    const discordId = interaction.user.id;
    if (
      name !== 'onboarding' &&
      COMMANDS_REQUIRING_ONBOARDING.includes(name) &&
      !(await this.verifyService.checkOnboarded(discordId))
    ) {
      const message = this.onboarding.buildOnboardingMessage(discordId);
      await interaction.reply({
        content: 'You need to complete onboarding first!',
        ...message,
        ephemeral: true,
      });
      return;
    }
    switch (name) {
      case 'propose':
        await this.propose.handle(
          interaction,
          interaction.options.getString('message', true),
          interaction.options.getString('issue_url', true),
          interaction.options.getNumber('bounty_amount', true),
          this.client,
        );
        await this.quest.autoCompleteQuest(discordId, 'bounty_proposal');
        return;
      case 'daily':
        return this.daily.handle(interaction);
      case 'rank':
        return this.rank.handle(interaction);
      case 'quests':
        return this.quest.handle(interaction);
      case 'proposals':
        return this.proposals.handle(interaction);
      case 'onboarding':
        return this.onboarding.handle(interaction);
      case 'leaderboard':
        return this.leaderboard.handle(interaction);
      case 'sync-points':
        return this.xpSyncService.handleSyncPoints(interaction);
      case 'setup-server':
        return this.setupService.handleSetupServer(interaction, this.client);
      case 'check-chef':
        return this.handleCheckChef(interaction);
      default:
        return;
    }
  }

  private async handleButton(interaction: ButtonInteraction): Promise<void> {
    if (interaction.customId === 'onboarding-verify')
      await this.verifyService.handleVerify(interaction);
  }

  private handleNewMember(member: GuildMember): void {
    this.logger.log(
      `[member] New member joined: ${member.user.tag} (${member.user.id})`,
    );
  }

  private async handleCheckChef(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
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
      `Open Source Chef check complete:\n� **${result.awarded}** users awarded\n� **${result.removed}** users removed\nBased on bounty activity in the last 7 days.`,
    );
  }
}
