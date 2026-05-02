import { Injectable, Logger } from '@nestjs/common';
import { Client, GuildMember, TextChannel } from 'discord.js';
import { DiscordRoleService } from './discord-role.service';
import { OnboardingCommand } from '../commands/onboarding';

@Injectable()
export class WelcomeService {
  private readonly logger = new Logger(WelcomeService.name);

  constructor(
    private roleService: DiscordRoleService,
    private onboarding: OnboardingCommand,
  ) {}

  async handleNewMember(member: GuildMember): Promise<void> {
    this.logger.log(
      `[member] New member joined: ${member.user.tag} (${member.user.id})`,
    );

    try {
      const verifiedRoleId =
        await this.roleService.fetchRoleIdByName('Verified');
      this.logger.log(
        `[member] ${member.user.tag} joined — Verified role ID: ${verifiedRoleId ?? 'not found (run /setup-server)'}`,
      );
    } catch (err) {
      this.logger.debug(`[member] Could not log role info: ${err}`);
    }
  }

  async setupVerifyChannel(client: Client): Promise<void> {
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!guildId) {
      this.logger.warn(
        '[welcome] DISCORD_GUILD_ID not set — skipping verify channel setup',
      );
      return;
    }

    try {
      const guild = await client.guilds.fetch(guildId);
      const channels = await guild.channels.fetch();

      const verifyChannel = channels.find((c) => c?.name === '🔓-verify');
      if (!verifyChannel || !('send' in verifyChannel)) {
        this.logger.log(
          '[welcome] #🔓-verify channel not found — skipping (run /setup-server first)',
        );
        return;
      }

      const textChannel = verifyChannel as TextChannel;
      const messages = await textChannel.messages.fetch({ limit: 20 });
      const existingBot = messages.find(
        (m) =>
          m.author.id === client.user?.id &&
          m.embeds[0]?.title === 'Welcome to DevLoot',
      );

      if (existingBot) {
        this.logger.log(
          '[welcome] Onboarding message already exists in #🔓-verify',
        );
        return;
      }

      const message = this.onboarding.buildOnboardingMessage();
      await textChannel.send(message);
      this.logger.log('[welcome] Posted onboarding message to #🔓-verify');
    } catch (err) {
      this.logger.warn(`[welcome] Could not setup verify channel: ${err}`);
    }
  }
}
