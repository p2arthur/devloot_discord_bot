import { Injectable, Logger } from '@nestjs/common';
import {
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { DiscordVerifyService } from '../handlers/discord-verify.service';
import { DiscordSetupService } from '../handlers/discord-setup.service';
import { ProposeCommand } from '../commands/propose';
import { DailyCommand } from '../commands/daily';
import { RankCommand } from '../commands/rank';
import { QuestCommand } from '../commands/quest';
import { ProposalsCommand } from '../commands/proposals';
import { OnboardingCommand } from '../commands/onboarding';
import { LeaderboardCommand } from '../commands/leaderboard';
import { XpSyncService } from './xp-sync.service';
import { DiscordRoleService } from './discord-role.service';
import { Client } from 'discord.js';

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
export class CommandDispatcherService {
  private readonly logger = new Logger(CommandDispatcherService.name);

  constructor(
    private verifyService: DiscordVerifyService,
    private setupService: DiscordSetupService,
    private propose: ProposeCommand,
    private daily: DailyCommand,
    private rank: RankCommand,
    private quest: QuestCommand,
    private proposals: ProposalsCommand,
    private onboarding: OnboardingCommand,
    private leaderboard: LeaderboardCommand,
    private xpSyncService: XpSyncService,
    private roleService: DiscordRoleService,
  ) {}

  async dispatch(
    interaction: ChatInputCommandInteraction,
    client: Client,
  ): Promise<void> {
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
            client,
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
        case 'sync-points':
          // Admin only - check permission
          if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({ content: '❌ Admin only command', flags: MessageFlags.Ephemeral });
            return;
          }
          this.logger.log(`[/sync-points] ${discordId} triggering XP sync`);
          await this.handleSyncPoints(interaction);
          break;
        case 'setup-server':
          this.logger.log(
            `[/setup-server] ${interaction.user.tag} (${discordId}) triggering setup`,
          );
          await this.setupService.handleSetupServer(interaction, client);
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

  private async handleSyncPoints(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });
    const result = await this.xpSyncService.syncPoints();

    await interaction.editReply(
      `XP sync complete:\n` +
        `• **${result.usersUpdated}** users updated\n` +
        `• **${result.totalXpAwarded}** XP awarded`,
    );
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
