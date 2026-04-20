/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import { EmbedBuilder, Colors, Client } from 'discord.js';
import { OnboardingCommand } from '../commands/onboarding';

@Injectable()
export class DiscordSetupService {
  private readonly logger = new Logger(DiscordSetupService.name);

  constructor(private readonly onboarding: OnboardingCommand) {}

  async handleSetupServer(interaction: any, client: Client): Promise<void> {
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
    const verifiedId = createdRoles['Verified'];

    const categories = [
      {
        name: '🚪 ONBOARDING',
        permissionOverwrites: [
          { id: everyoneId, allow: ['ViewChannel'], deny: ['SendMessages'] },
          { id: verifiedId, allow: ['ViewChannel', 'SendMessages'] },
        ],
      },
      {
        name: '🌍 COMMUNITY',
        permissionOverwrites: [
          { id: everyoneId, deny: ['ViewChannel'] },
          { id: verifiedId, allow: ['ViewChannel'] },
        ],
      },
      {
        name: '🎯 BOUNTIES',
        permissionOverwrites: [
          { id: everyoneId, deny: ['ViewChannel'] },
          { id: verifiedId, allow: ['ViewChannel'] },
        ],
      },
    ];

    const createdCategories: Record<string, string> = {};
    for (const catDef of categories) {
      try {
        const existing = guild.channels.cache.find(
          (c) => c?.name === catDef.name && c.type === 4,
        );
        if (existing) {
          createdCategories[catDef.name] = existing.id;
          results.push(`Category **${catDef.name}** already exists`);
        } else {
          const cat = await guild.channels.create({
            name: catDef.name,
            type: 4,
            permissionOverwrites: catDef.permissionOverwrites.map((p) => ({
              id: p.id,
              allow: p.allow,
              deny: p.deny,
            })),
          });
          createdCategories[catDef.name] = cat.id;
          results.push(`Created category **${catDef.name}**`);
        }
      } catch (err) {
        results.push(`Failed to create category ${catDef.name}: ${err}`);
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
            allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'],
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
            allow: ['ViewChannel', 'ReadMessageHistory'],
            deny: ['SendMessages'],
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
            allow: ['ViewChannel', 'ReadMessageHistory'],
            deny: ['SendMessages'],
          },
        ],
      },
      {
        name: '⚡-general',
        topic:
          'Talk open source, bounties, dev tools, or whatever. Builders+ can chat.',
        parent: createdCategories['🌍 COMMUNITY'],
        permissions: [
          { id: everyoneId, deny: ['ViewChannel'] },
          { id: verifiedId, allow: ['ViewChannel'] },
        ],
      },
      {
        name: '💡-proposals',
        topic:
          'Suggest open source issues worth funding. Use /propose — raw messages get cleaned up.',
        parent: createdCategories['🌍 COMMUNITY'],
        permissions: [
          { id: everyoneId, deny: ['ViewChannel'] },
          { id: verifiedId, allow: ['ViewChannel', 'SendMessages'] },
        ],
      },
      {
        name: '💰-feed',
        topic:
          'Live bounty feed — new bounties, claims, and payouts as they happen. devloot.xyz',
        parent: createdCategories['🎯 BOUNTIES'],
        permissions: [
          { id: everyoneId, deny: ['ViewChannel'] },
          { id: verifiedId, allow: ['ViewChannel', 'ReadMessageHistory'] },
        ],
      },
    ];

    for (const chDef of channels) {
      try {
        const existing = guild.channels.cache.find(
          (c) => c?.name === chDef.name,
        );
        if (existing) {
          if ('topic' in existing && existing.topic !== chDef.topic) {
            await existing.edit({ topic: chDef.topic });
            results.push(`Updated topic on **#${chDef.name}**`);
          } else {
            results.push(`Channel **#${chDef.name}** already exists`);
          }
        } else {
          const ch = await guild.channels.create({
            name: chDef.name,
            type: 0,
            topic: chDef.topic,
            parent: chDef.parent,
            permissionOverwrites: chDef.permissions.map((p) => ({
              id: p.id,
              allow: p.allow || [],
              deny: p.deny || [],
            })),
          });
          results.push(`Created channel **#${chDef.name}**`);
        }
      } catch (err) {
        results.push(`Failed to create channel #${chDef.name}: ${err}`);
      }
    }

    try {
      const verifyChannel = guild.channels.cache.find(
        (c) => c?.name === '🔓-verify',
      );
      if (verifyChannel && 'send' in verifyChannel) {
        const messages = await verifyChannel.messages.fetch({ limit: 20 });
        const existingEmbed = messages.find(
          (m) =>
            m.author.id === client.user?.id &&
            m.embeds[0]?.title === 'Welcome to DevLoot',
        );
        if (!existingEmbed) {
          const message = this.onboarding.buildOnboardingMessage();
          await verifyChannel.send(message);
          results.push('Posted onboarding embed in #🔓-verify');
        } else {
          results.push('Onboarding embed already exists in #🔓-verify');
        }
      }
    } catch (err) {
      results.push(`Failed to post onboarding embed: ${err}`);
    }

    const embed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle('Server Setup Complete')
      .setDescription(
        results.map((r) => `• ${r}`).join('\n') +
          '\n\n**Important:** Make sure the bot role is at the TOP of the role hierarchy in Server Settings > Roles.',
      );

    await interaction.editReply({ embeds: [embed] });
    this.logger.log(
      `[setup-server] Completed by ${interaction.user.tag}: ${results.length} items`,
    );
  }
}
