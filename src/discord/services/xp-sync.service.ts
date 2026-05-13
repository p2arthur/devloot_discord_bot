import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DiscordXpService } from './discord-xp.service';

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

@Injectable()
export class XpSyncService {
  private readonly logger = new Logger(XpSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly xpService: DiscordXpService,
  ) {}

  async syncBountyActivity(): Promise<{
    usersUpdated: number;
    totalXpAwarded: number;
    creators: number;
    claimers: number;
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

      const xpFromCreations = group._count.id * 100;
      await this.xpService
        .addXpByUserId(user.id, xpFromCreations)
        .catch((err: unknown) =>
          this.logger.warn(
            `[sync-points] Failed to award creation XP to user#${user.id}: ${describeError(err)}`,
          ),
        );
      usersUpdated++;
      totalXpAwarded += xpFromCreations;
    }

    for (const group of claimedBounties) {
      if (!group.winnerId) continue;

      const xpFromClaims = group._count.id * 200;
      await this.xpService
        .addXpByUserId(group.winnerId, xpFromClaims)
        .catch((err: unknown) =>
          this.logger.warn(
            `[sync-points] Failed to award claim XP to user#${group.winnerId}: ${describeError(err)}`,
          ),
        );
      usersUpdated++;
      totalXpAwarded += xpFromClaims;
    }

    this.logger.log(
      `[sync-points] Synced ${usersUpdated} users, ${totalXpAwarded} XP awarded`,
    );

    return {
      usersUpdated,
      totalXpAwarded,
      creators: createdBounties.length,
      claimers: claimedBounties.length,
    };
  }
}
