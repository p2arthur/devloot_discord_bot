import { Injectable, Logger } from '@nestjs/common';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, TextChannel } from 'discord.js';
import { PrismaService } from '../../prisma/prisma.service';
import { DiscordService } from '../discord.service';
import { AiService } from '../../ai/ai.service';
import axios from 'axios';

const ISSUE_URL_REGEX = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)$/;

@Injectable()
export class ProposeCommand {
  private readonly logger = new Logger(ProposeCommand.name);

  constructor(
    private prisma: PrismaService,
    private discordService: DiscordService,
    private aiService: AiService,
  ) {}

  async handle(interaction: any, message: string, issueUrl: string, bountyAmountUsdc: number, client: Client) {
    const match = issueUrl.match(ISSUE_URL_REGEX);
    if (!match) {
      await interaction.reply({
        content: 'Invalid issue URL. Format: https://github.com/{owner}/{repo}/issues/{number}',
        ephemeral: true,
      });
      return;
    }

    const [, owner, repo, issueNumberStr] = match;
    const issueNumber = parseInt(issueNumberStr);
    const discordId = interaction.user.id;

    // Rate limit: 10 per user per 24h
    const yesterday = new Date(Date.now() - 86400000);
    const recentProposals = await this.prisma.proposal.count({
      where: { proposerId: discordId, createdAt: { gte: yesterday } },
    });
    if (recentProposals >= 10) {
      await interaction.reply({
        content: 'You can only propose 10 issues per 24 hours.',
        ephemeral: true,
      });
      return;
    }

    // Server-wide rate limit: 10 per day
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayProposals = await this.prisma.proposal.count({
      where: { createdAt: { gte: today } },
    });
    if (todayProposals >= 10) {
      await interaction.reply({
        content: 'Daily proposal limit reached. Try again tomorrow.',
        ephemeral: true,
      });
      return;
    }

    // Check if same issue was already proposed in last 30 days
    const existingProposal = await this.prisma.proposal.findUnique({ where: { issueUrl } });
    if (existingProposal) {
      await interaction.reply({
        content: 'This issue was already proposed recently.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    // Fetch issue from GitHub
    let issueTitle: string;
    let issueBody = '';
    let issueLabels: string[] = [];
    try {
      const issueRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
        headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` },
      });

      if (issueRes.data.state !== 'open') {
        await interaction.editReply('This issue is closed. Only open issues can be proposed.');
        return;
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
      return;
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
      return;
    }

    // AI summary
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
      this.logger.warn(`[propose] AI summary failed for ${owner}/${repo}#${issueNumber}`);
    }

    // Save proposal to database
    const proposal = await this.prisma.proposal.create({
      data: {
        issueUrl,
        owner,
        repo,
        issueNumber,
        title: issueTitle,
        proposerId: discordId,
        aiAnalysis: aiSummary?.issueDescription ?? null,
        aiCachedAt: aiSummary ? new Date() : null,
      },
    });

    // Award XP
    await this.discordService.addProposalXp(discordId);

    // Assign Scout role on first proposal
    await this.discordService.assignScoutRole(discordId);

    // Build suggestions channel embed
    const suggestionsEmbed = new EmbedBuilder()
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
        suggestionsEmbed.addFields({
          name: 'About the Project',
          value: `> ${aiSummary.repoDescription}`,
          inline: false,
        });
      }
      if (aiSummary.issueDescription) {
        suggestionsEmbed.addFields({
          name: 'Why This Issue',
          value: `> ${aiSummary.issueDescription}`,
          inline: false,
        });
      }
      suggestionsEmbed.setFooter({ text: '⚡ AI-generated summary' });
    }

    suggestionsEmbed.setTimestamp();

    const frontendUrl = process.env.CLIENT_URL || 'https://devloot.app';
    const topUpUrl = `${frontendUrl}/bounty/new?issueUrl=${encodeURIComponent(issueUrl)}`;

    const topUpRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setLabel('Create Bounty').setStyle(ButtonStyle.Link).setURL(topUpUrl).setEmoji('💰'),
    );

    // Post to bounty suggestions channel
    const suggestionsChannelId = process.env.DISCORD_BOUNTY_SUGGESTIONS_CHANNEL_ID;
    let channelMessageId: string | null = null;
    if (suggestionsChannelId) {
      try {
        const channel = (await client.channels.fetch(suggestionsChannelId)) as TextChannel;
        if (channel && 'send' in channel) {
          const channelMsg = await channel.send({ embeds: [suggestionsEmbed], components: [topUpRow] });
          channelMessageId = channelMsg.id;
          // Add reactions for voting
          await channelMsg.react('👍');
          await channelMsg.react('👎');
          await channelMsg.react('💵');
        }
      } catch (err) {
        this.logger.warn(`[propose] Failed to post to suggestions channel: ${err}`);
      }
    }

    // Build ephemeral reply
    const replyEmbed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle(`Issue Proposed by @${interaction.user.displayName}`)
      .addFields(
        {
          name: 'Repository',
          value: `[${owner}/${repo}](https://github.com/${owner}/${repo})`,
          inline: false,
        },
        {
          name: 'Issue',
          value: `#${issueNumber}: "${issueTitle}"`,
          inline: false,
        },
        {
          name: 'Suggested Bounty',
          value: `**${bountyAmountUsdc.toFixed(2)} USDC**`,
          inline: true,
        },
      );

    await interaction.editReply({ embeds: [replyEmbed] });

    // Store channel message ID for vote tracking
    if (channelMessageId) {
      await this.prisma.proposal.update({
        where: { id: proposal.id },
        data: { messageId: channelMessageId },
      });
    }

    this.logger.log(`[propose] ${discordId} proposed ${owner}/${repo}#${issueNumber} (${bountyAmountUsdc} USDC)`);
  }
}
