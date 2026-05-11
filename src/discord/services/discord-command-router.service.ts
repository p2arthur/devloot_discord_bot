import { Injectable, Logger } from '@nestjs/common';
import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  Interaction,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { PrismaService } from '../../prisma/prisma.service';
import { DiscordRoleService } from './discord-role.service';
import { DiscordSetupService } from '../handlers/discord-setup.service';
import { DiscordVerifyService } from '../handlers/discord-verify.service';
import { ProposeCommand } from '../commands/propose';
import { DailyCommand } from '../commands/daily';
import { RankCommand } from '../commands/rank';
import { QuestCommand } from '../commands/quest';
import { ProposalsCommand } from '../commands/proposals';
import { OnboardingCommand } from '../commands/onboarding';
import { LeaderboardCommand } from '../commands/leaderboard';
import { DiscordXpService } from './discord-xp.service';

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
export class DiscordCommandRouterService {
  private readonly logger = new Logger(DiscordCommandRouterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly xpService: DiscordXpService,
    private readonly roleService: DiscordRoleService,
    private readonly setupService: DiscordSetupService,
    private readonly verifyService: DiscordVerifyService,
    private readonly propose: ProposeCommand,
    private readonly daily: DailyCommand,
    private readonly rank: RankCommand,
    private readonly quest: QuestCommand,
    private readonly proposals: ProposalsCommand,
    private readonly onboarding: OnboardingCommand,
    private readonly leaderboard: LeaderboardCommand,
  ) {}

  async handleInteraction(
    interaction: Interaction,
    client: Client,
  ): Promise<void> {
    if (interaction.isChatInputCommand()) {
      this.logger.log(
        `[/] /${interaction.commandName} by ${interaction.user.tag} (${interaction.user.id}) in ${interaction.guild?.name ?? 'DM'}`,
      );
      await this.handleCommand(interaction, client);
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
      await this.dispatchCommand(name, interaction, client);
      this.logger.log(`[/] /${name} completed for ${discordId}`);
    } catch (error) {
      this.logger.error(
        `[/] /${name} FAILED for ${discordId}: ${this.formatError(error)}`,
      );
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'Something went wrong.',
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.editReply({ content: 'Something went wrong.' });
      }
    }
  }

  private async dispatchCommand(
    name: string,
    interaction: ChatInputCommandInteraction,
    client: Client,
  ): Promise<void> {
    const discordId = interaction.user.id;

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
  }

  private async handleButton(interaction: ButtonInteraction): Promise<void> {
    if (interaction.customId === 'onboarding-verify') {
      this.logger.log(`[btn] onboarding-verify from ${interaction.user.tag}`);
      await this.verifyService.handleVerify(interaction);
    } else {
      this.logger.warn(`[btn] Unhandled button: ${interaction.customId}`);
    }
  }

  private async handleSyncPoints(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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
        .catch((error: unknown) =>
          this.logger.warn(
            `[sync-points] Failed to award creation XP to user#${user.id}: ${this.formatError(error)}`,
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
        .catch((error: unknown) =>
          this.logger.warn(
            `[sync-points] Failed to award claim XP to user#${group.winnerId}: ${this.formatError(error)}`,
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

  private async handleCheckChef(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    if (
      !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    ) {
      await interaction.reply({
        content: 'Only server admins can run this command.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await this.roleService.checkWeeklyChef();

    await interaction.editReply(
      `Open Source Chef check complete:\n` +
        `• **${result.awarded}** users awarded\n` +
        `• **${result.removed}** users removed\n` +
        `Based on bounty activity in the last 7 days.`,
    );
  }

  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
