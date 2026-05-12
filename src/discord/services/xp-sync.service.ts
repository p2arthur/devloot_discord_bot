import { Injectable, Logger } from '@nestjs/common';
import { ChatInputCommandInteraction } from 'discord.js';
import { PrismaService } from '../../prisma/prisma.service';
import { DiscordXpService } from './discord-xp.service';

@Injectable()
export class XpSyncService {
  private readonly logger = new Logger(XpSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly xpService: DiscordXpService,
  ) {}

  async handleSyncPoints(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const createdBounties = await this.prisma.bounty.groupBy({
      by: ['creatorWallet'],
      _count: { id: true },
    });
    const claimedBounties = await this.prisma.bounty.groupBy({
      by: ['winnerId'],
      where: { status: 'CLAIMED', winnerId: { not: null } },
      _count: { id: true },
    });

    let usersUpdated = 0;
    let totalXpAwarded = 0;

    for (const group of createdBounties) {
      const user = await this.prisma.user.findFirst({
        where: { wallet: group.creatorWallet },
      });
      if (!user) continue;
      const xpFromCreations = group._count.id * 100;
      await this.xpService
        .addXpByUserId(user.id, xpFromCreations)
        .catch(() => undefined);
      usersUpdated++;
      totalXpAwarded += xpFromCreations;
    }

    for (const group of claimedBounties) {
      if (!group.winnerId) continue;
      const xpFromClaims = group._count.id * 200;
      await this.xpService
        .addXpByUserId(group.winnerId, xpFromClaims)
        .catch(() => undefined);
      usersUpdated++;
      totalXpAwarded += xpFromClaims;
    }

    await interaction.editReply(
      `Sync complete!\n� **${usersUpdated}** users updated\n� **${totalXpAwarded}** total XP awarded\n� ${createdBounties.length} creators, ${claimedBounties.length} claimers processed`,
    );
    this.logger.log(
      `[sync-points] Synced ${usersUpdated} users, ${totalXpAwarded} XP awarded`,
    );
  }
}
