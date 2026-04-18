import { Injectable, Logger } from '@nestjs/common';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, TextChannel } from 'discord.js';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../../ai/ai.service';
import axios from 'axios';

const ISSUE_URL_REGEX = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)$/;

@Injectable()
export class SuggestionCommand {
  private readonly logger = new Logger(SuggestionCommand.name);

  constructor(
    private prisma: PrismaService,
    private aiService: AiService,
  ) {}

  async handle(interaction: any, message: string, issueUrl: string, bountyAmountUsdc: number, client: Client): Promise<boolean> {
    const match = issueUrl.match(ISSUE_URL_REGEX);
    if (!match) {
      await interaction.reply({
        content: 'Invalid issue URL. Format: https://github.com/{owner}/{repo}/issues/{number}',
        ephemeral: true,
      });
      return false;
    }

    const [, owner, repo, issueNumberStr] = match;
    const issueNumber = parseInt(issueNumberStr);
    const discordId = interaction.user.id;

    await interaction.deferReply({ ephemeral: true });

    // Check if the GitHub issue exists and is open
    let issueTitle: string;
    let issueBody = '';
    let issueLabels: string[] = [];
    try {
      const issueRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
        headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` },
      });

      if (issueRes.data.state !== 'open') {
        await interaction.editReply('This issue is closed. Only open issues can be suggested.');
        return false;
      }

      issueTitle = issueRes.data.title;
      issueBody = issueRes.data.body || '';
      issueLabels = (issueRes.data.labels || []).map((l: any) => (typeof l === 'string' ? l : l.name));
    } catch (err: any) {
      this.logger.warn(`GitHub API error for ${owner}/${repo}#${issueNumber}: ${err?.response?.status}`);
      if (err?.response?.status === 404) {
        await interaction.editReply('Issue not found on GitHub. Double-check the URL.');
      } else {
        await interaction.editReply('Failed to verify the issue on GitHub. Try again later.');
      }
      return false;
    }

    // Check if a bounty already exists and is open
    const existingBounty = await this.prisma.bounty.findUnique({
      where: { issueUrl },
    });

    if (existingBounty && !['CLAIMED', 'REFUNDED', 'CANCELLED'].includes(existingBounty.status)) {
      const bountyUrl = `${process.env.CLIENT_URL || 'https://devloot.app'}/bounty/${existingBounty.id}`;
      const embed = new EmbedBuilder()
        .setColor(0xf39c12)
        .setTitle('Bounty Already Exists')
        .setDescription(
          `There's already an **open bounty** for [${owner}/${repo}#${issueNumber}](${issueUrl}).\n\n` +
            `Top it up to increase the reward!`,
        )
        .addFields(
          { name: 'Issue', value: `#${issueNumber}: "${issueTitle}"`, inline: false },
          {
            name: 'Current Bounty',
            value: `${(existingBounty.amount / 1_000_000).toFixed(2)} USDC`,
            inline: true,
          },
          { name: 'Status', value: existingBounty.status, inline: true },
        );

      const topUpRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setLabel('TOP UP').setStyle(ButtonStyle.Link).setURL(bountyUrl).setEmoji('💰'),
      );

      await interaction.editReply({ embeds: [embed], components: [topUpRow] });
      return false;
    }

    // AI summary (graceful degradation if fails)
    let aiSummary: { repoDescription: string; issueDescription: string } | null = null;
    try {
      aiSummary = await this.aiService.generateSuggestionSummary({
        owner,
        repo,
        issueTitle,
        labels: issueLabels,
        issueBody,
      });
    } catch {
      this.logger.warn(`[suggestion] AI summary failed for ${owner}/${repo}#${issueNumber}`);
    }

    // Build the suggestion embed
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('Bounty Suggestion')
      .setAuthor({
        name: interaction.user.displayName,
        iconURL: interaction.user.displayAvatarURL(),
      })
      .setDescription(message)
      .addFields(
        {
          name: 'Repository',
          value: `[${owner}/${repo}](https://github.com/${owner}/${repo})`,
          inline: true,
        },
        {
          name: 'Suggested Amount',
          value: `**${bountyAmountUsdc.toFixed(2)} USDC**`,
          inline: true,
        },
        {
          name: 'Issue',
          value: `[#${issueNumber}: ${issueTitle}](${issueUrl})`,
          inline: false,
        },
      );

    if (aiSummary && (aiSummary.repoDescription || aiSummary.issueDescription)) {
      if (aiSummary.repoDescription) {
        embed.addFields({
          name: '📦 About the Project',
          value: `> ${aiSummary.repoDescription}`,
          inline: false,
        });
      }
      if (aiSummary.issueDescription) {
        embed.addFields({
          name: '🎯 Why This Issue',
          value: `> ${aiSummary.issueDescription}`,
          inline: false,
        });
      }
      embed.setFooter({ text: '⚡ AI-generated summary' });
    }

    embed.setTimestamp();

    const frontendUrl = process.env.CLIENT_URL || 'https://devloot.app';
    const bountyUrl = `${frontendUrl}/bounty/new?issueUrl=${encodeURIComponent(issueUrl)}`;

    const topUpRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setLabel('Create Bounty').setStyle(ButtonStyle.Link).setURL(bountyUrl).setEmoji('💰'),
    );

    // Post to the bounty-suggestions channel
    const suggestionsChannelId = process.env.DISCORD_BOUNTY_SUGGESTIONS_CHANNEL_ID;
    if (!suggestionsChannelId) {
      await interaction.editReply('Suggestions channel is not configured. Contact an admin.');
      return false;
    }

    try {
      const channel = (await client.channels.fetch(suggestionsChannelId)) as TextChannel;
      if (!channel || !('send' in channel)) {
        await interaction.editReply('Could not find the suggestions channel.');
        return false;
      }

      await channel.send({ embeds: [embed], components: [topUpRow] });
      await interaction.editReply(`Your suggestion for [${owner}/${repo}#${issueNumber}](${issueUrl}) has been posted!`);
      this.logger.log(`[suggestion] ${discordId} suggested ${owner}/${repo}#${issueNumber} (${bountyAmountUsdc} USDC)`);
      return true;
    } catch (err) {
      this.logger.error(`[suggestion] Failed to post to suggestions channel: ${err}`);
      await interaction.editReply('Failed to post your suggestion. Try again later.');
      return false;
    }
  }
}
