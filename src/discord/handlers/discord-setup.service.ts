import { Injectable, Logger } from '@nestjs/common';
import {
  ChatInputCommandInteraction,
  Client,
  Colors,
  EmbedBuilder,
} from 'discord.js';
import { OnboardingCommand } from '../commands/onboarding';

@Injectable()
export class DiscordSetupService {
  private readonly logger = new Logger(DiscordSetupService.name);

  constructor(private readonly onboarding: OnboardingCommand) {}

  async handleSetupServer(
    interaction: ChatInputCommandInteraction,
    client: Client,
  ): Promise<void> {
    if (!interaction.memberPermissions?.has('Administrator')) {
      await interaction.reply({
        content: 'Only server admins can run this command.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const guild = interaction.guild;
    if (!guild) {
      await interaction.editReply('This command must be run in a server.');
      return;
    }

    const results: string[] = [];
    const roles = [
      { name: 'Verified', color: 0x2ecc71, hoist: true },
      { name: 'Open Source Chef', color: 0xf39c12, hoist: true },
    ];

    const createdRoles: Record<string, string> = {};
    for (const roleDef of roles) {
      const existing = guild.roles.cache.find((r) => r.name === roleDef.name);
      if (existing) {
        createdRoles[roleDef.name] = existing.id;
        results.push(
          `Role **${roleDef.name}** already exists (${existing.id})`,
        );
      } else {
        const role = await guild.roles.create({
          name: roleDef.name,
          color: roleDef.color,
          hoist: roleDef.hoist,
          reason: 'DevLoot server setup',
        });
        createdRoles[roleDef.name] = role.id;
        results.push(`Created role **${roleDef.name}** (${role.id})`);
      }
    }

    const verifyChannel = guild.channels.cache.find(
      (c) => c.name === '??-verify',
    );
    if (verifyChannel && verifyChannel.isTextBased()) {
      const messages = await verifyChannel.messages.fetch({ limit: 20 });
      const existingEmbed = messages.find(
        (m) =>
          m.author.id === client.user?.id &&
          m.embeds[0]?.title === 'Welcome to DevLoot',
      );
      if (!existingEmbed) {
        await verifyChannel.send(this.onboarding.buildOnboardingMessage());
        results.push('Posted onboarding embed in #??-verify');
      }
    }

    const embed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle('Server Setup Complete')
      .setDescription(results.map((r) => `� ${r}`).join('\n'));
    await interaction.editReply({ embeds: [embed] });
  }

  async setupVerifyChannel(client: Client): Promise<void> {
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!guildId) return;
    try {
      const guild = await client.guilds.fetch(guildId);
      const channels = await guild.channels.fetch();
      const verifyChannel = channels.find((c) => c?.name === '??-verify');
      if (!verifyChannel || !verifyChannel.isTextBased()) return;

      const messages = await verifyChannel.messages.fetch({ limit: 20 });
      const existingBot = messages.find(
        (m) =>
          m.author.id === client.user?.id &&
          m.embeds[0]?.title === 'Welcome to DevLoot',
      );
      if (existingBot) return;

      await verifyChannel.send(this.onboarding.buildOnboardingMessage());
      this.logger.log('[welcome] Posted onboarding message to #??-verify');
    } catch (err) {
      this.logger.warn(
        `[welcome] Could not setup verify channel: ${String(err)}`,
      );
    }
  }
}
