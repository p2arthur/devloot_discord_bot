import { Injectable, Logger } from '@nestjs/common';
import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Interaction,
  MessageFlags,
} from 'discord.js';
import { DiscordVerifyService } from '../handlers/discord-verify.service';
import { ProposeCommand } from '../commands/propose';
import { DailyCommand } from '../commands/daily';
import { RankCommand } from '../commands/rank';
import { QuestCommand } from '../commands/quest';
import { ProposalsCommand } from '../commands/proposals';
import { OnboardingCommand } from '../commands/onboarding';
import { LeaderboardCommand } from '../commands/leaderboard';
import { DiscordSetupService } from '../handlers/discord-setup.service';
import { XpSyncService } from './xp-sync.service';
import { ChefSchedulerService } from './chef-scheduler.service';

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
export class DiscordInteractionRouterService {
  private readonly logger = new Logger(DiscordInteractionRouterService.name);

  constructor(
    private readonly verifyService: DiscordVerifyService,
    private readonly propose: ProposeCommand,
    private readonly daily: DailyCommand,
    private readonly rank: RankCommand,
    private readonly quest: QuestCommand,
    private readonly proposals: ProposalsCommand,
    private readonly onboarding: OnboardingCommand,
    private readonly leaderboard: LeaderboardCommand,
    private readonly setupService: DiscordSetupService,
    private readonly xpSync: XpSyncService,
    private readonly chefScheduler: ChefSchedulerService,
  ) {}

  async handleInteraction(interaction: Interaction): Promise<void> {
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

  private async handleCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const name = interaction.commandName;
    const discordId = interaction.user.id;

    if (name !== 'onboarding' && COMMANDS_REQUIRING_ONBOARDING.includes(name)) {
      const isOnboarded = await this.verifyService.checkOnboarded(discordId);
      if (!isOnboarded) {
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
      await this.dispatchCommand(name, interaction);
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

  private async dispatchCommand(
    name: string,
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    switch (name) {
      case 'propose':
        await this.propose.handle(
          interaction,
          interaction.options.getString('message', true),
          interaction.options.getString('issue_url', true),
          interaction.options.getNumber('bounty_amount', true),
          interaction.client,
        );
        await this.quest.autoCompleteQuest(
          interaction.user.id,
          'bounty_proposal',
        );
        break;
      case 'daily':
        await this.daily.handle(interaction);
        break;
      case 'rank':
        await this.rank.handle(interaction);
        break;
      case 'quests':
        await this.quest.handle(interaction);
        break;
      case 'proposals':
        await this.proposals.handle(interaction);
        break;
      case 'onboarding':
        await this.onboarding.handle(interaction);
        break;
      case 'leaderboard':
        await this.leaderboard.handle(interaction);
        break;
      case 'sync-points':
        await this.handleSyncPoints(interaction);
        break;
      case 'setup-server':
        await this.setupService.handleSetupServer(interaction);
        break;
      case 'check-chef':
        await this.handleCheckChef(interaction);
        break;
      default:
        this.logger.warn(`Unknown command: ${name}`);
    }
  }

  private async handleButton(interaction: ButtonInteraction): Promise<void> {
    if (interaction.customId === 'onboarding-verify') {
      await this.verifyService.handleVerify(interaction);
    } else {
      this.logger.warn(`[btn] Unhandled button: ${interaction.customId}`);
    }
  }

  private async handleSyncPoints(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await this.xpSync.syncBountyActivity();

    await interaction.editReply(
      `Sync complete!\n` +
        `- **${result.usersUpdated}** users updated\n` +
        `- **${result.totalXpAwarded}** total XP awarded\n` +
        `- ${result.creators} creators, ${result.claimers} claimers processed`,
    );
  }

  private async handleCheckChef(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    if (!interaction.memberPermissions?.has('Administrator')) {
      await interaction.reply({
        content: 'Only server admins can run this command.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await this.chefScheduler.runNow();

    await interaction.editReply(
      `Open Source Chef check complete:\n` +
        `- **${result.awarded}** users awarded\n` +
        `- **${result.removed}** users removed\n` +
        `Based on bounty activity in the last 7 days.`,
    );
  }
}
