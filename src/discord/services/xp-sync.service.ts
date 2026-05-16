import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DiscordXpService } from './discord-xp.service';

@Injectable()
export class XpSyncService {
  private readonly logger = new Logger(XpSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly xpService: DiscordXpService,
  ) {}

  async syncPoints(): Promise<{
    usersUpdated: number;
    totalXpAwarded: number;
  }> {
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

      const xp = group._count.id * 100;
      await this.xpService.addXpByUserId(user.id, xp);
      usersUpdated++;
      totalXpAwarded += xp;
    }

    for (const group of claimedBounties) {
      const user = await this.prisma.user.findFirst({
        where: { id: group.winnerId! },
      });
      if (!user || !user.discordId) continue;

      const xp = group._count.id * 200;
      await this.xpService.addXp(user.discordId, xp);
      usersUpdated++;
      totalXpAwarded += xp;
    }

    this.logger.log(
      `[sync-points] Synced ${usersUpdated} users, ${totalXpAwarded} XP awarded — ` +
        `• ${createdBounties.length} creators, ${claimedBounties.length} claimers processed`,
    );

    return { usersUpdated, totalXpAwarded };
  }
}
