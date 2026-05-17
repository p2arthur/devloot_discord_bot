import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { Client } from 'discord.js';
import { AiService } from '../../ai/ai.service';
import { AutoThreadingService } from './auto-threading.service';

interface DiscordMessageResponse {
  id?: string;
}

interface GitHubIssueResponse {
  title: string;
  body: string | null;
  labels: ({ name: string } | string)[];
}

@Injectable()
export class DiscordNotificationService implements OnModuleInit {
  private readonly logger = new Logger(DiscordNotificationService.name);
  private readonly botToken = process.env.DISCORD_BOT_TOKEN;
  private readonly channelId = process.env.DISCORD_BOUNTY_FEED_CHANNEL;

  constructor(
    private readonly aiService: AiService,
    private readonly threadingService: AutoThreadingService,
    @Inject('DISCORD_CLIENT') private readonly client: Client,
  ) {}

  private get isConfigured(): boolean {
    return !!(this.botToken && this.channelId);
  }

  onModuleInit() {
    this.logger.log(
      `Discord config — token present: ${!!this.botToken}, channelId: ${this.channelId ?? 'NOT SET'}`,
    );
    if (!this.isConfigured) {
      this.logger.warn(
        'Discord notifications are DISABLED — set DISCORD_BOT_TOKEN and DISCORD_BOUNTY_FEED_CHANNEL',
      );
    } else {
      this.logger.log('Discord notifications are ENABLED');
    }
  }

  private async sendMessage(content: string): Promise<void> {
    if (!this.isConfigured) {
      this.logger.warn('Discord not configured — skipping notification');
      return;
    }

    this.logger.debug(
      `Sending Discord message to channel ${this.channelId}: ${content.slice(0, 80)}`,
    );

    try {
      const response = await axios.post(
        `https://discord.com/api/v10/channels/${this.channelId}/messages`,
        { content },
        {
          headers: {
            Authorization: `Bot ${this.botToken}`,
            'Content-Type': 'application/json',
          },
        },
      );
      const data = response.data as DiscordMessageResponse;
      this.logger.log(
        `Discord message sent — status: ${response.status}, messageId: ${data.id}`,
      );
    } catch (err) {
      const e = err as AxiosError;
      this.logger.error(
        `Discord notification failed — status: ${e.response?.status}, body: ${JSON.stringify(e.response?.data)}, message: ${e.message}`,
      );
    }
  }

  notifyProjectCreated(projectName: string, category: string): void {
    void this.sendMessage(
      `🚀 **New project created:** **${projectName}** [${category}]`,
    );
  }

  private async sendEmbed(
    title: string,
    description: string,
    fields: { name: string; value: string; inline?: boolean }[],
    color: number,
  ): Promise<{ status: number; data?: DiscordMessageResponse } | null> {
    if (!this.isConfigured) {
      this.logger.warn('Discord not configured — skipping notification');
      return null;
    }

    try {
      const response = await axios.post<DiscordMessageResponse>(
        `https://discord.com/api/v10/channels/${this.channelId}/messages`,
        {
          embeds: [
            {
              title,
              description,
              fields,
              color,
              timestamp: new Date().toISOString(),
            },
          ],
        },
        {
          headers: {
            Authorization: `Bot ${this.botToken}`,
            'Content-Type': 'application/json',
          },
        },
      );
      this.logger.log(
        `Discord embed sent — status: ${response.status}, messageId: ${response.data.id}`,
      );
      return { status: response.status, data: response.data };
    } catch (err) {
      const e = err as AxiosError;
      this.logger.error(
        `Discord embed failed — status: ${e.response?.status}, body: ${JSON.stringify(e.response?.data)}, message: ${e.message}`,
      );
      return null;
    }
  }

  async notifyBountyCreated(
    issueUrl: string,
    currencyAmount: number,
    creatorWallet: string,
  ): Promise<void> {
    const amount = (currencyAmount / 1_000_000).toFixed(2);

    const match = issueUrl.match(
      /github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/,
    );
    if (!match) {
      await this.sendMessage(
        `🎯 **New bounty:** ${issueUrl}\n💰 **${amount} USDC** — created by \`${creatorWallet}\``,
      );
      return;
    }

    const [, owner, repo, issueNumberStr] = match;
    const issueNumber = parseInt(issueNumberStr);

    let issueTitle = '';
    let aiSummary: {
      repoDescription: string;
      issueDescription: string;
    } | null = null;

    try {
      const issueRes = await axios.get<GitHubIssueResponse>(
        `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`,
        {
          headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` },
        },
      );
      issueTitle = issueRes.data.title;
      const issueBody = issueRes.data.body ?? '';
      const issueLabels = (issueRes.data.labels ?? []).map((l) =>
        typeof l === 'string' ? l : l.name,
      );

      aiSummary = await this.aiService.generateSuggestionSummary({
        owner,
        repo,
        issueTitle,
        labels: issueLabels,
        issueBody,
      });
    } catch (err) {
      this.logger.warn(
        `[bounty-feed] Failed to fetch issue or generate AI summary: ${err}`,
      );
    }

    const fields: { name: string; value: string; inline?: boolean }[] = [
      {
        name: 'Issue',
        value: issueTitle
          ? `[#${issueNumber}: ${issueTitle}](${issueUrl})`
          : `[#${issueNumber}](${issueUrl})`,
        inline: false,
      },
      { name: 'Bounty', value: `**${amount} USDC**`, inline: true },
      { name: 'Creator', value: `\`${creatorWallet}\``, inline: true },
    ];

    if (aiSummary?.repoDescription) {
      fields.push({
        name: '📦 About the Project',
        value: `> ${aiSummary.repoDescription}`,
        inline: false,
      });
    }
    if (aiSummary?.issueDescription) {
      fields.push({
        name: '🎯 Why This Issue',
        value: `> ${aiSummary.issueDescription}`,
        inline: false,
      });
    }

    const response = await this.sendEmbed(
      '🎯 New Bounty Created',
      `[${owner}/${repo}](https://github.com/${owner}/${repo})`,
      fields,
      0x2ecc71,
    );

    // Create auto-thread for bounty discussion
    if (response?.data?.id && this.channelId) {
      await this.threadingService.createBountyThread(
        this.client,
        this.channelId,
        response.data.id,
        issueTitle || `#${issueNumber}`,
      );
    }
  }

  notifyBountyClaimed(
    bountyId: number,
    issueUrl: string,
    winnerWallet: string,
  ): void {
    void this.sendMessage(
      `✅ **Bounty claimed:** [#${bountyId}](${issueUrl})\n🏆 Winner: \`${winnerWallet}\``,
    );
  }

  notifyBountyDisputed(
    bountyId: number,
    issueUrl: string,
    reason: string,
  ): void {
    void this.sendMessage(
      `⚠️ **Bounty disputed:** [#${bountyId}](${issueUrl})\n📝 Reason: ${reason}`,
    );
  }

  notifyBountyApproved(
    bountyId: number,
    issueUrl: string,
    winnerWallet: string,
  ): void {
    void this.sendMessage(
      `👍 **Bounty approved:** [#${bountyId}](${issueUrl})\n🏆 Winner \`${winnerWallet}\` is ready to claim`,
    );
  }

  notifyBountyToppedUp(
    bountyId: number,
    issueUrl: string,
    addedCurrencyAmount: number,
    totalCurrencyAmount: number,
  ): void {
    const added = (addedCurrencyAmount / 1_000_000).toFixed(2);
    const total = (totalCurrencyAmount / 1_000_000).toFixed(2);
    void this.sendMessage(
      `💸 **Bounty topped up:** [#${bountyId}](${issueUrl})\n+${added} USDC → total **${total} USDC**`,
    );
  }
}
