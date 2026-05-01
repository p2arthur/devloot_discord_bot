import { Injectable, Logger } from '@nestjs/common';
import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { PrismaService } from '../../prisma/prisma.service';
import { DiscordXpService } from '../services/discord-xp.service';

export const QUEST_POOL = [
  {
    id: 'bounty_proposal',
    name: 'Propose a bounty in #bounty-proposal',
    xp: 25,
    type: 'engagement',
    channelId: '1493523305456468139',
  },
];

@Injectable()
export class QuestCommand {
  private readonly logger = new Logger(QuestCommand.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly xpService: DiscordXpService,
  ) {}

  async handle(interaction: ChatInputCommandInteraction): Promise<void> {
    const discordId = interaction.user.id;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const completed = await this.prisma.questCompletion.findMany({
      where: { userId: discordId, date: { gte: today } },
    });

    const completedTypes = completed.map((entry) => entry.questType);

    const embed = new EmbedBuilder()
      .setTitle("Today's Quest")
      .setDescription(
        'Post a bounty proposal to earn XP! Quest completes automatically when you post in the channel.',
      )
      .setColor(0xf1c40f);

    for (const quest of QUEST_POOL) {
      const done = completedTypes.includes(quest.id);
      embed.addFields({
        name: `${done ? '✅' : '⬜'} ${quest.name}`,
        value: done ? 'Completed!' : `+${quest.xp} XP`,
        inline: false,
      });
    }

    if (completedTypes.length >= QUEST_POOL.length) {
      embed.setFooter({
        text: 'All quests completed for today! Come back tomorrow.',
      });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  async autoCompleteQuest(discordId: string, questType: string): Promise<void> {
    const quest = QUEST_POOL.find((entry) => entry.id === questType);
    if (!quest) return;

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const existing = await this.prisma.questCompletion.findUnique({
      where: {
        userId_questType_date: { userId: discordId, questType, date: today },
      },
    });

    if (existing) return;

    await this.prisma.questCompletion.create({
      data: { userId: discordId, questType, date: today },
    });
    await this.xpService.addXp(discordId, quest.xp);

    this.logger.log(
      `[quest] Auto-completed ${questType} for ${discordId} (+${quest.xp} XP)`,
    );
  }
}
