import { Global, Module } from '@nestjs/common';
import { DiscordService } from './discord.service';
import { DiscordBotService } from './discord-bot.service';
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
    DiscordService,
    DiscordBotService,
    OnboardingCommand,
    RankCommand,
    DailyCommand,
    QuestCommand,
    ProposeCommand,
    ProposalsCommand,
    LeaderboardCommand,
  ],
  exports: [
    DiscordService,
    DiscordBotService,
    OnboardingCommand,
    RankCommand,
    DailyCommand,
    QuestCommand,
    ProposeCommand,
    ProposalsCommand,
    LeaderboardCommand,
  ],
})
export class DiscordModule {}
