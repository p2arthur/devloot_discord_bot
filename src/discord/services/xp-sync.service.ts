import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DiscordXpService } from './discord-xp.service';

export interface XpSyncResult {
  synced: number;
  totalXpAwarded: number;
}

@Injectable()
export class XpSyncService {
  private readonly logger = new Logger(XpSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly xpService: DiscordXpService,
  ) {}

  /**
   * Sync XP from bounty activity for a given Discord user.
   * Awards XP for each bounty the user has created or completed.
   */
  async syncFromBountyActivity(discordId: string): Promise<XpSyncResult> {
    const user = await this.prisma.user.findUnique({
      where: { discordId },
    });

    if (!user) {
      this.logger.debug(
        `[xp-sync] User ${discordId} not found — skipping sync`,
      );
      return { synced: 0, totalXpAwarded: 0 };
    }

    let totalXpAwarded = 0;
    let synced = 0;

    // Check for unsynced bounty completions
    const completedBounties = await this.prisma.bounty.findMany({
      where: {
        creatorWallet: user.wallet ?? undefined,
        status: 'COMPLETED',
        xpSynced: false,
      },
    });

    for (const bounty of completedBounties) {
      const XP_PER_BOUNTY = 50;
      await this.xpService.addXpByUserId(user.id, XP_PER_BOUNTY);
      await this.prisma.bounty.update({
        where: { id: bounty.id },
        data: { xpSynced: true },
      });
      totalXpAwarded += XP_PER_BOUNTY;
      synced++;
    }

    this.logger.log(
      `[xp-sync] Synced ${synced} bounties for ${discordId} — awarded ${totalXpAwarded} XP`,
    );

    return { synced, totalXpAwarded };
  }

  /**
   * Sync XP for all users with pending bounty activity.
   * Called from admin commands or scheduled jobs.
   */
  async syncAllPendingBountyXp(): Promise<XpSyncResult> {
    const pendingBounties = await this.prisma.bounty.findMany({
      where: {
        status: 'COMPLETED',
        xpSynced: false,
        creatorWallet: { not: null },
      },
      include: {
        creator: true,
      },
    });

    let totalXpAwarded = 0;
    let synced = 0;

    for (const bounty of pendingBounties) {
      if (!bounty.creator) continue;

      const XP_PER_BOUNTY = 50;
      await this.xpService.addXpByUserId(bounty.creator.id, XP_PER_BOUNTY);
      await this.prisma.bounty.update({
        where: { id: bounty.id },
        data: { xpSynced: true },
      });
      totalXpAwarded += XP_PER_BOUNTY;
      synced++;
    }

    this.logger.log(
      `[xp-sync] Global sync — ${synced} bounties, ${totalXpAwarded} XP awarded`,
    );

    return { synced, totalXpAwarded };
  }
}