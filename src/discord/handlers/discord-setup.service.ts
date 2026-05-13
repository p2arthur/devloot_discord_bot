import { Injectable, Logger } from '@nestjs/common';
import {
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  Colors,
  EmbedBuilder,
  PermissionFlagsBits,
  TextChannel,
} from 'discord.js';
import { OnboardingCommand } from '../commands/onboarding';

@Injectable()
export class DiscordSetupService {
  private readonly logger = new Logger(DiscordSetupService.name);

  constructor(private readonly onboarding: OnboardingCommand) {}

  async handleSetupServer(
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
      try {
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
      } catch (err) {
        results.push(`Failed to create role ${roleDef.name}: ${err}`);
      }
    }

    const everyoneId = guild.id;
    const verifiedId = createdRoles.Verified;
    const categories = [
      {
        name: '🚪 ONBOARDING',
        permissionOverwrites: [
          {
            id: everyoneId,
            allow: [PermissionFlagsBits.ViewChannel],
            deny: [PermissionFlagsBits.SendMessages],
          },
          {
            id: verifiedId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
            ],
          },
        ],
      },
      {
        name: '🌍 COMMUNITY',
        permissionOverwrites: [
          { id: everyoneId, deny: [PermissionFlagsBits.ViewChannel] },
          { id: verifiedId, allow: [PermissionFlagsBits.ViewChannel] },
        ],
      },
      {
        name: '🎯 BOUNTIES',
        permissionOverwrites: [
          { id: everyoneId, deny: [PermissionFlagsBits.ViewChannel] },
          { id: verifiedId, allow: [PermissionFlagsBits.ViewChannel] },
        ],
      },
    ];

    const createdCategories: Record<string, string> = {};
    for (const category of categories) {
      try {
        const existing = guild.channels.cache.find(
          (channel) =>
            channel?.name === category.name &&
            channel.type === ChannelType.GuildCategory,
        );
        if (existing) {
          createdCategories[category.name] = existing.id;
          results.push(`Category **${category.name}** already exists`);
        } else {
          const created = await guild.channels.create({
            name: category.name,
            type: ChannelType.GuildCategory,
            permissionOverwrites: category.permissionOverwrites,
          });
          createdCategories[category.name] = created.id;
          results.push(`Created category **${category.name}**`);
        }
      } catch (err) {
        results.push(`Failed to create category ${category.name}: ${err}`);
      }
    }

    const channels = [
      {
        name: '🔓-verify',
        topic:
          'Link your GitHub and verify to unlock the full server. devloot.xyz/connect',
        parent: createdCategories['🚪 ONBOARDING'],
        permissions: [
          {
            id: everyoneId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          },
        ],
      },
      {
        name: '⚖️-rules',
        topic: 'Read before engaging. Respect the community, respect the code.',
        parent: createdCategories['🚪 ONBOARDING'],
        permissions: [
          {
            id: everyoneId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.ReadMessageHistory,
            ],
            deny: [PermissionFlagsBits.SendMessages],
          },
        ],
      },
      {
        name: '📢-announcement',
        topic:
          'Platform updates, bounty highlights, and community news. devloot.xyz',
        parent: createdCategories['🚪 ONBOARDING'],
        permissions: [
          {
            id: everyoneId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.ReadMessageHistory,
            ],
            deny: [PermissionFlagsBits.SendMessages],
          },
        ],
      },
      {
        name: '⚡-general',
        topic:
          'Talk open source, bounties, dev tools, or whatever. Builders+ can chat.',
        parent: createdCategories['🌍 COMMUNITY'],
        permissions: [
          { id: everyoneId, deny: [PermissionFlagsBits.ViewChannel] },
          { id: verifiedId, allow: [PermissionFlagsBits.ViewChannel] },
        ],
      },
      {
        name: '💡-proposals',
        topic:
          'Suggest open source issues worth funding. Use /propose - raw messages get cleaned up.',
        parent: createdCategories['🌍 COMMUNITY'],
        permissions: [
          { id: everyoneId, deny: [PermissionFlagsBits.ViewChannel] },
          {
            id: verifiedId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
            ],
          },
        ],
      },
      {
        name: '💰-feed',
        topic:
          'Live bounty feed - new bounties, claims, and payouts as they happen. devloot.xyz',
        parent: createdCategories['🎯 BOUNTIES'],
        permissions: [
          { id: everyoneId, deny: [PermissionFlagsBits.ViewChannel] },
          {
            id: verifiedId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          },
        ],
      },
    ];

    for (const channel of channels) {
      try {
        const existing = guild.channels.cache.find(
          (candidate) => candidate?.name === channel.name,
        );
        if (existing) {
          if ('topic' in existing && existing.topic !== channel.topic) {
            await existing.edit({ topic: channel.topic });
            results.push(`Updated topic on **#${channel.name}**`);
          } else {
            results.push(`Channel **#${channel.name}** already exists`);
          }
        } else {
          await guild.channels.create({
            name: channel.name,
            type: ChannelType.GuildText,
            topic: channel.topic,
            parent: channel.parent,
            permissionOverwrites: channel.permissions,
          });
          results.push(`Created channel **#${channel.name}**`);
        }
      } catch (err) {
        results.push(`Failed to create channel #${channel.name}: ${err}`);
      }
    }

    try {
      const verifyChannel = guild.channels.cache.find(
        (channel) => channel?.name === '🔓-verify',
      );
      if (verifyChannel instanceof TextChannel) {
        const posted = await this.postOnboardingEmbed(verifyChannel);
        results.push(
          posted
            ? 'Posted onboarding embed in #🔓-verify'
            : 'Onboarding embed already exists in #🔓-verify',
        );
      }
    } catch (err) {
      results.push(`Failed to post onboarding embed: ${err}`);
    }

    const embed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle('Server Setup Complete')
      .setDescription(
        results.map((result) => `- ${result}`).join('\n') +
          '\n\n**Important:** Make sure the bot role is at the TOP of the role hierarchy in Server Settings > Roles.',
      );

    await interaction.editReply({ embeds: [embed] });
    this.logger.log(
      `[setup-server] Completed by ${interaction.user.tag}: ${results.length} items`,
    );
  }

  async ensureVerifyChannel(client: Client): Promise<void> {
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!guildId) {
      this.logger.warn(
        '[welcome] DISCORD_GUILD_ID not set - skipping verify channel setup',
      );
      return;
    }

    try {
      const guild = await client.guilds.fetch(guildId);
      const channels = await guild.channels.fetch();
      const verifyChannel = channels.find(
        (channel) => channel?.name === '🔓-verify',
      );

      if (!(verifyChannel instanceof TextChannel)) {
        this.logger.log(
          '[welcome] #🔓-verify channel not found - skipping (run /setup-server first)',
        );
        return;
      }

      const posted = await this.postOnboardingEmbed(verifyChannel);
      this.logger.log(
        posted
          ? '[welcome] Posted onboarding message to #🔓-verify'
          : '[welcome] Onboarding message already exists in #🔓-verify',
      );
    } catch (err) {
      this.logger.warn(`[welcome] Could not setup verify channel: ${err}`);
    }
  }

  private async postOnboardingEmbed(channel: TextChannel): Promise<boolean> {
    const messages = await channel.messages.fetch({ limit: 20 });
    const existingBot = messages.find(
      (message) =>
        message.author.id === channel.client.user?.id &&
        message.embeds[0]?.title === 'Welcome to DevLoot',
    );
    if (existingBot) return false;

    const message = this.onboarding.buildOnboardingMessage();
    await channel.send(message);
    return true;
  }
}
