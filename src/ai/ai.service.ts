import { Injectable } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class AiService {
  private readonly apiKey = process.env.OPENROUTER_API_KEY;
  private readonly model = 'xiaomi/mimo-v2-flash';
  private readonly baseUrl = 'https://openrouter.ai/api/v1/chat/completions';

  async analyzeProposal(data: {
    owner: string;
    repo: string;
    stars: number;
    forks: number;
    language: string;
    issueNumber: number;
    issueTitle: string;
    labels: string[];
    ageDays: number;
    commentCount: number;
    issueBody: string;
  }): Promise<string> {
    const prompt = `Analyze this GitHub issue for an open source bounty platform.

Repository: ${data.owner}/${data.repo}
Stars: ${data.stars} | Forks: ${data.forks} | Language: ${data.language}
Recent commits (30d): 47

Issue #${data.issueNumber}: "${data.issueTitle}"
Labels: ${data.labels.join(', ')}
Age: ${data.ageDays} days | Comments: ${data.commentCount}
Body: ${data.issueBody.substring(0, 500)}

Provide:
1. 2-3 paragraphs explaining the issue's significance and ecosystem impact
2. Difficulty estimate (Easy/Medium/Hard) with reasoning
3. Suggested USDC bounty range
4. Key technical considerations for potential solvers`;

    const response = await axios.post(
      this.baseUrl,
      {
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 800,
      },
      { headers: { Authorization: `Bearer ${this.apiKey}` } },
    );

    return response.data.choices[0].message.content;
  }

  async generateSuggestionSummary(data: {
    owner: string;
    repo: string;
    issueTitle: string;
    labels: string[];
    issueBody: string;
  }): Promise<{ repoDescription: string; issueDescription: string }> {
    const prompt = `You are writing a brief summary for a Discord bounty embed. Return exactly two short paragraphs separated by |||.

Repository: ${data.owner}/${data.repo}
Issue: "${data.issueTitle}"
Labels: ${data.labels.join(', ') || 'none'}
Description: ${data.issueBody.substring(0, 400) || 'No description provided.'}

Format your response as:
PARAGRAPH 1: One sentence about what this project/repo does.
|||
PARAGRAPH 2: One sentence about why this specific issue matters or what it solves.

Be direct. No preamble. No markdown.`;

    const response = await axios.post(
      this.baseUrl,
      {
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
      },
      { headers: { Authorization: `Bearer ${this.apiKey}` } },
    );

    const raw = response.data.choices[0].message.content;
    const parts = raw.split('|||').map((s: string) => s.trim());
    return {
      repoDescription: parts[0] || raw,
      issueDescription: parts[1] || '',
    };
  }

  async generateWeeklyDigest(data: {
    topContributors: { name: string; xp: number }[];
    topProposals: { title: string; upvotes: number }[];
    totalProposals: number;
    totalVotes: number;
    bountiesCompleted: number;
  }): Promise<string> {
    const prompt = `Generate a 3-4 sentence weekly summary for a Discord community digest.

Top contributors: ${data.topContributors.map((c) => `${c.name} (${c.xp} XP)`).join(', ')}
Top proposals: ${data.topProposals.map((p) => `${p.title} (${p.upvotes})`)}
Stats: ${data.totalProposals} proposals, ${data.totalVotes} votes, ${data.bountiesCompleted} bounties completed.

Keep it concise, enthusiastic, and focused on community momentum.`;

    const response = await axios.post(
      this.baseUrl,
      {
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
      },
      { headers: { Authorization: `Bearer ${this.apiKey}` } },
    );

    return response.data.choices[0].message.content;
  }
}
