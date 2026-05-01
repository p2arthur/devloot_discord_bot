import { Injectable, Logger } from '@nestjs/common';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
} from 'discord.js';
import axios from 'axios';
import { PrismaService } from '../../prisma/prisma.service';
import { DiscordXpService } from '../services/discord-xp.service';
import { DiscordRoleService } from '../services/discord-role.service';
import { AiService } from '../../ai/ai.service';
import { DiscordThreadService } from '../services/discord-thread.service';

interface GitHubLabelRecord {
  name?: string;
}

interface GitHubIssueResponse {
  state?: string;
  title?: string;
  body?: string;
  labels?: Array<string | GitHubLabelRecord>;
}

const ISSUE_URL_REGEX =
  /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)$/;

@Injectable()
export class ProposeCommand {
  private readonly logger = new Logger(ProposeCommand.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly xpService: DiscordXpService,
    private readonly roleService: DiscordRoleService,
    private readonly aiService: AiService,
    private readonly threadService: DiscordThreadService,
  ) {}

  async handle(
    interaction: ChatInputCommandInteraction,
    message: string,
    issueUrl: string,
    bountyAmountUsdc: number,
    client: Client,
  ): Promise<void> {
    const match = issueUrl.match(ISSUE_URL_REGEX);
    if (!match) {
      await interaction.reply({
        content:
          'Invalid issue URL. Format: https://github.com/{owner}/{repo}/issues/{number}',
        ephemeral: true,
      });
      return;
    }

    const [, owner, repo, issueNumberStr] = match;
    const issueNumber = Number.parseInt(issueNumberStr, 10);
    const discordId = interaction.user.id;

    const yesterday = new Date(Date.now() - 86_400_000);
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

    const existingProposal = await this.prisma.proposal.findUnique({
      where: { issueUrl },
    });
    if (existingProposal) {
      await interaction.reply({
        content: 'This issue was already proposed recently.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    let issueTitle = '';
    let issueBody = '';
    let issueLabels: string[] = [];
    try {
      const issueRes = await axios.get<GitHubIssueResponse>(
        `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`,
        {
          headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` },
        },
      );

      if (issueRes.data.state !== 'open') {
        await interaction.editReply(
          'This issue is closed. Only open issues can be proposed.',
        );
        return;
      }

      issueTitle = issueRes.data.title ?? '';
      issueBody = issueRes.data.body ?? '';
      issueLabels = (issueRes.data.labels || [])
        .map((label) => (typeof label === 'string' ? label : label.name ?? ''))
        .filter(Boolean);
    } catch (err) {
      this.logger.warn(
        `GitHub API error for ${owner}/${repo}#${issueNumber}: ${this.describeError(err)}`,
      );
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        await interaction.editReply(
          'Issue not found on GitHub. Double-check the URL.',
        );
      } else {
        await interaction.editReply(
          'Failed to verify the issue on GitHub. Try again later.',
        );
      }
      return;
    }

    const existingBounty = await this.prisma.bounty.findUnique({
      where: { issueUrl },
    });

    if (
      existingBounty &&
      !['CLAIMED', 'REFUNDED', 'CANCELLED'].includes(existingBounty.status)
    ) {
      const bountyUrl = `${process.env.CLIENT_URL || 'https://devloot.app'}/bounty/${existingBounty.id}`;
      const embed = new EmbedBuilder()
        .setColor(0xf39c12)
        .setTitle('Bounty Already Exists')
        .setDescription(
          `There's already an **open bounty** for [${owner}/${repo}#${issueNumber}](${issueUrl}).\n\n` +
            `Top it up to increase the reward!`,
        )
        .addFields(
          {
            name: 'Issue',
            value: `#${issueNumber}: "${issueTitle}"`,
            inline: false,
          },
          {
            name: 'Current Bounty',
            value: `${(existingBounty.amount / 1_000_000).toFixed(2)} USDC`,
            inline: true,
          },
          { name: 'Status', value: existingBounty.status, inline: true },
        );

      const topUpRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel('TOP UP')
          .setStyle(ButtonStyle.Link)
          .setURL(bountyUrl)
          .setEmoji('💰'),
      );

      await interaction.editReply({ embeds: [embed], components: [topUpRow] });
      return;
    }

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
      this.logger.warn(
        `[propose] AI summary failed for ${owner}/${repo}#${issueNumber}`,
      );
    }

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

    await this.xpService.addProposalXp(discordId);
    await this.roleService.assignScoutRole(discordId);

    const displayName = interaction.member && 'displayName' in interaction.member
      ? interaction.member.displayName
      : interaction.user.username;
    const suggestionsEmbed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('Bounty Suggestion')
      .setAuthor({
        name: displayName,
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

    if (aiSummary?.repoDescription || aiSummary?.issueDescription) {
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
      suggestionsEmbed.setFooter({ text: 'AI-generated summary' });
    }

    suggestionsEmbed.setTimestamp();

    const frontendUrl = process.env.CLIENT_URL || 'https://devloot.app';
    const topUpUrl = `${frontendUrl}/bounty/new?issueUrl=${encodeURIComponent(issueUrl)}`;

    const topUpRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('Create Bounty')
        .setStyle(ButtonStyle.Link)
        .setURL(topUpUrl)
        .setEmoji('💰'),
    );

    const suggestionsChannelId = process.env.DISCORD_BOUNTY_SUGGESTIONS_CHANNEL_ID;
    let channelMessageId: string | null = null;
    let threadCreated = false;
    if (suggestionsChannelId) {
      try {
        const channel = await client.channels.fetch(suggestionsChannelId);
        if (channel && 'send' in channel) {
          const channelMsg = await channel.send({
            embeds: [suggestionsEmbed],
            components: [topUpRow],
          });
          channelMessageId = channelMsg.id;
          await channelMsg.react('👍');
          await channelMsg.react('👎');
          await channelMsg.react('💵');

          threadCreated = await this.threadService.createThreadFromMessage({
            channelId: suggestionsChannelId,
            messageId: channelMsg.id,
            name: `proposal-${issueNumber}-${issueTitle || repo}`,
            reason: 'DevLoot proposal discussion thread',
          });
        }
      } catch (err) {
        this.logger.warn(
          `[propose] Failed to post to suggestions channel: ${this.describeError(err)}`,
        );
      }
    }

    const replyEmbed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle(`Issue Proposed by ${displayName}`)
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

    if (channelMessageId) {
      await this.prisma.proposal.update({
        where: { id: proposal.id },
        data: {
          messageId: channelMessageId,
          threadCreated,
        },
      });
    }

    this.logger.log(
      `[propose] ${discordId} proposed ${owner}/${repo}#${issueNumber} (${bountyAmountUsdc} USDC)`,
    );
  }

  private describeError(err: unknown): string {
    if (typeof err === 'object' && err && 'message' in err) {
      return String((err as { message?: unknown }).message ?? err);
    }
    return String(err);
  }
}
