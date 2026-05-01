import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import { AiService } from '../../ai/ai.service';
import { DiscordThreadService } from './discord-thread.service';

interface GitHubLabelRecord {
  name?: string;
}

interface GitHubIssueResponse {
  title?: string;
  body?: string;
  labels?: Array<string | GitHubLabelRecord>;
}

@Injectable()
export class DiscordNotificationService implements OnModuleInit {
  private readonly logger = new Logger(DiscordNotificationService.name);
  private readonly botToken = process.env.DISCORD_BOT_TOKEN;
  private readonly channelId = process.env.DISCORD_BOUNTY_FEED_CHANNEL;

  constructor(
    private readonly aiService: AiService,
    private readonly threadService: DiscordThreadService,
  ) {}

  private get isConfigured(): boolean {
    return !!(this.botToken && this.channelId);
  }

  onModuleInit(): void {
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

  private async postMessage(payload: unknown): Promise<string | null> {
    if (!this.isConfigured) {
      this.logger.warn('Discord not configured — skipping notification');
      return null;
    }

    try {
      const response = await axios.post(
        `https://discord.com/api/v10/channels/${this.channelId}/messages`,
        payload,
        {
          headers: {
            Authorization: `Bot ${this.botToken}`,
            'Content-Type': 'application/json',
          },
        },
      );
      this.logger.log(
        `Discord message sent — status: ${response.status}, messageId: ${response.data?.id}`,
      );
      return response.data?.id ?? null;
    } catch (err) {
      this.logger.error(
        `Discord notification failed — status: ${axios.isAxiosError(err) ? err.response?.status : 'unknown'}, body: ${axios.isAxiosError(err) ? JSON.stringify(err.response?.data) : 'unknown'}, message: ${this.describeError(err)}`,
      );
      return null;
    }
  }

  private async postFeedMessage(
    payload: unknown,
    threadName?: string,
  ): Promise<void> {
    const messageId = await this.postMessage(payload);
    if (messageId && threadName) {
      await this.threadService.createThreadFromMessage({
        channelId: this.channelId ?? '',
        messageId,
        name: threadName,
        reason: 'DevLoot bounty feed auto-thread',
      });
    }
  }

  notifyProjectCreated(projectName: string, category: string): void {
    void this.postMessage(
      `🚀 **New project created:** **${projectName}** [${category}]`,
    );
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
      await this.postFeedMessage(
        `🎯 **New bounty:** ${issueUrl}\n💰 **${amount} USDC** — created by \`${creatorWallet}\``,
        'bounty discussion',
      );
      return;
    }

    const [, owner, repo, issueNumberStr] = match;
    const issueNumber = Number.parseInt(issueNumberStr, 10);

    let issueTitle = '';
    let aiSummary: { repoDescription: string; issueDescription: string } | null = null;

    try {
      const issueRes = await axios.get<GitHubIssueResponse>(
        `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`,
        {
          headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` },
        },
      );
      issueTitle = issueRes.data.title || '';
      const issueBody = issueRes.data.body || '';
      const issueLabels = (issueRes.data.labels || [])
        .map((label) => (typeof label === 'string' ? label : label.name || ''))
        .filter(Boolean);

      aiSummary = await this.aiService.generateSuggestionSummary({
        owner,
        repo,
        issueTitle,
        labels: issueLabels,
        issueBody,
      });
    } catch (err) {
      this.logger.warn(
        `[bounty-feed] Failed to fetch issue or generate AI summary: ${this.describeError(err)}`,
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

    await this.postFeedMessage(
      {
        embeds: [
          {
            title: '🎯 New Bounty Created',
            description: `[${owner}/${repo}](https://github.com/${owner}/${repo})`,
            fields,
            color: 0x2ecc71,
            timestamp: new Date().toISOString(),
          },
        ],
      },
      `bounty-${issueNumber}`,
    );
  }

  notifyBountyClaimed(
    bountyId: number,
    issueUrl: string,
    winnerWallet: string,
  ): void {
    void this.postFeedMessage(
      `✅ **Bounty claimed:** [#${bountyId}](${issueUrl})\n🏆 Winner: \`${winnerWallet}\``,
      `bounty-${bountyId}`,
    );
  }

  notifyBountyDisputed(
    bountyId: number,
    issueUrl: string,
    reason: string,
  ): void {
    void this.postFeedMessage(
      `⚠️ **Bounty disputed:** [#${bountyId}](${issueUrl})\n📝 Reason: ${reason}`,
      `bounty-${bountyId}`,
    );
  }

  notifyBountyApproved(
    bountyId: number,
    issueUrl: string,
    winnerWallet: string,
  ): void {
    void this.postFeedMessage(
      `👍 **Bounty approved:** [#${bountyId}](${issueUrl})\n🏆 Winner \`${winnerWallet}\` is ready to claim`,
      `bounty-${bountyId}`,
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
    void this.postFeedMessage(
      `💸 **Bounty topped up:** [#${bountyId}](${issueUrl})\n+${added} USDC → total **${total} USDC**`,
      `bounty-${bountyId}`,
    );
  }

  private describeError(err: unknown): string {
    if (typeof err === 'object' && err && 'message' in err) {
      return String((err as { message?: unknown }).message ?? err);
    }
    return String(err);
  }
}
