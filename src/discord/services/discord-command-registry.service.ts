import { Injectable, Logger } from '@nestjs/common';
import {
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from 'discord.js';

@Injectable()
export class DiscordCommandRegistryService {
  private readonly logger = new Logger(DiscordCommandRegistryService.name);

  async register(
    token: string,
    clientId: string,
    guildId?: string,
  ): Promise<void> {
    const commands = [
      new SlashCommandBuilder()
        .setName('propose')
        .setDescription('Suggest a GitHub issue for a bounty')
        .addStringOption((o) =>
          o
            .setName('message')
            .setDescription('Why this issue should have a bounty')
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

    const rest = new REST().setToken(token);
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: commands,
      });
      this.logger.log(`Slash commands registered for guild ${guildId}`);
      return;
    }

    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    this.logger.log('Slash commands registered globally');
  }
}
