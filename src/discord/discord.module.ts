import { Global, Module } from '@nestjs/common';
import { DiscordGateway } from './discord.gateway';
import { DiscordNotificationService } from './services/discord-notification.service';
import { DiscordXpService } from './services/discord-xp.service';
import { DiscordRoleService } from './services/discord-role.service';
import { DiscordGuildService } from './services/discord-guild.service';
import { DiscordCommandRouterService } from './services/discord-command-router.service';
import { ProposalVoteService } from './services/proposal-vote.service';
import { ChannelModerationService } from './services/channel-moderation.service';
import { ChefSchedulerService } from './services/chef-scheduler.service';
import { DiscordThreadService } from './services/discord-thread.service';
import { DiscordSetupService } from './handlers/discord-setup.service';
import { DiscordVerifyService } from './handlers/discord-verify.service';
import { OnboardingCommand } from './commands/onboarding';
import { RankCommand } from './commands/rank';
import { DailyCommand } from './commands/daily';
import { QuestCommand } from './commands/quest';
import { ProposeCommand } from './commands/propose';
import { ProposalsCommand } from './commands/proposals';
import { LeaderboardCommand } from './commands/leaderboard';
import { AiModule } from '../ai/ai.module';

@Global()
@Module({
  imports: [AiModule],
  providers: [
    DiscordGateway,
    DiscordNotificationService,
    DiscordXpService,
    DiscordRoleService,
    DiscordGuildService,
    DiscordCommandRouterService,
    ProposalVoteService,
    ChannelModerationService,
    ChefSchedulerService,
    DiscordThreadService,
    DiscordSetupService,
    DiscordVerifyService,
    OnboardingCommand,
    RankCommand,
    DailyCommand,
    QuestCommand,
    ProposeCommand,
    ProposalsCommand,
    LeaderboardCommand,
  ],
  exports: [DiscordNotificationService, DiscordXpService],
})
export class DiscordModule {}
