import { Global, Module } from '@nestjs/common';
import { DiscordGateway } from './discord.gateway';
import { DiscordNotificationService } from './services/discord-notification.service';
import { DiscordXpService } from './services/discord-xp.service';
import { DiscordRoleService } from './services/discord-role.service';
import { DiscordGuildService } from './services/discord-guild.service';
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
import { ProposalVoteService } from './services/proposal-vote.service';
import { ChannelModerationService } from './services/channel-moderation.service';
import { XpSyncService } from './services/xp-sync.service';

@Global()
@Module({
  imports: [AiModule],
  providers: [
    DiscordGateway,
    DiscordNotificationService,
    DiscordXpService,
    DiscordRoleService,
    DiscordGuildService,
    DiscordSetupService,
    DiscordVerifyService,
    OnboardingCommand,
    RankCommand,
    DailyCommand,
    QuestCommand,
    ProposeCommand,
    ProposalsCommand,
    LeaderboardCommand,
    ProposalVoteService,
    ChannelModerationService,
    XpSyncService,
  ],
  exports: [DiscordNotificationService, DiscordXpService, XpSyncService],
})
export class DiscordModule {}