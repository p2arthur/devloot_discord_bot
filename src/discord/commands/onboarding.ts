import { Injectable } from '@nestjs/common';
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';

@Injectable()
export class OnboardingCommand {
  buildOnboardingMessage(discordId?: string) {
    const frontendUrl = process.env.CLIENT_URL || 'https://devloot.app';
    const connectUrl = discordId
      ? `${frontendUrl}/connect?discord_id=${discordId}`
      : `${frontendUrl}/connect`;

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('Welcome to DevLoot')
      .setDescription(
        'Connect your GitHub to unlock the full server and start earning.\n\n' +
          '**How it works:**\n' +
          '1. Click **Link GitHub** — sign in with your GitHub account\n' +
          '2. Come back here and click **Verify**\n' +
          '3. Earn **100 XP** and unlock all channels\n\n' +
          'Already linked? Just click Verify.',
      )
      .setFooter({ text: 'Open source bounties on Algorand' });

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('Link GitHub')
        .setStyle(ButtonStyle.Link)
        .setURL(connectUrl),
      new ButtonBuilder()
        .setCustomId('onboarding-verify')
        .setLabel('Verify')
        .setStyle(ButtonStyle.Success),
    );

    return { embeds: [embed], components: [buttons] };
  }

  async handle(interaction: any) {
    const message = this.buildOnboardingMessage(interaction.user.id);
    await interaction.reply({ ...message, flags: MessageFlags.Ephemeral });
  }
}
